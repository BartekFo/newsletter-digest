import { execFile } from 'node:child_process';
import { writeFile } from 'node:fs/promises';

import { createNewsletterRefresh, type DigestDeps, type NewsletterRefresh } from './digest.js';
import { buildDigestEmail, sendDigestEmail } from './email.js';
import { extractText } from './extract.js';
import { fetchTopStories } from './hackernews.js';
import { createGmailSourceAdapter } from './gmailSource.js';
import { renderDigestPage } from './render.js';
import { openDigestArchive, type DigestArchive } from './store.js';
import { summarize } from './summarize.js';
import { fetchWeather } from './weather.js';
import type { AppConfig, AppLogger } from './types.js';

export interface Application {
  archive: DigestArchive;
  config: AppConfig;
  logger: AppLogger;
  refresh: NewsletterRefresh;
  close(): void;
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
  const archive = openDigestArchive(config.dbPath);

  const refreshDeps: DigestDeps = {
    archive,
    config,
    source: createGmailSourceAdapter(config),
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
    refreshDeps.renderHtml = renderDigestPage;
    refreshDeps.writeFile = (path, content) => writeFile(path, content, 'utf8');
    if (options.openStaticExport) refreshDeps.openFile = openFile;
  }

  return {
    archive,
    config,
    logger,
    refresh: createNewsletterRefresh(refreshDeps),
    close: () => archive.close(),
  };
}
