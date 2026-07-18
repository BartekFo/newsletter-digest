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
export interface HackerNewsItem {
  title?: string;
  url?: string;
  score?: number;
  descendants?: number;
}

export interface HackerNewsClient {
  topStoryIds(): Promise<number[]>;
  story(id: number): Promise<HackerNewsItem | null>;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function fetchTopStoryIds(): Promise<number[]> {
  const res = await fetch(TOP_STORIES_URL, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Top stories failed: HTTP ${res.status}`);

  return (await res.json()) as number[];
}

async function fetchStoryItem(id: number): Promise<HackerNewsItem | null> {
  const res = await fetch(`${ITEM_URL}/${id}.json`, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Item ${id} failed: HTTP ${res.status}`);

  return (await res.json()) as HackerNewsItem | null;
}

const hackerNewsClient: HackerNewsClient = {
  topStoryIds: fetchTopStoryIds,
  story: fetchStoryItem,
};

async function fetchStory(
  id: number,
  client: HackerNewsClient,
): Promise<HackerNewsStory | null> {
  const item = await client.story(id);
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
 * @param {HackerNewsClient} [client] - injectable API client for deterministic tests
 * @returns {Promise<Array<{title: string, url: string, score: number, comments: number, hnUrl: string}> | null>}
 */
export async function fetchTopStories(
  n = 6,
  logger: AppLogger = silentLogger,
  client: HackerNewsClient = hackerNewsClient,
): Promise<HackerNewsStory[] | null> {
  try {
    const ids = await client.topStoryIds();
    const topIds = ids.slice(0, n);

    const stories = await Promise.all(topIds.map((id) => fetchStory(id, client)));
    return stories.filter((story): story is HackerNewsStory => story !== null);
  } catch (err) {
    logger.warn({ err: errorMessage(err) }, 'HackerNews niedostępny');
    return null;
  }
}
