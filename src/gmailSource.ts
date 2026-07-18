import { fetchNewMessages } from './imap.js';
import { parseMail } from './parse.js';
import type { AppConfig, NewsletterSourceAdapter } from './types.js';

export function gmailMessageUrl(messageId: string, gmailUser?: string): string {
  const account = gmailUser ? encodeURIComponent(gmailUser) : '0';
  return `https://mail.google.com/mail/u/${account}/#search/rfc822msgid:${encodeURIComponent(messageId)}`;
}

export function gmailMessageIdFromMetadata(metadata: Record<string, string | number>): string | null {
  const messageId = metadata.gmailMessageId;
  return typeof messageId === 'string' && messageId.length > 0 ? messageId : null;
}

/** Gmail-specific fetch, cursor and RFC822 identity mapping. */
export function createGmailSourceAdapter(
  config: AppConfig,
  fetchMessages = fetchNewMessages,
  parseMessage = parseMail,
): NewsletterSourceAdapter {
  return {
    async fetch(cursor) {
      const lastUid = cursor == null ? null : Number(cursor);
      const fetched = await fetchMessages(config, Number.isFinite(lastUid) ? lastUid : null);
      let maxUid = lastUid ?? 0;
      const newsletters = [];

      for (const message of fetched) {
        const mail = await parseMessage(message.raw);
        maxUid = Math.max(maxUid, message.uid);
        newsletters.push({
          source: {
            type: 'gmail',
            externalId: mail.messageId,
            cursor: String(message.uid),
            metadata: {
              gmailMessageId: mail.messageId,
              gmailUid: message.uid,
            },
          },
          sender: mail.sender,
          subject: mail.subject,
          date: mail.date,
          html: mail.html,
          link: mail.link,
          isPaywalled: mail.isPaywalled,
        });
      }

      return {
        newsletters,
        cursor: fetched.length > 0 ? String(maxUid) : cursor,
      };
    },
  };
}
