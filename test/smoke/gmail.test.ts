import { test } from 'node:test';
import assert from 'node:assert/strict';

import { fetchNewMessages } from '../../src/imap.js';

const gmailUser = process.env.GMAIL_USER;
const gmailAppPassword = process.env.GMAIL_APP_PASSWORD;
const hasCredentials = Boolean(gmailUser && gmailAppPassword);

test(
  'Gmail IMAP returns raw messages with UIDs',
  {
    skip: hasCredentials
      ? false
      : 'no Gmail credentials (set GMAIL_USER and GMAIL_APP_PASSWORD)',
  },
  async () => {
    assert.ok(gmailUser);
    assert.ok(gmailAppPassword);
    const messages = await fetchNewMessages(
      {
        gmailUser,
        gmailAppPassword,
        imapFolder: process.env.IMAP_FOLDER ?? 'Newsletters',
        bootstrapDays: 1,
      },
      null,
    );

    for (const message of messages) {
      assert.ok(Buffer.isBuffer(message.raw), 'message.raw must be a Buffer');
      assert.equal(typeof message.uid, 'number', 'message.uid must be a number');
    }
  },
);
