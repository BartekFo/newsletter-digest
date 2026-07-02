import { execFile } from 'node:child_process';
import { writeFile as fsWriteFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { loadConfig } from './config.js';
import { createLogger, silentLogger } from './logger.js';
import { fetchNewMessages } from './imap.js';
import { parseMail } from './parse.js';
import { extractText } from './extract.js';
import { summarize } from './summarize.js';
import { renderHtml } from './render.js';
import { fetchWeather } from './weather.js';
import { fetchTopStories } from './hackernews.js';
import {
  openDb,
  initSchema,
  getLastUid,
  setLastUid,
  isKnown,
  insertItem,
  setSummary,
  recordRun,
  addRunItems,
  getItemsByUids,
} from './store.js';
import type {
  AppConfig,
  AppLogger,
  Db,
  DigestItem,
  FetchedMessage,
  HackerNewsStory,
  ParsedMail,
  WeatherSummary,
} from './types.js';

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Open a file in the system's default application.
 * No-op on non-macOS platforms or when path is absent.
 * @param {string} filePath
 * @returns {Promise<void>}
 */
function openFile(filePath: string): Promise<void> {
  return new Promise<void>((resolve) => {
    execFile('open', [filePath], () => resolve());
  });
}

export interface DigestDeps {
  db: Db;
  config: AppConfig;
  fetchNewMessages(config: AppConfig, lastUid: number | null): Promise<FetchedMessage[]>;
  parseMail(raw: Buffer): Promise<ParsedMail>;
  extractText(html: string): Promise<string>;
  summarize(text: string, model: string): Promise<string>;
  renderHtml(
    items: DigestItem[],
    meta: {
      ranAt: string;
      newCount: number;
      gmailUser?: string;
      weather: WeatherSummary | null;
      hackernews: HackerNewsStory[] | null;
    },
  ): string;
  fetchWeather(config: AppConfig, logger: AppLogger): Promise<WeatherSummary | null>;
  fetchTopStories(n: number, logger: AppLogger): Promise<HackerNewsStory[] | null>;
  writeFile(path: string, content: string): Promise<void>;
  openFile(path: string): Promise<void>;
  now(): Date;
  logger?: AppLogger;
}

/**
 * Core orchestration function — fully injectable for offline testing.
 *
 * deps shape:
 *   db            — better-sqlite3 db handle (schema already initialised)
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
export async function runDigest(deps: DigestDeps): Promise<{ fetched: number; newItems: number; runId: number | null }> {
  const {
    db,
    config,
    fetchNewMessages: fetch,
    parseMail: parse,
    extractText: extract,
    summarize: summariseFn,
    renderHtml: render,
    fetchWeather: weatherFn,
    fetchTopStories: hackernewsFn,
    writeFile,
    openFile: open,
    now,
    logger = silentLogger,
  } = deps;

  const startMs = Date.now();
  const lastUid = getLastUid(db);

  let fetched: FetchedMessage[] | undefined;
  let newUids: number[] = [];
  const newMessageIds: string[] = [];

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

      if (isKnown(db, mail.messageId)) {
        logger.debug({ uid, subject: mail.subject }, 'Pomijam — już znana');
        continue;
      }

      const cleanText = await extract(mail.html);

      insertItem(db, {
        messageId: mail.messageId,
        uid,
        sender: mail.sender,
        subject: mail.subject,
        date: mail.date,
        cleanText,
        summary: null,
        link: mail.link ?? null,
      });

      logger.info(
        { uid, sender: mail.sender, subject: mail.subject, model: config.ollamaModel },
        'Streszczam (lokalny model — może chwilę potrwać)…',
      );
      const summaryStartMs = Date.now();

      try {
        const summary = await summariseFn(cleanText, config.ollamaModel);

        // Commit summary immediately (commit-per-mail resilience).
        setSummary(db, mail.messageId, summary);
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
      newMessageIds.push(mail.messageId);
    }

    // Advance cursor only after the full loop completes without throwing.
    if (maxUid > (lastUid ?? 0)) {
      setLastUid(db, maxUid);
    }

    logger.info({ newItems: newUids.length }, 'Przetworzono maile, pobieram pogodę i HackerNews…');
    const items = getItemsByUids(db, newUids);

    // Optional extras — failure-safe: a dead API must not abort the digest.
    // Each fn logs its own failure via the injected logger and returns null;
    // the .catch guards against any unexpected throw.
    const [weather, hackernews] = await Promise.all([
      weatherFn(config, logger).catch(() => null),
      hackernewsFn(6, logger).catch(() => null),
    ]);

    const html = render(items, {
      ranAt: now().toISOString(),
      newCount: newUids.length,
      gmailUser: config.gmailUser,
      weather,
      hackernews,
    });

    await writeFile(config.outPath, html);
    logger.info({ outPath: config.outPath }, 'Zapisano digest');

    const durationMs = Date.now() - startMs;
    const runId = recordRun(db, {
      fetched: fetched.length,
      newItems: newUids.length,
      durationMs,
      ok: 1,
    });
    addRunItems(db, runId, newMessageIds);

    await open(config.outPath);

    logger.info(
      { fetched: fetched.length, newItems: newUids.length, durationMs },
      'Gotowe',
    );

    return { fetched: fetched.length, newItems: newUids.length, runId: newMessageIds.length > 0 ? runId : null };
  } catch (err) {
    logger.error(
      { err: errorMessage(err), durationMs: Date.now() - startMs },
      'Bieg nieudany',
    );
    recordRun(db, {
      fetched: fetched?.length ?? 0,
      newItems: newUids?.length ?? 0,
      durationMs: Date.now() - startMs,
      ok: 0,
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
    const db = openDb(config.dbPath);
    initSchema(db);

    try {
      await runDigest({
        db,
        config,
        fetchNewMessages,
        parseMail,
        extractText,
        summarize,
        renderHtml,
        fetchWeather,
        fetchTopStories,
        writeFile: (path: string, content: string) => fsWriteFile(path, content, 'utf8'),
        openFile,
        now: () => new Date(),
        logger,
      });
    } catch {
      // runDigest already logged the failure; just set the exit code.
      process.exitCode = 1;
    }
  })();
}
