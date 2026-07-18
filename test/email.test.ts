import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildDigestEmail,
  sendDigestEmail,
  type DigestEmailDelivery,
  type DigestEmailTransport,
} from '../src/email.js';
import type { AppConfig } from '../src/types.js';

const ITEMS = [
  {
    messageId: '<digest@example.com>',
    uid: 7,
    sender: 'Example Newsletter <hello@example.com>',
    subject: 'A useful article',
    date: '2026-07-18T08:30:00.000Z',
    cleanText: 'Full article body must stay local.',
    summary: 'Krótkie podsumowanie artykułu.',
    link: 'https://example.com/article',
    isPaywalled: false,
  },
];

const META = {
  ranAt: '2026-07-18T10:00:00.000Z',
  newCount: 1,
  gmailUser: 'reader@gmail.com',
  weather: {
    city: 'Warszawa',
    temp: 24,
    code: 1,
    description: 'Prawie bezchmurnie',
    max: 27,
    min: 16,
    precipProb: 10,
  },
  hackernews: [
    {
      title: 'An interesting HN story',
      url: 'https://example.com/hn-story',
      score: 150,
      comments: 42,
      hnUrl: 'https://news.ycombinator.com/item?id=123',
    },
  ],
};

test('builds an email-safe digest with summaries and useful links', () => {
  const email = buildDigestEmail(ITEMS, META);

  assert.equal(email.subject, 'Newsletter Digest — 1 nowy');
  assert.match(email.html, /Krótkie podsumowanie artykułu/);
  assert.match(email.html, /https:\/\/example\.com\/article/);
  assert.match(email.html, /mail\.google\.com/);
  assert.match(email.html, /Warszawa/);
  assert.match(email.html, /An interesting HN story/);
  assert.match(email.text, /Krótkie podsumowanie artykułu/);
  assert.doesNotMatch(email.html, /<script/i);
  assert.doesNotMatch(email.html, /class="chat-button"/);
  assert.doesNotMatch(email.html, /Full article body must stay local/);
});

test('sends the digest from Gmail to the configured recipient', async () => {
  let sent: DigestEmailDelivery | undefined;
  const transport: DigestEmailTransport = {
    sendMail: async (message) => {
      sent = message;
    },
  };
  const config = {
    gmailUser: 'sender@gmail.com',
    gmailAppPassword: 'app-password',
    digestEmailRecipient: 'reader@example.com',
  } as AppConfig;
  const email = buildDigestEmail(ITEMS, META);

  await sendDigestEmail(config, email, transport);

  assert.deepEqual(sent, {
    from: 'sender@gmail.com',
    to: 'reader@example.com',
    subject: 'Newsletter Digest — 1 nowy',
    html: email.html,
    text: email.text,
  });
});
