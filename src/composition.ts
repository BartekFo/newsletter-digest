import { writeFile } from 'node:fs/promises';

import { chatWithArticle } from './chatModel.js';
import { createNewsletterRefresh, type DigestDeps, type NewsletterRefresh } from './digest.js';
import { buildDigestEmail, sendDigestEmail } from './email.js';
import { extractText } from './extract.js';
import { fetchTopStories } from './hackernews.js';
import { createGmailSourceAdapter } from './gmailSource.js';
import { openExternal } from './openExternal.js';
import { renderDigestPage } from './render.js';
import { openDigestArchive, type DigestArchive } from './store.js';
import { summarize } from './summarize.js';
import { fetchWeather } from './weather.js';
import type { AppConfig, AppLogger, NewsletterSource, ResolvedSourceLink } from './types.js';

export interface Application {
  archive: DigestArchive;
  config: AppConfig;
  logger: AppLogger;
  refresh: NewsletterRefresh;
  chatWithArticle: typeof chatWithArticle;
  resolveSourceLink(source: NewsletterSource): ResolvedSourceLink | null;
  close(): void;
}

export interface ApplicationOptions {
  staticExport?: boolean;
  openStaticExport?: boolean;
}

/** The single concrete adapter wiring shared by the Reader and export CLI. */
export function createApplication(
  config: AppConfig,
  logger: AppLogger,
  options: ApplicationOptions = {},
): Application {
  const archive = openDigestArchive(config.dbPath);
  const source = createGmailSourceAdapter(config);

  const refreshDeps: DigestDeps = {
    archive,
    config,
    source,
    extractText,
    summarize,
    buildDigestEmail,
    sendDigestEmail,
    fetchWeather,
    fetchTopStories,
    logger,
  };

  if (options.staticExport) {
    refreshDeps.renderHtml = renderDigestPage;
    refreshDeps.writeFile = (path, content) => writeFile(path, content, 'utf8');
    if (options.openStaticExport) refreshDeps.openFile = openExternal;
  }

  return {
    archive,
    config,
    logger,
    refresh: createNewsletterRefresh(refreshDeps),
    chatWithArticle,
    resolveSourceLink: source.resolveSourceLink ?? (() => null),
    close: () => archive.close(),
  };
}
