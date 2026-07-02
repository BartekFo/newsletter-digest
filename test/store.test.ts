// @ts-nocheck
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

const SAMPLE_ITEM = {
  messageId: '<test-1@example.com>',
  uid: 101,
  sender: 'newsletter@example.com',
  subject: 'Weekly Digest',
  date: '2026-06-27T10:00:00Z',
  cleanText: 'Hello world content',
  summary: null,
};

function freshDb() {
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

  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all()
    .map((r) => r.name);

  assert.ok(tables.includes('items'));
  assert.ok(tables.includes('run_items'));
  assert.ok(tables.includes('state'));
  assert.ok(tables.includes('runs'));
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
  const count = db.prepare('SELECT COUNT(*) as c FROM items').get().c;
  assert.equal(count, 1);
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
  const row = db.prepare('SELECT summary FROM items WHERE message_id = ?').get(SAMPLE_ITEM.messageId);
  assert.equal(row.summary, 'A great summary');
  db.close();
});

test('recordRun appends a row to runs', () => {
  const db = freshDb();
  const runId = recordRun(db, { fetched: 10, newItems: 3, durationMs: 500, ok: true });
  const count = db.prepare('SELECT COUNT(*) as c FROM runs').get().c;
  assert.equal(count, 1);
  assert.equal(runId, 1);
  db.close();
});

test('recordRun stores ok=1 for true and ok=0 for false', () => {
  const db = freshDb();
  recordRun(db, { fetched: 5, newItems: 0, durationMs: 100, ok: true });
  recordRun(db, { fetched: 5, newItems: 0, durationMs: 200, ok: false });
  const rows = db.prepare('SELECT ok FROM runs ORDER BY id').all();
  assert.equal(rows[0].ok, 1);
  assert.equal(rows[1].ok, 0);
  db.close();
});

test('getItemsByUids returns matching items in camelCase shape', () => {
  const db = freshDb();
  const item2 = { ...SAMPLE_ITEM, messageId: '<test-2@example.com>', uid: 102 };
  const item3 = { ...SAMPLE_ITEM, messageId: '<test-3@example.com>', uid: 103 };
  insertItem(db, SAMPLE_ITEM);
  insertItem(db, item2);
  insertItem(db, item3);

  const results = getItemsByUids(db, [101, 103]);
  assert.equal(results.length, 2);

  const uids = results.map((r) => r.uid).sort();
  assert.deepEqual(uids, [101, 103]);

  // verify camelCase shape
  assert.ok('messageId' in results[0]);
  assert.ok('cleanText' in results[0]);
  assert.ok(!('message_id' in results[0]));
  assert.ok(!('clean_text' in results[0]));
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
  assert.equal(found.messageId, SAMPLE_ITEM.messageId);
  assert.equal(found.cleanText, SAMPLE_ITEM.cleanText);
  assert.equal(getItemByMessageId(db, '<missing@example.com>'), null);
  db.close();
});

test('addRunItems links a run to items and getItemsByRunId returns snapshot items', () => {
  const db = freshDb();
  const item2 = { ...SAMPLE_ITEM, messageId: '<test-2@example.com>', uid: 102, subject: 'Second' };
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
  assert.equal(summaries[0].id, nonEmptyRunId);
  assert.equal(summaries[0].newItems, 1);
  assert.equal(summaries[0].itemCount, 1);
  assert.notEqual(summaries[0].id, emptyRunId);

  const latest = getLatestNonEmptyRun(db);
  assert.equal(latest.id, nonEmptyRunId);
  db.close();
});
