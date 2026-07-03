export function normalizeArticleUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const isOpenSubstackArticle =
      parsed.hostname.toLowerCase() === 'open.substack.com' &&
      /^\/pub\/[^/]+\/p\/[^/]+/i.test(parsed.pathname);

    if (isOpenSubstackArticle && parsed.searchParams.get('redirect') === 'app-store') {
      parsed.search = '';
      parsed.hash = '';
      return parsed.toString();
    }
  } catch {
    return url;
  }

  return url;
}
