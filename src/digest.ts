import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { loadConfig } from './config.js';
import { createLogger, silentLogger } from './logger.js';
import {
  type DigestEmailMessage,
} from './email.js';
import type { DigestArchive } from './store.js';
import type {
  AppConfig,
  AppLogger,
  DigestItem,
  DigestMeta,
  FetchedMessage,
  HackerNewsStory,
  ParsedMail,
  WeatherSummary,
} from './types.js';

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export interface DigestDeps {
  archive: DigestArchive;
  config: AppConfig;
  fetchNewMessages(config: AppConfig, lastUid: number | null): Promise<FetchedMessage[]>;
  parseMail(raw: Buffer): Promise<ParsedMail>;
  extractText(html: string): Promise<string>;
  summarize(text: string, model: string): Promise<string>;
  renderHtml?(items: DigestItem[], meta: DigestMeta): string;
  buildDigestEmail(items: DigestItem[], meta: DigestMeta): DigestEmailMessage;
  sendDigestEmail(config: AppConfig, message: DigestEmailMessage): Promise<void>;
  fetchWeather(config: AppConfig, logger: AppLogger): Promise<WeatherSummary | null>;
  fetchTopStories(n: number, logger: AppLogger): Promise<HackerNewsStory[] | null>;
  writeFile?(path: string, content: string): Promise<void>;
  openFile?(path: string): Promise<void>;
  now(): Date;
  logger?: AppLogger;
}

export interface RefreshResult {
  fetched: number;
  newItems: number;
  runId: number | null;
  newsletterIds: string[];
}

export interface NewsletterRefresh {
  refresh(): Promise<RefreshResult>;
}

/** Build the small public use-case seam used by Reader and CLI callers. */
export function createNewsletterRefresh(deps: DigestDeps): NewsletterRefresh {
  return { refresh: () => runDigest(deps) };
}

/**
 * Core orchestration function — fully injectable for offline testing.
 *
 * deps shape:
 *   archive       — publication, recovery and read interface
 *   config        — { gmailUser, gmailAppPassword, imapFolder, bootstrapDays,
 *                     ollamaModel, dbPath, outPath }
 *   fetchNewMessages(config, lastUid) → Promise<{raw, uid}[]>
 *   parseMail(raw)                    → Promise<{messageId, sender, subject, date, html}>
 *   extractText(html)                 → Promise<string>
 *   summarize(text, model)            → Promise<string>
 *   renderHtml(items, meta)           → string
 *   fetchWeather(config)              → Promise<object|null>
 *   fetchTopStories(n)                → Promise<object[]|null>
 *   writeFile(path, content)          → Promise<void>
 *   openFile(path)                    → Promise<void>
 *   now()                             → Date
 *   logger                            → pino-compatible logger (optional; silent by default)
 *
 * @returns {Promise<{fetched: number, newItems: number, runId: number | null}>}
 */
export async function runDigest(deps: DigestDeps): Promise<RefreshResult> {
  const {
    archive,
    config,
    fetchNewMessages: fetch,
    parseMail: parse,
    extractText: extract,
    summarize: summariseFn,
    renderHtml: render,
    buildDigestEmail: buildEmail,
    sendDigestEmail: sendEmail,
    fetchWeather: weatherFn,
    fetchTopStories: hackernewsFn,
    writeFile,
    openFile: open,
    now,
    logger = silentLogger,
  } = deps;

  const startMs = Date.now();
  const lastUid = archive.getCursor();

  let fetched: FetchedMessage[] | undefined;
  let newUids: number[] = [];
  const stagedItems: DigestItem[] = [];
  const stagedMessageIds = new Set<string>();

  try {
    logger.info({ lastUid, folder: config.imapFolder }, 'Łączę z Gmail, pobieram nowe wiadomości…');
    fetched = await fetch(config, lastUid);
    logger.info({ fetched: fetched.length }, 'Pobrano wiadomości z IMAP');

    let maxUid = lastUid ?? 0;
    newUids = [];

    for (const { raw, uid } of fetched) {
      const mail = await parse(raw);

      // Always advance the cursor past seen UIDs, even already-known ones, so
      // we don't re-fetch them on the next run (dedup is handled by isKnown).
      maxUid = Math.max(maxUid, uid);

      const sourceIdentity = { type: 'gmail', externalId: mail.messageId };
      if (archive.isKnown(sourceIdentity) || stagedMessageIds.has(mail.messageId)) {
        logger.debug({ uid, subject: mail.subject }, 'Pomijam — już znana');
        continue;
      }

      const cleanText = await extract(mail.html);

      const item: DigestItem = {
        id: randomUUID(),
        source: {
          type: 'gmail',
          externalId: mail.messageId,
          cursor: String(uid),
          metadata: { gmailMessageId: mail.messageId, gmailUid: uid },
        },
        messageId: mail.messageId,
        uid,
        sender: mail.sender,
        subject: mail.subject,
        date: mail.date,
        cleanText,
        summary: null,
        link: mail.link ?? null,
        isPaywalled: mail.isPaywalled,
      };

      logger.info(
        { uid, sender: mail.sender, subject: mail.subject, model: config.ollamaModel },
        'Streszczam (lokalny model — może chwilę potrwać)…',
      );
      const summaryStartMs = Date.now();

      try {
        const summary = await summariseFn(cleanText, config.ollamaModel);

        item.summary = summary;
        logger.info(
          { uid, subject: mail.subject, ms: Date.now() - summaryStartMs },
          'Streszczono',
        );
      } catch (err) {
        // A failed summary must not abort the run or hide the newsletter. Leave
        // summary null (render shows "(brak streszczenia)") and keep going so the
        // item still reaches the digest and the cursor still advances past it.
        logger.error(
        { uid, messageId: mail.messageId, err: errorMessage(err), ms: Date.now() - summaryStartMs },
          'Streszczenie nieudane — pomijam, zostawiam placeholder',
        );
      }

      newUids.push(uid);
      stagedItems.push(item);
      stagedMessageIds.add(mail.messageId);
    }

    if (newUids.length === 0) {
      const durationMs = Date.now() - startMs;
      logger.info(
        { fetched: fetched.length, durationMs },
        'Brak nowych newsletterów — zachowuję poprzedni digest',
      );
      return { fetched: fetched.length, newItems: 0, runId: null, newsletterIds: [] };
    }

    logger.info({ newItems: newUids.length }, 'Przetworzono maile, pobieram pogodę i HackerNews…');
    const items = stagedItems;

    // Optional extras — failure-safe: a dead API must not abort the digest.
    // Each fn logs its own failure via the injected logger and returns null;
    // the .catch guards against any unexpected throw.
    const [weather, hackernews] = await Promise.all([
      weatherFn(config, logger).catch(() => null),
      hackernewsFn(6, logger).catch(() => null),
    ]);

    const digestMeta = {
      ranAt: now().toISOString(),
      newCount: newUids.length,
      gmailUser: config.gmailUser,
      weather,
      hackernews,
    };
    const durationMs = Date.now() - startMs;
    const runId = archive.publishSnapshot({
      items,
      cursorUid: maxUid,
      run: {
        fetched: fetched.length,
        newItems: newUids.length,
        durationMs,
        ok: 1,
        weather,
        hackernews,
      },
    });

    // Delivery consumes the committed snapshot, never the in-flight staging
    // collection. A delivery failure cannot invalidate publication.
    const publishedSnapshot = archive.getSnapshot(runId);
    if (!publishedSnapshot) throw new Error(`Published snapshot #${runId} is not readable.`);
    const publishedItems = publishedSnapshot.items;
    if (render && writeFile) try {
      const html = render(publishedItems, digestMeta);
      await writeFile(config.outPath, html);
      logger.info({ outPath: config.outPath, runId }, 'Zapisano digest');
      await open?.(config.outPath);
    } catch (err) {
      logger.error(
        { outPath: config.outPath, runId, err: errorMessage(err) },
        'Nie udało się wyeksportować digestu — opublikowany snapshot pozostaje dostępny',
      );
    }

    if (config.sendDigestEmail) {
      try {
        const email = buildEmail(publishedItems, digestMeta);
        await sendEmail(config, email);
        logger.info({ recipient: config.digestEmailRecipient, runId }, 'Wysłano digest e-mailem');
      } catch (err) {
        logger.error(
          { recipient: config.digestEmailRecipient, runId, err: errorMessage(err) },
          'Nie udało się wysłać digestu e-mailem — digest pozostaje zapisany lokalnie',
        );
      }
    }

    logger.info(
      { fetched: fetched.length, newItems: newUids.length, durationMs },
      'Gotowe',
    );

    return {
      fetched: fetched.length,
      newItems: newUids.length,
      runId,
      newsletterIds: publishedItems.map((item) => item.id),
    };
  } catch (err) {
    logger.error(
      { err: errorMessage(err), durationMs: Date.now() - startMs },
      'Bieg nieudany',
    );
    archive.recordFailedRefresh({
      fetched: fetched?.length ?? 0,
      newItems: newUids?.length ?? 0,
      durationMs: Date.now() - startMs,
      ok: false,
    });
    throw err;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Real entry point — only runs when executed directly (`node src/digest.js`).
// ────────────────────────────────────────────────────────────────────────────
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
    const { createApplication } = await import('./composition.js');
    const application = createApplication(config, logger, {
      staticExport: true,
      openStaticExport: true,
    });

    try {
      await application.refresh.refresh();
    } catch {
      // runDigest already logged the failure; just set the exit code.
      process.exitCode = 1;
    } finally {
      application.close();
    }
  })();
}
