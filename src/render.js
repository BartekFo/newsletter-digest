/**
 * Escapes HTML special characters to prevent injection from untrusted input
 * (email headers: subject, sender).
 */
function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDate(iso) {
  try {
    return new Date(iso).toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw' });
  } catch {
    return escapeHtml(iso);
  }
}

/**
 * Renders the current-weather banner, or empty string when no data.
 * @param {{city: string, temp: number, description: string, max: number, min: number, precipProb: number}|null|undefined} weather
 * @returns {string}
 */
function renderWeather(weather) {
  if (!weather) return '';

  return `
    <div class="weather">
      <span class="w-city">${escapeHtml(weather.city)}</span>
      <span class="w-temp">${escapeHtml(String(weather.temp))}°C</span>
      <span class="w-desc">${escapeHtml(weather.description)}</span>
      <span class="w-range">↑${escapeHtml(String(weather.max))}° ↓${escapeHtml(String(weather.min))}°</span>
      <span class="w-precip">opady ${escapeHtml(String(weather.precipProb))}%</span>
    </div>`;
}

/**
 * Renders the HackerNews Top section, or empty string when no data.
 * @param {Array<{title: string, url: string, score: number, comments: number, hnUrl: string}>|null|undefined} stories
 * @returns {string}
 */
function renderHackerNews(stories) {
  if (!stories || stories.length === 0) return '';

  const list = stories.map(s => `
      <li class="hn-item">
        <a class="hn-title" href="${escapeHtml(s.url)}">${escapeHtml(s.title)}</a>
        <span class="hn-meta">${escapeHtml(String(s.score))} pkt &middot; <a class="hn-comments" href="${escapeHtml(s.hnUrl)}">${escapeHtml(String(s.comments))} komentarzy</a></span>
      </li>`).join('\n');

  return `
  <section class="hn">
    <h2 class="hn-heading">HackerNews Top ${stories.length}</h2>
    <ul class="hn-list">
${list}
    </ul>
  </section>`;
}

/**
 * Renders a list of digest items into a standalone HTML document string.
 *
 * @param {Array<{messageId: string, uid: number, sender: string, subject: string, date: string, cleanText: string, summary: string|null}>} items
 * @param {{ranAt: string, newCount: number, weather?: object|null, hackernews?: object[]|null}} meta
 * @returns {string} Full HTML document
 */
export function renderHtml(items, meta) {
  const sorted = [...items].sort((a, b) => new Date(b.date) - new Date(a.date));

  const ranAtFormatted = formatDate(meta.ranAt);

  const itemsHtml = sorted.length === 0
    ? '<p class="empty">Brak nowych newsletterów.</p>'
    : sorted.map(item => {
        const summary = item.summary != null
          ? `<p class="summary">${escapeHtml(item.summary)}</p>`
          : '<p class="summary no-summary">(brak streszczenia)</p>';

        const sourceLink = item.messageId
          ? `<a class="source-link" href="${escapeHtml(`https://mail.google.com/mail/u/0/#search/rfc822msgid:${encodeURIComponent(item.messageId)}`)}">Otwórz w Gmailu</a>`
          : '';

        return `
  <article class="item">
    <h2 class="subject">${escapeHtml(item.subject)}</h2>
    <p class="meta">
      <span class="sender">${escapeHtml(item.sender)}</span>
      <span class="date">${escapeHtml(formatDate(item.date))}</span>
      ${sourceLink}
    </p>
    ${summary}
  </article>`;
      }).join('\n');

  return `<!DOCTYPE html>
<html lang="pl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Newsletter Digest</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, sans-serif; background: #f5f5f5; color: #222; padding: 2rem; }
    header { background: #1a1a2e; color: #fff; padding: 1.5rem 2rem; border-radius: 8px; margin-bottom: 2rem; }
    header h1 { font-size: 1.5rem; margin-bottom: 0.25rem; }
    header .meta { font-size: 0.9rem; opacity: 0.8; }
    .item { background: #fff; border-radius: 8px; padding: 1.5rem; margin-bottom: 1.25rem; box-shadow: 0 1px 3px rgba(0,0,0,.1); }
    .subject { font-size: 1.1rem; margin-bottom: 0.5rem; color: #1a1a2e; }
    .meta { font-size: 0.85rem; color: #666; margin-bottom: 0.75rem; display: flex; gap: 1rem; flex-wrap: wrap; }
    .summary { font-size: 0.95rem; line-height: 1.6; }
    .no-summary { color: #999; font-style: italic; }
    .empty { text-align: center; color: #888; font-size: 1.1rem; margin-top: 3rem; }
    .weather { margin-top: 0.75rem; display: flex; gap: 1rem; flex-wrap: wrap; align-items: baseline; font-size: 0.95rem; }
    .weather .w-temp { font-size: 1.25rem; font-weight: 600; }
    .weather .w-city { font-weight: 600; }
    .weather .w-range, .weather .w-precip { opacity: 0.8; }
    .hn { background: #fff; border-radius: 8px; padding: 1.5rem; margin-top: 2rem; box-shadow: 0 1px 3px rgba(0,0,0,.1); }
    .hn-heading { font-size: 1.1rem; color: #ff6600; margin-bottom: 1rem; }
    .hn-list { list-style: none; }
    .hn-item { padding: 0.6rem 0; border-bottom: 1px solid #eee; }
    .hn-item:last-child { border-bottom: none; }
    .hn-title { color: #1a1a2e; text-decoration: none; font-weight: 500; }
    .hn-title:hover { text-decoration: underline; }
    .hn-meta { display: block; font-size: 0.8rem; color: #888; margin-top: 0.2rem; }
    .hn-comments { color: #888; }
  </style>
</head>
<body>
  <header>
    <h1>Newsletter Digest</h1>
    <p class="meta">Wygenerowano: ${escapeHtml(ranAtFormatted)} &mdash; Nowych: <strong>${escapeHtml(String(meta.newCount))}</strong></p>${renderWeather(meta.weather)}
  </header>
  <main>
${itemsHtml}
  </main>
${renderHackerNews(meta.hackernews)}
</body>
</html>`;
}
