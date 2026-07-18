import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createGmailSourceAdapter } from '../src/gmailSource.js';
import { buildAppConfig } from './builders.js';

test('Gmail source adapter owns UID cursor and RFC822 deep-link metadata', async () => {
  let receivedCursor: number | null | undefined;
  const adapter = createGmailSourceAdapter(
    buildAppConfig(),
    async (_config, cursor) => {
      receivedCursor = cursor;
      return [{ raw: Buffer.from('mail'), uid: 44 }];
    },
    async () => ({
      messageId: '<source@example.com>',
      sender: 'Source',
      subject: 'Subject',
      date: '2026-07-18T08:00:00Z',
      html: '<p>Body</p>',
      link: 'https://example.com',
      isPaywalled: false,
    }),
  );

  const batch = await adapter.fetch('41');

  assert.equal(receivedCursor, 41);
  assert.equal(batch.cursor, '44');
  assert.deepEqual(batch.newsletters[0]?.source, {
    type: 'gmail',
    externalId: '<source@example.com>',
    cursor: '44',
    metadata: {
      gmailMessageId: '<source@example.com>',
      gmailUid: 44,
    },
  });
});
