// @ts-nocheck
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { extractText } from '../src/extract.js';

const fixtureHtml = await readFile(
  new URL('./fixtures/newsletter-with-junk.html', import.meta.url),
  'utf-8',
);

test('extractText: contains article body sentence', async () => {
  const text = await extractText(fixtureHtml);
  assert.ok(
    text.includes('hidden classes') || text.includes('JavaScript engines'),
    `Expected article content, got: ${text.slice(0, 200)}`,
  );
});

test('extractText: does not contain "Unsubscribe"', async () => {
  const text = await extractText(fixtureHtml);
  assert.ok(!text.includes('Unsubscribe'), `Text should not contain Unsubscribe, got: ${text.slice(0, 300)}`);
});

test('extractText: does not contain "Manage preferences"', async () => {
  const text = await extractText(fixtureHtml);
  assert.ok(!text.includes('Manage preferences'), `Text should not contain Manage preferences`);
});

test('extractText: empty string returns empty string', async () => {
  const text = await extractText('');
  assert.equal(text, '');
});

test('extractText: null/undefined returns empty string', async () => {
  const text = await extractText(null);
  assert.equal(text, '');
});

test('extractText: malformed html returns empty string (no throw)', async () => {
  const text = await extractText('<<<<not html at all!!>>');
  assert.equal(text, '');
});

test('extractText: whitespace-only html returns empty string', async () => {
  const text = await extractText('   \n\t  ');
  assert.equal(text, '');
});
