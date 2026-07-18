import { test } from 'node:test';
import assert from 'node:assert/strict';

import { fetchTopStories } from '../../src/hackernews.js';
import { isReachable } from './support.js';

const apiReachable = await isReachable(
  'https://hacker-news.firebaseio.com/v0/topstories.json',
  3000,
);

test(
  'Hacker News returns shaped top stories',
  {
    skip: apiReachable ? false : 'Hacker News not reachable — skipping smoke test',
    timeout: 30_000,
  },
  async () => {
    const stories = await fetchTopStories(6);

    assert.ok(stories, 'stories must not be null');
    assert.ok(stories.length > 0, 'should return at least one story');
    assert.ok(stories.length <= 6, 'must return at most six stories');
    for (const story of stories) {
      assert.ok(story.title.length > 0, 'story must have a title');
      assert.ok(story.url.length > 0, 'story must have a URL');
      assert.ok(story.hnUrl.includes('news.ycombinator.com'), 'hnUrl must point at HN');
      assert.equal(typeof story.score, 'number', 'score must be a number');
    }
  },
);
