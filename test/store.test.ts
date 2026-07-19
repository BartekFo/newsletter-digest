import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createDigestArchive, initSchema, openDb } from '../src/store.js';
import { buildDigestItem } from './builders.js';

const ITEM = buildDigestItem();

test('fresh archive uses source-neutral item and snapshot relations', () => {
  const db = openDb(':memory:');
  initSchema(db);

  const itemColumns = (db.prepare('PRAGMA table_info(items)').all() as { name: string }[])
    .map((row) => row.name);
  const relationColumns = (db.prepare('PRAGMA table_info(run_items)').all() as { name: string }[])
    .map((row) => row.name);

  assert.ok(itemColumns.includes('newsletter_id'));
  assert.ok(itemColumns.includes('source_metadata_json'));
  assert.ok(!itemColumns.includes('message_id'));
  assert.ok(!itemColumns.includes('uid'));
  assert.deepEqual(relationColumns.filter((name) => name !== 'run_id'), ['newsletter_id', 'position']);
  db.close();
});

test('legacy Gmail archive migrates without losing snapshots, cursor or deep-link metadata', () => {
  const db = openDb(':memory:');
  db.exec(`
    CREATE TABLE items (
      message_id TEXT PRIMARY KEY,
      newsletter_id TEXT,
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
    CREATE TABLE state (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ran_at TEXT,
      fetched INTEGER,
      new_items INTEGER,
      duration_ms INTEGER,
      ok INTEGER
    );
    CREATE TABLE run_items (
      run_id INTEGER NOT NULL,
      message_id TEXT NOT NULL,
      PRIMARY KEY (run_id, message_id)
    );
    INSERT INTO items VALUES (
      '<legacy@example.com>', 'newsletter-a', 42, 'Legacy', 'Preserved first',
      '2026-07-01T08:00:00Z', 'Body', 'Summary', 'https://example.com', 1, datetime('now')
    );
    INSERT INTO items VALUES (
      '<legacy-second@example.com>', 'newsletter-z', 43, 'Legacy', 'Preserved second',
      '2026-07-01T08:00:00Z', 'Body 2', 'Summary 2', null, 0, datetime('now')
    );
    INSERT INTO state VALUES ('last_uid', '43');
    INSERT INTO runs VALUES (1, datetime('now'), 2, 2, 10, 1);
    INSERT INTO run_items VALUES (1, '<legacy@example.com>');
    INSERT INTO run_items VALUES (1, '<legacy-second@example.com>');
  `);

  initSchema(db);
  const archive = createDigestArchive(db);
  const snapshot = archive.getSnapshot(1);
  const item = snapshot?.items[0];

  assert.ok(item);
  assert.match(item.newsletterId, /^newsletter-/);
  assert.deepEqual(snapshot?.items.map((candidate) => candidate.subject), ['Preserved second', 'Preserved first']);
  assert.equal(item.subject, 'Preserved second');
  assert.equal(item.isPaywalled, false);
  assert.equal(item.source.type, 'gmail');
  assert.equal(item.source.externalId, '<legacy-second@example.com>');
  assert.equal(item.source.metadata.gmailMessageId, '<legacy-second@example.com>');
  assert.equal(item.source.metadata.gmailUid, 43);
  assert.equal(archive.getCursor(), '43');
  assert.equal(db.prepare("SELECT 1 FROM state WHERE key = 'last_uid'").get(), undefined);
  archive.close();
});

test('existing source-neutral relations gain positions that preserve legacy equal-date order', () => {
  const db = openDb(':memory:');
  db.exec(`
    CREATE TABLE state (key TEXT PRIMARY KEY, value TEXT);
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
    CREATE TABLE run_items (
      run_id INTEGER NOT NULL,
      newsletter_id TEXT NOT NULL,
      PRIMARY KEY (run_id, newsletter_id)
    );
    INSERT INTO runs VALUES (1, '2026-07-01T10:00:00Z', 2, 2, 10, 1, null, null);
    INSERT INTO items VALUES
      ('newsletter-a', 'gmail', 'first', '1', '{"gmailUid":1}', 'Sender', 'First relation', '2026-07-01T08:00:00Z', 'First', null, null, 0, datetime('now')),
      ('newsletter-z', 'gmail', 'second', '2', '{"gmailUid":2}', 'Sender', 'Second relation', '2026-07-01T08:00:00Z', 'Second', null, null, 0, datetime('now'));
    INSERT INTO run_items VALUES (1, 'newsletter-a');
    INSERT INTO run_items VALUES (1, 'newsletter-z');
  `);

  initSchema(db);
  const archive = createDigestArchive(db);

  assert.deepEqual(
    archive.getSnapshot(1)?.items.map((item) => item.subject),
    ['Second relation', 'First relation'],
  );
  const positions = db.prepare('SELECT position FROM run_items ORDER BY rowid').all() as { position: number }[];
  assert.deepEqual(positions.map((row) => row.position), [1, 0]);
  archive.close();
});

test('archive publishes and reads a complete snapshot through internal identity', () => {
  const db = openDb(':memory:');
  initSchema(db);
  const archive = createDigestArchive(db);
  const second = buildDigestItem({
    newsletterId: 'newsletter-test-2',
    source: {
      type: 'gmail',
      externalId: '<test-2@example.com>',
      cursor: '102',
      metadata: { gmailMessageId: '<test-2@example.com>', gmailUid: 102 },
    },
    subject: 'Second',
  });

  const runId = archive.publishSnapshot({
    items: [ITEM, second],
    cursor: '102',
    run: {
      fetched: 2,
      newItems: 2,
      durationMs: 10,
      ok: true,
      weather: { city: 'Testowo', temp: 12, code: 3, description: 'Pochmurno', max: 15, min: 7, precipProb: 40 },
      hackernews: [{ title: 'Story', url: 'https://example.com', score: 1, comments: 2, hnUrl: 'https://news.ycombinator.com/item?id=1' }],
    },
  });

  assert.equal(archive.getCursor(), '102');
  assert.equal(archive.isKnown(ITEM.source), true);
  assert.equal(archive.getNewsletter(ITEM.newsletterId)?.subject, ITEM.subject);
  assert.equal(archive.getNewsletter(ITEM.source.externalId), null, 'legacy source ID is not a reader key');
  assert.deepEqual(
    archive.getSnapshot(runId)?.items.map((item) => item.newsletterId).sort(),
    [ITEM.newsletterId, second.newsletterId].sort(),
  );
  assert.equal(archive.latestSnapshot()?.run.weather?.city, 'Testowo');
  assert.equal(archive.listSnapshots()[0]?.hackernews?.[0]?.title, 'Story');
  archive.close();
});

test('failed refresh records technical diagnostics without creating a visible snapshot', () => {
  const db = openDb(':memory:');
  initSchema(db);
  const archive = createDigestArchive(db);

  archive.recordFailedRefresh({ fetched: 1, newItems: 0, durationMs: 5, ok: false });

  assert.equal(archive.latestSnapshot(), null);
  assert.deepEqual(archive.listSnapshots(), []);
  const row = db.prepare('SELECT ok FROM runs').get() as { ok: number };
  assert.equal(row.ok, 0);
  archive.close();
});
