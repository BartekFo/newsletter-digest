import { ImapFlow } from 'imapflow';
import type { AppConfig } from './types.js';

export interface GmailFetchedMessage {
  raw: Buffer;
  uid: number;
}

/**
 * Determine what to fetch based on the last-seen UID.
 *
 * @param {number|null} lastUid - last UID stored in the cursor; null means first run
 * @param {number} bootstrapDays - how many days back to go on first run
 * @param {Date} [now=new Date()] - injectable clock for deterministic tests
 * @returns {{ mode: 'since', since: Date } | { mode: 'uid', range: string }}
 */
export type FetchCriteria =
  | { mode: 'since'; since: Date }
  | { mode: 'uid'; range: string };

export interface ImapClient {
  connect(): Promise<void>;
  mailboxOpen(path: string): Promise<unknown>;
  search(query: object, options: object): Promise<number[]>;
  fetch(
    range: string,
    query: object,
    options: object,
  ): AsyncIterable<{ source: Buffer; uid: number }>;
  logout(): Promise<void>;
}

interface ImapError {
  responseStatus?: string;
  code?: string;
  responseText?: string;
  message?: string;
}

export function buildFetchCriteria(
  lastUid: number | null,
  bootstrapDays: number,
  now = new Date(),
): FetchCriteria {
  if (lastUid == null) {
    const since = new Date(now.getTime() - bootstrapDays * 24 * 3600 * 1000);
    return { mode: 'since', since };
  }
  return { mode: 'uid', range: `${lastUid + 1}:*` };
}

/**
 * True when the error is Gmail's "no matching messages" response for an
 * out-of-range UID set, rather than a genuine failure.
 */
function isNoMatchingMessagesError(err: unknown): boolean {
  const imapErr = err as ImapError;
  const code = imapErr.responseStatus ?? imapErr.code ?? '';
  const text = `${imapErr.responseText ?? imapErr.message ?? ''}`.toUpperCase();
  return code === 'NO' || text.includes('NONEXISTENT');
}

/**
 * Connect to Gmail via IMAP and fetch new messages from the configured folder.
 *
 * @param {{ gmailUser: string, gmailAppPassword: string, imapFolder: string, bootstrapDays: number }} config
 * @param {number|null} lastUid
 * @param {object} [client] - injectable ImapFlow-compatible client (for tests)
 * @returns {Promise<{ raw: Buffer, uid: number }[]>}
 */
export async function fetchNewMessages(
  config: Pick<AppConfig, 'gmailUser' | 'gmailAppPassword' | 'imapFolder' | 'bootstrapDays'>,
  lastUid: number | null,
  client?: ImapClient,
): Promise<GmailFetchedMessage[]> {
  const imap =
    client ??
    (new ImapFlow({
      host: 'imap.gmail.com',
      port: 993,
      secure: true,
      auth: {
        user: config.gmailUser,
        pass: config.gmailAppPassword,
      },
      // Suppress imapflow's built-in logger to keep output clean
      logger: false,
    }) as unknown as ImapClient);

  const messages: GmailFetchedMessage[] = [];

  try {
    await imap.connect();
    await imap.mailboxOpen(config.imapFolder);

    const criteria = buildFetchCriteria(lastUid, config.bootstrapDays);

    if (criteria.mode === 'since') {
      // Search for messages since the bootstrap date, then fetch their sources
      const uids = await imap.search({ since: criteria.since }, { uid: true });

      if (uids.length > 0) {
        const range = uids.join(',');
        for await (const message of imap.fetch(range, { source: true }, { uid: true })) {
          messages.push({ raw: message.source, uid: message.uid });
        }
      }
    } else {
      // Incremental: fetch UID range (lastUid+1):*.
      // When lastUid+1 is past the highest UID (the common "nothing new"
      // case), Gmail answers with a NONEXISTENT NO error that imapflow throws.
      // Treat that as zero new messages and return []; re-throw real errors.
      try {
        for await (const message of imap.fetch(criteria.range, { source: true }, { uid: true })) {
          messages.push({ raw: message.source, uid: message.uid });
        }
      } catch (err) {
        if (!isNoMatchingMessagesError(err)) throw err;
      }
    }
  } finally {
    await imap.logout();
  }

  return messages;
}
