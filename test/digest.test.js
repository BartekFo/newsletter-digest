import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { openDb, initSchema, getLastUid, getItemsByUids, isKnown } from '../src/store.js';
import { renderHtml } from '../src/render.js';
import { runDigest } from '../src/digest.js';

// ──────────────────────────────────────────────────────────────────────────────
// Shared fakes & helpers
// ──────────────────────────────────────────────────────────────────────────────

const FIXED_NOW = new Date('2025-01-15T10:00:00.000Z');

const FAKE_MAILS = [
  {
    raw: Buffer.from('raw-mail-1'),
    uid: 101,
    parsed: {
      messageId: 'msg-001@test',
      sender: 'newsletter@example.com',
      subject: 'Weekly Digest #1',
      date: '2025-01-14T08:00:00.000Z',
      html: '<p>Content one</p>',
    },
    cleanText: 'Content one',
    summary: 'Podsumowanie pierwszego maila.',
  },
  {
    raw: Buffer.from('raw-mail-2'),
    uid: 102,
    parsed: {
      messageId: 'msg-002@test',
      sender: 'news@example.org',
      subject: 'Breaking News',
      date: '2025-01-14T09:00:00.000Z',
      html: '<p>Content two</p>',
    },
    cleanText: 'Content two',
    summary: 'Podsumowanie drugiego maila.',
  },
];

function makeFakeMail(mail) {
  return { raw: mail.raw, uid: mail.uid };
}

function makeDeps(db, overrides = {}) {
  let capturedHtml = null;
  let openFileCalled = false;

  const deps = {
    db,
    config: {
      gmailUser: 'test@gmail.com',
      gmailAppPassword: 'secret',
      imapFolder: 'Newsletters',
      bootstrapDays: 7,
      ollamaModel: 'test-model',
      dbPath: ':memory:',
      outPath: '/tmp/digest-test.html',
    },
    fetchNewMessages: async (_config, _lastUid) =>
      FAKE_MAILS.map(makeFakeMail),
    parseMail: async (raw) => {
      const str = raw.toString();
      const match = FAKE_MAILS.find((m) => m.raw.toString() === str);
      if (!match) throw new Error(`parseMail: unknown raw: ${str}`);
      return { ...match.parsed };
    },
    extractText: async (html) => {
      const match = FAKE_MAILS.find((m) => m.parsed.html === html);
      return match ? match.cleanText : '';
    },
    summarize: async (text, _model) => {
      const match = FAKE_MAILS.find((m) => m.cleanText === text);
      return match ? match.summary : 'Brak streszczenia.';
    },
    renderHtml,
    writeFile: async (_path, html) => {
      capturedHtml = html;
    },
    openFile: async (_path) => {
      openFileCalled = true;
    },
    now: () => FIXED_NOW,
    // Expose test-only helpers
    _getHtml: () => capturedHtml,
    _openFileCalled: () => openFileCalled,
  };

  return { ...deps, ...overrides };
}

// ──────────────────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────────────────

describe('runDigest', () => {
  let db;

  beforeEach(() => {
    db = openDb(':memory:');
    initSchema(db);
  });

  it('returns correct summary object', async () => {
    const deps = makeDeps(db);
    const result = await runDigest(deps);

    assert.deepEqual(result, { fetched: 2, newItems: 2 });
  });

  it('inserts both items in db with summaries set (commit-per-mail)', async () => {
    const deps = makeDeps(db);
    await runDigest(deps);

    for (const mail of FAKE_MAILS) {
      assert.equal(isKnown(db, mail.parsed.messageId), true, `isKnown(${mail.parsed.messageId})`);
    }

    const items = getItemsByUids(db, [101, 102]);
    assert.equal(items.length, 2);

    for (const item of items) {
      const expected = FAKE_MAILS.find((m) => m.uid === item.uid);
      assert.equal(item.summary, expected.summary, `summary for uid ${item.uid}`);
    }
  });

  it('rendered html contains both subjects and summaries', async () => {
    const deps = makeDeps(db);
    await runDigest(deps);

    const html = deps._getHtml();
    assert.ok(html, 'writeFile should have been called');

    for (const mail of FAKE_MAILS) {
      assert.ok(html.includes(mail.parsed.subject), `html should contain subject: ${mail.parsed.subject}`);
      assert.ok(html.includes(mail.summary), `html should contain summary: ${mail.summary}`);
    }
  });

  it('advances the UID cursor to the max uid after success', async () => {
    const deps = makeDeps(db);
    await runDigest(deps);

    assert.equal(getLastUid(db), 102);
  });

  it('records a run row with ok=1', async () => {
    const deps = makeDeps(db);
    await runDigest(deps);

    const row = db.prepare('SELECT * FROM runs ORDER BY id DESC LIMIT 1').get();
    assert.equal(row.ok, 1);
    assert.equal(row.fetched, 2);
    assert.equal(row.new_items, 2);
  });

  it('openFile is called after success', async () => {
    const deps = makeDeps(db);
    await runDigest(deps);

    assert.equal(deps._openFileCalled(), true);
  });

  describe('dedup: second run with same messages yields newItems=0', () => {
    it('does not insert duplicates and returns newItems=0', async () => {
      const deps = makeDeps(db);

      // First run
      await runDigest(deps);

      // Second run — same fake fetch returns the same 2 messages
      const result2 = await runDigest(deps);

      assert.deepEqual(result2, { fetched: 2, newItems: 0 });

      // Still exactly 2 rows in items table
      const count = db.prepare('SELECT COUNT(*) AS c FROM items').get().c;
      assert.equal(count, 2);
    });
  });

  describe('resilience: summarize throws on 2nd mail', () => {
    it('runDigest rejects and records ok=0', async () => {
      let callCount = 0;
      const failingSummarize = async (text, model) => {
        callCount++;
        if (callCount === 2) throw new Error('Ollama exploded');
        const match = FAKE_MAILS.find((m) => m.cleanText === text);
        return match ? match.summary : 'Fallback.';
      };

      const deps = makeDeps(db, { summarize: failingSummarize });

      await assert.rejects(
        () => runDigest(deps),
        (err) => {
          assert.ok(err.message.includes('Ollama exploded'));
          return true;
        },
      );

      // ok=0 run was recorded
      const row = db.prepare('SELECT * FROM runs ORDER BY id DESC LIMIT 1').get();
      assert.equal(row.ok, 0);
    });

    it('first mail summary was saved (commit-per-mail)', async () => {
      let callCount = 0;
      const failingSummarize = async (text, model) => {
        callCount++;
        if (callCount === 2) throw new Error('Ollama exploded');
        const match = FAKE_MAILS.find((m) => m.cleanText === text);
        return match ? match.summary : 'Fallback.';
      };

      const deps = makeDeps(db, { summarize: failingSummarize });

      try {
        await runDigest(deps);
      } catch {
        // expected
      }

      // First mail (uid=101) was committed with summary
      const firstMail = FAKE_MAILS[0];
      assert.equal(isKnown(db, firstMail.parsed.messageId), true);

      const items = getItemsByUids(db, [101]);
      assert.equal(items.length, 1);
      assert.equal(items[0].summary, firstMail.summary);
    });

    it('cursor was NOT advanced after failed run', async () => {
      let callCount = 0;
      const failingSummarize = async (text, model) => {
        callCount++;
        if (callCount === 2) throw new Error('Ollama exploded');
        const match = FAKE_MAILS.find((m) => m.cleanText === text);
        return match ? match.summary : 'Fallback.';
      };

      const deps = makeDeps(db, { summarize: failingSummarize });

      const uidBefore = getLastUid(db);

      try {
        await runDigest(deps);
      } catch {
        // expected
      }

      assert.equal(getLastUid(db), uidBefore);
    });
  });
});
