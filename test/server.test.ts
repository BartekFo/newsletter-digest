import { test } from 'node:test';
import assert from 'node:assert/strict';
import pino from 'pino';

import {
  createReaderServer,
  shouldSkipStartupRefresh,
  type ReaderServerDeps,
} from '../src/server.js';
import { addRunItems, initSchema, insertItem, openDb, recordRun } from '../src/store.js';
import type { Db } from '../src/types.js';
import { buildAppConfig, buildDigestItem } from './builders.js';

const CONFIG = buildAppConfig({
  gmailUser: 'reader@example.com',
  ollamaModel: 'test-model',
  weatherCity: 'Warsaw',
});

const ITEM = buildDigestItem({
  messageId: '<chat@test>',
  uid: 1,
  sender: 'News <news@example.com>',
  subject: 'Chat Newsletter',
  date: '2026-07-02T08:00:00.000Z',
  cleanText: 'This is the newsletter body for chat.',
  summary: 'A short summary.',
  link: null,
  isPaywalled: false,
});

type ServerOptions = Omit<ReaderServerDeps, 'db' | 'config'>;

interface ServerContext {
  db: Db;
  baseUrl: string;
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

async function withServer(options: ServerOptions, fn: ServerCallback): Promise<void> {
  const db = openDb(':memory:');
  initSchema(db);

  const server = createReaderServer({
    db,
    config: CONFIG,
    chatWithArticle: async () => 'Test answer',
    ...options,
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
    await fn({ db, baseUrl });
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    db.close();
  }
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
    const invalidPayload: unknown = { question: 'Co tu jest?' };
    const response = await postChat(baseUrl, invalidPayload);
    const json = await readJsonObject(response);

    assert.equal(response.status, 400);
    assert.ok(typeof json.error === 'string');
    assert.ok(json.error.includes('messageId'));
  });
});

test('POST /chat without question returns 400', async () => {
  await withServer({}, async ({ baseUrl }) => {
    const invalidPayload: unknown = { messageId: ITEM.messageId };
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
      messageId: '<missing@test>',
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
  }, async ({ db, baseUrl }) => {
    insertItem(db, ITEM);

    const response = await postChat(baseUrl, {
      messageId: ITEM.messageId,
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
  }, async ({ db, baseUrl }) => {
    insertItem(db, ITEM);

    const response = await postChat(baseUrl, {
      messageId: ITEM.messageId,
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
      refresh: async () => ({ fetched: 1, newItems: 1, runId: 1 }),
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
      refresh: async () => ({ fetched: 0, newItems: 0, runId: null }),
    },
  }, async ({ db, baseUrl }) => {
    insertItem(db, ITEM);
    const runId = recordRun(db, { fetched: 1, newItems: 1, durationMs: 10, ok: true });
    addRunItems(db, runId, [ITEM.messageId]);

    const response = await fetch(`${baseUrl}/refresh`, { method: 'POST', redirect: 'manual' });

    assert.equal(response.status, 303);
    assert.ok(response.headers.get('location')?.startsWith('/runs/1?notice='));
  });
});
