import { execFile } from 'node:child_process';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';

import { chatWithArticle, type ChatMessage } from './chatModel.js';
import { loadConfig } from './config.js';
import { runDigest, type DigestDeps } from './digest.js';
import { extractText } from './extract.js';
import { buildDigestEmail, sendDigestEmail } from './email.js';
import { fetchTopStories } from './hackernews.js';
import { fetchNewMessages } from './imap.js';
import { createLogger, silentLogger } from './logger.js';
import { parseMail } from './parse.js';
import { renderDigestPage, renderHtml, renderRunsPage } from './render.js';
import { summarize } from './summarize.js';
import {
  getItemByMessageId,
  getItemsByRunId,
  getLatestNonEmptyRun,
  getRunSummaries,
  initSchema,
  openDb,
} from './store.js';
import { fetchWeather } from './weather.js';
import type { AppConfig, AppLogger, Db, DigestItem, RunSummary } from './types.js';

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

function openUrl(url: string): Promise<void> {
  return new Promise<void>((resolve) => {
    if (process.platform !== 'darwin') {
      resolve();
      return;
    }

    execFile('open', [url], () => resolve());
  });
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
  db: Db;
  config: AppConfig;
  logger?: AppLogger;
  runDigest?: (deps: DigestDeps) => Promise<{ fetched: number; newItems: number; runId: number | null }>;
  chatWithArticle?: typeof chatWithArticle;
  chatTimeoutMs?: number;
  now?: () => Date;
}

function createDigestDeps(deps: ReaderServerDeps): DigestDeps {
  return {
    db: deps.db,
    config: deps.config,
    fetchNewMessages,
    parseMail,
    extractText,
    summarize,
    renderHtml,
    buildDigestEmail,
    sendDigestEmail,
    fetchWeather,
    fetchTopStories,
    writeFile: async () => undefined,
    openFile: async () => undefined,
    now: deps.now ?? (() => new Date()),
    logger: deps.logger ?? silentLogger,
  };
}

function renderRun(db: Db, run: RunSummary, config: AppConfig, extras: { notice?: string; error?: string } = {}): string {
  const items = getItemsByRunId(db, run.id);
  return renderDigestPage(items, {
    ranAt: run.ranAt,
    newCount: run.newItems,
    runId: run.id,
    gmailUser: config.gmailUser,
    ...(run.weather !== undefined ? { weather: run.weather } : {}),
    ...(run.hackernews !== undefined ? { hackernews: run.hackernews } : {}),
    ...extras,
  });
}

function renderEmpty(config: AppConfig, extras: { notice?: string; error?: string } = {}): string {
  return renderDigestPage([], {
    ranAt: currentIso(),
    newCount: 0,
    gmailUser: config.gmailUser,
    ...extras,
  });
}

export function createReaderServer(deps: ReaderServerDeps): http.Server {
  const logger = deps.logger ?? silentLogger;
  const refresh = deps.runDigest ?? runDigest;
  const chat = deps.chatWithArticle ?? chatWithArticle;
  const chatTimeoutMs = deps.chatTimeoutMs ?? CHAT_TIMEOUT_MS;

  return http.createServer(async (req, res) => {
    try {
      const host = req.headers.host ?? 'localhost';
      const url = new URL(req.url ?? '/', `http://${host}`);

      if (req.method === 'GET' && url.pathname === '/') {
        const run = getLatestNonEmptyRun(deps.db);
        const meta = noticeFromUrl(url);
        sendHtml(res, 200, run ? renderRun(deps.db, run, deps.config, meta) : renderEmpty(deps.config, meta));
        return;
      }

      if (req.method === 'GET' && url.pathname === '/runs') {
        sendHtml(res, 200, renderRunsPage(getRunSummaries(deps.db), { ranAt: currentIso(), ...noticeFromUrl(url) }));
        return;
      }

      const runMatch = url.pathname.match(/^\/runs\/(\d+)$/);
      if (req.method === 'GET' && runMatch?.[1]) {
        const runId = Number(runMatch[1]);
        const run = getRunSummaries(deps.db).find((summary) => summary.id === runId);
        if (!run) {
          sendHtml(res, 404, renderRunsPage(getRunSummaries(deps.db), {
            ranAt: currentIso(),
            error: `Nie znaleziono digestu #${runId}.`,
          }));
          return;
        }

        sendHtml(res, 200, renderRun(deps.db, run, deps.config, noticeFromUrl(url)));
        return;
      }

      if (req.method === 'POST' && url.pathname === '/refresh') {
        try {
          const result = await refresh(createDigestDeps(deps));
          if (result.runId != null) {
            redirect(res, `/runs/${result.runId}?notice=${encodeURIComponent('Pobrano nowe newslettery.')}`);
            return;
          }

          const latest = getLatestNonEmptyRun(deps.db);
          redirect(res, `${latest ? `/runs/${latest.id}` : '/'}?notice=${encodeURIComponent('Brak nowych newsletterów.')}`);
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
        if (typeof data.messageId !== 'string' || data.messageId.trim() === '') {
          sendJson(res, 400, { error: 'messageId jest wymagany.' });
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

        const item = getItemByMessageId(deps.db, data.messageId);
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
          messageId: item.messageId,
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

      sendHtml(res, 404, renderEmpty(deps.config, { error: 'Nie znaleziono strony.' }));
    } catch (err) {
      logger.error({ err: errorMessage(err) }, 'Błąd serwera');
      sendJson(res, 500, { error: 'Błąd serwera.' });
    }
  });
}

async function runStartupRefresh(deps: ReaderServerDeps): Promise<void> {
  const refresh = deps.runDigest ?? runDigest;
  await refresh(createDigestDeps(deps));
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
    const db = openDb(config.dbPath);
    initSchema(db);

    const port = Number(process.env.PORT ?? '3789');
    const server = createReaderServer({ db, config, logger });

    server.listen(port, '127.0.0.1', async () => {
      const url = `http://localhost:${port}`;
      logger.info({ url }, 'Uruchomiono reader');

      try {
        await runStartupRefresh({ db, config, logger });
      } catch (err) {
        logger.error({ err: errorMessage(err) }, 'Startowe pobieranie nieudane');
      }

      await openUrl(url);
    });

    process.on('SIGINT', () => {
      server.close(() => {
        db.close();
        process.exit(0);
      });
    });
  })();
}
