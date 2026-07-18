import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  openDb,
  initSchema,
  getLastUid,
  setLastUid,
  isKnown,
  insertItem,
  setSummary,
  recordRun,
  getItemsByUids,
  getItemByMessageId,
  addRunItems,
  getItemsByRunId,
  getLatestNonEmptyRun,
  getRunSummaries,
} from '../src/store.js';
import type { Db } from '../src/types.js';
import { buildDigestItem } from './builders.js';

const SAMPLE_ITEM = buildDigestItem();

function freshDb(): Db {
  const db = openDb(':memory:');
  initSchema(db);
  return db;
}

test('openDb returns a better-sqlite3 instance', () => {
  const db = openDb(':memory:');
  assert.ok(db);
  assert.equal(typeof db.prepare, 'function');
  db.close();
});

test('initSchema creates tables; calling twice does not throw', () => {
  const db = openDb(':memory:');
  initSchema(db);
  initSchema(db); // idempotent

  const tables = (db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all() as { name: string }[])
    .map((r) => r.name);

  assert.ok(tables.includes('items'));
  assert.ok(tables.includes('run_items'));
  assert.ok(tables.includes('state'));
  assert.ok(tables.includes('runs'));
  db.close();
});

test('initSchema migrates legacy items table with is_paywalled column', () => {
  const db = openDb(':memory:');
  db.exec(`
    CREATE TABLE items (
      message_id TEXT PRIMARY KEY,
      uid        INTEGER,
      sender     TEXT,
      subject    TEXT,
      date       TEXT,
      clean_text TEXT,
      summary    TEXT,
      link       TEXT,
      created_at TEXT
    );
  `);

  initSchema(db);

  const columns = (db.prepare('PRAGMA table_info(items)').all() as { name: string }[])
    .map((r) => r.name);
  assert.ok(columns.includes('is_paywalled'), 'is_paywalled column missing');
  db.close();
});

test('initSchema expands an existing archive with stable newsletter and source identity', () => {
  const db = openDb(':memory:');
  db.exec(`
    CREATE TABLE items (
      message_id TEXT PRIMARY KEY,
      uid INTEGER,
      sender TEXT,
      subject TEXT,
      date TEXT,
      clean_text TEXT,
      summary TEXT,
      link TEXT,
      is_paywalled INTEGER DEFAULT 0,
      created_at TEXT
    );
    CREATE TABLE runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ran_at TEXT,
      fetched INTEGER,
      new_items INTEGER,
      duration_ms INTEGER,
      ok INTEGER,
      weather_json TEXT,
      hackernews_json TEXT
    );
    CREATE TABLE run_items (
      run_id INTEGER NOT NULL,
      message_id TEXT NOT NULL,
      PRIMARY KEY (run_id, message_id)
    );
    INSERT INTO items VALUES (
      '<legacy@example.com>', 42, 'Legacy', 'Preserved',
      '2026-07-01T08:00:00Z', 'Body', 'Summary', NULL, 0, datetime('now')
    );
    INSERT INTO runs VALUES (1, datetime('now'), 1, 1, 10, 1, NULL, NULL);
    INSERT INTO run_items VALUES (1, '<legacy@example.com>');
  `);

  initSchema(db);

  const item = getItemByMessageId(db, '<legacy@example.com>');
  assert.ok(item);
  assert.match(item.id, /^newsletter-/);
  assert.equal(item.source.type, 'gmail');
  assert.equal(item.source.externalId, '<legacy@example.com>');
  assert.equal(item.messageId, '<legacy@example.com>', 'legacy identity remains available during expand');
  assert.equal(getItemsByRunId(db, 1)[0]?.id, item.id, 'snapshot relation is backfilled');
  db.close();
});

test('getLastUid returns null on fresh db', () => {
  const db = freshDb();
  assert.equal(getLastUid(db), null);
  db.close();
});

test('setLastUid then getLastUid returns the number', () => {
  const db = freshDb();
  setLastUid(db, 42);
  assert.equal(getLastUid(db), 42);
  db.close();
});

test('setLastUid overwrites previous value', () => {
  const db = freshDb();
  setLastUid(db, 42);
  setLastUid(db, 99);
  assert.equal(getLastUid(db), 99);
  db.close();
});

test('insertItem returns true for a new item', () => {
  const db = freshDb();
  const result = insertItem(db, SAMPLE_ITEM);
  assert.equal(result, true);
  db.close();
});

test('insertItem returns false for a duplicate messageId', () => {
  const db = freshDb();
  insertItem(db, SAMPLE_ITEM);
  const result = insertItem(db, SAMPLE_ITEM);
  assert.equal(result, false);
  db.close();
});

test('insertItem duplicate does not create a second row', () => {
  const db = freshDb();
  insertItem(db, SAMPLE_ITEM);
  insertItem(db, SAMPLE_ITEM);
  const count = (db.prepare('SELECT COUNT(*) as c FROM items').get() as { c: number }).c;
  assert.equal(count, 1);
  db.close();
});

test('insertItem stores and reads isPaywalled flag', () => {
  const db = freshDb();
  const item = buildDigestItem({ isPaywalled: true });

  insertItem(db, item);

  const found = getItemByMessageId(db, item.messageId);
  assert.ok(found);
  assert.equal(found.isPaywalled, true);
  db.close();
});

test('isKnown returns false when item not in db', () => {
  const db = freshDb();
  assert.equal(isKnown(db, SAMPLE_ITEM.messageId), false);
  db.close();
});

test('isKnown returns true after insertItem', () => {
  const db = freshDb();
  insertItem(db, SAMPLE_ITEM);
  assert.equal(isKnown(db, SAMPLE_ITEM.messageId), true);
  db.close();
});

test('setSummary updates the summary for a known item', () => {
  const db = freshDb();
  insertItem(db, SAMPLE_ITEM);
  setSummary(db, SAMPLE_ITEM.messageId, 'A great summary');
  const row = db.prepare('SELECT summary FROM items WHERE message_id = ?').get(SAMPLE_ITEM.messageId) as {
    summary: string | null;
  };
  assert.equal(row.summary, 'A great summary');
  db.close();
});

test('recordRun appends a row to runs', () => {
  const db = freshDb();
  const runId = recordRun(db, { fetched: 10, newItems: 3, durationMs: 500, ok: true });
  const count = (db.prepare('SELECT COUNT(*) as c FROM runs').get() as { c: number }).c;
  assert.equal(count, 1);
  assert.equal(runId, 1);
  db.close();
});

test('recordRun stores ok=1 for true and ok=0 for false', () => {
  const db = freshDb();
  recordRun(db, { fetched: 5, newItems: 0, durationMs: 100, ok: true });
  recordRun(db, { fetched: 5, newItems: 0, durationMs: 200, ok: false });
  const rows = db.prepare('SELECT ok FROM runs ORDER BY id').all() as { ok: number }[];
  assert.deepEqual(rows, [{ ok: 1 }, { ok: 0 }]);
  db.close();
});

test('getItemsByUids returns matching items in camelCase shape', () => {
  const db = freshDb();
  const item2 = buildDigestItem({ messageId: '<test-2@example.com>', uid: 102 });
  const item3 = buildDigestItem({ messageId: '<test-3@example.com>', uid: 103 });
  insertItem(db, SAMPLE_ITEM);
  insertItem(db, item2);
  insertItem(db, item3);

  const results = getItemsByUids(db, [101, 103]);
  assert.equal(results.length, 2);

  const uids = results.map((r) => r.uid).sort();
  assert.deepEqual(uids, [101, 103]);

  // verify camelCase shape
  const first = results[0];
  assert.ok(first);
  assert.ok('messageId' in first);
  assert.ok('cleanText' in first);
  assert.ok(!('message_id' in first));
  assert.ok(!('clean_text' in first));
  db.close();
});

test('getItemsByUids returns empty array for empty uids list', () => {
  const db = freshDb();
  const results = getItemsByUids(db, []);
  assert.deepEqual(results, []);
  db.close();
});

test('getItemByMessageId returns matching item or null', () => {
  const db = freshDb();
  insertItem(db, SAMPLE_ITEM);

  const found = getItemByMessageId(db, SAMPLE_ITEM.messageId);
  assert.ok(found);
  assert.equal(found.messageId, SAMPLE_ITEM.messageId);
  assert.equal(found.cleanText, SAMPLE_ITEM.cleanText);
  assert.equal(getItemByMessageId(db, '<missing@example.com>'), null);
  db.close();
});

test('addRunItems links a run to items and getItemsByRunId returns snapshot items', () => {
  const db = freshDb();
  const item2 = buildDigestItem({
    messageId: '<test-2@example.com>',
    uid: 102,
    subject: 'Second',
  });
  insertItem(db, SAMPLE_ITEM);
  insertItem(db, item2);

  const runId = recordRun(db, { fetched: 2, newItems: 2, durationMs: 10, ok: true });
  addRunItems(db, runId, [SAMPLE_ITEM.messageId, item2.messageId]);

  const items = getItemsByRunId(db, runId);
  assert.equal(items.length, 2);
  assert.deepEqual(items.map((item) => item.messageId).sort(), [SAMPLE_ITEM.messageId, item2.messageId].sort());
  db.close();
});

test('getRunSummaries and getLatestNonEmptyRun ignore empty technical runs', () => {
  const db = freshDb();
  insertItem(db, SAMPLE_ITEM);

  const emptyRunId = recordRun(db, { fetched: 0, newItems: 0, durationMs: 5, ok: true });
  const nonEmptyRunId = recordRun(db, { fetched: 1, newItems: 1, durationMs: 10, ok: true });
  addRunItems(db, nonEmptyRunId, [SAMPLE_ITEM.messageId]);

  const summaries = getRunSummaries(db);
  assert.equal(summaries.length, 1);
  const summary = summaries[0];
  assert.ok(summary);
  assert.equal(summary.id, nonEmptyRunId);
  assert.equal(summary.newItems, 1);
  assert.equal(summary.itemCount, 1);
  assert.notEqual(summary.id, emptyRunId);

  const latest = getLatestNonEmptyRun(db);
  assert.ok(latest);
  assert.equal(latest.id, nonEmptyRunId);
  db.close();
});
