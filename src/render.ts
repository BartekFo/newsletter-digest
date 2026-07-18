import { escapeHtml, gmailMessageUrl, safeUrl } from './renderUtils.js';
import type { DigestItem, DigestMeta, HackerNewsStory, RunSummary, WeatherSummary } from './types.js';

const THEME_CSS = `
  :root {
    color-scheme: light;
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
    --on-accent: #ffffff;
    --notice-bg: #eef6f1;
    --notice-border: #b8d8c8;
    --notice-ink: #24483b;
    --error-bg: #fff1f0;
    --error-border: #e6b8b2;
    --error-ink: #7f1d1d;
    --paid-bg: #fff4ec;
    --paid-border: #d69b74;
    --paid-ink: #8a3f18;
    --user-bg: #edf3ff;
    --user-ink: #19304f;
    --temperature-high: #b4532a;
    --overlay: rgba(27, 26, 23, .42);
    --shadow: 0 1px 2px rgba(27,26,23,.04), 0 6px 24px rgba(27,26,23,.05);
    --modal-shadow: 0 24px 80px rgba(27,26,23,.22);
    --serif: Georgia, "Times New Roman", "Noto Serif", serif;
    --sans: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  }

  :root[data-theme="dark"] {
    color-scheme: dark;
    --bg: #111512;
    --surface: #1a201c;
    --ink: #f2efe8;
    --ink-soft: #cec8bc;
    --muted: #a39d91;
    --line: #303832;
    --line-strong: #49534b;
    --link: #8bc2ae;
    --link-hover: #b1dbc9;
    --hn: #ff7b29;
    --on-accent: #102019;
    --notice-bg: #17271f;
    --notice-border: #3c6652;
    --notice-ink: #bce4cf;
    --error-bg: #301b1c;
    --error-border: #714041;
    --error-ink: #f3b9b5;
    --paid-bg: #322219;
    --paid-border: #8c5b3c;
    --paid-ink: #f2b88e;
    --user-bg: #1b3043;
    --user-ink: #c9e2fa;
    --temperature-high: #e18c65;
    --overlay: rgba(0, 0, 0, .68);
    --shadow: 0 1px 2px rgba(0,0,0,.28), 0 8px 28px rgba(0,0,0,.22);
    --modal-shadow: 0 24px 80px rgba(0,0,0,.58);
  }

  .theme-toggle-icon { font-size: 16px; line-height: 1; margin-right: 7px; }

  :where(a, button, textarea):focus-visible {
    outline: 3px solid var(--link);
    outline-offset: 2px;
  }`;

const THEME_BOOT_SCRIPT = `<script>
(() => {
  function getSavedTheme() {
    try {
      const value = localStorage.getItem('newsletter-digest-theme');
      return value === 'dark' || value === 'light' ? value : null;
    } catch {
      return null;
    }
  }

  function getSystemTheme() {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function applyTheme(nextTheme, persist = false) {
    document.documentElement.dataset.theme = nextTheme;
    if (!persist) return;
    try {
      localStorage.setItem('newsletter-digest-theme', nextTheme);
    } catch {}
  }

  window.newsletterDigestTheme = { getSavedTheme, getSystemTheme, applyTheme };
  applyTheme(getSavedTheme() ?? getSystemTheme());
})();
</script>`;

function renderThemeToggle(): string {
  return `<button type="button" id="theme-toggle" aria-label="Włącz ciemny motyw" aria-pressed="false">
        <span class="theme-toggle-icon" aria-hidden="true">☾</span>
        <span class="theme-toggle-label">Ciemny motyw</span>
      </button>`;
}

const THEME_TOGGLE_SCRIPT = `<script>
(() => {
  const toggle = document.getElementById('theme-toggle');
  if (!toggle) return;
  const icon = toggle.querySelector('.theme-toggle-icon');
  const label = toggle.querySelector('.theme-toggle-label');
  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  const themeControl = window.newsletterDigestTheme;
  if (!themeControl) return;

  function updateToggle(theme) {
    const dark = theme === 'dark';
    toggle.setAttribute('aria-pressed', String(dark));
    toggle.setAttribute('aria-label', dark ? 'Włącz jasny motyw' : 'Włącz ciemny motyw');
    icon.textContent = dark ? '☀' : '☾';
    label.textContent = dark ? 'Jasny motyw' : 'Ciemny motyw';
  }

  updateToggle(document.documentElement.dataset.theme);

  toggle.addEventListener('click', () => {
    const nextTheme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    themeControl.applyTheme(nextTheme, true);
    updateToggle(nextTheme);
  });

  mediaQuery.addEventListener('change', (event) => {
    if (themeControl.getSavedTheme()) return;
    const nextTheme = event.matches ? 'dark' : 'light';
    themeControl.applyTheme(nextTheme);
    updateToggle(nextTheme);
  });
})();
</script>`;

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

function renderNotice(meta: DigestMeta): string {
  const notice = 'notice' in meta ? (meta as DigestMeta & { notice?: string }).notice : undefined;
  const error = 'error' in meta ? (meta as DigestMeta & { error?: string }).error : undefined;

  if (error) return `<div class="notice error">${escapeHtml(error)}</div>`;
  if (notice) return `<div class="notice">${escapeHtml(notice)}</div>`;
  return '';
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

        const paywallBadge = item.isPaywalled
          ? '<span class="paywall-badge" title="Newsletter wygląda na częściowo albo w całości płatny">Płatne</span>'
          : '';

        const chatButton = item.messageId
          ? `<button type="button" class="chat-button" data-message-id="${escapeHtml(item.messageId)}" data-subject="${escapeHtml(item.subject)}">Chat</button>`
          : '';

        return `
      <article class="card">
        <h3 class="subject">${subjectHtml}</h3>
        <div class="item-meta">
          ${paywallBadge}
          <span class="sender">${escapeHtml(item.sender)}</span>
          <span class="dot" aria-hidden="true">·</span>
          <span class="date">${escapeHtml(formatDate(item.date))}</span>${sourceLink}
        </div>
        ${summary}
        <div class="item-actions">${chatButton}</div>
      </article>`;
      }).join('\n')}
    </div>`;

  return `<!DOCTYPE html>
<html lang="pl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Newsletter Digest</title>
${THEME_BOOT_SCRIPT}
<style>
${THEME_CSS}

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

  .top-nav {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    margin-top: 22px;
  }
  .top-nav a,
  .top-nav button,
  .chat-button {
    appearance: none;
    border: 1px solid var(--line-strong);
    border-radius: 8px;
    background: var(--surface);
    color: var(--ink);
    cursor: pointer;
    font: 700 13px/1 var(--sans);
    min-height: 36px;
    padding: 0 13px;
    text-decoration: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .top-nav a:hover,
  .top-nav button:hover,
  .chat-button:hover {
    border-color: var(--link);
    color: var(--link);
  }
  .top-nav form { margin: 0; }
  .notice {
    margin-top: 18px;
    padding: 12px 14px;
    background: var(--notice-bg);
    border: 1px solid var(--notice-border);
    border-radius: 8px;
    color: var(--notice-ink);
    font-size: 14px;
  }
  .notice.error {
    background: var(--error-bg);
    border-color: var(--error-border);
    color: var(--error-ink);
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
  .weather .w-chip .hi { color: var(--temperature-high); font-weight: 600; }
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
  .paywall-badge {
    display: inline-flex;
    align-items: center;
    min-height: 22px;
    padding: 0 8px;
    border: 1px solid var(--paid-border);
    border-radius: 6px;
    background: var(--paid-bg);
    color: var(--paid-ink);
    font-size: 12px;
    font-weight: 800;
    line-height: 1;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

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
  .item-actions {
    margin-top: 18px;
    display: flex;
    justify-content: flex-end;
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
    color: var(--on-accent);
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

  /* ---------- CHAT ---------- */
  .chat-panel[hidden] { display: none; }
  .chat-panel {
    position: fixed;
    inset: 0;
    z-index: 20;
    background: var(--overlay);
    display: flex;
    align-items: flex-end;
    justify-content: center;
    padding: 18px;
  }
  .chat-box {
    width: min(720px, 100%);
    max-height: min(760px, calc(100vh - 36px));
    background: var(--surface);
    border: 1px solid var(--line-strong);
    border-radius: 8px;
    box-shadow: var(--modal-shadow);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .chat-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 14px 16px;
    border-bottom: 1px solid var(--line);
  }
  .chat-title {
    font-weight: 700;
    font-size: 15px;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .chat-close {
    appearance: none;
    border: 0;
    background: transparent;
    cursor: pointer;
    color: var(--muted);
    font-size: 24px;
    line-height: 1;
    padding: 2px 4px;
  }
  .chat-log {
    flex: 1;
    min-height: 220px;
    overflow: auto;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .chat-message {
    border-radius: 8px;
    padding: 10px 12px;
    font-size: 15px;
    line-height: 1.45;
    white-space: pre-wrap;
  }
  .chat-message.user {
    align-self: flex-end;
    max-width: 82%;
    background: var(--user-bg);
    color: var(--user-ink);
  }
  .chat-message.assistant {
    align-self: flex-start;
    max-width: 88%;
    background: var(--bg);
    color: var(--ink-soft);
  }
  .chat-message.error {
    align-self: stretch;
    background: var(--error-bg);
    color: var(--error-ink);
  }
  .chat-message.loading {
    align-self: flex-start;
    background: var(--bg);
    color: var(--muted);
    font-style: italic;
  }
  .chat-form {
    display: flex;
    gap: 10px;
    border-top: 1px solid var(--line);
    padding: 12px;
  }
  .chat-form textarea {
    flex: 1;
    resize: vertical;
    min-height: 48px;
    max-height: 140px;
    border: 1px solid var(--line-strong);
    border-radius: 8px;
    background: var(--surface);
    color: var(--ink);
    padding: 10px 12px;
    font: 15px/1.4 var(--sans);
  }
  .chat-form button {
    appearance: none;
    border: 1px solid var(--link);
    border-radius: 8px;
    background: var(--link);
    color: var(--on-accent);
    cursor: pointer;
    font: 700 14px/1 var(--sans);
    padding: 0 16px;
  }
  .chat-form button:disabled,
  .chat-form textarea:disabled {
    cursor: wait;
    opacity: 0.65;
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
    .chat-form { flex-direction: column; }
    .chat-form button { min-height: 42px; }
  }
</style>
</head>
<body>
<div class="page">

  <header class="masthead">
    <h1>Newsletter Digest</h1>
    <div class="meta">Wygenerowano: ${escapeHtml(ranAtFormatted)} &nbsp;—&nbsp; Nowych: <span class="count">${escapeHtml(String(meta.newCount))}</span></div>${renderWeather(meta.weather)}
    <nav class="top-nav" aria-label="Nawigacja">
      <a href="/">Najnowszy</a>
      <a href="/runs">Historia</a>
      <form method="post" action="/refresh"><button type="submit">Pobierz nowe</button></form>
      ${renderThemeToggle()}
    </nav>
    ${renderNotice(meta)}
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
<section class="chat-panel" id="chat-panel" hidden>
  <div class="chat-box" role="dialog" aria-modal="true" aria-labelledby="chat-title">
    <div class="chat-head">
      <div class="chat-title" id="chat-title">Chat</div>
      <button type="button" class="chat-close" aria-label="Zamknij">&times;</button>
    </div>
    <div class="chat-log" id="chat-log"></div>
    <form class="chat-form" id="chat-form">
      <textarea id="chat-question" name="question" required placeholder="Zapytaj o ten newsletter"></textarea>
      <button type="submit">Wyślij</button>
    </form>
  </div>
</section>
<script>
(() => {
  const panel = document.getElementById('chat-panel');
  const title = document.getElementById('chat-title');
  const log = document.getElementById('chat-log');
  const form = document.getElementById('chat-form');
  const question = document.getElementById('chat-question');
  const close = document.querySelector('.chat-close');
  const send = form.querySelector('button[type="submit"]');
  // Give the server five seconds to return its structured five-minute timeout response.
  const CHAT_CLIENT_TIMEOUT_MS = 305_000;
  let messageId = null;
  let history = [];
  let sending = false;

  function addMessage(role, content) {
    const el = document.createElement('div');
    el.className = 'chat-message ' + role;
    el.textContent = content;
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
    return el;
  }

  function setSending(value) {
    sending = value;
    question.disabled = value;
    send.disabled = value;
    send.textContent = value ? 'Czekam…' : 'Wyślij';
  }

  document.querySelectorAll('.chat-button').forEach((button) => {
    button.addEventListener('click', () => {
      if (sending) return;
      messageId = button.dataset.messageId;
      history = [];
      log.textContent = '';
      setSending(false);
      title.textContent = button.dataset.subject || 'Chat';
      panel.hidden = false;
      question.focus();
    });
  });

  close.addEventListener('click', () => {
    panel.hidden = true;
  });

  panel.addEventListener('click', (event) => {
    if (event.target === panel) panel.hidden = true;
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const text = question.value.trim();
    if (!text || !messageId || sending) return;

    question.value = '';
    addMessage('user', text);
    setSending(true);
    const loading = addMessage('loading', 'Czekam na odpowiedź modelu… To może potrwać kilka minut.');
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), CHAT_CLIENT_TIMEOUT_MS);

    try {
      const response = await fetch('/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messageId, question: text, history }),
        signal: controller.signal,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Chat nie odpowiedział.');
      loading.remove();
      addMessage('assistant', data.answer);
      history.push({ role: 'user', content: text }, { role: 'assistant', content: data.answer });
    } catch (err) {
      loading.remove();
      const message = err instanceof Error && err.name === 'AbortError'
        ? 'Odpowiedź trwa zbyt długo. Sprawdź, czy Ollama działa i model jest gotowy.'
        : err instanceof Error ? err.message : String(err);
      addMessage('error', message);
    } finally {
      window.clearTimeout(timeout);
      setSending(false);
      question.focus();
    }
  });
})();
</script>
${THEME_TOGGLE_SCRIPT}
</body>
</html>`;
}

export function renderDigestPage(items: DigestItem[], meta: DigestMeta): string {
  return renderHtml(items, meta);
}

export function renderRunsPage(runs: RunSummary[], meta: { ranAt: string; notice?: string; error?: string } = { ranAt: new Date().toISOString() }): string {
  const rows = runs.length === 0
    ? '<div class="empty-list">Brak zapisanych digestów.</div>'
    : `<ol class="runs-list">
${runs.map((run) => `
      <li>
        <a href="/runs/${escapeHtml(String(run.id))}">Digest #${escapeHtml(String(run.id))}</a>
        <span>${escapeHtml(formatDate(run.ranAt))}</span>
        <strong>${escapeHtml(String(run.itemCount))} newsletterów</strong>
      </li>`).join('\n')}
    </ol>`;

  return `<!DOCTYPE html>
<html lang="pl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Historia digestów</title>
${THEME_BOOT_SCRIPT}
<style>
${THEME_CSS}
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--bg);
    color: var(--ink);
    font-family: var(--sans);
    line-height: 1.6;
    font-size: 17px;
  }
  .page { max-width: 720px; margin: 0 auto; padding: 0 20px 72px; }
  header { padding: 56px 0 28px; border-bottom: 2px solid var(--ink); margin-bottom: 28px; }
  h1 { font-family: var(--serif); font-size: clamp(34px, 8vw, 48px); line-height: 1.05; margin: 0; }
  nav { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 22px; }
  nav a, nav button {
    border: 1px solid var(--line-strong);
    border-radius: 8px;
    background: var(--surface);
    color: var(--ink);
    cursor: pointer;
    font: 700 13px/1 var(--sans);
    min-height: 36px;
    padding: 0 13px;
    text-decoration: none;
    display: inline-flex;
    align-items: center;
  }
  nav form { margin: 0; }
  nav a:hover, nav button:hover { border-color: var(--link); color: var(--link); }
  .notice {
    margin-top: 18px;
    padding: 12px 14px;
    background: var(--notice-bg);
    border: 1px solid var(--notice-border);
    border-radius: 8px;
    color: var(--notice-ink);
    font-size: 14px;
  }
  .notice.error { background: var(--error-bg); border-color: var(--error-border); color: var(--error-ink); }
  .runs-list {
    list-style: none;
    padding: 0;
    margin: 0;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 8px;
    overflow: hidden;
  }
  .runs-list li {
    display: grid;
    grid-template-columns: 1fr auto auto;
    gap: 14px;
    align-items: center;
    padding: 14px 16px;
    border-bottom: 1px solid var(--line);
  }
  .runs-list li:last-child { border-bottom: 0; }
  .runs-list a { color: var(--link); font-weight: 700; text-decoration: none; }
  .runs-list span { color: var(--muted); font-size: 14px; }
  .runs-list strong { font-size: 14px; }
  .empty-list {
    text-align: center;
    padding: 56px 20px;
    color: var(--muted);
    font-family: var(--serif);
    font-size: 19px;
    font-style: italic;
    background: var(--surface);
    border: 1px dashed var(--line-strong);
    border-radius: 8px;
  }
  @media (max-width: 640px) {
    .runs-list li { grid-template-columns: 1fr; gap: 4px; }
  }
</style>
</head>
<body>
<div class="page">
  <header>
    <h1>Historia digestów</h1>
    <nav aria-label="Nawigacja">
      <a href="/">Najnowszy</a>
      <form method="post" action="/refresh"><button type="submit">Pobierz nowe</button></form>
      ${renderThemeToggle()}
    </nav>
    ${meta.error ? `<div class="notice error">${escapeHtml(meta.error)}</div>` : ''}
    ${meta.notice ? `<div class="notice">${escapeHtml(meta.notice)}</div>` : ''}
  </header>
  <main>${rows}</main>
</div>
${THEME_TOGGLE_SCRIPT}
</body>
</html>`;
}
