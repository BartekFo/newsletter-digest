import { simpleParser } from 'mailparser';
import type { ParsedMail } from './types.js';

const JUNK_LINK_PATTERNS = [
  /unsubscribe/i,
  /manage[-_ ]?preferences/i,
  /preferences/i,
  /privacy/i,
  /terms/i,
  /\/about\/?$/i,
  /\/archive\/?$/i,
  /\/archives\/?$/i,
  /facebook\.com/i,
  /instagram\.com/i,
  /linkedin\.com/i,
  /twitter\.com/i,
  /x\.com/i,
];

function decodeHtmlAttribute(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function getAttr(tag: string, name: string): string | null {
  const match = tag.match(new RegExp(`\\s${name}\\s*=\\s*["']([^"']+)["']`, 'i'));
  return match?.[1] ? decodeHtmlAttribute(match[1]) : null;
}

function isHttpUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

function isJunkLink(url: string, text: string): boolean {
  const haystack = `${url} ${text}`;
  if (JUNK_LINK_PATTERNS.some((pattern) => pattern.test(haystack))) return true;

  try {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/\/+$/g, '');
    return path === '' || path === '/';
  } catch {
    return true;
  }
}

function extractAnchorLinks(html: string): Array<{ href: string; text: string }> {
  const links: Array<{ href: string; text: string }> = [];
  const anchorRe = /<a\b[^>]*>[\s\S]*?<\/a>/gi;
  const anchors = html.match(anchorRe) ?? [];

  for (const anchor of anchors) {
    const openTag = anchor.match(/^<a\b[^>]*>/i)?.[0] ?? '';
    const href = getAttr(openTag, 'href');
    if (!href || !isHttpUrl(href)) continue;
    links.push({ href, text: stripTags(anchor) });
  }

  return links;
}

/**
 * Extract the canonical article URL from newsletter HTML.
 *
 * Newsletter platforms (Substack, Medium, Ghost, beehiiv) embed the web
 * version of the post as og:url or rel=canonical. Those are clean,
 * tracking-free links. Many newsletters do not include those tags in email,
 * so we also look for the common "view/read in browser" web-version link,
 * then fall back to the first non-boilerplate http(s) body link.
 *
 * @param {string} html
 * @returns {string|null}
 */
export function extractLink(html: unknown): string | null {
  if (!html || typeof html !== 'string') return null;

  const og =
    html.match(/<meta[^>]+property=["']og:url["'][^>]*content=["']([^"']+)["']/i) ||
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]*property=["']og:url["']/i);
  if (og?.[1] && /^https?:\/\//i.test(og[1])) return og[1];

  const canonical =
    html.match(/<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']+)["']/i) ||
    html.match(/<link[^>]+href=["']([^"']+)["'][^>]*rel=["']canonical["']/i);
  if (canonical?.[1] && /^https?:\/\//i.test(canonical[1])) return canonical[1];

  const anchors = extractAnchorLinks(html);
  const webVersion = anchors.find(({ text }) =>
    /\b(view|read|open)\b.*\b(browser|web|online|app)\b/i.test(text) ||
    /\b(browser|web|online|app)\b.*\bversion\b/i.test(text),
  );
  if (webVersion) return webVersion.href;

  const articleLink = anchors.find(({ href, text }) => !isJunkLink(href, text));
  if (articleLink) return articleLink.href;

  return null;
}

/**
 * Parse a raw RFC822 email message into structured fields.
 * @param {Buffer|string} raw
 * @returns {Promise<{messageId: string, sender: string, subject: string, date: string, html: string, link: string|null}>}
 */
export async function parseMail(raw: Buffer | string): Promise<ParsedMail> {
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
