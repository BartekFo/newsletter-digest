import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderHtml } from '../src/render.js';

const ITEM_A = {
  messageId: '<a@test>',
  uid: 1,
  sender: 'Alice <alice@example.com>',
  subject: 'Newsletter January',
  date: '2024-01-15T10:00:00.000Z',
  cleanText: 'Body A',
  summary: 'Summary of January newsletter.',
};

const ITEM_B = {
  messageId: '<b@test>',
  uid: 2,
  sender: 'Bob <bob@example.com>',
  subject: 'Newsletter February',
  date: '2024-02-20T10:00:00.000Z',
  cleanText: 'Body B',
  summary: 'Summary of February newsletter.',
};

const META = { ranAt: '2024-03-01T08:00:00.000Z', newCount: 2 };

test('two items — output contains both subjects, senders, summaries', () => {
  const html = renderHtml([ITEM_A, ITEM_B], META);

  assert.ok(html.includes('Newsletter January'), 'missing subject A');
  assert.ok(html.includes('Newsletter February'), 'missing subject B');
  assert.ok(html.includes('alice@example.com'), 'missing sender A');
  assert.ok(html.includes('bob@example.com'), 'missing sender B');
  assert.ok(html.includes('Summary of January newsletter.'), 'missing summary A');
  assert.ok(html.includes('Summary of February newsletter.'), 'missing summary B');
});

test('items are sorted by date descending (later date appears first)', () => {
  const html = renderHtml([ITEM_A, ITEM_B], META);

  const posA = html.indexOf('Newsletter January');
  const posB = html.indexOf('Newsletter February');

  // ITEM_B (February) is more recent, must appear earlier in the string
  assert.ok(posB < posA, `Expected February (pos ${posB}) before January (pos ${posA})`);
});

test('meta.newCount appears in header', () => {
  const html = renderHtml([ITEM_A, ITEM_B], META);
  assert.ok(html.includes('2'), 'newCount not found in output');
  // More precise: the strong tag wraps it
  assert.ok(html.includes('<strong>2</strong>'), 'newCount not in <strong> tag');
});

test('HTML escaping: <script> in subject does not appear raw', () => {
  const dangerous = {
    ...ITEM_A,
    subject: '<script>alert(1)</script>',
    sender: 'Safe <safe@example.com>',
  };
  const html = renderHtml([dangerous], META);

  assert.ok(!html.includes('<script>alert(1)</script>'), 'raw <script> found — not escaped!');
  assert.ok(html.includes('&lt;script&gt;'), 'escaped &lt;script&gt; not found');
});

test('HTML escaping: & in subject is escaped', () => {
  const withAmpersand = { ...ITEM_A, subject: 'Cats & Dogs' };
  const html = renderHtml([withAmpersand], META);

  // The raw & from the subject must not appear — only &amp; or inside attribute-safe contexts
  // We check that the escaped form is present
  assert.ok(html.includes('Cats &amp; Dogs'), 'ampersand not escaped in subject');
});

test('summary: null does not crash and shows fallback', () => {
  const noSummary = { ...ITEM_A, summary: null };
  let html;
  assert.doesNotThrow(() => { html = renderHtml([noSummary], META); });
  assert.ok(html.includes('brak streszczenia'), 'fallback text missing for null summary');
});

test('empty items array returns valid page with brak message, no throw', () => {
  let html;
  assert.doesNotThrow(() => { html = renderHtml([], { ranAt: '2024-03-01T08:00:00.000Z', newCount: 0 }); });
  assert.ok(html.includes('<!DOCTYPE html>'), 'not a valid HTML doc');
  assert.ok(html.includes('Brak nowych newsletterów'), 'missing brak message');
});

test('item with messageId renders a Gmail deep-link containing rfc822msgid', () => {
  const html = renderHtml([ITEM_A], META);

  assert.ok(html.includes('rfc822msgid:'), 'href missing rfc822msgid: prefix');
  // ITEM_A.messageId is '<a@test>' — encodeURIComponent encodes < > @ so check encoded form
  assert.ok(html.includes(encodeURIComponent('<a@test>')), 'encoded messageId not in href');
  assert.ok(html.includes('mail.google.com'), 'Gmail domain missing');
});

test('messageId with special chars (<, &) is URL-encoded and HTML-attribute-escaped in href', () => {
  const specialItem = {
    ...ITEM_A,
    messageId: '<foo+bar&baz@example.com>',
  };
  const html = renderHtml([specialItem], META);

  const encoded = encodeURIComponent('<foo+bar&baz@example.com>');
  // Encoded form must appear in the href
  assert.ok(html.includes(encoded), 'URL-encoded messageId not found in output');
  // Raw < must not appear inside the href attribute (escapeHtml turns it to &lt;)
  // The href value after escapeHtml must not contain a literal unencoded <
  // We verify by checking the raw character does not appear as part of an href="..." value
  const hrefMatch = html.match(/href="([^"]+)"/);
  assert.ok(hrefMatch, 'no href attribute found in output');
  assert.ok(!hrefMatch[1].includes('<'), 'raw < found unescaped inside href attribute');
  assert.ok(!hrefMatch[1].includes('&baz'), 'raw & found unescaped inside href attribute (should be %26baz)');
});

test('item with null messageId renders no href, no throw', () => {
  const noId = { ...ITEM_A, messageId: null };
  let html;
  assert.doesNotThrow(() => { html = renderHtml([noId], META); });
  assert.ok(!html.includes('rfc822msgid:'), 'href rendered despite null messageId');
});

test('item with empty string messageId renders no href, no throw', () => {
  const emptyId = { ...ITEM_A, messageId: '' };
  let html;
  assert.doesNotThrow(() => { html = renderHtml([emptyId], META); });
  assert.ok(!html.includes('rfc822msgid:'), 'href rendered despite empty messageId');
});
