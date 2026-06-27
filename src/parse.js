import { simpleParser } from 'mailparser';

/**
 * Extract the canonical article URL from newsletter HTML.
 *
 * Newsletter platforms (Substack, Medium, Ghost, beehiiv) embed the web
 * version of the post as og:url or rel=canonical. Those are clean,
 * tracking-free links — unlike body anchors, which are mostly redirect/
 * unsubscribe/social junk. Returns null when neither is present so the
 * caller keeps the Gmail deep-link as the only affordance.
 *
 * @param {string} html
 * @returns {string|null}
 */
export function extractLink(html) {
  if (!html || typeof html !== 'string') return null;

  const og =
    html.match(/<meta[^>]+property=["']og:url["'][^>]*content=["']([^"']+)["']/i) ||
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]*property=["']og:url["']/i);
  if (og && /^https?:\/\//i.test(og[1])) return og[1];

  const canonical =
    html.match(/<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']+)["']/i) ||
    html.match(/<link[^>]+href=["']([^"']+)["'][^>]*rel=["']canonical["']/i);
  if (canonical && /^https?:\/\//i.test(canonical[1])) return canonical[1];

  return null;
}

/**
 * Parse a raw RFC822 email message into structured fields.
 * @param {Buffer|string} raw
 * @returns {Promise<{messageId: string, sender: string, subject: string, date: string, html: string, link: string|null}>}
 */
export async function parseMail(raw) {
  const parsed = await simpleParser(raw);

  const rawMessageId = parsed.messageId ?? '';
  const messageId = rawMessageId.replace(/^<|>$/g, '');

  const sender = parsed.from?.text ?? parsed.from?.value?.[0]?.address ?? '';
  const subject = parsed.subject ?? '';
  const date = parsed.date?.toISOString() ?? '';
  const html = parsed.html || parsed.textAsHtml || '';
  const link = extractLink(html);

  return { messageId, sender, subject, date, html, link };
}
