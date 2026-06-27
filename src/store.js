import Database from 'better-sqlite3';

export function openDb(path) {
  return new Database(path);
}

export function initSchema(db) {
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
      ok          INTEGER
    );
  `);

  // Migration: add link column to pre-existing items tables.
  const cols = db.prepare('PRAGMA table_info(items)').all();
  if (!cols.some((c) => c.name === 'link')) {
    db.exec('ALTER TABLE items ADD COLUMN link TEXT');
  }
}

export function getLastUid(db) {
  const row = db.prepare("SELECT value FROM state WHERE key = 'last_uid'").get();
  if (!row) return null;
  return Number(row.value);
}

export function setLastUid(db, uid) {
  db.prepare("INSERT OR REPLACE INTO state (key, value) VALUES ('last_uid', ?)").run(String(uid));
}

export function isKnown(db, messageId) {
  const row = db.prepare('SELECT 1 FROM items WHERE message_id = ?').get(messageId);
  return row !== undefined;
}

export function insertItem(db, item) {
  const { messageId, uid, sender, subject, date, cleanText, summary, link } = item;
  const result = db
    .prepare(
      `INSERT OR IGNORE INTO items (message_id, uid, sender, subject, date, clean_text, summary, link, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    )
    .run(messageId, uid, sender, subject, date, cleanText, summary ?? null, link ?? null);
  return result.changes === 1;
}

export function setSummary(db, messageId, summary) {
  db.prepare('UPDATE items SET summary = ? WHERE message_id = ?').run(summary, messageId);
}

export function recordRun(db, { fetched, newItems, durationMs, ok }) {
  db
    .prepare(
      `INSERT INTO runs (ran_at, fetched, new_items, duration_ms, ok)
       VALUES (datetime('now'), ?, ?, ?, ?)`,
    )
    .run(fetched, newItems, durationMs, ok ? 1 : 0);
}

function rowToItem(row) {
  return {
    messageId: row.message_id,
    uid: row.uid,
    sender: row.sender,
    subject: row.subject,
    date: row.date,
    cleanText: row.clean_text,
    summary: row.summary,
    link: row.link,
    createdAt: row.created_at,
  };
}

export function getItemsByUids(db, uids) {
  if (uids.length === 0) return [];
  const placeholders = uids.map(() => '?').join(', ');
  const rows = db.prepare(`SELECT * FROM items WHERE uid IN (${placeholders})`).all(...uids);
  return rows.map(rowToItem);
}
