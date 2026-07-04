// @ts-nocheck
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseMail, extractLink, detectPaywall } from '../src/parse.js';

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
  assert.ok('link' in result);
  assert.ok('isPaywalled' in result);
});

test('parseMail: extracts web-version link from newsletter body', async () => {
  const result = await parseMail(fixtureRaw);
  assert.equal(result.link, 'https://techweekly.example.com/view?id=001');
});

test('extractLink: picks up og:url', () => {
  const html = '<html><head><meta property="og:url" content="https://blog.example.com/post-1"></head><body>hi</body></html>';
  assert.equal(extractLink(html), 'https://blog.example.com/post-1');
});

test('extractLink: picks up og:url with reversed attribute order', () => {
  const html = '<meta content="https://blog.example.com/post-2" property="og:url">';
  assert.equal(extractLink(html), 'https://blog.example.com/post-2');
});

test('extractLink: falls back to rel=canonical', () => {
  const html = '<link rel="canonical" href="https://blog.example.com/canon">';
  assert.equal(extractLink(html), 'https://blog.example.com/canon');
});

test('extractLink: og:url wins over canonical', () => {
  const html =
    '<meta property="og:url" content="https://blog.example.com/og">' +
    '<link rel="canonical" href="https://blog.example.com/canon">';
  assert.equal(extractLink(html), 'https://blog.example.com/og');
});

test('extractLink: falls back to view-in-browser body link', () => {
  const html = `
    <a href="https://newsletter.example.com">Home</a>
    <a href="https://newsletter.example.com/archive">Archive</a>
    <a href="https://newsletter.example.com/view?id=42">View in browser</a>
  `;
  assert.equal(extractLink(html), 'https://newsletter.example.com/view?id=42');
});

test('extractLink: prioritizes Substack read-in-app body link', () => {
  const html = `
    <a href="https://example.substack.com">Home</a>
    <a href="https://example.substack.com/archive">Archive</a>
    <a href="https://example.substack.com/p/the-post?utm_source=substack&utm_medium=email">Read in app</a>
    <a href="https://example.substack.com/account">Manage subscription</a>
  `;
  assert.equal(
    extractLink(html),
    'https://example.substack.com/p/the-post?utm_source=substack&utm_medium=email',
  );
});

test('extractLink: strips app-store redirect params from open.substack.com article links', () => {
  const html = `
    <a href="https://pragmaticengineer.substack.com">Home</a>
    <a href="https://open.substack.com/pub/pragmaticengineer/p/how-kent-beck-shapes-the-software?utm_source=email&amp;redirect=app-store&amp;utm_campaign=email-read-in-app">Read in app</a>
    <a href="https://pragmaticengineer.substack.com/account">Manage subscription</a>
  `;
  assert.equal(
    extractLink(html),
    'https://open.substack.com/pub/pragmaticengineer/p/how-kent-beck-shapes-the-software',
  );
});

test('extractLink: falls back to first non-boilerplate body link', () => {
  const html = `
    <a href="https://newsletter.example.com">Home</a>
    <a href="https://newsletter.example.com/preferences">Manage preferences</a>
    <a href="https://blog.example.com/post-3">Read the article</a>
  `;
  assert.equal(extractLink(html), 'https://blog.example.com/post-3');
});

test('extractLink: decodes escaped href attributes', () => {
  const html = '<a href="https://newsletter.example.com/view?id=42&amp;token=abc">Read online</a>';
  assert.equal(extractLink(html), 'https://newsletter.example.com/view?id=42&token=abc');
});

test('extractLink: rejects non-http schemes', () => {
  const html = '<meta property="og:url" content="javascript:alert(1)">';
  assert.equal(extractLink(html), null);
});

test('extractLink: returns null when neither present', () => {
  assert.equal(extractLink('<p>no canonical here</p>'), null);
  assert.equal(extractLink(''), null);
  assert.equal(extractLink(null), null);
});

test('detectPaywall: marks explicit Substack paid-subscriber teaser', () => {
  const html = `
    <article>
      <p>Here is the free preview.</p>
      <p>This post is for paid subscribers</p>
      <a href="https://example.substack.com/subscribe">Subscribe to read more</a>
    </article>
  `;

  assert.equal(detectPaywall(html), true);
});

test('detectPaywall: marks paid subscriber copy with HTML entities', () => {
  const html = '<p>Keep reading with a 7-day free trial</p><p>Become a paid&nbsp;subscriber.</p>';

  assert.equal(detectPaywall(html), true);
});

test('detectPaywall: marks unlock-the-rest paid newsletter copy', () => {
  const html = `
    <p>The clearer you define the outcome, the better the AI performs.</p>
    <p>Subscribe to Engineering Leadership to unlock the rest.</p>
    <p>Become a paying subscriber of Engineering Leadership to get access to this post and other subscriber-only content.</p>
    <a href="https://example.substack.com/subscribe">Upgrade to paid</a>
  `;

  assert.equal(detectPaywall(html), true);
});

test('detectPaywall: does not mark ordinary subscription boilerplate', () => {
  const html = `
    <p>Read the full newsletter above.</p>
    <a href="https://newsletter.example.com/subscribe">Subscribe</a>
    <a href="https://newsletter.example.com/account">Manage subscription</a>
  `;

  assert.equal(detectPaywall(html), false);
});
