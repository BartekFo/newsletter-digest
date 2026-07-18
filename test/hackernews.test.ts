import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchTopStories, type HackerNewsClient } from '../src/hackernews.js';
import { silentLogger } from '../src/logger.js';

test('fetchTopStories: shapes the requested stories from an injected client', async () => {
  const requestedIds: number[] = [];
  const client: HackerNewsClient = {
    async topStoryIds() {
      return [101, 102, 103];
    },
    async story(id) {
      requestedIds.push(id);
      if (id === 101) {
        return { title: 'External story', url: 'https://example.com/story', score: 42, descendants: 7 };
      }
      if (id === 102) return { title: 'Ask HN' };
      return { score: 99 };
    },
  };

  const stories = await fetchTopStories(3, silentLogger, client);

  assert.deepEqual(requestedIds, [101, 102, 103]);
  assert.deepEqual(stories, [
    {
      title: 'External story',
      url: 'https://example.com/story',
      score: 42,
      comments: 7,
      hnUrl: 'https://news.ycombinator.com/item?id=101',
    },
    {
      title: 'Ask HN',
      url: 'https://news.ycombinator.com/item?id=102',
      score: 0,
      comments: 0,
      hnUrl: 'https://news.ycombinator.com/item?id=102',
    },
  ]);
});

test('fetchTopStories: client failure returns null without throwing', async () => {
  const client: HackerNewsClient = {
    async topStoryIds() {
      throw new Error('Hacker News unavailable');
    },
    async story() {
      throw new Error('story should not be called');
    },
  };

  const stories = await fetchTopStories(6, silentLogger, client);

  assert.equal(stories, null);
});
