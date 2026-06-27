import { execFile } from 'node:child_process';
import { writeFile as fsWriteFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { loadConfig } from './config.js';
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
  getItemsByUids,
} from './store.js';

/**
 * Open a file in the system's default application.
 * No-op on non-macOS platforms or when path is absent.
 * @param {string} filePath
 * @returns {Promise<void>}
 */
function openFile(filePath) {
  return new Promise((resolve) => {
    execFile('open', [filePath], () => resolve());
  });
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
 *
 * @returns {Promise<{fetched: number, newItems: number}>}
 */
export async function runDigest(deps) {
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
  } = deps;

  const startMs = Date.now();
  const lastUid = getLastUid(db);

  let fetched, newUids;

  try {
    fetched = await fetch(config, lastUid);
    let maxUid = lastUid ?? 0;
    newUids = [];

    for (const { raw, uid } of fetched) {
      const mail = await parse(raw);

      // Always advance the cursor past seen UIDs, even already-known ones, so
      // we don't re-fetch them on the next run (dedup is handled by isKnown).
      maxUid = Math.max(maxUid, uid);

      if (isKnown(db, mail.messageId)) continue;

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

      try {
        const summary = await summariseFn(cleanText, config.ollamaModel);

        // Commit summary immediately (commit-per-mail resilience).
        setSummary(db, mail.messageId, summary);
      } catch (err) {
        // A failed summary must not abort the run or hide the newsletter. Leave
        // summary null (render shows "(brak streszczenia)") and keep going so the
        // item still reaches the digest and the cursor still advances past it.
        console.error(
          `[digest] Summary failed for ${mail.messageId}: ${err.message}`,
        );
      }

      newUids.push(uid);
    }

    // Advance cursor only after the full loop completes without throwing.
    if (maxUid > (lastUid ?? 0)) {
      setLastUid(db, maxUid);
    }

    const items = getItemsByUids(db, newUids);

    // Optional extras — failure-safe: a dead API must not abort the digest.
    const [weather, hackernews] = await Promise.all([
      weatherFn(config).catch(() => null),
      hackernewsFn(6).catch(() => null),
    ]);

    const html = render(items, {
      ranAt: now().toISOString(),
      newCount: newUids.length,
      weather,
      hackernews,
    });

    await writeFile(config.outPath, html);

    recordRun(db, {
      fetched: fetched.length,
      newItems: newUids.length,
      durationMs: Date.now() - startMs,
      ok: 1,
    });

    await open(config.outPath);

    return { fetched: fetched.length, newItems: newUids.length };
  } catch (err) {
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
    let config;
    try {
      config = loadConfig();
    } catch (err) {
      console.error(`[digest] Configuration error: ${err.message}`);
      process.exitCode = 1;
      return;
    }

    const db = openDb(config.dbPath);
    initSchema(db);

    try {
      const result = await runDigest({
        db,
        config,
        fetchNewMessages,
        parseMail,
        extractText,
        summarize,
        renderHtml,
        fetchWeather,
        fetchTopStories,
        writeFile: (path, content) => fsWriteFile(path, content, 'utf8'),
        openFile,
        now: () => new Date(),
      });

      console.log(
        `[digest] Done — fetched ${result.fetched}, new ${result.newItems}. Output: ${config.outPath}`,
      );
    } catch (err) {
      console.error(`[digest] Run failed: ${err.message}`);
      process.exitCode = 1;
    }
  })();
}
