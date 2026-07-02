import type { DigestItem, DigestMeta, HackerNewsStory, WeatherSummary } from './types.js';

/**
 * Escapes HTML special characters to prevent injection from untrusted input
 * (email headers: subject, sender).
 */
function escapeHtml(str: unknown): string {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Returns the URL only if it is a safe http/https link, else null.
 * Blocks javascript:/data: schemes from reaching an href.
 */
function safeUrl(url: unknown): string | null {
  if (!url || typeof url !== 'string') return null;
  return /^https?:\/\//i.test(url) ? url : null;
}

function gmailMessageUrl(messageId: string, gmailUser?: string): string {
  const account = gmailUser ? encodeURIComponent(gmailUser) : '0';
  return `https://mail.google.com/mail/u/${account}/#search/rfc822msgid:${encodeURIComponent(messageId)}`;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw' });
  } catch {
    return escapeHtml(iso);
  }
}

function formatDay(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('pl-PL', {
      timeZone: 'Europe/Warsaw',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  } catch {
    return escapeHtml(iso);
  }
}

/**
 * Map a WMO weather code to a representative emoji glyph for the masthead icon.
 * Falls back to a neutral cloud when the code is unknown.
 * @param {number} code
 * @returns {string}
 */
function weatherIcon(code: number): string {
  if (code === 0) return '☀️';
  if (code === 1) return '🌤️';
  if (code === 2) return '⛅';
  if (code === 3) return '☁️';
  if (code === 45 || code === 48) return '🌫️';
  if (code >= 51 && code <= 57) return '🌦️';
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return '🌧️';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return '❄️';
  if (code >= 95) return '⛈️';
  return '☁️';
}

/**
 * Renders the current-weather banner, or empty string when no data.
 * @param {{city: string, temp: number, code?: number, description: string, max: number, min: number, precipProb: number}|null|undefined} weather
 * @returns {string}
 */
function renderWeather(weather: WeatherSummary | null | undefined): string {
  if (!weather) return '';

  return `
    <div class="weather">
      <span class="w-icon" aria-hidden="true">${weatherIcon(weather.code)}</span>
      <span class="w-city">${escapeHtml(weather.city)}</span>
      <span class="w-temp">${escapeHtml(String(weather.temp))}°C</span>
      <span class="w-desc">${escapeHtml(weather.description)}</span>
      <span class="w-sep" aria-hidden="true"></span>
      <span class="w-chip"><span class="hi">↑${escapeHtml(String(weather.max))}°</span> <span class="lo">↓${escapeHtml(String(weather.min))}°</span></span>
      <span class="w-chip">opady ${escapeHtml(String(weather.precipProb))}%</span>
    </div>`;
}

/**
 * Renders the HackerNews Top section, or empty string when no data.
 * @param {Array<{title: string, url: string, score: number, comments: number, hnUrl: string}>|null|undefined} stories
 * @returns {string}
 */
function renderHackerNews(stories: HackerNewsStory[] | null | undefined): string {
  if (!stories || stories.length === 0) return '';

  const list = stories.map((s, i) => `
      <li>
        <span class="hn-rank">${i + 1}</span>
        <div class="hn-body">
          <a class="hn-title" href="${escapeHtml(s.url)}" target="_blank" rel="noopener">${escapeHtml(s.title)}</a>
          <div class="hn-meta">${escapeHtml(String(s.score))} pkt &middot; <a href="${escapeHtml(s.hnUrl)}" target="_blank" rel="noopener">${escapeHtml(String(s.comments))} komentarzy</a></div>
        </div>
      </li>`).join('\n');

  return `
  <section class="hn-section">
    <div class="section-label">
      <h2><span class="hn-flag" aria-hidden="true">Y</span>&nbsp; HackerNews Top ${stories.length}</h2>
      <span class="rule"></span>
    </div>
    <ol class="hn-list">
${list}
    </ol>
  </section>`;
}

/**
 * Renders a list of digest items into a standalone HTML document string.
 *
 * @param {Array<{messageId: string, uid: number, sender: string, subject: string, date: string, cleanText: string, summary: string|null}>} items
 * @param {{ranAt: string, newCount: number, weather?: object|null, hackernews?: object[]|null}} meta
 * @returns {string} Full HTML document
 */
export function renderHtml(items: DigestItem[], meta: DigestMeta): string {
  const sorted = [...items].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const ranAtFormatted = formatDate(meta.ranAt);

  const itemsHtml = sorted.length === 0
    ? '<div class="empty-list">Brak nowych newsletterów.</div>'
    : `<div class="items">
${sorted.map(item => {
        const summary = item.summary != null
          ? `<p class="summary">${escapeHtml(item.summary)}</p>`
          : '<p class="summary empty">(brak streszczenia)</p>';

        const sourceLink = item.messageId
          ? `
          <span class="dot" aria-hidden="true">·</span>
          <a class="gmail-link" href="${escapeHtml(gmailMessageUrl(item.messageId, meta.gmailUser))}" target="_blank" rel="noopener">Otwórz w Gmailu</a>`
          : '';

        const articleLink = safeUrl(item.link);
        const subjectHtml = articleLink
          ? `<a class="subject-link" href="${escapeHtml(articleLink)}" target="_blank" rel="noopener">${escapeHtml(item.subject)}</a>`
          : escapeHtml(item.subject);

        return `
      <article class="card">
        <h3 class="subject">${subjectHtml}</h3>
        <div class="item-meta">
          <span class="sender">${escapeHtml(item.sender)}</span>
          <span class="dot" aria-hidden="true">·</span>
          <span class="date">${escapeHtml(formatDate(item.date))}</span>${sourceLink}
        </div>
        ${summary}
      </article>`;
      }).join('\n')}
    </div>`;

  return `<!DOCTYPE html>
<html lang="pl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Newsletter Digest</title>
<style>
  :root {
    --bg: #f7f5f0;
    --surface: #ffffff;
    --ink: #1b1a17;
    --ink-soft: #4a463e;
    --muted: #8a8478;
    --line: #e4e0d6;
    --line-strong: #d3cebf;
    --link: #2f5d50;
    --link-hover: #1d3d34;
    --hn: #ff6600;
    --shadow: 0 1px 2px rgba(27,26,23,.04), 0 6px 24px rgba(27,26,23,.05);
    --serif: Georgia, "Times New Roman", "Noto Serif", serif;
    --sans: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  }

  * { box-sizing: border-box; }

  html { -webkit-text-size-adjust: 100%; }

  body {
    margin: 0;
    background: var(--bg);
    color: var(--ink);
    font-family: var(--sans);
    line-height: 1.6;
    font-size: 17px;
    -webkit-font-smoothing: antialiased;
    text-rendering: optimizeLegibility;
  }

  .page {
    max-width: 720px;
    margin: 0 auto;
    padding: 0 20px 72px;
  }

  /* ---------- HEADER ---------- */
  header.masthead {
    padding: 56px 0 28px;
    border-bottom: 2px solid var(--ink);
    margin-bottom: 4px;
  }

  .masthead h1 {
    font-family: var(--serif);
    font-weight: 700;
    font-size: clamp(34px, 8vw, 48px);
    line-height: 1.05;
    letter-spacing: -0.02em;
    margin: 0;
  }

  .masthead .meta {
    margin-top: 12px;
    font-size: 13px;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }

  .masthead .meta .count {
    color: var(--ink);
    font-weight: 600;
  }

  /* ---------- WEATHER ---------- */
  .weather {
    margin-top: 22px;
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px 18px;
    padding: 14px 18px;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 12px;
    box-shadow: var(--shadow);
  }

  .weather .w-icon { font-size: 28px; line-height: 1; }
  .weather .w-city {
    font-weight: 600;
    font-size: 15px;
  }
  .weather .w-temp {
    font-family: var(--serif);
    font-size: 26px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    margin-left: 2px;
  }
  .weather .w-desc { color: var(--ink-soft); font-size: 15px; }
  .weather .w-sep {
    width: 1px;
    align-self: stretch;
    background: var(--line);
    margin: 2px 0;
  }
  .weather .w-chip {
    font-size: 13px;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
    letter-spacing: 0.01em;
  }
  .weather .w-chip .hi { color: #b4532a; font-weight: 600; }
  .weather .w-chip .lo { color: var(--link); font-weight: 600; }

  /* ---------- SECTION LABEL ---------- */
  .section-label {
    display: flex;
    align-items: baseline;
    gap: 12px;
    margin: 40px 0 6px;
  }
  .section-label h2 {
    font-family: var(--sans);
    font-size: 13px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--muted);
    margin: 0;
    white-space: nowrap;
  }
  .section-label .rule {
    flex: 1;
    height: 1px;
    background: var(--line-strong);
  }

  /* ---------- NEWSLETTER CARDS ---------- */
  .items { display: flex; flex-direction: column; gap: 14px; margin-top: 18px; }

  .card {
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 14px;
    padding: 24px 26px;
    box-shadow: var(--shadow);
  }

  .card .subject {
    font-family: var(--serif);
    font-size: 22px;
    line-height: 1.25;
    font-weight: 700;
    letter-spacing: -0.01em;
    margin: 0 0 10px;
    text-wrap: balance;
  }

  .card .subject a.subject-link {
    color: inherit;
    text-decoration: none;
    border-bottom: 2px solid transparent;
    transition: color .12s, border-color .12s;
  }
  .card .subject a.subject-link:hover {
    color: var(--link);
    border-bottom-color: var(--link);
  }

  .card .item-meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 10px;
    font-size: 13.5px;
    color: var(--muted);
    margin-bottom: 14px;
  }
  .card .item-meta .sender { color: var(--ink-soft); font-weight: 600; }
  .card .item-meta .dot { color: var(--line-strong); }
  .card .item-meta .date { font-variant-numeric: tabular-nums; }

  a.gmail-link {
    color: var(--link);
    text-decoration: none;
    font-weight: 600;
    border-bottom: 1px solid transparent;
    white-space: nowrap;
  }
  a.gmail-link::after { content: " ↗"; font-weight: 400; }
  a.gmail-link:hover { color: var(--link-hover); border-bottom-color: currentColor; }

  .card .summary {
    margin: 0;
    color: var(--ink-soft);
    font-size: 16.5px;
    line-height: 1.62;
  }
  .card .summary.empty {
    color: var(--muted);
    font-style: italic;
  }

  /* ---------- EMPTY LIST ---------- */
  .empty-list {
    text-align: center;
    padding: 56px 20px;
    color: var(--muted);
    font-family: var(--serif);
    font-size: 19px;
    font-style: italic;
    background: var(--surface);
    border: 1px dashed var(--line-strong);
    border-radius: 14px;
    margin-top: 18px;
  }

  /* ---------- HACKERNEWS ---------- */
  .hn-section { margin-top: 48px; }
  .hn-section .section-label h2 { color: var(--hn); }
  .hn-section .section-label .rule { background: var(--hn); opacity: .35; }
  .hn-flag {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px; height: 20px;
    background: var(--hn);
    color: #fff;
    font-weight: 700;
    font-size: 13px;
    border-radius: 4px;
    line-height: 1;
  }

  ol.hn-list {
    list-style: none;
    margin: 18px 0 0;
    padding: 0;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 14px;
    box-shadow: var(--shadow);
    overflow: hidden;
  }
  ol.hn-list li {
    display: flex;
    gap: 16px;
    padding: 16px 22px;
    border-bottom: 1px solid var(--line);
  }
  ol.hn-list li:last-child { border-bottom: 0; }

  .hn-rank {
    font-family: var(--serif);
    font-size: 18px;
    font-weight: 700;
    color: var(--hn);
    font-variant-numeric: tabular-nums;
    min-width: 22px;
    text-align: right;
    line-height: 1.5;
  }
  .hn-body { flex: 1; min-width: 0; }
  .hn-body .hn-title {
    color: var(--ink);
    text-decoration: none;
    font-weight: 600;
    font-size: 16.5px;
    line-height: 1.4;
    border-bottom: 1px solid transparent;
  }
  .hn-body .hn-title:hover { color: var(--hn); border-bottom-color: currentColor; }
  .hn-body .hn-meta {
    margin-top: 5px;
    font-size: 13px;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }
  .hn-body .hn-meta a {
    color: var(--muted);
    text-decoration: none;
    border-bottom: 1px solid var(--line-strong);
  }
  .hn-body .hn-meta a:hover { color: var(--hn); border-bottom-color: var(--hn); }

  /* ---------- FOOTER ---------- */
  footer.foot {
    margin-top: 44px;
    padding-top: 18px;
    border-top: 1px solid var(--line);
    font-size: 12.5px;
    color: var(--muted);
    text-align: center;
    letter-spacing: 0.03em;
  }

  /* ---------- MOBILE ---------- */
  @media (max-width: 540px) {
    body { font-size: 16px; }
    .page { padding: 0 16px 56px; }
    header.masthead { padding: 36px 0 22px; }
    .card { padding: 20px; border-radius: 12px; }
    .card .subject { font-size: 20px; }
    ol.hn-list li { padding: 14px 16px; gap: 12px; }
    .weather { padding: 12px 14px; }
    .weather .w-sep { display: none; }
  }
</style>
</head>
<body>
<div class="page">

  <header class="masthead">
    <h1>Newsletter Digest</h1>
    <div class="meta">Wygenerowano: ${escapeHtml(ranAtFormatted)} &nbsp;—&nbsp; Nowych: <span class="count">${escapeHtml(String(meta.newCount))}</span></div>${renderWeather(meta.weather)}
  </header>

  <main>
    <div class="section-label">
      <h2>Newslettery</h2>
      <span class="rule"></span>
    </div>
    ${itemsHtml}
  </main>
${renderHackerNews(meta.hackernews)}
  <footer class="foot">
    Newsletter Digest · wygenerowano lokalnie · ${escapeHtml(formatDay(meta.ranAt))}
  </footer>

</div>
</body>
</html>`;
}
