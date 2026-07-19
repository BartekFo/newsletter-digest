import { test } from 'node:test';
import assert from 'node:assert/strict';
import pino from 'pino';

import {
  createReaderServer,
  shouldSkipStartupRefresh,
  type ReaderServerDeps,
} from '../src/server.js';
import { createDigestArchive, initSchema, openDb, type DigestArchive, type RunRecord } from '../src/store.js';
import { buildAppConfig, buildDigestItem } from './builders.js';

const CONFIG = buildAppConfig({
  gmailUser: 'reader@example.com',
  ollamaModel: 'test-model',
  weatherCity: 'Warsaw',
});

const ITEM = buildDigestItem({
  newsletterId: 'newsletter-chat',
  source: { type: 'gmail', externalId: '<chat@test>', cursor: '1', metadata: { gmailMessageId: '<chat@test>', gmailUid: 1 } },
  sender: 'News <news@example.com>',
  subject: 'Chat Newsletter',
  date: '2026-07-02T08:00:00.000Z',
  cleanText: 'This is the newsletter body for chat.',
  summary: 'A short summary.',
  link: null,
  isPaywalled: false,
});

type ServerOptions = Partial<Omit<ReaderServerDeps, 'archive' | 'config'>>;

interface ServerContext {
  archive: DigestArchive;
  baseUrl: string;
  db: ReturnType<typeof openDb>;
}

type ServerCallback = (context: ServerContext) => Promise<void>;

async function readJsonObject(response: Response): Promise<Record<string, unknown>> {
  const payload: unknown = await response.json();
  assert.ok(payload && typeof payload === 'object' && !Array.isArray(payload));
  return payload as Record<string, unknown>;
}

function postChat(baseUrl: string, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function withServer(
  options: ServerOptions,
  fn: ServerCallback,
  beforeInit?: (db: ReturnType<typeof openDb>) => void,
): Promise<void> {
  const db = openDb(':memory:');
  beforeInit?.(db);
  initSchema(db);
  const archive = createDigestArchive(db);

  const {
    chatWithArticle = async () => 'Test answer',
    ...serverOptions
  } = options;
  const server = createReaderServer({
    archive,
    config: CONFIG,
    ...serverOptions,
    chatWithArticle,
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Reader test server did not bind to an ephemeral TCP port');
  }
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    await fn({ archive, baseUrl, db });
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    archive.close();
  }
}

function publishItem(archive: DigestArchive, run: Partial<RunRecord> = {}): number {
  return archive.publishSnapshot({
    items: [ITEM],
    cursor: ITEM.source.cursor,
    run: { fetched: 1, newItems: 1, durationMs: 10, ok: true, ...run },
  });
}

function publishItems(archive: DigestArchive, items: ReturnType<typeof buildDigestItem>[]): number {
  return archive.publishSnapshot({
    items,
    cursor: items.at(-1)?.source.cursor ?? '0',
    run: { fetched: items.length, newItems: items.length, durationMs: 10, ok: true },
  });
}

test('shouldSkipStartupRefresh reads --no-refresh and --open', () => {
  assert.equal(shouldSkipStartupRefresh(['node', 'server.js']), false);
  assert.equal(shouldSkipStartupRefresh(['node', 'server.js', '--no-refresh']), true);
  assert.equal(shouldSkipStartupRefresh(['node', 'server.js', '--open']), true);
});

test('GET / without runs shows empty state', async () => {
  await withServer({}, async ({ baseUrl }) => {
    const response = await fetch(`${baseUrl}/`);
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.ok(html.includes('Brak nowych newsletterów'));
    assert.ok(html.includes('Pobierz nowe'));
  });
});

test('GET /runs/:id for missing run returns 404', async () => {
  await withServer({}, async ({ baseUrl }) => {
    const response = await fetch(`${baseUrl}/runs/999`);
    const html = await response.text();

    assert.equal(response.status, 404);
    assert.ok(html.includes('Nie znaleziono digestu #999'));
  });
});

test('GET / renders latest non-empty run', async () => {
  await withServer({}, async ({ archive, baseUrl }) => {
    publishItem(archive);

    const response = await fetch(`${baseUrl}/`);
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.ok(html.includes('Chat Newsletter'));
    assert.ok(html.includes('class="chat-button"'));
  });
});

test('GET / resolves original links through the configured source adapter', async () => {
  await withServer({
    resolveSourceLink: () => ({
      url: 'https://source.example/original',
      label: 'Otwórz w źródle',
    }),
  }, async ({ archive, baseUrl }) => {
    publishItem(archive);

    const response = await fetch(`${baseUrl}/`);
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.ok(html.includes('href="https://source.example/original"'));
    assert.ok(html.includes('Otwórz w źródle'));
  });
});

test('GET / renders saved weather and HackerNews for latest run', async () => {
  await withServer({}, async ({ archive, baseUrl }) => {
    publishItem(archive, {
      weather: {
        city: 'Testowo',
        temp: 12,
        code: 3,
        description: 'Pochmurno',
        max: 15,
        min: 7,
        precipProb: 40,
      },
      hackernews: [{
        title: 'Saved HN Story',
        url: 'https://example.com/story',
        score: 123,
        comments: 45,
        hnUrl: 'https://news.ycombinator.com/item?id=1',
      }],
    });

    const response = await fetch(`${baseUrl}/`);
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.ok(html.includes('Testowo'));
    assert.ok(html.includes('Saved HN Story'));
  });
});

test('GET /newsletters renders each stored newsletter once with shared navigation', async () => {
  await withServer({}, async ({ archive, baseUrl }) => {
    publishItems(archive, [ITEM]);
    publishItems(archive, [ITEM]);

    const response = await fetch(`${baseUrl}/newsletters`);
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.equal(html.match(/Chat Newsletter/g)?.length, 1);
    assert.ok(html.includes('Łącznie: <strong>1</strong>'));
    assert.ok(html.includes('href="/newsletters"'));
    assert.ok(html.includes(`href="/newsletters/${ITEM.newsletterId}"`));
  });
});

test('GET /newsletters orders newest first with insertion order as the equal-date tie-breaker', async () => {
  await withServer({}, async ({ archive, baseUrl }) => {
    const sameDate = '2026-07-03T08:00:00.000Z';
    publishItems(archive, [
      buildDigestItem({ newsletterId: 'newsletter-first', source: { type: 'test', externalId: 'first', cursor: '1', metadata: {} }, subject: 'Inserted first', date: sameDate }),
      buildDigestItem({ newsletterId: 'newsletter-second', source: { type: 'test', externalId: 'second', cursor: '2', metadata: {} }, subject: 'Inserted second', date: sameDate }),
      buildDigestItem({ newsletterId: 'newsletter-older', source: { type: 'test', externalId: 'older', cursor: '3', metadata: {} }, subject: 'Older newsletter', date: '2026-07-02T08:00:00.000Z' }),
    ]);

    const html = await (await fetch(`${baseUrl}/newsletters`)).text();

    assert.ok(html.indexOf('Inserted first') < html.indexOf('Inserted second'));
    assert.ok(html.indexOf('Inserted second') < html.indexOf('Older newsletter'));
  });
});

test('GET /newsletters paginates by 25 and accepts an out-of-range page as empty', async () => {
  await withServer({}, async ({ archive, baseUrl }) => {
    const items = Array.from({ length: 26 }, (_, index) => buildDigestItem({
      newsletterId: `newsletter-${index}`,
      source: { type: 'test', externalId: `external-${index}`, cursor: String(index), metadata: {} },
      subject: `Newsletter ${String(index).padStart(2, '0')}`,
      date: new Date(Date.UTC(2026, 6, 1, 0, 0, index)).toISOString(),
    }));
    publishItems(archive, items);

    const firstHtml = await (await fetch(`${baseUrl}/newsletters`)).text();
    const secondHtml = await (await fetch(`${baseUrl}/newsletters?page=2`)).text();
    const emptyResponse = await fetch(`${baseUrl}/newsletters?page=3`);
    const emptyHtml = await emptyResponse.text();

    assert.ok(firstHtml.includes('Strona 1 z 2'));
    assert.ok(firstHtml.includes('href="/newsletters?page=2"'));
    assert.ok(!firstHtml.includes('Newsletter 00'));
    assert.ok(secondHtml.includes('Newsletter 00'));
    assert.ok(secondHtml.includes('href="/newsletters?page=1"'));
    assert.equal(emptyResponse.status, 200);
    assert.ok(emptyHtml.includes('Brak newsletterów na tej stronie'));
  });
});

test('GET /newsletters rejects invalid pages and escapes newsletter-controlled fields', async () => {
  await withServer({}, async ({ archive, baseUrl }) => {
    publishItems(archive, [buildDigestItem({
      newsletterId: 'newsletter-dangerous',
      source: { type: 'test', externalId: 'dangerous', cursor: '1', metadata: {} },
      subject: '<script>alert(1)</script>',
      sender: '<img src=x onerror=alert(1)>',
      summary: '<b>unsafe</b>',
    })]);

    const archiveHtml = await (await fetch(`${baseUrl}/newsletters`)).text();
    const invalidResponse = await fetch(`${baseUrl}/newsletters?page=zero`);
    const invalidHtml = await invalidResponse.text();

    assert.ok(!archiveHtml.includes('<script>alert(1)</script>'));
    assert.ok(!archiveHtml.includes('<img src=x onerror=alert(1)>'));
    assert.ok(!archiveHtml.includes('<b>unsafe</b>'));
    assert.equal(invalidResponse.status, 400);
    assert.ok(invalidHtml.includes('Numer strony musi być dodatnią liczbą całkowitą'));
  });
});

test('GET /newsletters searches subject, sender, summary, and body with Polish case folding', async () => {
  await withServer({}, async ({ archive, baseUrl }) => {
    publishItems(archive, [
      buildDigestItem({ newsletterId: 'search-subject', source: { type: 'test', externalId: 'search-subject', cursor: '1', metadata: {} }, subject: 'ŻÓŁĆ i innowacje', sender: 'Alpha', summary: null, cleanText: 'One' }),
      buildDigestItem({ newsletterId: 'search-sender', source: { type: 'test', externalId: 'search-sender', cursor: '2', metadata: {} }, subject: 'Two', sender: 'Nadawca wyjątkowy', summary: null, cleanText: 'Two' }),
      buildDigestItem({ newsletterId: 'search-summary', source: { type: 'test', externalId: 'search-summary', cursor: '3', metadata: {} }, subject: 'Three', sender: 'Gamma', summary: 'Sekretne podsumowanie', cleanText: 'Three' }),
      buildDigestItem({ newsletterId: 'search-body', source: { type: 'test', externalId: 'search-body', cursor: '4', metadata: {} }, subject: 'Four', sender: 'Delta', summary: null, cleanText: 'Ukryty fragment treści' }),
    ]);

    const cases = [
      ['żółć', 'ŻÓŁĆ i innowacje'],
      ['WYJĄTKOWY', 'Nadawca wyjątkowy'],
      ['podsumowanie', 'Sekretne podsumowanie'],
      ['fragment', 'Four'],
    ] as const;
    for (const [query, expected] of cases) {
      const response = await fetch(`${baseUrl}/newsletters?q=${encodeURIComponent(query)}`);
      const html = await response.text();
      assert.equal(response.status, 200);
      assert.ok(html.includes(expected), `${query} should find ${expected}`);
      assert.ok(html.includes('Łącznie: <strong>1</strong>'));
    }
  });
});

test('GET /newsletters treats FTS-looking punctuation as plain input and blank input as browsing', async () => {
  await withServer({}, async ({ archive, baseUrl }) => {
    publishItems(archive, [buildDigestItem({
      newsletterId: 'search-safe',
      source: { type: 'test', externalId: 'search-safe', cursor: '1', metadata: {} },
      subject: 'AND OR quoted phrase',
    })]);

    const hostileResponse = await fetch(`${baseUrl}/newsletters?q=${encodeURIComponent('"AND" OR (phrase)* -')}`);
    const hostileHtml = await hostileResponse.text();
    const blankHtml = await (await fetch(`${baseUrl}/newsletters?q=%20%20`)).text();

    assert.equal(hostileResponse.status, 200);
    assert.ok(!hostileHtml.includes('Błąd serwera'));
    assert.ok(blankHtml.includes('AND OR quoted phrase'));
  });
});

test('GET /newsletters keeps search ordering and query state across pagination', async () => {
  await withServer({}, async ({ archive, baseUrl }) => {
    publishItems(archive, Array.from({ length: 26 }, (_, index) => buildDigestItem({
      newsletterId: `matching-${index}`,
      source: { type: 'test', externalId: `matching-${index}`, cursor: String(index), metadata: {} },
      subject: `Wspólny temat ${String(index).padStart(2, '0')}`,
      date: new Date(Date.UTC(2026, 6, 1, 0, 0, index)).toISOString(),
    })));

    const html = await (await fetch(`${baseUrl}/newsletters?q=wspólny`)).text();

    assert.ok(html.indexOf('Wspólny temat 25') < html.indexOf('Wspólny temat 24'));
    assert.ok(html.includes('href="/newsletters?q=wsp%C3%B3lny&amp;page=2"'));
    assert.ok(html.includes('Łącznie: <strong>26</strong>'));
  });
});

test('GET /newsletters searches rows stored before the FTS schema existed', async () => {
  await withServer({}, async ({ baseUrl }) => {
    const response = await fetch(`${baseUrl}/newsletters?q=przedindeksowy`);
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.ok(html.includes('Newsletter sprzed indeksu'));
  }, (db) => {
    db.exec(`
      CREATE TABLE items (
        newsletter_id TEXT PRIMARY KEY,
        source_type TEXT NOT NULL,
        source_external_id TEXT NOT NULL,
        source_cursor TEXT NOT NULL,
        source_metadata_json TEXT NOT NULL,
        sender TEXT,
        subject TEXT,
        date TEXT,
        clean_text TEXT,
        summary TEXT,
        link TEXT,
        is_paywalled INTEGER DEFAULT 0,
        created_at TEXT
      );
      INSERT INTO items VALUES (
        'newsletter-before-fts', 'test', 'before-fts', '1', '{}', 'Archiwalny nadawca',
        'Newsletter sprzed indeksu', '2026-07-01T08:00:00Z', 'przedindeksowy tekst',
        null, null, 0, datetime('now')
      );
    `);
  });
});

test('failed snapshot publication leaves no searchable orphan', async () => {
  await withServer({}, async ({ archive, baseUrl, db }) => {
    db.exec(`
      CREATE TRIGGER fail_archive_publication
      BEFORE INSERT ON run_items
      BEGIN
        SELECT RAISE(ABORT, 'test publication failure');
      END;
    `);
    const orphan = buildDigestItem({
      newsletterId: 'newsletter-orphan',
      source: { type: 'test', externalId: 'orphan', cursor: '1', metadata: {} },
      subject: 'Searchable orphan marker',
    });

    assert.throws(() => publishItems(archive, [orphan]), /test publication failure/);
    const html = await (await fetch(`${baseUrl}/newsletters?q=orphan`)).text();

    assert.ok(html.includes('Łącznie: <strong>0</strong>'));
    assert.ok(!html.includes('Searchable orphan marker'));
  });
});

test('GET /newsletters/:newsletterId renders the complete newsletter and existing chat controls', async () => {
  await withServer({
    resolveSourceLink: () => ({ url: 'https://source.example/message', label: 'Otwórz w źródle' }),
  }, async ({ archive, baseUrl }) => {
    const detailItem = buildDigestItem({
      newsletterId: 'newsletter-detail',
      source: { type: 'test', externalId: 'external-detail', cursor: '1', metadata: {} },
      sender: 'Detail Sender',
      subject: 'Detailed Newsletter',
      date: '2026-07-04T10:00:00.000Z',
      summary: 'Detailed summary',
      cleanText: 'First paragraph\n\nSecond paragraph',
      link: 'https://article.example/read',
      isPaywalled: true,
    });
    publishItems(archive, [detailItem]);

    const response = await fetch(`${baseUrl}/newsletters/${detailItem.newsletterId}`);
    const html = await response.text();

    assert.equal(response.status, 200);
    for (const text of ['Detailed Newsletter', 'Detail Sender', 'Detailed summary', 'First paragraph', 'Second paragraph', 'Płatne', 'Otwórz artykuł', 'Otwórz w źródle']) {
      assert.ok(html.includes(text), `missing ${text}`);
    }
    assert.ok(html.includes('href="https://article.example/read"'));
    assert.ok(html.includes('href="https://source.example/message"'));
    assert.ok(html.includes('class="chat-button"'));
    assert.ok(html.includes('id="chat-panel"'));
    assert.ok(html.includes('href="/newsletters"'));
  });
});

test('newsletter detail lookup accepts only opaque internal identity and missing IDs return a useful 404', async () => {
  await withServer({}, async ({ archive, baseUrl }) => {
    publishItems(archive, [ITEM]);

    const sourceIdentityResponse = await fetch(`${baseUrl}/newsletters/${encodeURIComponent(ITEM.source.externalId)}`);
    const missingResponse = await fetch(`${baseUrl}/newsletters/newsletter-missing`);
    const missingHtml = await missingResponse.text();

    assert.equal(sourceIdentityResponse.status, 404);
    assert.equal(missingResponse.status, 404);
    assert.ok(missingHtml.includes('Nie znaleziono newslettera'));
    assert.ok(missingHtml.includes('href="/newsletters"'));
  });
});

test('newsletter detail shows missing-summary state and escapes all controlled content and unsafe links', async () => {
  await withServer({
    resolveSourceLink: () => ({ url: 'javascript:alert(2)', label: '<b>unsafe source</b>' }),
  }, async ({ archive, baseUrl }) => {
    const dangerous = buildDigestItem({
      newsletterId: 'newsletter-danger-detail',
      source: { type: 'test', externalId: 'danger-detail', cursor: '1', metadata: {} },
      sender: '<img src=x onerror=alert(1)>',
      subject: '<script>alert(1)</script>',
      summary: null,
      cleanText: '<svg onload=alert(1)>',
      link: 'javascript:alert(1)',
    });
    publishItems(archive, [dangerous]);

    const html = await (await fetch(`${baseUrl}/newsletters/${dangerous.newsletterId}`)).text();

    assert.ok(html.includes('Brak streszczenia'));
    assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
    assert.ok(html.includes('&lt;svg onload=alert(1)&gt;'));
    assert.ok(!html.includes('<img src=x onerror=alert(1)>'));
    assert.ok(!html.includes('javascript:alert'));
    assert.ok(!html.includes('<b>unsafe source</b>'));
  });
});

test('GET /newsletters applies sender, Warsaw date, paywall, and summary filters independently', async () => {
  await withServer({}, async ({ archive, baseUrl }) => {
    publishItems(archive, [
      buildDigestItem({ newsletterId: 'filter-before', source: { type: 'test', externalId: 'filter-before', cursor: '1', metadata: {} }, sender: 'Beta Sender', subject: 'Before local day', date: '2026-06-30T21:59:59.999Z', summary: null, isPaywalled: false }),
      buildDigestItem({ newsletterId: 'filter-start', source: { type: 'test', externalId: 'filter-start', cursor: '2', metadata: {} }, sender: 'Alpha Sender', subject: 'Local day start', date: '2026-06-30T22:00:00.000Z', summary: 'Has summary', isPaywalled: true }),
      buildDigestItem({ newsletterId: 'filter-end', source: { type: 'test', externalId: 'filter-end', cursor: '3', metadata: {} }, sender: 'Beta Sender', subject: 'Local day end', date: '2026-07-01T21:59:59.999Z', summary: null, isPaywalled: false }),
      buildDigestItem({ newsletterId: 'filter-after', source: { type: 'test', externalId: 'filter-after', cursor: '4', metadata: {} }, sender: 'Gamma Sender', subject: 'After local day', date: '2026-07-01T22:00:00.000Z', summary: 'Later summary', isPaywalled: true }),
    ]);

    const cases = [
      ['sender=Alpha+Sender', ['Local day start'], ['Before local day', 'Local day end', 'After local day']],
      ['from=2026-07-01', ['Local day start', 'Local day end', 'After local day'], ['Before local day']],
      ['to=2026-07-01', ['Before local day', 'Local day start', 'Local day end'], ['After local day']],
      ['paywall=paid', ['Local day start', 'After local day'], ['Before local day', 'Local day end']],
      ['paywall=free', ['Before local day', 'Local day end'], ['Local day start', 'After local day']],
      ['summary=with', ['Local day start', 'After local day'], ['Before local day', 'Local day end']],
      ['summary=without', ['Before local day', 'Local day end'], ['Local day start', 'After local day']],
    ] as const;
    for (const [params, included, excluded] of cases) {
      const html = await (await fetch(`${baseUrl}/newsletters?${params}`)).text();
      for (const subject of included) assert.ok(html.includes(subject), `${params} should include ${subject}`);
      for (const subject of excluded) assert.ok(!html.includes(subject), `${params} should exclude ${subject}`);
    }
  });
});

test('archive filters compose with search, expose deterministic senders, persist in pagination, and reset', async () => {
  await withServer({}, async ({ archive, baseUrl }) => {
    publishItems(archive, Array.from({ length: 26 }, (_, index) => buildDigestItem({
      newsletterId: `composed-${index}`,
      source: { type: 'test', externalId: `composed-${index}`, cursor: String(index), metadata: {} },
      sender: index === 0 ? 'Zulu Sender' : 'Alpha Sender',
      subject: `Composable marker ${index}`,
      date: new Date(Date.UTC(2026, 6, 10, 0, 0, index)).toISOString(),
      summary: 'Ready',
      isPaywalled: true,
    })));

    const response = await fetch(`${baseUrl}/newsletters?q=marker&paywall=paid&summary=with&from=2026-07-01&to=2026-07-31`);
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.ok(html.includes('Łącznie: <strong>26</strong>'));
    assert.ok(html.indexOf('Alpha Sender') < html.indexOf('Zulu Sender'));
    assert.ok(html.includes('q=marker&amp;from=2026-07-01&amp;to=2026-07-31&amp;paywall=paid&amp;summary=with&amp;page=2'));
    assert.ok(html.includes('href="/newsletters"'));
    assert.ok(html.includes('Wyczyść filtry'));
  });
});

test('GET /newsletters returns readable validation errors for unsupported filters without crashing', async () => {
  await withServer({}, async ({ baseUrl }) => {
    const invalidQueries = [
      'page=0',
      'from=2026-02-30',
      'to=tomorrow',
      'paywall=maybe',
      'summary=unknown',
    ];
    for (const query of invalidQueries) {
      const response = await fetch(`${baseUrl}/newsletters?${query}`);
      const html = await response.text();
      assert.equal(response.status, 400, query);
      assert.ok(html.includes('Niepoprawne filtry archiwum'), query);
      assert.ok(!html.includes('Błąd serwera'), query);
    }
  });
});

test('POST /chat without newsletterId returns 400', async () => {
  await withServer({}, async ({ baseUrl }) => {
    const invalidPayload: unknown = { question: 'Co tu jest?' };
    const response = await postChat(baseUrl, invalidPayload);
    const json = await readJsonObject(response);

    assert.equal(response.status, 400);
    assert.ok(typeof json.error === 'string');
    assert.ok(json.error.includes('newsletterId'));
  });
});

test('POST /chat without question returns 400', async () => {
  await withServer({}, async ({ baseUrl }) => {
    const invalidPayload: unknown = { newsletterId: ITEM.newsletterId };
    const response = await postChat(baseUrl, invalidPayload);
    const json = await readJsonObject(response);

    assert.equal(response.status, 400);
    assert.ok(typeof json.error === 'string');
    assert.ok(json.error.includes('question'));
  });
});

test('POST /chat for unknown item returns 404', async () => {
  await withServer({}, async ({ baseUrl }) => {
    const response = await postChat(baseUrl, {
      newsletterId: 'missing-newsletter',
      question: 'Co tu jest?',
    });

    assert.equal(response.status, 404);
  });
});

test('POST /chat for known item returns answer JSON', async () => {
  const captured: Parameters<NonNullable<ReaderServerDeps['chatWithArticle']>>[0][] = [];
  await withServer({
    chatWithArticle: async (params) => {
      captured.push(params);
      return 'Answer from fake model';
    },
  }, async ({ archive, baseUrl }) => {
    publishItem(archive);

    const response = await postChat(baseUrl, {
      newsletterId: ITEM.newsletterId,
      question: 'Co tu jest?',
      history: [{ role: 'user', content: 'Wczesniejsze pytanie' }],
    });
    const json = await readJsonObject(response);

    assert.equal(response.status, 200);
    assert.deepEqual(json, { answer: 'Answer from fake model' });
    const request = captured[0];
    assert.ok(request);
    assert.equal(request.articleText, ITEM.cleanText);
    assert.equal(request.model, 'test-model');
    assert.equal(request.history?.length, 1);
  });
});

test('POST /chat stops waiting for an unresponsive model and logs the timeout', async () => {
  const logs: Record<string, unknown>[] = [];
  const logger = pino({ level: 'trace' }, {
    write(line: string) {
      const entry: unknown = JSON.parse(line);
      if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
        logs.push(entry as Record<string, unknown>);
      }
    },
  });

  await withServer({
    logger,
    chatTimeoutMs: 10,
    chatWithArticle: async () => new Promise(() => {}),
  }, async ({ archive, baseUrl }) => {
    publishItem(archive);

    const response = await postChat(baseUrl, {
      newsletterId: ITEM.newsletterId,
      question: 'Co tu jest?',
    });
    const json = await readJsonObject(response);

    assert.equal(response.status, 504);
    assert.ok(typeof json.error === 'string');
    assert.match(json.error, /Ollama nie odpowiedziała w ciągu/);
    assert.ok(logs.some((entry) => entry.msg === 'Rozpoczęto chat z newsletterem'));
    assert.ok(logs.some((entry) => entry.msg === 'Chat przekroczył limit czasu'));
  });
});

test('POST /refresh invokes the small refresh use-case and redirects to its snapshot', async () => {
  await withServer({
    refresh: {
      refresh: async () => ({ fetched: 1, newItems: 1, runId: 1, newsletterIds: [ITEM.newsletterId] }),
    },
  }, async ({ baseUrl }) => {
    const response = await fetch(`${baseUrl}/refresh`, { method: 'POST', redirect: 'manual' });

    assert.equal(response.status, 303);
    assert.ok(response.headers.get('location')?.startsWith('/runs/1'));
  });
});

test('POST /refresh keeps the latest snapshot when no new newsletters are found', async () => {
  await withServer({
    refresh: {
      refresh: async () => ({ fetched: 0, newItems: 0, runId: null, newsletterIds: [] }),
    },
  }, async ({ archive, baseUrl }) => {
    publishItem(archive);

    const response = await fetch(`${baseUrl}/refresh`, { method: 'POST', redirect: 'manual' });

    assert.equal(response.status, 303);
    assert.ok(response.headers.get('location')?.startsWith('/runs/1?notice='));
  });
});
