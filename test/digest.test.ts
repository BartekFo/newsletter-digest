import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  createDigestArchive,
  openDb,
  initSchema,
  getLastUid,
  getItemsByRunId,
  getItemsByUids,
  getRunSummaries,
  isKnown,
} from '../src/store.js';
import { renderDigestPage } from '../src/render.js';
import { runDigest, type DigestDeps } from '../src/digest.js';
import type { DigestEmailMessage } from '../src/email.js';
import type { Db } from '../src/types.js';
import {
  buildAppConfig,
  buildNewsletterFixture,
  type NewsletterFixture,
} from './builders.js';

// ──────────────────────────────────────────────────────────────────────────────
// Shared fakes & helpers
// ──────────────────────────────────────────────────────────────────────────────

const FIXED_NOW = new Date('2025-01-15T10:00:00.000Z');

const FAKE_MAILS: readonly [NewsletterFixture, NewsletterFixture] = [
  buildNewsletterFixture(),
  buildNewsletterFixture({
    message: {
      raw: Buffer.from('raw-mail-2'),
      uid: 102,
    },
    parsed: {
      messageId: 'msg-002@test',
      sender: 'news@example.org',
      subject: 'Breaking News',
      date: '2025-01-14T09:00:00.000Z',
      html: '<p>Content two</p>',
      link: null,
      isPaywalled: true,
    },
    cleanText: 'Content two',
    summary: 'Podsumowanie drugiego maila.',
  }),
];

interface DigestTestControls {
  _getHtml(): string | null;
  _openFileCalled(): boolean;
  _writeFileCalls(): number;
  _sendEmailCalls(): number;
  _sentEmail(): DigestEmailMessage | null;
}

type TestDigestDeps = DigestDeps & DigestTestControls;

function assertRefreshSummary(
  result: Awaited<ReturnType<typeof runDigest>>,
  expected: { fetched: number; newItems: number; runId: number | null },
): void {
  assert.deepEqual(
    { fetched: result.fetched, newItems: result.newItems, runId: result.runId },
    expected,
  );
}

function makeDeps(db: Db, overrides: Partial<DigestDeps> = {}): TestDigestDeps {
  let capturedHtml: string | null = null;
  let openFileCalled = false;
  let writeFileCalls = 0;
  let sentEmail: DigestEmailMessage | null = null;
  let sendEmailCalls = 0;

  const deps: TestDigestDeps = {
    archive: createDigestArchive(db),
    config: buildAppConfig(),
    fetchNewMessages: async () => FAKE_MAILS.map((mail) => mail.message),
    parseMail: async (raw) => {
      const str = raw.toString();
      const match = FAKE_MAILS.find((mail) => mail.message.raw.toString() === str);
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
    fetchWeather: async () => ({
      city: 'Testowo',
      temp: 12,
      code: 3,
      description: 'Pochmurno',
      max: 15,
      min: 7,
      precipProb: 40,
    }),
    fetchTopStories: async () => [
      {
        title: 'Fake HN Story',
        url: 'https://example.com/story',
        score: 123,
        comments: 45,
        hnUrl: 'https://news.ycombinator.com/item?id=1',
      },
    ],
    renderHtml: renderDigestPage,
    buildDigestEmail: (items, meta) => ({
      subject: `Digest: ${items.length}`,
      html: `<p>${meta.newCount}</p>`,
      text: String(meta.newCount),
    }),
    sendDigestEmail: async (_config, message) => {
      sendEmailCalls++;
      sentEmail = message;
    },
    writeFile: async (_path, html) => {
      writeFileCalls++;
      capturedHtml = html;
    },
    openFile: async (_path) => {
      openFileCalled = true;
    },
    now: () => FIXED_NOW,
    // Expose test-only helpers
    _getHtml: () => capturedHtml,
    _openFileCalled: () => openFileCalled,
    _writeFileCalls: () => writeFileCalls,
    _sendEmailCalls: () => sendEmailCalls,
    _sentEmail: () => sentEmail,
  };

  return { ...deps, ...overrides };
}

// ──────────────────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────────────────

describe('runDigest', () => {
  let db: Db;

  beforeEach(() => {
    db = openDb(':memory:');
    initSchema(db);
  });

  it('returns correct summary object', async () => {
    const deps = makeDeps(db);
    const result = await runDigest(deps);

    assertRefreshSummary(result, { fetched: 2, newItems: 2, runId: 1 });
    assert.equal(result.newsletterIds.length, 2);
  });

  it('publishes both items in db with summaries set', async () => {
    const deps = makeDeps(db);
    await runDigest(deps);

    for (const mail of FAKE_MAILS) {
      assert.equal(isKnown(db, mail.parsed.messageId), true, `isKnown(${mail.parsed.messageId})`);
    }

    const items = getItemsByUids(db, [101, 102]);
    assert.equal(items.length, 2);

    for (const item of items) {
      const expected = FAKE_MAILS.find((mail) => mail.message.uid === item.uid);
      assert.ok(expected, `fixture for uid ${item.uid}`);
      assert.equal(item.summary, expected.summary, `summary for uid ${item.uid}`);
      assert.equal(item.isPaywalled, expected.parsed.isPaywalled, `isPaywalled for uid ${item.uid}`);
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

    assert.ok(html.includes('class="paywall-badge"'), 'html should contain paid badge');
  });

  it('rendered html contains weather and HackerNews data', async () => {
    const deps = makeDeps(db);
    await runDigest(deps);

    const html = deps._getHtml();
    assert.ok(html, 'writeFile should have been called');
    assert.ok(html.includes('Testowo'), 'html should contain weather city');
    assert.ok(html.includes('12°C'), 'html should contain current temperature');
    assert.ok(html.includes('Fake HN Story'), 'html should contain HN story title');
  });

  it('survives null weather and hackernews (failure-safe)', async () => {
    const deps = makeDeps(db, {
      fetchWeather: async () => null,
      fetchTopStories: async () => null,
    });

    const result = await runDigest(deps);
    assertRefreshSummary(result, { fetched: 2, newItems: 2, runId: 1 });

    const html = deps._getHtml();
    assert.ok(html, 'writeFile should have been called');
    assert.ok(html.includes('<!DOCTYPE html>'), 'still a valid HTML doc');
  });

  it('survives a rejected extras fetch (failure-safe)', async () => {
    const deps = makeDeps(db, {
      fetchWeather: async () => { throw new Error('weather API down'); },
      fetchTopStories: async () => { throw new Error('HN API down'); },
    });

    const result = await runDigest(deps);
    assertRefreshSummary(result, { fetched: 2, newItems: 2, runId: 1 });
  });

  it('advances the UID cursor to the max uid after success', async () => {
    const deps = makeDeps(db);
    await runDigest(deps);

    assert.equal(getLastUid(db), 102);
  });

  it('records a run row with ok=1', async () => {
    const deps = makeDeps(db);
    await runDigest(deps);

    const row = db.prepare('SELECT * FROM runs ORDER BY id DESC LIMIT 1').get() as {
      ok: number;
      fetched: number;
      new_items: number;
    };
    assert.equal(row.ok, 1);
    assert.equal(row.fetched, 2);
    assert.equal(row.new_items, 2);
  });

  it('records weather and HackerNews with the run snapshot', async () => {
    const deps = makeDeps(db);
    const result = await runDigest(deps);

    const runId = result.runId;
    assert.ok(runId !== null);
    const run = db.prepare('SELECT weather_json, hackernews_json FROM runs WHERE id = ?').get(runId) as {
      weather_json: string;
      hackernews_json: string;
    };
    const weather = JSON.parse(run.weather_json);
    const hackernews = JSON.parse(run.hackernews_json);

    assert.equal(weather.city, 'Testowo');
    assert.equal(hackernews[0].title, 'Fake HN Story');
  });

  it('records run_items for the new snapshot', async () => {
    const deps = makeDeps(db);
    const result = await runDigest(deps);

    const runId = result.runId;
    assert.ok(runId !== null);
    const items = getItemsByRunId(db, runId);
    assert.equal(items.length, 2);
    assert.deepEqual(items.map((item) => item.messageId).sort(), ['msg-001@test', 'msg-002@test']);
  });

  it('recovers every newsletter after snapshot publication fails atomically', async () => {
    db.exec(`
      CREATE TRIGGER fail_snapshot_publication
      BEFORE INSERT ON run_items
      BEGIN
        SELECT RAISE(ABORT, 'simulated publication failure');
      END;
    `);

    await assert.rejects(
      runDigest(makeDeps(db)),
      /simulated publication failure/,
    );

    assert.equal(getLastUid(db), null, 'cursor must remain at the last recoverable snapshot');
    assert.equal(getItemsByUids(db, [101, 102]).length, 0, 'unpublished items must roll back');
    assert.deepEqual(getRunSummaries(db), [], 'failed publication must not become visible');

    db.exec('DROP TRIGGER fail_snapshot_publication');
    const recovered = await runDigest(makeDeps(db));

    assert.equal(recovered.newItems, 2);
    assert.ok(recovered.runId !== null);
    assert.equal(getLastUid(db), 102);
    assert.deepEqual(
      getItemsByRunId(db, recovered.runId).map((item) => item.messageId).sort(),
      ['msg-001@test', 'msg-002@test'],
    );
  });

  it('openFile is called after success', async () => {
    const deps = makeDeps(db);
    await runDigest(deps);

    assert.equal(deps._openFileCalled(), true);
  });

  it('emails a new digest when email delivery is enabled', async () => {
    const deps = makeDeps(db);
    deps.config.sendDigestEmail = true;

    await runDigest(deps);

    assert.equal(deps._sendEmailCalls(), 1);
    assert.deepEqual(deps._sentEmail(), {
      subject: 'Digest: 2',
      html: '<p>2</p>',
      text: '2',
    });
  });

  it('keeps a generated digest successful when email delivery fails', async () => {
    const deps = makeDeps(db, {
      sendDigestEmail: async () => {
        throw new Error('SMTP unavailable');
      },
    });
    deps.config.sendDigestEmail = true;

    const result = await runDigest(deps);

    assertRefreshSummary(result, { fetched: 2, newItems: 2, runId: 1 });
    assert.equal(deps._openFileCalled(), true);
    const run = db.prepare('SELECT ok FROM runs WHERE id = 1').get() as { ok: number };
    assert.equal(run.ok, 1);
  });

  it('keeps the published snapshot and continues email delivery when static export fails', async () => {
    const deps = makeDeps(db, {
      writeFile: async () => {
        throw new Error('disk unavailable');
      },
    });
    deps.config.sendDigestEmail = true;

    const result = await runDigest(deps);

    assert.ok(result.runId !== null);
    assert.equal(getItemsByRunId(db, result.runId).length, 2);
    assert.equal(deps._sendEmailCalls(), 1, 'email delivery should be independent from export');
    assert.equal(deps._openFileCalled(), false, 'a missing export must not be opened');
    const run = db.prepare('SELECT ok FROM runs WHERE id = ?').get(result.runId) as { ok: number };
    assert.equal(run.ok, 1);
  });

  it('does not email when delivery is disabled', async () => {
    const deps = makeDeps(db);

    await runDigest(deps);

    assert.equal(deps._sendEmailCalls(), 0);
  });

  describe('dedup: second run with same messages yields newItems=0', () => {
    it('does not insert duplicates and returns newItems=0', async () => {
      const deps = makeDeps(db);

      // First run
      await runDigest(deps);

      // Second run — same fake fetch returns the same 2 messages
      const result2 = await runDigest(deps);

      assertRefreshSummary(result2, { fetched: 2, newItems: 0, runId: null });

      // Still exactly 2 rows in items table
      const count = (db.prepare('SELECT COUNT(*) AS c FROM items').get() as { c: number }).c;
      assert.equal(count, 2);

      const runCount = (db.prepare('SELECT COUNT(*) AS c FROM runs').get() as { c: number }).c;
      assert.equal(runCount, 1, 'an empty refresh must not create a new digest snapshot');
      assert.equal(deps._writeFileCalls(), 1, 'an empty refresh must not overwrite digest.html');
    });

    it('does not send another email for an empty refresh', async () => {
      const deps = makeDeps(db);
      deps.config.sendDigestEmail = true;

      await runDigest(deps);
      await runDigest(deps);

      assert.equal(deps._sendEmailCalls(), 1);
    });
  });

  describe('resilience: summarize throws on 2nd mail', () => {
    let callCount = 0;
    const failingSummarize: DigestDeps['summarize'] = async (text) => {
      callCount++;
      if (callCount === 2) throw new Error('Ollama exploded');
      const match = FAKE_MAILS.find((m) => m.cleanText === text);
      return match ? match.summary : 'Fallback.';
    };

    beforeEach(() => {
      callCount = 0;
    });

    it('does not reject — completes with both items and records ok=1', async () => {
      const deps = makeDeps(db, { summarize: failingSummarize });

      const result = await runDigest(deps);
      assertRefreshSummary(result, { fetched: 2, newItems: 2, runId: 1 });

      const row = db.prepare('SELECT * FROM runs ORDER BY id DESC LIMIT 1').get() as { ok: number };
      assert.equal(row.ok, 1);
    });

    it('first mail keeps its summary, second mail summary is null', async () => {
      const deps = makeDeps(db, { summarize: failingSummarize });

      await runDigest(deps);

      const items = getItemsByUids(db, [101, 102]);
      assert.equal(items.length, 2);

      const first = items.find((i) => i.uid === 101);
      const second = items.find((i) => i.uid === 102);
      assert.ok(first);
      assert.ok(second);
      assert.equal(first.summary, FAKE_MAILS[0].summary);
      assert.equal(second.summary, null);
    });

    it('failed-summary item still appears in the digest with a placeholder', async () => {
      const deps = makeDeps(db, { summarize: failingSummarize });

      await runDigest(deps);

      const html = deps._getHtml();
      assert.ok(html, 'writeFile should have been called');
      assert.ok(html.includes('Breaking News'), 'second subject should render');
      assert.ok(html.includes('(brak streszczenia)'), 'placeholder should render');
    });

    it('cursor IS advanced past the failed mail', async () => {
      const deps = makeDeps(db, { summarize: failingSummarize });

      await runDigest(deps);

      assert.equal(getLastUid(db), 102);
    });
  });
});
