import { simpleParser } from 'mailparser';

/**
 * Parse a raw RFC822 email message into structured fields.
 * @param {Buffer|string} raw
 * @returns {Promise<{messageId: string, sender: string, subject: string, date: string, html: string}>}
 */
export async function parseMail(raw) {
  const parsed = await simpleParser(raw);

  const rawMessageId = parsed.messageId ?? '';
  const messageId = rawMessageId.replace(/^<|>$/g, '');

  const sender = parsed.from?.text ?? parsed.from?.value?.[0]?.address ?? '';
  const subject = parsed.subject ?? '';
  const date = parsed.date?.toISOString() ?? '';
  const html = parsed.html || parsed.textAsHtml || '';

  return { messageId, sender, subject, date, html };
}
