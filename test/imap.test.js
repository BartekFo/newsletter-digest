import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildFetchCriteria, fetchNewMessages } from '../src/imap.js';

// ── Unit tests (no network) ────────────────────────────────────────────────

const FIXED_NOW = new Date('2026-06-27T12:00:00Z');
const MS_PER_DAY = 24 * 3600 * 1000;

test('buildFetchCriteria — null lastUid returns since mode with correct date (7 days)', () => {
  const result = buildFetchCriteria(null, 7, FIXED_NOW);
  assert.equal(result.mode, 'since');
  assert.ok(result.since instanceof Date);
  assert.equal(result.since.getTime(), FIXED_NOW.getTime() - 7 * MS_PER_DAY);
});

test('buildFetchCriteria — null lastUid, bootstrapDays=1 returns since = now - 1 day', () => {
  const result = buildFetchCriteria(null, 1, FIXED_NOW);
  assert.equal(result.mode, 'since');
  assert.equal(result.since.getTime(), FIXED_NOW.getTime() - 1 * MS_PER_DAY);
});

test('buildFetchCriteria — numeric lastUid returns uid mode with range lastUid+1:*', () => {
  const result = buildFetchCriteria(100, 7, FIXED_NOW);
  assert.equal(result.mode, 'uid');
  assert.equal(result.range, '101:*');
});

test('buildFetchCriteria — lastUid=0 returns range 1:*', () => {
  const result = buildFetchCriteria(0, 7, FIXED_NOW);
  assert.equal(result.mode, 'uid');
  assert.equal(result.range, '1:*');
});

// ── Unit test: NONEXISTENT on empty uid range resolves to [] ───────────────

test('fetchNewMessages — uid mode returns [] when fetch throws NONEXISTENT', async () => {
  let loggedOut = false;
  const fakeClient = {
    async connect() {},
    async mailboxOpen() {},
    fetch() {
      return (async function* () {
        const err = new Error('Command failed');
        err.responseStatus = 'NO';
        err.responseText = 'NONEXISTENT No matching messages';
        throw err;
      })();
    },
    async logout() {
      loggedOut = true;
    },
  };

  const config = { imapFolder: 'Newsletters', bootstrapDays: 7 };
  const result = await fetchNewMessages(config, 500, fakeClient);

  assert.deepEqual(result, []);
  assert.equal(loggedOut, true, 'logout must be called in finally');
});

test('fetchNewMessages — re-throws genuine (non-NONEXISTENT) errors', async () => {
  let loggedOut = false;
  const fakeClient = {
    async connect() {},
    async mailboxOpen() {},
    fetch() {
      return (async function* () {
        throw new Error('Authentication failed');
      })();
    },
    async logout() {
      loggedOut = true;
    },
  };

  const config = { imapFolder: 'Newsletters', bootstrapDays: 7 };
  await assert.rejects(() => fetchNewMessages(config, 500, fakeClient), /Authentication failed/);
  assert.equal(loggedOut, true, 'logout must still be called in finally');
});

// ── Integration test (skipped unless credentials are present) ──────────────

const hasCredentials =
  typeof process.env.GMAIL_USER === 'string' &&
  process.env.GMAIL_USER.length > 0 &&
  typeof process.env.GMAIL_APP_PASSWORD === 'string' &&
  process.env.GMAIL_APP_PASSWORD.length > 0;

test(
  'fetchNewMessages — connects and returns array of { raw, uid } objects',
  { skip: hasCredentials ? false : 'no Gmail credentials (set GMAIL_USER and GMAIL_APP_PASSWORD)' },
  async () => {
    const config = {
      gmailUser: process.env.GMAIL_USER,
      gmailAppPassword: process.env.GMAIL_APP_PASSWORD,
      imapFolder: process.env.IMAP_FOLDER ?? 'Newsletters',
      bootstrapDays: 1,
    };

    const messages = await fetchNewMessages(config, null);

    assert.ok(Array.isArray(messages), 'result must be an array');
    for (const msg of messages) {
      assert.ok(Buffer.isBuffer(msg.raw), 'msg.raw must be a Buffer');
      assert.equal(typeof msg.uid, 'number', 'msg.uid must be a number');
    }
  },
);
