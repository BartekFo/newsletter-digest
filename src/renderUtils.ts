import { normalizeArticleUrl } from './link.js';

export function escapeHtml(value: unknown): string {
  if (value == null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function safeUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !/^https?:\/\//i.test(value)) return null;
  return normalizeArticleUrl(value);
}

export function gmailMessageUrl(messageId: string, gmailUser?: string): string {
  const account = gmailUser ? encodeURIComponent(gmailUser) : '0';
  return `https://mail.google.com/mail/u/${account}/#search/rfc822msgid:${encodeURIComponent(messageId)}`;
}
