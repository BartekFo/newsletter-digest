import Database from 'better-sqlite3';
import type { Db, DigestItem, HackerNewsStory, RunSummary, WeatherSummary } from './types.js';

interface StateRow {
  value: string;
}

interface TableInfoRow {
  name: string;
}

interface ItemRow {
  message_id: string;
  uid: number;
  sender: string;
  subject: string;
  date: string;
  clean_text: string;
  summary: string | null;
  link: string | null;
  is_paywalled: number;
  created_at: string;
}

interface RunSummaryRow {
  id: number;
  ran_at: string;
  new_items: number;
  item_count: number;
  weather_json: string | null;
  hackernews_json: string | null;
}

export interface RunRecord {
  fetched: number;
  newItems: number;
  durationMs: number;
  ok: boolean | number;
  weather?: WeatherSummary | null;
  hackernews?: HackerNewsStory[] | null;
}

export interface SnapshotPublication {
  items: DigestItem[];
  cursorUid: number;
  run: RunRecord;
}

export interface DigestSnapshot {
  run: RunSummary;
  items: DigestItem[];
}

export interface DigestArchive {
  getCursor(): number | null;
  isKnown(messageId: string): boolean;
  publishSnapshot(publication: SnapshotPublication): number;
  recordFailedRefresh(run: RunRecord): void;
  latestSnapshot(): DigestSnapshot | null;
  listSnapshots(): RunSummary[];
  getSnapshot(runId: number): DigestSnapshot | null;
  getNewsletter(messageId: string): DigestItem | null;
  close(): void;
}

export function openDb(path: string): Db {
  return new Database(path);
}

export function initSchema(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS items (
      message_id TEXT PRIMARY KEY,
      uid        INTEGER,
      sender     TEXT,
      subject    TEXT,
      date       TEXT,
      clean_text TEXT,
      summary    TEXT,
      link       TEXT,
      is_paywalled INTEGER DEFAULT 0,
      created_at TEXT
    );

    CREATE TABLE IF NOT EXISTS state (
      key   TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS runs (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      ran_at      TEXT,
      fetched     INTEGER,
      new_items   INTEGER,
      duration_ms INTEGER,
      ok          INTEGER,
      weather_json TEXT,
      hackernews_json TEXT
    );

    CREATE TABLE IF NOT EXISTS run_items (
      run_id     INTEGER NOT NULL,
      message_id TEXT NOT NULL,
      PRIMARY KEY (run_id, message_id),
      FOREIGN KEY (run_id) REFERENCES runs(id),
      FOREIGN KEY (message_id) REFERENCES items(message_id)
    );
  `);

  // Migration: add link column to pre-existing items tables.
  const cols = db.prepare('PRAGMA table_info(items)').all() as TableInfoRow[];
  if (!cols.some((c) => c.name === 'link')) {
    db.exec('ALTER TABLE items ADD COLUMN link TEXT');
  }
  if (!cols.some((c) => c.name === 'is_paywalled')) {
    db.exec('ALTER TABLE items ADD COLUMN is_paywalled INTEGER DEFAULT 0');
  }

  const runCols = db.prepare('PRAGMA table_info(runs)').all() as TableInfoRow[];
  if (!runCols.some((c) => c.name === 'weather_json')) {
    db.exec('ALTER TABLE runs ADD COLUMN weather_json TEXT');
  }
  if (!runCols.some((c) => c.name === 'hackernews_json')) {
    db.exec('ALTER TABLE runs ADD COLUMN hackernews_json TEXT');
  }
}

export function getLastUid(db: Db): number | null {
  const row = db.prepare("SELECT value FROM state WHERE key = 'last_uid'").get() as StateRow | undefined;
  if (!row) return null;
  return Number(row.value);
}

export function setLastUid(db: Db, uid: number): void {
  db.prepare("INSERT OR REPLACE INTO state (key, value) VALUES ('last_uid', ?)").run(String(uid));
}

export function isKnown(db: Db, messageId: string): boolean {
  const row = db.prepare('SELECT 1 FROM items WHERE message_id = ?').get(messageId);
  return row !== undefined;
}

export function insertItem(db: Db, item: DigestItem): boolean {
  const { messageId, uid, sender, subject, date, cleanText, summary, link, isPaywalled } = item;
  const result = db
    .prepare(
      `INSERT OR IGNORE INTO items (message_id, uid, sender, subject, date, clean_text, summary, link, is_paywalled, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    )
    .run(messageId, uid, sender, subject, date, cleanText, summary ?? null, link ?? null, isPaywalled ? 1 : 0);
  return result.changes === 1;
}

export function setSummary(db: Db, messageId: string, summary: string): void {
  db.prepare('UPDATE items SET summary = ? WHERE message_id = ?').run(summary, messageId);
}

export function recordRun(db: Db, { fetched, newItems, durationMs, ok, weather, hackernews }: RunRecord): number {
  const result = db
    .prepare(
      `INSERT INTO runs (ran_at, fetched, new_items, duration_ms, ok, weather_json, hackernews_json)
       VALUES (datetime('now'), ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      fetched,
      newItems,
      durationMs,
      ok ? 1 : 0,
      weather ? JSON.stringify(weather) : null,
      hackernews ? JSON.stringify(hackernews) : null,
    );
  return Number(result.lastInsertRowid);
}

function parseJson<T>(value: string | null): T | null {
  if (!value) return null;

  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function rowToItem(row: ItemRow): DigestItem {
  return {
    messageId: row.message_id,
    uid: row.uid,
    sender: row.sender,
    subject: row.subject,
    date: row.date,
    cleanText: row.clean_text,
    summary: row.summary,
    link: row.link,
    isPaywalled: row.is_paywalled === 1,
    createdAt: row.created_at,
  };
}

export function getItemsByUids(db: Db, uids: number[]): DigestItem[] {
  if (uids.length === 0) return [];
  const placeholders = uids.map(() => '?').join(', ');
  const rows = db.prepare(`SELECT * FROM items WHERE uid IN (${placeholders})`).all(...uids) as ItemRow[];
  return rows.map(rowToItem);
}

export function getItemByMessageId(db: Db, messageId: string): DigestItem | null {
  const row = db.prepare('SELECT * FROM items WHERE message_id = ?').get(messageId) as ItemRow | undefined;
  return row ? rowToItem(row) : null;
}

export function addRunItems(db: Db, runId: number, messageIds: string[]): void {
  if (messageIds.length === 0) return;

  const insert = db.prepare(
    'INSERT OR IGNORE INTO run_items (run_id, message_id) VALUES (?, ?)',
  );
  const insertMany = db.transaction((ids: string[]) => {
    for (const messageId of ids) {
      insert.run(runId, messageId);
    }
  });

  insertMany(messageIds);
}

/**
 * Make a completed refresh visible as one recoverable SQLite state.
 * Items, the run, snapshot relations and the IMAP cursor either all commit or
 * all roll back together.
 */
export function publishSnapshot(db: Db, publication: SnapshotPublication): number {
  const publish = db.transaction(({ items, cursorUid, run }: SnapshotPublication) => {
    for (const item of items) {
      insertItem(db, item);
    }

    const runId = recordRun(db, run);
    addRunItems(db, runId, items.map((item) => item.messageId));
    setLastUid(db, cursorUid);
    return runId;
  });

  return publish(publication);
}

function rowToRunSummary(row: RunSummaryRow): RunSummary {
  return {
    id: row.id,
    ranAt: row.ran_at,
    newItems: row.new_items,
    itemCount: row.item_count,
    weather: parseJson<WeatherSummary>(row.weather_json),
    hackernews: parseJson<HackerNewsStory[]>(row.hackernews_json),
  };
}

export function getRunSummaries(db: Db): RunSummary[] {
  const rows = db
    .prepare(
      `SELECT r.id, r.ran_at, r.new_items, r.weather_json, r.hackernews_json, COUNT(ri.message_id) AS item_count
       FROM runs r
       JOIN run_items ri ON ri.run_id = r.id
       GROUP BY r.id
       HAVING item_count > 0
       ORDER BY r.ran_at DESC, r.id DESC`,
    )
    .all() as RunSummaryRow[];
  return rows.map(rowToRunSummary);
}

export function getLatestNonEmptyRun(db: Db): RunSummary | null {
  const row = db
    .prepare(
      `SELECT r.id, r.ran_at, r.new_items, r.weather_json, r.hackernews_json, COUNT(ri.message_id) AS item_count
       FROM runs r
       JOIN run_items ri ON ri.run_id = r.id
       GROUP BY r.id
       HAVING item_count > 0
       ORDER BY r.ran_at DESC, r.id DESC
       LIMIT 1`,
    )
    .get() as RunSummaryRow | undefined;
  return row ? rowToRunSummary(row) : null;
}

export function getItemsByRunId(db: Db, runId: number): DigestItem[] {
  const rows = db
    .prepare(
      `SELECT i.*
       FROM run_items ri
       JOIN items i ON i.message_id = ri.message_id
       WHERE ri.run_id = ?
       ORDER BY datetime(i.date) DESC, i.uid DESC`,
    )
    .all(runId) as ItemRow[];
  return rows.map(rowToItem);
}

/** Reader-facing archive interface. SQLite and query composition stay here. */
export function createDigestArchive(db: Db): DigestArchive {
  const getSnapshot = (runId: number): DigestSnapshot | null => {
    const run = getRunSummaries(db).find((candidate) => candidate.id === runId);
    return run ? { run, items: getItemsByRunId(db, runId) } : null;
  };

  return {
    getCursor: () => getLastUid(db),
    isKnown: (messageId) => isKnown(db, messageId),
    publishSnapshot: (publication) => publishSnapshot(db, publication),
    recordFailedRefresh: (run) => { recordRun(db, { ...run, ok: false }); },
    latestSnapshot() {
      const run = getLatestNonEmptyRun(db);
      return run ? { run, items: getItemsByRunId(db, run.id) } : null;
    },
    listSnapshots: () => getRunSummaries(db),
    getSnapshot,
    getNewsletter: (messageId) => getItemByMessageId(db, messageId),
    close: () => db.close(),
  };
}

/** Open, migrate and own a SQLite-backed archive without exposing its handle. */
export function openDigestArchive(path: string): DigestArchive {
  const db = openDb(path);
  initSchema(db);
  return createDigestArchive(db);
}
