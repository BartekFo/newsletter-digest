// @ts-nocheck
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchTopStories } from '../src/hackernews.js';

// ---------------------------------------------------------------------------
// Integration test — skips gracefully when the HN API is unreachable
// ---------------------------------------------------------------------------

let apiReachable = false;
try {
  const res = await fetch('https://hacker-news.firebaseio.com/v0/topstories.json', {
    signal: AbortSignal.timeout(3000),
  });
  apiReachable = res.ok;
} catch {
  apiReachable = false;
}

test(
  'fetchTopStories: returns up to N shaped stories (integration)',
  { skip: !apiReachable ? 'HackerNews not reachable — skipping integration test' : false, timeout: 30_000 },
  async () => {
    const stories = await fetchTopStories(6);

    assert.ok(Array.isArray(stories), 'stories must be an array');
    assert.ok(stories.length <= 6, 'must return at most 6 stories');
    assert.ok(stories.length > 0, 'should return at least one story');

    for (const s of stories) {
      assert.ok(s.title.length > 0, 'story must have a title');
      assert.ok(s.url.length > 0, 'story must have a url (external or HN thread)');
      assert.ok(s.hnUrl.includes('news.ycombinator.com'), 'hnUrl must point at HN');
      assert.equal(typeof s.score, 'number', 'score must be a number');
    }
  },
);
