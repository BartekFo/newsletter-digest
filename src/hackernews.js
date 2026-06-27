const TOP_STORIES_URL = 'https://hacker-news.firebaseio.com/v0/topstories.json';
const ITEM_URL = 'https://hacker-news.firebaseio.com/v0/item';
const TIMEOUT_MS = 5000;

/**
 * Fetch a single HN item and shape it into a digest story.
 * @param {number} id
 * @returns {Promise<{title: string, url: string, score: number, comments: number, hnUrl: string} | null>}
 */
async function fetchStory(id) {
  const res = await fetch(`${ITEM_URL}/${id}.json`, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Item ${id} failed: HTTP ${res.status}`);

  const item = await res.json();
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
 * @returns {Promise<Array<{title: string, url: string, score: number, comments: number, hnUrl: string}> | null>}
 */
export async function fetchTopStories(n = 6) {
  try {
    const res = await fetch(TOP_STORIES_URL, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Top stories failed: HTTP ${res.status}`);

    const ids = await res.json();
    const topIds = ids.slice(0, n);

    const stories = await Promise.all(topIds.map(fetchStory));
    return stories.filter(Boolean);
  } catch (err) {
    console.warn(`[digest] HackerNews unavailable: ${err.message}`);
    return null;
  }
}
