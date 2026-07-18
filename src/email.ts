import nodemailer from 'nodemailer';

import { gmailMessageIdFromMetadata, gmailMessageUrl } from './gmailSource.js';
import { escapeHtml, safeUrl } from './renderUtils.js';
import type { AppConfig, DigestItem, DigestMeta } from './types.js';

export interface DigestEmailMessage {
  subject: string;
  html: string;
  text: string;
}

export interface DigestEmailDelivery extends DigestEmailMessage {
  from: string;
  to: string;
}

export interface DigestEmailTransport {
  sendMail(message: DigestEmailDelivery): Promise<unknown>;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('pl-PL', {
    timeZone: 'Europe/Warsaw',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function newItemsLabel(count: number): string {
  if (count === 1) return '1 nowy';
  if (count >= 2 && count <= 4) return `${count} nowe`;
  return `${count} nowych`;
}

export function buildDigestEmail(items: DigestItem[], meta: DigestMeta): DigestEmailMessage {
  const sorted = [...items].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  const label = newItemsLabel(meta.newCount);

  const weatherHtml = meta.weather
    ? `<div style="margin:20px 0;padding:14px 16px;background:#ffffff;border:1px solid #e4e0d6;border-radius:10px;color:#4a463e">
        <strong style="color:#1b1a17">${escapeHtml(meta.weather.city)} · ${escapeHtml(meta.weather.temp)}°C</strong><br>
        ${escapeHtml(meta.weather.description)} · maks. ${escapeHtml(meta.weather.max)}°, min. ${escapeHtml(meta.weather.min)}° · opady ${escapeHtml(meta.weather.precipProb)}%
      </div>`
    : '';

  const itemsHtml = sorted.map((item) => {
    const articleUrl = safeUrl(item.link);
    const subject = articleUrl
      ? `<a href="${escapeHtml(articleUrl)}" style="color:#1b1a17;text-decoration:none">${escapeHtml(item.subject)}</a>`
      : escapeHtml(item.subject);
    const gmailMessageId = gmailMessageIdFromMetadata(item.source.metadata);
    const gmailUrl = gmailMessageId ? gmailMessageUrl(gmailMessageId, meta.gmailUser) : null;
    const summary = item.summary ?? '(brak streszczenia)';

    return `<div style="margin:0 0 14px;padding:22px;background:#ffffff;border:1px solid #e4e0d6;border-radius:12px">
      <h2 style="margin:0 0 8px;font:700 21px/1.3 Georgia,serif;color:#1b1a17">${subject}</h2>
      <div style="margin:0 0 13px;font-size:13px;line-height:1.5;color:#8a8478">
        ${item.isPaywalled ? '<strong style="color:#8a3f18">Płatne · </strong>' : ''}${escapeHtml(item.sender)} · ${escapeHtml(formatDate(item.date))}
      </div>
      <p style="margin:0;color:#4a463e;font-size:16px;line-height:1.6">${escapeHtml(summary)}</p>
      <div style="margin-top:14px;font-size:13px">
        ${articleUrl ? `<a href="${escapeHtml(articleUrl)}" style="color:#2f5d50">Otwórz artykuł</a>` : ''}
        ${articleUrl && gmailUrl ? ' &nbsp;·&nbsp; ' : ''}
        ${gmailUrl ? `<a href="${escapeHtml(gmailUrl)}" style="color:#2f5d50">Otwórz w Gmailu</a>` : ''}
      </div>
    </div>`;
  }).join('\n');

  const hackerNewsHtml = meta.hackernews?.length
    ? `<div style="margin-top:34px">
        <h2 style="font:700 14px/1.4 Arial,sans-serif;color:#ff6600;text-transform:uppercase;letter-spacing:.08em">Hacker News Top ${meta.hackernews.length}</h2>
        <ol style="padding-left:24px;color:#4a463e">
          ${meta.hackernews.map((story) => {
            const storyUrl = safeUrl(story.url);
            const title = storyUrl
              ? `<a href="${escapeHtml(storyUrl)}" style="color:#1b1a17">${escapeHtml(story.title)}</a>`
              : escapeHtml(story.title);
            return `<li style="margin:0 0 10px">${title}<br><span style="font-size:12px;color:#8a8478">${escapeHtml(story.score)} pkt · ${escapeHtml(story.comments)} komentarzy</span></li>`;
          }).join('')}
        </ol>
      </div>`
    : '';

  const textItems = sorted.map((item) => {
    const gmailMessageId = gmailMessageIdFromMetadata(item.source.metadata);
    const links = [safeUrl(item.link), gmailMessageId ? gmailMessageUrl(gmailMessageId, meta.gmailUser) : null]
      .filter((url): url is string => Boolean(url))
      .join('\n');
    return `${item.subject}\n${item.sender} · ${formatDate(item.date)}\n${item.summary ?? '(brak streszczenia)'}${links ? `\n${links}` : ''}`;
  }).join('\n\n');

  const weatherText = meta.weather
    ? `${meta.weather.city}: ${meta.weather.temp}°C, ${meta.weather.description}, maks. ${meta.weather.max}°, min. ${meta.weather.min}°, opady ${meta.weather.precipProb}%\n\n`
    : '';
  const hackerNewsText = meta.hackernews?.length
    ? `\n\nHacker News Top ${meta.hackernews.length}\n${meta.hackernews.map((story, index) => `${index + 1}. ${story.title}\n${story.url}`).join('\n')}`
    : '';

  return {
    subject: `Newsletter Digest — ${label}`,
    html: `<!DOCTYPE html>
<html lang="pl">
<body style="margin:0;background:#f7f5f0;color:#1b1a17;font-family:Arial,sans-serif">
  <div style="max-width:680px;margin:0 auto;padding:36px 18px 48px">
    <h1 style="margin:0;font:700 38px/1.1 Georgia,serif">Newsletter Digest</h1>
    <p style="margin:10px 0 0;color:#8a8478;font-size:13px">Wygenerowano ${escapeHtml(formatDate(meta.ranAt))} · ${escapeHtml(label)}</p>
    ${weatherHtml}
    <div style="margin-top:24px">${itemsHtml}</div>
    ${hackerNewsHtml}
    <p style="margin-top:36px;padding-top:16px;border-top:1px solid #e4e0d6;text-align:center;color:#8a8478;font-size:12px">Newsletter Digest · wygenerowano lokalnie</p>
  </div>
</body>
</html>`,
    text: `Newsletter Digest — ${label}\nWygenerowano ${formatDate(meta.ranAt)}\n\n${weatherText}${textItems}${hackerNewsText}`,
  };
}

export async function sendDigestEmail(
  config: AppConfig,
  message: DigestEmailMessage,
  transport: DigestEmailTransport = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: {
      user: config.gmailUser,
      pass: config.gmailAppPassword,
    },
  }),
): Promise<void> {
  await transport.sendMail({
    from: config.gmailUser,
    to: config.digestEmailRecipient,
    subject: message.subject,
    html: message.html,
    text: message.text,
  });
}
