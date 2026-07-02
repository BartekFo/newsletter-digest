import { silentLogger } from './logger.js';
import type { AppLogger, HackerNewsStory } from './types.js';

const TOP_STORIES_URL = 'https://hacker-news.firebaseio.com/v0/topstories.json';
const ITEM_URL = 'https://hacker-news.firebaseio.com/v0/item';
const TIMEOUT_MS = 5000;

/**
 * Fetch a single HN item and shape it into a digest story.
 * @param {number} id
 * @returns {Promise<{title: string, url: string, score: number, comments: number, hnUrl: string} | null>}
 */
interface HackerNewsItem {
  title?: string;
  url?: string;
  score?: number;
  descendants?: number;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function fetchStory(id: number): Promise<HackerNewsStory | null> {
  const res = await fetch(`${ITEM_URL}/${id}.json`, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Item ${id} failed: HTTP ${res.status}`);

  const item = (await res.json()) as HackerNewsItem | null;
  if (!item || !item.title) return null;

  const hnUrl = `https://news.ycombinator.com/item?id=${id}`;
  return {
    title: item.title,
    // Ask HN / self-posts have no external url — fall back to the HN thread.
    url: item.url || hnUrl,
    score: item.score ?? 0,
    comments: item.descendants ?? 0,
    hnUrl,
  };
}

/**
 * Fetch the top N HackerNews stories. Returns null on any failure (failure-safe
 * — the digest must render even when HN is unreachable).
 *
 * @param {number} [n=6]
 * @param {import('pino').Logger} [logger=silentLogger]
 * @returns {Promise<Array<{title: string, url: string, score: number, comments: number, hnUrl: string}> | null>}
 */
export async function fetchTopStories(
  n = 6,
  logger: AppLogger = silentLogger,
): Promise<HackerNewsStory[] | null> {
  try {
    const res = await fetch(TOP_STORIES_URL, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Top stories failed: HTTP ${res.status}`);

    const ids = (await res.json()) as number[];
    const topIds = ids.slice(0, n);

    const stories = await Promise.all(topIds.map(fetchStory));
    return stories.filter((story): story is HackerNewsStory => story !== null);
  } catch (err) {
    logger.warn({ err: errorMessage(err) }, 'HackerNews niedostępny');
    return null;
  }
}
