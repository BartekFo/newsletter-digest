import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderHtml, renderRunsPage } from '../src/render.js';
import type {
  DigestItem,
  DigestMeta,
  HackerNewsStory,
  WeatherSummary,
} from '../src/types.js';
import { buildDigestItem } from './builders.js';

const ITEM_A = buildDigestItem({
  messageId: '<a@test>',
  uid: 1,
  sender: 'Alice <alice@example.com>',
  subject: 'Newsletter January',
  date: '2024-01-15T10:00:00.000Z',
  cleanText: 'Body A',
  summary: 'Summary of January newsletter.',
  isPaywalled: false,
});

const ITEM_B = buildDigestItem({
  messageId: '<b@test>',
  uid: 2,
  sender: 'Bob <bob@example.com>',
  subject: 'Newsletter February',
  date: '2024-02-20T10:00:00.000Z',
  cleanText: 'Body B',
  summary: 'Summary of February newsletter.',
  isPaywalled: false,
});

const META: DigestMeta = { ranAt: '2024-03-01T08:00:00.000Z', newCount: 2 };

function renderUnknownItems(items: unknown, meta: DigestMeta = META): string {
  return renderHtml(items as DigestItem[], meta);
}

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
  // More precise: the count span wraps it
  assert.ok(html.includes('<span class="count">2</span>'), 'newCount not in count span');
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
  let html = '';
  assert.doesNotThrow(() => { html = renderHtml([noSummary], META); });
  assert.ok(html.includes('brak streszczenia'), 'fallback text missing for null summary');
});

test('empty items array returns valid page with brak message, no throw', () => {
  let html = '';
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

test('Gmail deep-link targets configured newsletter account when present', () => {
  const html = renderHtml([ITEM_A], { ...META, gmailUser: 'newsletters@example.com' });

  assert.ok(
    html.includes('/mail/u/newsletters%40example.com/#search/'),
    'Gmail link should include configured account',
  );
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
  const href = hrefMatch?.[1];
  assert.ok(href, 'no href attribute found in output');
  assert.ok(!href.includes('<'), 'raw < found unescaped inside href attribute');
  assert.ok(!href.includes('&baz'), 'raw & found unescaped inside href attribute (should be %26baz)');
});

test('item with null messageId renders no href, no throw', () => {
  const noId: unknown = { ...ITEM_A, messageId: null };
  let html = '';
  assert.doesNotThrow(() => { html = renderUnknownItems([noId]); });
  assert.ok(!html.includes('rfc822msgid:'), 'href rendered despite null messageId');
});

test('item with messageId renders a Chat button with data-message-id', () => {
  const html = renderHtml([ITEM_A], META);

  assert.ok(html.includes('class="chat-button"'), 'chat button missing');
  assert.ok(html.includes('data-message-id="&lt;a@test&gt;"'), 'message id data attribute missing');
});

test('chat UI communicates progress and prevents duplicate sends while waiting', () => {
  const html = renderHtml([ITEM_A], META);

  assert.ok(html.includes('Czekam na odpowiedź modelu… To może potrwać kilka minut.'), 'loading state missing');
  assert.ok(html.includes("if (!text || !messageId || sending) return;"), 'duplicate-send guard missing');
  assert.ok(html.includes('if (sending) return;'), 'article-switch guard missing');
  assert.ok(html.includes('AbortController'), 'client timeout controller missing');
  assert.ok(html.includes('CHAT_CLIENT_TIMEOUT_MS = 305_000'), 'client timeout should allow a slow local model');
  assert.ok(html.includes('Odpowiedź trwa zbyt długo'), 'client timeout message missing');
});

test('render does not include cleanText body', () => {
  const html = renderHtml([ITEM_A, ITEM_B], META);

  assert.ok(!html.includes('Body A'), 'cleanText for item A leaked into HTML');
  assert.ok(!html.includes('Body B'), 'cleanText for item B leaked into HTML');
});

test('item with empty string messageId renders no href, no throw', () => {
  const emptyId = { ...ITEM_A, messageId: '' };
  let html = '';
  assert.doesNotThrow(() => { html = renderHtml([emptyId], META); });
  assert.ok(!html.includes('rfc822msgid:'), 'href rendered despite empty messageId');
});

test('item with link renders subject as an anchor to the article', () => {
  const linked = { ...ITEM_A, link: 'https://blog.example.com/the-post' };
  const html = renderHtml([linked], META);

  assert.ok(html.includes('class="subject-link"'), 'subject-link anchor missing');
  assert.ok(html.includes('href="https://blog.example.com/the-post"'), 'article href missing');
  // Gmail deep-link still present alongside.
  assert.ok(html.includes('rfc822msgid:'), 'Gmail link dropped');
});

test('item with open.substack.com app-store redirect link renders normalized article href', () => {
  const linked = {
    ...ITEM_A,
    link: 'https://open.substack.com/pub/pragmaticengineer/p/how-kent-beck-shapes-the-software?utm_source=email&redirect=app-store&utm_campaign=email-read-in-app',
  };
  const html = renderHtml([linked], META);

  assert.ok(
    html.includes('href="https://open.substack.com/pub/pragmaticengineer/p/how-kent-beck-shapes-the-software"'),
    'normalized article href missing',
  );
  assert.ok(!html.includes('redirect=app-store'), 'app-store redirect leaked into href');
});

test('item without link renders plain subject (no subject anchor)', () => {
  const html = renderHtml([ITEM_A], META);
  assert.ok(!html.includes('class="subject-link"'), 'subject-link rendered despite no link');
});

test('subject link rejects non-http scheme (no javascript: href)', () => {
  const evil = { ...ITEM_A, link: 'javascript:alert(1)' };
  const html = renderHtml([evil], META);
  assert.ok(!html.includes('javascript:alert(1)'), 'unsafe scheme reached href');
  assert.ok(!html.includes('class="subject-link"'), 'unsafe link still wrapped subject');
});

test('paywalled item renders a visible paid badge', () => {
  const paid = { ...ITEM_A, isPaywalled: true };
  const html = renderHtml([paid], META);

  assert.ok(html.includes('class="paywall-badge"'), 'paywall badge missing');
  assert.ok(html.includes('Płatne'), 'paywall label missing');
});

test('free item does not render paid badge', () => {
  const html = renderHtml([ITEM_A], META);

  assert.ok(!html.includes('class="paywall-badge"'), 'paywall badge rendered for free item');
});

// ---------------------------------------------------------------------------
// Weather banner
// ---------------------------------------------------------------------------

const WEATHER: WeatherSummary = {
  city: 'Warszawa',
  temp: 18,
  code: 2,
  description: 'Częściowe zachmurzenie',
  max: 22,
  min: 11,
  precipProb: 30,
};

test('weather: banner renders city, temp, description and range', () => {
  const html = renderHtml([ITEM_A], { ...META, weather: WEATHER });

  assert.ok(html.includes('Warszawa'), 'missing weather city');
  assert.ok(html.includes('18°C'), 'missing current temp');
  assert.ok(html.includes('Częściowe zachmurzenie'), 'missing description');
  assert.ok(html.includes('22'), 'missing max');
  assert.ok(html.includes('30%'), 'missing precip probability');
});

test('weather: no banner when weather is null/absent', () => {
  const html = renderHtml([ITEM_A], META);
  assert.ok(!html.includes('class="weather"'), 'weather banner rendered despite no data');
});

// ---------------------------------------------------------------------------
// HackerNews section
// ---------------------------------------------------------------------------

const HN: HackerNewsStory[] = [
  { title: 'Story One', url: 'https://example.com/1', score: 250, comments: 80, hnUrl: 'https://news.ycombinator.com/item?id=1' },
  { title: 'Ask HN: something', url: 'https://news.ycombinator.com/item?id=2', score: 90, comments: 40, hnUrl: 'https://news.ycombinator.com/item?id=2' },
];

test('hackernews: section renders titles, links and scores', () => {
  const html = renderHtml([ITEM_A], { ...META, hackernews: HN });

  assert.ok(html.includes('HackerNews Top 2'), 'missing HN heading with count');
  assert.ok(html.includes('Story One'), 'missing first story title');
  assert.ok(html.includes('Ask HN: something'), 'missing second story title');
  assert.ok(html.includes('https://example.com/1'), 'missing external url');
  assert.ok(html.includes('news.ycombinator.com/item?id=1'), 'missing HN comments link');
  assert.ok(html.includes('250'), 'missing score');
});

test('hackernews: no section when list is null or empty', () => {
  const htmlNull = renderHtml([ITEM_A], META);
  assert.ok(!htmlNull.includes('class="hn"'), 'HN section rendered despite no data');

  const htmlEmpty = renderHtml([ITEM_A], { ...META, hackernews: [] });
  assert.ok(!htmlEmpty.includes('class="hn"'), 'HN section rendered for empty list');
});

test('hackernews: malicious title is escaped', () => {
  const evil: HackerNewsStory[] = [{ title: '<script>alert(1)</script>', url: 'https://x.com', score: 1, comments: 0, hnUrl: 'https://news.ycombinator.com/item?id=9' }];
  const html = renderHtml([ITEM_A], { ...META, hackernews: evil });

  assert.ok(!html.includes('<script>alert(1)</script>'), 'raw script in HN title not escaped');
  assert.ok(html.includes('&lt;script&gt;'), 'escaped script not found');
});

test('runs page renders links to run snapshots', () => {
  const html = renderRunsPage([
    { id: 7, ranAt: '2024-03-01T08:00:00.000Z', newItems: 2, itemCount: 2 },
  ]);

  assert.ok(html.includes('href="/runs/7"'), 'run link missing');
  assert.ok(html.includes('Digest #7'), 'run label missing');
});

test('runs page empty state does not crash', () => {
  const html = renderRunsPage([]);

  assert.ok(html.includes('<!DOCTYPE html>'), 'not a valid HTML doc');
  assert.ok(html.includes('Brak zapisanych digestów'), 'empty state missing');
});

test('digest and runs pages support a persistent dark theme', () => {
  const pages = [
    renderHtml([ITEM_A], META),
    renderRunsPage([]),
  ];

  for (const html of pages) {
    assert.ok(html.includes('prefers-color-scheme: dark'), 'system theme detection missing');
    assert.ok(html.includes("localStorage.getItem('newsletter-digest-theme')"), 'saved theme lookup missing');
    assert.ok(html.includes("localStorage.setItem('newsletter-digest-theme', nextTheme)"), 'theme persistence missing');
    assert.ok(html.includes(':root[data-theme="dark"]'), 'dark color palette missing');
    assert.ok(html.includes('id="theme-toggle"'), 'theme toggle missing');
    assert.ok(html.includes('aria-pressed="false"'), 'theme toggle state missing');
  }
});
