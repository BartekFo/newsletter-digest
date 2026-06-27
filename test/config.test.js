import { test } from 'node:test';
import assert from 'node:assert/strict';

// We import the factory function, not the default export, so we can inject env.
import { loadConfig } from '../src/config.js';

test('throws when GMAIL_USER is missing', () => {
  const env = { GMAIL_APP_PASSWORD: 'secret' };
  assert.throws(() => loadConfig(env), /GMAIL_USER/);
});

test('throws when GMAIL_APP_PASSWORD is missing', () => {
  const env = { GMAIL_USER: 'user@example.com' };
  assert.throws(() => loadConfig(env), /GMAIL_APP_PASSWORD/);
});

test('returns config with defaults when only required vars are set', () => {
  const env = {
    GMAIL_USER: 'user@example.com',
    GMAIL_APP_PASSWORD: 'secret',
  };
  const cfg = loadConfig(env);

  assert.equal(cfg.gmailUser, 'user@example.com');
  assert.equal(cfg.gmailAppPassword, 'secret');
  assert.equal(cfg.imapFolder, 'Newsletters');
  assert.equal(cfg.bootstrapDays, 7);
  assert.equal(cfg.ollamaModel, 'qwen3.6:35b-a3b');
  assert.equal(cfg.dbPath, './digest.db');
  assert.equal(cfg.outPath, './digest.html');
});

test('overrides defaults with env vars', () => {
  const env = {
    GMAIL_USER: 'user@example.com',
    GMAIL_APP_PASSWORD: 'secret',
    IMAP_FOLDER: 'MyNewsletters',
    BOOTSTRAP_DAYS: '14',
    OLLAMA_MODEL: 'llama3',
    DB_PATH: '/tmp/test.db',
    OUT_PATH: '/tmp/test.html',
  };
  const cfg = loadConfig(env);

  assert.equal(cfg.imapFolder, 'MyNewsletters');
  assert.equal(cfg.bootstrapDays, 14);
  assert.equal(cfg.ollamaModel, 'llama3');
  assert.equal(cfg.dbPath, '/tmp/test.db');
  assert.equal(cfg.outPath, '/tmp/test.html');
});
