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
  HackerNewsStory,
  NewsletterSourceAdapter,
  WeatherSummary,
} from './types.js';

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export interface DigestDeps {
  archive: DigestArchive;
  config: AppConfig;
  source: NewsletterSourceAdapter;
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
 *   source.fetch(cursor)              → Promise<{newsletters, cursor}>
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
async function runDigest(deps: DigestDeps): Promise<RefreshResult> {
  const {
    archive,
    config,
    source,
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
  const cursor = archive.getCursor();

  let fetchedCount = 0;
  let newItemCount = 0;
  const stagedItems: DigestItem[] = [];
  const stagedMessageIds = new Set<string>();

  try {
    logger.info({ cursor }, 'Pobieram nowe newslettery ze źródła…');
    const batch = await source.fetch(cursor);
    fetchedCount = batch.newsletters.length;
    logger.info({ fetched: fetchedCount }, 'Pobrano newslettery');

    for (const newsletter of batch.newsletters) {
      const sourceKey = `${newsletter.source.type}\0${newsletter.source.externalId}`;
      if (archive.isKnown(newsletter.source) || stagedMessageIds.has(sourceKey)) {
        logger.debug({ newsletter: newsletter.source.externalId, subject: newsletter.subject }, 'Pomijam — już znana');
        continue;
      }

      const cleanText = await extract(newsletter.html);

      const item: DigestItem = {
        id: randomUUID(),
        source: newsletter.source,
        sender: newsletter.sender,
        subject: newsletter.subject,
        date: newsletter.date,
        cleanText,
        summary: null,
        link: newsletter.link,
        isPaywalled: newsletter.isPaywalled,
      };

      logger.info(
        { newsletterId: item.id, sender: newsletter.sender, subject: newsletter.subject, model: config.ollamaModel },
        'Streszczam (lokalny model — może chwilę potrwać)…',
      );
      const summaryStartMs = Date.now();

      try {
        const summary = await summariseFn(cleanText, config.ollamaModel);

        item.summary = summary;
        logger.info(
          { newsletterId: item.id, subject: newsletter.subject, ms: Date.now() - summaryStartMs },
          'Streszczono',
        );
      } catch (err) {
        // A failed summary must not abort the run or hide the newsletter. Leave
        // summary null (render shows "(brak streszczenia)") and keep going so the
        // item still reaches the digest and the cursor still advances past it.
        logger.error(
        { newsletterId: item.id, sourceId: newsletter.source.externalId, err: errorMessage(err), ms: Date.now() - summaryStartMs },
          'Streszczenie nieudane — pomijam, zostawiam placeholder',
        );
      }

      newItemCount++;
      stagedItems.push(item);
      stagedMessageIds.add(sourceKey);
    }

    if (newItemCount === 0) {
      const durationMs = Date.now() - startMs;
      logger.info(
        { fetched: fetchedCount, durationMs },
        'Brak nowych newsletterów — zachowuję poprzedni digest',
      );
      return { fetched: fetchedCount, newItems: 0, runId: null, newsletterIds: [] };
    }

    logger.info({ newItems: newItemCount }, 'Przetworzono newslettery, pobieram pogodę i HackerNews…');
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
      newCount: newItemCount,
      gmailUser: config.gmailUser,
      weather,
      hackernews,
    };
    const durationMs = Date.now() - startMs;
    const publicationCursor = batch.cursor ?? stagedItems.at(-1)?.source.cursor;
    if (!publicationCursor) throw new Error('Source did not provide a publication cursor.');
    const runId = archive.publishSnapshot({
      items,
      cursor: publicationCursor,
      run: {
        fetched: fetchedCount,
        newItems: newItemCount,
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
      { fetched: fetchedCount, newItems: newItemCount, durationMs },
      'Gotowe',
    );

    return {
      fetched: fetchedCount,
      newItems: newItemCount,
      runId,
      newsletterIds: publishedItems.map((item) => item.id),
    };
  } catch (err) {
    logger.error(
      { err: errorMessage(err), durationMs: Date.now() - startMs },
      'Bieg nieudany',
    );
    archive.recordFailedRefresh({
      fetched: fetchedCount,
      newItems: newItemCount,
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
