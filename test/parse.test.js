import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseMail } from '../src/parse.js';

const fixtureRaw = await readFile(
  new URL('./fixtures/sample-newsletter.eml', import.meta.url),
);

test('parseMail: returns correct messageId (no angle brackets)', async () => {
  const result = await parseMail(fixtureRaw);
  assert.equal(result.messageId, 'tw-2026-06-27-001@techweekly.example.com');
});

test('parseMail: returns sender', async () => {
  const result = await parseMail(fixtureRaw);
  assert.ok(result.sender.includes('editor@techweekly.example.com') || result.sender.includes('Tech Weekly'));
});

test('parseMail: returns correct subject', async () => {
  const result = await parseMail(fixtureRaw);
  assert.equal(result.subject, 'This Week in Tech: AI Breakthroughs and Open Source');
});

test('parseMail: returns ISO date string', async () => {
  const result = await parseMail(fixtureRaw);
  assert.equal(result.date, '2026-06-27T08:00:00.000Z');
  assert.match(result.date, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
});

test('parseMail: returns non-empty html', async () => {
  const result = await parseMail(fixtureRaw);
  assert.ok(result.html.length > 0, 'html should not be empty');
  assert.ok(result.html.includes('<'), 'html should contain tags');
});

test('parseMail: result has all required keys', async () => {
  const result = await parseMail(fixtureRaw);
  assert.ok('messageId' in result);
  assert.ok('sender' in result);
  assert.ok('subject' in result);
  assert.ok('date' in result);
  assert.ok('html' in result);
});
