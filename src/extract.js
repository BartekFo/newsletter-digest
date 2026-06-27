import Parser from '@postlight/parser';

/**
 * Strip HTML tags from a string, collapsing whitespace.
 * @param {string} html
 * @returns {string}
 */
function stripTags(html) {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extract readable article text from an HTML string.
 * Uses @postlight/parser to remove nav/header/footer/tracking boilerplate.
 * Returns '' for empty or malformed input — never throws.
 * @param {string} html
 * @returns {Promise<string>}
 */
export async function extractText(html) {
  if (!html || typeof html !== 'string' || html.trim() === '') return '';

  try {
    const result = await Parser.parse('https://example.com/', {
      html,
      contentType: 'html',
    });

    const content = result?.content;
    if (!content || typeof content !== 'string') return '';

    return stripTags(content);
  } catch {
    return '';
  }
}
