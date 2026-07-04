// @ts-nocheck
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createReaderServer } from '../src/server.js';
import { addRunItems, initSchema, insertItem, openDb, recordRun } from '../src/store.js';

const CONFIG = {
  gmailUser: 'reader@example.com',
  gmailAppPassword: 'secret',
  imapFolder: 'Newsletters',
  bootstrapDays: 7,
  ollamaModel: 'test-model',
  dbPath: ':memory:',
  outPath: '/tmp/digest-test.html',
  weatherCity: 'Warsaw',
  logLevel: 'silent',
};

const ITEM = {
  messageId: '<chat@test>',
  uid: 1,
  sender: 'News <news@example.com>',
  subject: 'Chat Newsletter',
  date: '2026-07-02T08:00:00.000Z',
  cleanText: 'This is the newsletter body for chat.',
  summary: 'A short summary.',
  link: null,
  isPaywalled: false,
};

async function withServer(options, fn) {
  const db = openDb(':memory:');
  initSchema(db);

  const server = createReaderServer({
    db,
    config: CONFIG,
    chatWithArticle: async () => 'Test answer',
    ...options,
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    await fn({ db, baseUrl });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    db.close();
  }
}

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
  await withServer({}, async ({ db, baseUrl }) => {
    insertItem(db, ITEM);
    const runId = recordRun(db, { fetched: 1, newItems: 1, durationMs: 10, ok: true });
    addRunItems(db, runId, [ITEM.messageId]);

    const response = await fetch(`${baseUrl}/`);
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.ok(html.includes('Chat Newsletter'));
    assert.ok(html.includes('class="chat-button"'));
  });
});

test('GET / renders saved weather and HackerNews for latest run', async () => {
  await withServer({}, async ({ db, baseUrl }) => {
    insertItem(db, ITEM);
    const runId = recordRun(db, {
      fetched: 1,
      newItems: 1,
      durationMs: 10,
      ok: true,
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
    addRunItems(db, runId, [ITEM.messageId]);

    const response = await fetch(`${baseUrl}/`);
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.ok(html.includes('Testowo'));
    assert.ok(html.includes('Saved HN Story'));
  });
});

test('POST /chat without messageId returns 400', async () => {
  await withServer({}, async ({ baseUrl }) => {
    const response = await fetch(`${baseUrl}/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: 'Co tu jest?' }),
    });
    const json = await response.json();

    assert.equal(response.status, 400);
    assert.ok(json.error.includes('messageId'));
  });
});

test('POST /chat without question returns 400', async () => {
  await withServer({}, async ({ baseUrl }) => {
    const response = await fetch(`${baseUrl}/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messageId: ITEM.messageId }),
    });
    const json = await response.json();

    assert.equal(response.status, 400);
    assert.ok(json.error.includes('question'));
  });
});

test('POST /chat for unknown item returns 404', async () => {
  await withServer({}, async ({ baseUrl }) => {
    const response = await fetch(`${baseUrl}/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messageId: '<missing@test>', question: 'Co tu jest?' }),
    });

    assert.equal(response.status, 404);
  });
});

test('POST /chat for known item returns answer JSON', async () => {
  let captured = null;
  await withServer({
    chatWithArticle: async (params) => {
      captured = params;
      return 'Answer from fake model';
    },
  }, async ({ db, baseUrl }) => {
    insertItem(db, ITEM);

    const response = await fetch(`${baseUrl}/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        messageId: ITEM.messageId,
        question: 'Co tu jest?',
        history: [{ role: 'user', content: 'Wczesniejsze pytanie' }],
      }),
    });
    const json = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(json, { answer: 'Answer from fake model' });
    assert.equal(captured.articleText, ITEM.cleanText);
    assert.equal(captured.model, 'test-model');
    assert.equal(captured.history.length, 1);
  });
});

test('POST /refresh redirects to new snapshot when runDigest creates one', async () => {
  await withServer({
    runDigest: async ({ db }) => {
      insertItem(db, ITEM);
      const runId = recordRun(db, { fetched: 1, newItems: 1, durationMs: 10, ok: true });
      addRunItems(db, runId, [ITEM.messageId]);
      return { fetched: 1, newItems: 1, runId };
    },
  }, async ({ baseUrl }) => {
    const response = await fetch(`${baseUrl}/refresh`, { method: 'POST', redirect: 'manual' });

    assert.equal(response.status, 303);
    assert.ok(response.headers.get('location').startsWith('/runs/1'));
  });
});
