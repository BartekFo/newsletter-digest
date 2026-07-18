import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildFetchCriteria, fetchNewMessages, type ImapClient } from '../src/imap.js';

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
  const fakeClient: ImapClient = {
    async connect() {},
    async mailboxOpen() {},
    async search() {
      return [];
    },
    fetch() {
      return (async function* () {
        const err = Object.assign(new Error('Command failed'), {
          responseStatus: 'NO',
          responseText: 'NONEXISTENT No matching messages',
        });
        throw err;
      })();
    },
    async logout() {
      loggedOut = true;
    },
  };

  const config = {
    gmailUser: 'test@example.com',
    gmailAppPassword: 'test-password',
    imapFolder: 'Newsletters',
    bootstrapDays: 7,
  };
  const result = await fetchNewMessages(config, 500, fakeClient);

  assert.deepEqual(result, []);
  assert.equal(loggedOut, true, 'logout must be called in finally');
});

test('fetchNewMessages — re-throws genuine (non-NONEXISTENT) errors', async () => {
  let loggedOut = false;
  const fakeClient: ImapClient = {
    async connect() {},
    async mailboxOpen() {},
    async search() {
      return [];
    },
    fetch() {
      return (async function* () {
        throw new Error('Authentication failed');
      })();
    },
    async logout() {
      loggedOut = true;
    },
  };

  const config = {
    gmailUser: 'test@example.com',
    gmailAppPassword: 'test-password',
    imapFolder: 'Newsletters',
    bootstrapDays: 7,
  };
  await assert.rejects(() => fetchNewMessages(config, 500, fakeClient), /Authentication failed/);
  assert.equal(loggedOut, true, 'logout must still be called in finally');
});
