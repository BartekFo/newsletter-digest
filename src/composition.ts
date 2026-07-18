import { execFile } from 'node:child_process';
import { writeFile } from 'node:fs/promises';

import { createNewsletterRefresh, type DigestDeps, type NewsletterRefresh } from './digest.js';
import { buildDigestEmail, sendDigestEmail } from './email.js';
import { extractText } from './extract.js';
import { fetchTopStories } from './hackernews.js';
import { fetchNewMessages } from './imap.js';
import { parseMail } from './parse.js';
import { renderHtml } from './render.js';
import { openDb, initSchema } from './store.js';
import { summarize } from './summarize.js';
import { fetchWeather } from './weather.js';
import type { AppConfig, AppLogger, Db } from './types.js';

export interface Application {
  db: Db;
  config: AppConfig;
  logger: AppLogger;
  refresh: NewsletterRefresh;
}

export interface ApplicationOptions {
  staticExport?: boolean;
  openStaticExport?: boolean;
}

function openFile(filePath: string): Promise<void> {
  return new Promise<void>((resolve) => {
    if (process.platform !== 'darwin') {
      resolve();
      return;
    }

    execFile('open', [filePath], () => resolve());
  });
}

/** The single concrete adapter wiring shared by the Reader and export CLI. */
export function createApplication(
  config: AppConfig,
  logger: AppLogger,
  options: ApplicationOptions = {},
): Application {
  const db = openDb(config.dbPath);
  initSchema(db);

  const refreshDeps: DigestDeps = {
    db,
    config,
    fetchNewMessages,
    parseMail,
    extractText,
    summarize,
    buildDigestEmail,
    sendDigestEmail,
    fetchWeather,
    fetchTopStories,
    now: () => new Date(),
    logger,
  };

  if (options.staticExport) {
    refreshDeps.renderHtml = renderHtml;
    refreshDeps.writeFile = (path, content) => writeFile(path, content, 'utf8');
    if (options.openStaticExport) refreshDeps.openFile = openFile;
  }

  return {
    db,
    config,
    logger,
    refresh: createNewsletterRefresh(refreshDeps),
  };
}
