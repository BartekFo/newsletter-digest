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
 * Renders a list of digest items into a standalone HTML document string.
 *
 * @param {Array<{messageId: string, uid: number, sender: string, subject: string, date: string, cleanText: string, summary: string|null}>} items
 * @param {{ranAt: string, newCount: number}} meta
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
  </style>
</head>
<body>
  <header>
    <h1>Newsletter Digest</h1>
    <p class="meta">Wygenerowano: ${escapeHtml(ranAtFormatted)} &mdash; Nowych: <strong>${escapeHtml(String(meta.newCount))}</strong></p>
  </header>
  <main>
${itemsHtml}
  </main>
</body>
</html>`;
}
