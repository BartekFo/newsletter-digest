import type { DigestItem } from './types.js';

/** Newest first, preserving adapter or snapshot order when dates are equal. */
export function sortNewslettersNewestFirst(items: readonly DigestItem[]): DigestItem[] {
  return [...items].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}
