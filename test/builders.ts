import type {
  AppConfig,
  DigestItem,
} from '../src/types.js';
import type { GmailFetchedMessage } from '../src/imap.js';
import type { ParsedMail } from '../src/parse.js';

export interface NewsletterFixture {
  message: GmailFetchedMessage;
  parsed: ParsedMail;
  cleanText: string;
  summary: string;
}

export interface NewsletterFixtureOverrides {
  message?: Partial<GmailFetchedMessage>;
  parsed?: Partial<ParsedMail>;
  cleanText?: string;
  summary?: string;
}

export function buildAppConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    gmailUser: 'test@gmail.com',
    gmailAppPassword: 'secret',
    imapFolder: 'Newsletters',
    bootstrapDays: 7,
    ollamaModel: 'test-model',
    dbPath: ':memory:',
    outPath: '/tmp/digest-test.html',
    weatherCity: 'Testowo',
    logLevel: 'silent',
    sendDigestEmail: false,
    digestEmailRecipient: 'test@gmail.com',
    ...overrides,
  };
}

export function buildDigestItem(overrides: Partial<DigestItem> = {}): DigestItem {
  return {
    newsletterId: overrides.newsletterId ?? 'newsletter-test-1',
    source: overrides.source ?? {
      type: 'gmail',
      externalId: '<test-1@example.com>',
      cursor: '101',
      metadata: {
        gmailMessageId: '<test-1@example.com>',
        gmailUid: 101,
      },
    },
    sender: 'newsletter@example.com',
    subject: 'Weekly Digest',
    date: '2026-06-27T10:00:00Z',
    cleanText: 'Hello world content',
    summary: null,
    link: null,
    isPaywalled: false,
    ...overrides,
  };
}

export function buildNewsletterFixture(
  overrides: NewsletterFixtureOverrides = {},
): NewsletterFixture {
  return {
    message: {
      raw: Buffer.from('raw-mail-1'),
      uid: 101,
      ...overrides.message,
    },
    parsed: {
      messageId: 'msg-001@test',
      sender: 'newsletter@example.com',
      subject: 'Weekly Digest #1',
      date: '2025-01-14T08:00:00.000Z',
      html: '<p>Content one</p>',
      link: null,
      isPaywalled: false,
      ...overrides.parsed,
    },
    cleanText: overrides.cleanText ?? 'Content one',
    summary: overrides.summary ?? 'Podsumowanie pierwszego maila.',
  };
}
