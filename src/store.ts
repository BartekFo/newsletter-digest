import Database from 'better-sqlite3';
import { sortNewslettersNewestFirst } from './newsletterOrder.js';
import type {
  Db,
  DigestItem,
  HackerNewsStory,
  NewsletterSourceIdentity,
  RunSummary,
  WeatherSummary,
} from './types.js';

interface StateRow { value: string }
interface TableInfoRow { name: string }

interface ItemRow {
  newsletter_id: string;
  source_type: string;
  source_external_id: string;
  source_cursor: string;
  source_metadata_json: string;
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
  cursor: string;
  run: RunRecord;
}

export interface DigestSnapshot {
  run: RunSummary;
  items: DigestItem[];
}

export const ARCHIVE_PAGE_SIZE = 25;

export interface ArchiveCriteria {
  page: number;
  query?: string;
  sender?: string;
  fromInclusive?: string;
  toExclusive?: string;
  paywall?: boolean;
  hasSummary?: boolean;
}

export interface ArchivePage {
  items: DigestItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  hasPrevious: boolean;
  hasNext: boolean;
  criteria: ArchiveCriteria;
  senders: string[];
}

export interface DigestArchive {
  getCursor(): string | null;
  isKnown(source: NewsletterSourceIdentity): boolean;
  publishSnapshot(publication: SnapshotPublication): number;
  recordFailedRefresh(run: RunRecord): void;
  latestSnapshot(): DigestSnapshot | null;
  listSnapshots(): RunSummary[];
  getSnapshot(runId: number): DigestSnapshot | null;
  listNewsletters(criteria: ArchiveCriteria): ArchivePage;
  getNewsletter(newsletterId: string): DigestItem | null;
  close(): void;
}

export function openDb(path: string): Db {
  return new Database(path);
}

function columns(db: Db, table: string): Set<string> {
  return new Set((db.prepare(`PRAGMA table_info(${table})`).all() as TableInfoRow[]).map((row) => row.name));
}

function tableExists(db: Db, table: string): boolean {
  return db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) !== undefined;
}

function createFinalItemTables(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS items (
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
    CREATE UNIQUE INDEX IF NOT EXISTS idx_items_source_identity
      ON items(source_type, source_external_id);
    CREATE TABLE IF NOT EXISTS run_items (
      run_id INTEGER NOT NULL,
      newsletter_id TEXT NOT NULL,
      position INTEGER NOT NULL,
      PRIMARY KEY (run_id, newsletter_id),
      FOREIGN KEY (run_id) REFERENCES runs(id),
      FOREIGN KEY (newsletter_id) REFERENCES items(newsletter_id)
    );
  `);
}

function migrateLegacyIdentity(db: Db): void {
  const itemColumns = columns(db, 'items');
  if (!itemColumns.has('message_id')) return;
  const hasRunItems = tableExists(db, 'run_items');
  const runItemColumns = hasRunItems ? columns(db, 'run_items') : new Set<string>();
  const legacyColumnOrFallback = (name: string, fallback: string) => itemColumns.has(name) ? name : fallback;

  db.pragma('foreign_keys = OFF');
  const migrate = db.transaction(() => {
    db.exec(`
      CREATE TABLE items_next (
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
      INSERT INTO items_next (
        newsletter_id, source_type, source_external_id, source_cursor,
        source_metadata_json, sender, subject, date, clean_text, summary,
        link, is_paywalled, created_at
      )
      SELECT
        ${legacyColumnOrFallback('newsletter_id', "'newsletter-' || lower(hex(randomblob(16)))")},
        ${legacyColumnOrFallback('source_type', "'gmail'")},
        ${legacyColumnOrFallback('source_external_id', 'message_id')},
        ${legacyColumnOrFallback('source_cursor', 'CAST(uid AS TEXT)')},
        json_object('gmailMessageId', message_id, 'gmailUid', uid),
        sender, subject, date, clean_text, summary,
        ${legacyColumnOrFallback('link', 'NULL')}, ${legacyColumnOrFallback('is_paywalled', '0')}, created_at
      FROM items;
      CREATE TABLE run_items_next (
        run_id INTEGER NOT NULL,
        newsletter_id TEXT NOT NULL,
        position INTEGER NOT NULL,
        PRIMARY KEY (run_id, newsletter_id),
        FOREIGN KEY (run_id) REFERENCES runs(id),
        FOREIGN KEY (newsletter_id) REFERENCES items_next(newsletter_id)
      );
    `);

    if (hasRunItems) {
      const relationIdentityConditions = [
        ...(runItemColumns.has('message_id') ? ['migrated.source_external_id = ri.message_id'] : []),
        ...(runItemColumns.has('newsletter_id') ? ['migrated.newsletter_id = ri.newsletter_id'] : []),
      ];
      if (relationIdentityConditions.length === 0) {
        throw new Error('Legacy run_items has no recognizable newsletter identity column.');
      }
      db.exec(`
        INSERT OR IGNORE INTO run_items_next (run_id, newsletter_id, position)
        SELECT ri.run_id, migrated.newsletter_id,
               ${runItemColumns.has('position')
                 ? `COALESCE(ri.position, ROW_NUMBER() OVER (
                     PARTITION BY ri.run_id
                     ORDER BY datetime(migrated.date) DESC,
                              CAST(json_extract(migrated.source_metadata_json, '$.gmailUid') AS INTEGER) DESC,
                              ri.rowid
                   ) - 1)`
                 : `ROW_NUMBER() OVER (
                     PARTITION BY ri.run_id
                     ORDER BY datetime(migrated.date) DESC,
                              CAST(json_extract(migrated.source_metadata_json, '$.gmailUid') AS INTEGER) DESC,
                              ri.rowid
                   ) - 1`}
        FROM run_items ri
        JOIN items_next migrated ON ${relationIdentityConditions.join(' OR ')};
        DROP TABLE run_items;
      `);
    }

    db.exec(`
      DROP TABLE items;
      ALTER TABLE items_next RENAME TO items;
      ALTER TABLE run_items_next RENAME TO run_items;
    `);
  });

  try {
    migrate();
  } finally {
    db.pragma('foreign_keys = ON');
  }
}

export function initSchema(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE IF NOT EXISTS runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ran_at TEXT,
      fetched INTEGER,
      new_items INTEGER,
      duration_ms INTEGER,
      ok INTEGER,
      weather_json TEXT,
      hackernews_json TEXT
    );
  `);

  const runColumns = columns(db, 'runs');
  if (!runColumns.has('weather_json')) db.exec('ALTER TABLE runs ADD COLUMN weather_json TEXT');
  if (!runColumns.has('hackernews_json')) db.exec('ALTER TABLE runs ADD COLUMN hackernews_json TEXT');

  if (tableExists(db, 'items')) migrateLegacyIdentity(db);
  createFinalItemTables(db);

  const migrateRelationPositions = db.transaction(() => {
    const runItemColumns = columns(db, 'run_items');
    if (!runItemColumns.has('position')) db.exec('ALTER TABLE run_items ADD COLUMN position INTEGER');
    db.exec(`
      WITH ordered AS (
        SELECT ri.rowid AS relation_rowid,
               ROW_NUMBER() OVER (
                 PARTITION BY ri.run_id
                 ORDER BY datetime(items.date) DESC,
                          CAST(json_extract(items.source_metadata_json, '$.gmailUid') AS INTEGER) DESC,
                          ri.rowid
               ) - 1 AS position
        FROM run_items ri
        JOIN items ON items.newsletter_id = ri.newsletter_id
      )
      UPDATE run_items
      SET position = (
        SELECT ordered.position FROM ordered WHERE ordered.relation_rowid = run_items.rowid
      )
      WHERE position IS NULL;
    `);
  });
  migrateRelationPositions();

  db.exec(`
    INSERT OR IGNORE INTO state (key, value)
    SELECT 'source_cursor', value FROM state WHERE key = 'last_uid';
    DELETE FROM state WHERE key = 'last_uid';
  `);

  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS items_fts USING fts5(
      newsletter_id UNINDEXED,
      subject,
      sender,
      summary,
      clean_text,
      tokenize = 'unicode61 remove_diacritics 2'
    );
    INSERT INTO items_fts (rowid, newsletter_id, subject, sender, summary, clean_text)
    SELECT items.rowid, items.newsletter_id, items.subject, items.sender, items.summary, items.clean_text
    FROM items
    WHERE NOT EXISTS (SELECT 1 FROM items_fts WHERE items_fts.rowid = items.rowid);
  `);
}

function getCursor(db: Db): string | null {
  const row = db.prepare("SELECT value FROM state WHERE key = 'source_cursor'").get() as StateRow | undefined;
  return row?.value ?? null;
}

function setCursor(db: Db, cursor: string): void {
  db.prepare("INSERT OR REPLACE INTO state (key, value) VALUES ('source_cursor', ?)").run(cursor);
}

function insertItem(db: Db, item: DigestItem): boolean {
  const { newsletterId, source, sender, subject, date, cleanText, summary, link, isPaywalled } = item;
  const result = db.prepare(`
    INSERT OR IGNORE INTO items (
      newsletter_id, source_type, source_external_id, source_cursor,
      source_metadata_json, sender, subject, date, clean_text, summary,
      link, is_paywalled, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(
    newsletterId, source.type, source.externalId, source.cursor, JSON.stringify(source.metadata),
    sender, subject, date, cleanText, summary, link, isPaywalled ? 1 : 0,
  );
  if (result.changes === 1) {
    const row = db.prepare('SELECT rowid FROM items WHERE newsletter_id = ?').get(newsletterId) as { rowid: number };
    db.prepare(`
      INSERT INTO items_fts (rowid, newsletter_id, subject, sender, summary, clean_text)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(row.rowid, newsletterId, subject, sender, summary, cleanText);
    return true;
  }
  return false;
}

function recordRun(db: Db, { fetched, newItems, durationMs, ok, weather, hackernews }: RunRecord): number {
  const result = db.prepare(`
    INSERT INTO runs (ran_at, fetched, new_items, duration_ms, ok, weather_json, hackernews_json)
    VALUES (datetime('now'), ?, ?, ?, ?, ?, ?)
  `).run(
    fetched, newItems, durationMs, ok ? 1 : 0,
    weather ? JSON.stringify(weather) : null,
    hackernews ? JSON.stringify(hackernews) : null,
  );
  return Number(result.lastInsertRowid);
}

function parseJson<T>(value: string | null): T | null {
  if (!value) return null;
  try { return JSON.parse(value) as T; } catch { return null; }
}

function rowToItem(row: ItemRow): DigestItem {
  return {
    newsletterId: row.newsletter_id,
    source: {
      type: row.source_type,
      externalId: row.source_external_id,
      cursor: row.source_cursor,
      metadata: parseJson<Record<string, string | number>>(row.source_metadata_json) ?? {},
    },
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

function addRunItems(db: Db, runId: number, newsletterIds: string[]): void {
  const insert = db.prepare('INSERT OR IGNORE INTO run_items (run_id, newsletter_id, position) VALUES (?, ?, ?)');
  newsletterIds.forEach((newsletterId, position) => insert.run(runId, newsletterId, position));
}

function publishSnapshot(db: Db, publication: SnapshotPublication): number {
  const publish = db.transaction(({ items, cursor, run }: SnapshotPublication) => {
    for (const item of items) insertItem(db, item);
    const runId = recordRun(db, run);
    addRunItems(db, runId, sortNewslettersNewestFirst(items).map((item) => item.newsletterId));
    setCursor(db, cursor);
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

function getRunSummaries(db: Db): RunSummary[] {
  return (db.prepare(`
    SELECT r.id, r.ran_at, r.new_items, r.weather_json, r.hackernews_json,
           COUNT(ri.newsletter_id) AS item_count
    FROM runs r JOIN run_items ri ON ri.run_id = r.id
    GROUP BY r.id HAVING item_count > 0
    ORDER BY r.ran_at DESC, r.id DESC
  `).all() as RunSummaryRow[]).map(rowToRunSummary);
}

function getItemsByRunId(db: Db, runId: number): DigestItem[] {
  return (db.prepare(`
    SELECT items.* FROM run_items
    JOIN items ON items.newsletter_id = run_items.newsletter_id
    WHERE run_items.run_id = ?
    ORDER BY datetime(items.date) DESC, run_items.position ASC
  `).all(runId) as ItemRow[]).map(rowToItem);
}

function safeFtsQuery(query: string | undefined): string | null {
  const terms = query?.match(/[\p{L}\p{N}_]+/gu) ?? [];
  if (terms.length === 0) return null;
  return terms.map((term) => `"${term.replace(/"/g, '""')}"`).join(' AND ');
}

function listNewsletters(db: Db, criteria: ArchiveCriteria): ArchivePage {
  const { page } = criteria;
  const ftsQuery = safeFtsQuery(criteria.query);
  const fromSql = ftsQuery
    ? 'items JOIN items_fts ON items_fts.rowid = items.rowid'
    : 'items';
  const conditions: string[] = [];
  const searchParams: Array<string | number> = [];
  if (ftsQuery) {
    conditions.push('items_fts MATCH ?');
    searchParams.push(ftsQuery);
  }
  if (criteria.sender) {
    conditions.push('items.sender = ?');
    searchParams.push(criteria.sender);
  }
  if (criteria.fromInclusive) {
    conditions.push('datetime(items.date) >= datetime(?)');
    searchParams.push(criteria.fromInclusive);
  }
  if (criteria.toExclusive) {
    conditions.push('datetime(items.date) < datetime(?)');
    searchParams.push(criteria.toExclusive);
  }
  if (criteria.paywall !== undefined) {
    conditions.push('items.is_paywalled = ?');
    searchParams.push(criteria.paywall ? 1 : 0);
  }
  if (criteria.hasSummary !== undefined) {
    conditions.push(criteria.hasSummary
      ? "items.summary IS NOT NULL AND trim(items.summary) <> ''"
      : "(items.summary IS NULL OR trim(items.summary) = '')");
  }
  const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const total = (db.prepare(`SELECT COUNT(*) AS count FROM ${fromSql} ${whereSql}`).get(
    ...searchParams,
  ) as { count: number }).count;
  const items = (db.prepare(`
    SELECT items.* FROM ${fromSql}
    ${whereSql}
    ORDER BY julianday(items.date) DESC, items.rowid ASC
    LIMIT ? OFFSET ?
  `).all(...searchParams, ARCHIVE_PAGE_SIZE, (page - 1) * ARCHIVE_PAGE_SIZE) as ItemRow[]).map(rowToItem);
  const totalPages = Math.ceil(total / ARCHIVE_PAGE_SIZE);

  return {
    items,
    total,
    page,
    pageSize: ARCHIVE_PAGE_SIZE,
    totalPages,
    hasPrevious: page > 1,
    hasNext: page < totalPages,
    criteria,
    senders: (db.prepare(`
      SELECT DISTINCT sender FROM items
      WHERE sender IS NOT NULL AND trim(sender) <> ''
      ORDER BY sender COLLATE NOCASE ASC, sender ASC
    `).all() as { sender: string }[]).map((row) => row.sender),
  };
}

export function createDigestArchive(db: Db): DigestArchive {
  const getSnapshot = (runId: number): DigestSnapshot | null => {
    const run = getRunSummaries(db).find((candidate) => candidate.id === runId);
    return run ? { run, items: getItemsByRunId(db, runId) } : null;
  };

  return {
    getCursor: () => getCursor(db),
    isKnown: (source) => db.prepare(
      'SELECT 1 FROM items WHERE source_type = ? AND source_external_id = ?',
    ).get(source.type, source.externalId) !== undefined,
    publishSnapshot: (publication) => publishSnapshot(db, publication),
    recordFailedRefresh: (run) => { recordRun(db, { ...run, ok: false }); },
    latestSnapshot() {
      const run = getRunSummaries(db)[0];
      return run ? { run, items: getItemsByRunId(db, run.id) } : null;
    },
    listSnapshots: () => getRunSummaries(db),
    getSnapshot,
    listNewsletters: (criteria) => listNewsletters(db, criteria),
    getNewsletter(newsletterId) {
      const row = db.prepare('SELECT * FROM items WHERE newsletter_id = ?').get(newsletterId) as ItemRow | undefined;
      return row ? rowToItem(row) : null;
    },
    close: () => db.close(),
  };
}

export function openDigestArchive(path: string): DigestArchive {
  const db = openDb(path);
  initSchema(db);
  return createDigestArchive(db);
}
