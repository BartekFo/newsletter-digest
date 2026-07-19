import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';

import type { chatWithArticle, ChatMessage } from './chatModel.js';
import { loadConfig } from './config.js';
import type { NewsletterRefresh } from './digest.js';
import { digestMetaFromSnapshot } from './digestMeta.js';
import { createApplication } from './composition.js';
import { createLogger, silentLogger } from './logger.js';
import { openExternal } from './openExternal.js';
import {
  renderArchivePage,
  renderDigestPage,
  renderNewsletterPage,
  renderRunsPage,
  type ArchiveFilterValues,
} from './render.js';
import {
  type ArchiveCriteria,
  type DigestArchive,
  type DigestSnapshot,
} from './store.js';
import type { AppConfig, AppLogger, DigestItem, NewsletterSource, ResolvedSourceLink } from './types.js';

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// A local 12B model can need more than a minute to load and answer from a full article.
export const CHAT_TIMEOUT_MS = 5 * 60_000;

class ChatTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Ollama nie odpowiedziała w ciągu ${Math.round(timeoutMs / 1_000)} sekund.`);
    this.name = 'ChatTimeoutError';
  }
}

async function withChatTimeout<T>(task: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  const timeoutTask = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new ChatTimeoutError(timeoutMs)), timeoutMs);
  });

  try {
    return await Promise.race([task, timeoutTask]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function sendHtml(res: ServerResponse, statusCode: number, html: string): void {
  res.writeHead(statusCode, { 'content-type': 'text/html; charset=utf-8' });
  res.end(html);
}

function sendJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  res.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function redirect(res: ServerResponse, location: string): void {
  res.writeHead(303, { location });
  res.end();
}

function currentIso(): string {
  return new Date().toISOString();
}

function noticeFromUrl(url: URL): { notice?: string; error?: string } {
  const notice = url.searchParams.get('notice');
  const error = url.searchParams.get('error');
  return {
    ...(notice ? { notice } : {}),
    ...(error ? { error } : {}),
  };
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  let body = '';

  for await (const chunk of req) {
    body += String(chunk);
    if (body.length > 1_000_000) throw new Error('Payload is too large');
  }

  if (!body.trim()) return {};
  return JSON.parse(body);
}

function isChatHistory(value: unknown): value is ChatMessage[] {
  if (value == null) return true;
  if (!Array.isArray(value)) return false;
  return value.every((message) => {
    if (!message || typeof message !== 'object') return false;
    const candidate = message as Record<string, unknown>;
    return (
      (candidate.role === 'user' || candidate.role === 'assistant') &&
      typeof candidate.content === 'string'
    );
  });
}

export interface ReaderServerDeps {
  archive: DigestArchive;
  config: AppConfig;
  logger?: AppLogger;
  refresh?: NewsletterRefresh;
  chatWithArticle: typeof chatWithArticle;
  chatTimeoutMs?: number;
  resolveSourceLink?(source: NewsletterSource): ResolvedSourceLink | null;
}

function renderSnapshot(
  snapshot: DigestSnapshot,
  resolveSourceLink: ReaderServerDeps['resolveSourceLink'],
  extras: { notice?: string; error?: string } = {},
): string {
  return renderDigestPage(snapshot.items, {
    ...digestMetaFromSnapshot(snapshot, resolveSourceLink),
    ...extras,
  });
}

function renderEmpty(extras: { notice?: string; error?: string } = {}): string {
  return renderDigestPage([], {
    ranAt: currentIso(),
    newCount: 0,
    ...extras,
  });
}

function isCalendarDate(value: string): boolean {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match?.[1] || !match[2] || !match[3]) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function nextCalendarDate(value: string): string {
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return [next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate()]
    .map((part, index) => index === 0 ? String(part) : String(part).padStart(2, '0'))
    .join('-');
}

function warsawMidnightIso(value: string): string {
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  const desiredLocalEpoch = Date.UTC(year, month - 1, day);
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Warsaw',
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  let instant = desiredLocalEpoch;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(instant)).map((part) => [part.type, part.value]));
    const representedLocalEpoch = Date.UTC(
      Number(parts.year), Number(parts.month) - 1, Number(parts.day),
      Number(parts.hour), Number(parts.minute), Number(parts.second),
    );
    instant += desiredLocalEpoch - representedLocalEpoch;
  }
  return new Date(instant).toISOString();
}

type ParsedArchiveRequest =
  | { criteria: ArchiveCriteria; filters: ArchiveFilterValues }
  | { error: string; filters: ArchiveFilterValues };

function parseArchiveRequest(url: URL): ParsedArchiveRequest {
  const rawPage = url.searchParams.get('page') ?? '1';
  const query = url.searchParams.get('q')?.trim() || undefined;
  const sender = url.searchParams.get('sender')?.trim() || undefined;
  const from = url.searchParams.get('from')?.trim() || undefined;
  const to = url.searchParams.get('to')?.trim() || undefined;
  const rawPaywall = url.searchParams.get('paywall')?.trim() || undefined;
  const rawSummary = url.searchParams.get('summary')?.trim() || undefined;
  const filters: ArchiveFilterValues = {
    ...(query ? { query } : {}),
    ...(sender ? { sender } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    ...(rawPaywall === 'paid' || rawPaywall === 'free' ? { paywall: rawPaywall } : {}),
    ...(rawSummary === 'with' || rawSummary === 'without' ? { summary: rawSummary } : {}),
  };

  if (!/^\d+$/.test(rawPage) || Number(rawPage) < 1) {
    return { error: 'Niepoprawne filtry archiwum: Numer strony musi być dodatnią liczbą całkowitą.', filters };
  }
  if (from && !isCalendarDate(from)) {
    return { error: 'Niepoprawne filtry archiwum: data „od” musi mieć format RRRR-MM-DD.', filters };
  }
  if (to && !isCalendarDate(to)) {
    return { error: 'Niepoprawne filtry archiwum: data „do” musi mieć format RRRR-MM-DD.', filters };
  }
  if (from && to && from > to) {
    return { error: 'Niepoprawne filtry archiwum: data „od” nie może być późniejsza niż data „do”.', filters };
  }
  if (rawPaywall && rawPaywall !== 'paid' && rawPaywall !== 'free') {
    return { error: 'Niepoprawne filtry archiwum: nieobsługiwany filtr paywalla.', filters };
  }
  if (rawSummary && rawSummary !== 'with' && rawSummary !== 'without') {
    return { error: 'Niepoprawne filtry archiwum: nieobsługiwany filtr streszczenia.', filters };
  }

  return {
    filters,
    criteria: {
      page: Number(rawPage),
      ...(query ? { query } : {}),
      ...(sender ? { sender } : {}),
      ...(from ? { fromInclusive: warsawMidnightIso(from) } : {}),
      ...(to ? { toExclusive: warsawMidnightIso(nextCalendarDate(to)) } : {}),
      ...(rawPaywall ? { paywall: rawPaywall === 'paid' } : {}),
      ...(rawSummary ? { hasSummary: rawSummary === 'with' } : {}),
    },
  };
}

export function createReaderServer(deps: ReaderServerDeps): http.Server {
  const logger = deps.logger ?? silentLogger;
  const refresh = deps.refresh;
  const chat = deps.chatWithArticle;
  const chatTimeoutMs = deps.chatTimeoutMs ?? CHAT_TIMEOUT_MS;

  return http.createServer(async (req, res) => {
    try {
      const host = req.headers.host ?? 'localhost';
      const url = new URL(req.url ?? '/', `http://${host}`);

      if (req.method === 'GET' && url.pathname === '/') {
        const snapshot = deps.archive.latestSnapshot();
        const meta = noticeFromUrl(url);
        sendHtml(res, 200, snapshot ? renderSnapshot(snapshot, deps.resolveSourceLink, meta) : renderEmpty(meta));
        return;
      }

      if (req.method === 'GET' && url.pathname === '/runs') {
        sendHtml(res, 200, renderRunsPage(deps.archive.listSnapshots(), { ranAt: currentIso(), ...noticeFromUrl(url) }));
        return;
      }

      if (req.method === 'GET' && url.pathname === '/newsletters') {
        const parsed = parseArchiveRequest(url);
        if ('error' in parsed) {
          sendHtml(res, 400, renderArchivePage(
            deps.archive.listNewsletters({ page: 1 }),
            parsed.error,
            parsed.filters,
          ));
          return;
        }

        sendHtml(res, 200, renderArchivePage(
          deps.archive.listNewsletters(parsed.criteria),
          undefined,
          parsed.filters,
        ));
        return;
      }

      const newsletterMatch = url.pathname.match(/^\/newsletters\/([^/]+)$/);
      if (req.method === 'GET' && newsletterMatch?.[1]) {
        let newsletterId: string;
        try {
          newsletterId = decodeURIComponent(newsletterMatch[1]);
        } catch {
          sendHtml(res, 404, renderNewsletterPage(null));
          return;
        }
        const item = deps.archive.getNewsletter(newsletterId);
        if (!item) {
          sendHtml(res, 404, renderNewsletterPage(null));
          return;
        }
        const sourceLink = deps.resolveSourceLink?.(item.source) ?? null;
        sendHtml(res, 200, renderNewsletterPage(item, sourceLink));
        return;
      }

      const runMatch = url.pathname.match(/^\/runs\/(\d+)$/);
      if (req.method === 'GET' && runMatch?.[1]) {
        const runId = Number(runMatch[1]);
        const snapshot = deps.archive.getSnapshot(runId);
        if (!snapshot) {
          sendHtml(res, 404, renderRunsPage(deps.archive.listSnapshots(), {
            ranAt: currentIso(),
            error: `Nie znaleziono digestu #${runId}.`,
          }));
          return;
        }

        sendHtml(res, 200, renderSnapshot(snapshot, deps.resolveSourceLink, noticeFromUrl(url)));
        return;
      }

      if (req.method === 'POST' && url.pathname === '/refresh') {
        try {
          if (!refresh) throw new Error('Newsletter refresh is not configured.');
          const result = await refresh.refresh();
          if (result.runId != null) {
            redirect(res, `/runs/${result.runId}?notice=${encodeURIComponent('Pobrano nowe newslettery.')}`);
            return;
          }

          const latest = deps.archive.latestSnapshot();
          redirect(res, `${latest ? `/runs/${latest.run.id}` : '/'}?notice=${encodeURIComponent('Brak nowych newsletterów.')}`);
        } catch (err) {
          logger.error({ err: errorMessage(err) }, 'Odświeżenie nieudane');
          redirect(res, `/?error=${encodeURIComponent(`Odświeżenie nieudane: ${errorMessage(err)}`)}`);
        }
        return;
      }

      if (req.method === 'POST' && url.pathname === '/chat') {
        let payload: unknown;
        try {
          payload = await readJsonBody(req);
        } catch {
          sendJson(res, 400, { error: 'Niepoprawny JSON.' });
          return;
        }

        const data = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
        if (typeof data.newsletterId !== 'string' || data.newsletterId.trim() === '') {
          sendJson(res, 400, { error: 'newsletterId jest wymagany.' });
          return;
        }
        if (typeof data.question !== 'string' || data.question.trim() === '') {
          sendJson(res, 400, { error: 'question jest wymagane.' });
          return;
        }
        if (!isChatHistory(data.history)) {
          sendJson(res, 400, { error: 'history ma niepoprawny format.' });
          return;
        }

        const item = deps.archive.getNewsletter(data.newsletterId);
        if (!item) {
          sendJson(res, 404, { error: 'Nie znaleziono newslettera.' });
          return;
        }
        if (!item.cleanText.trim()) {
          sendJson(res, 400, { error: 'Newsletter nie ma tekstu do rozmowy.' });
          return;
        }

        const startedAt = Date.now();
        const logContext = {
          newsletterId: item.newsletterId,
          subject: item.subject,
          model: deps.config.ollamaModel,
        };
        logger.info(logContext, 'Rozpoczęto chat z newsletterem');

        try {
          const answer = await withChatTimeout(
            chat({
              articleText: item.cleanText,
              question: data.question,
              history: data.history ?? [],
              model: deps.config.ollamaModel,
            }),
            chatTimeoutMs,
          );
          logger.info({ ...logContext, durationMs: Date.now() - startedAt }, 'Chat zakończony');
          sendJson(res, 200, { answer });
        } catch (err) {
          if (err instanceof ChatTimeoutError) {
            logger.error(
              { ...logContext, durationMs: Date.now() - startedAt, timeoutMs: chatTimeoutMs },
              'Chat przekroczył limit czasu',
            );
            sendJson(res, 504, { error: `${err.message} Sprawdź, czy Ollama działa i model jest gotowy.` });
            return;
          }

          logger.error({ ...logContext, err: errorMessage(err), durationMs: Date.now() - startedAt }, 'Chat nieudany');
          sendJson(res, 502, { error: `Ollama nie odpowiedziała: ${errorMessage(err)}` });
        }
        return;
      }

      sendHtml(res, 404, renderEmpty({ error: 'Nie znaleziono strony.' }));
    } catch (err) {
      logger.error({ err: errorMessage(err) }, 'Błąd serwera');
      sendJson(res, 500, { error: 'Błąd serwera.' });
    }
  });
}

async function runStartupRefresh(deps: ReaderServerDeps): Promise<void> {
  if (!deps.refresh) throw new Error('Newsletter refresh is not configured.');
  await deps.refresh.refresh();
}

/** True when startup should skip IMAP fetch and just serve saved digests. */
export function shouldSkipStartupRefresh(argv: string[] = process.argv): boolean {
  return argv.includes('--no-refresh') || argv.includes('--open');
}

const isMain =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isMain) {
  (async () => {
    let config: AppConfig;
    try {
      config = loadConfig();
    } catch (err) {
      createLogger().error({ err: errorMessage(err) }, 'Błąd konfiguracji');
      process.exitCode = 1;
      return;
    }

    const logger = createLogger(config.logLevel);
    const application = createApplication(config, logger);
    const port = Number(process.env.PORT ?? '3789');
    const skipRefresh = shouldSkipStartupRefresh();
    const server = createReaderServer(application);

    server.listen(port, '127.0.0.1', async () => {
      const url = `http://localhost:${port}`;
      logger.info({ url, skipRefresh }, 'Uruchomiono reader');

      if (!skipRefresh) {
        try {
          await runStartupRefresh(application);
        } catch (err) {
          logger.error({ err: errorMessage(err) }, 'Startowe pobieranie nieudane');
        }
      } else {
        logger.info('Pominięto startowe pobieranie — otwieram zapisany digest');
      }

      await openExternal(url);
    });

    process.on('SIGINT', () => {
      server.close(() => {
        application.close();
        process.exit(0);
      });
    });
  })();
}
