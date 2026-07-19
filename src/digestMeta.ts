import type { DigestSnapshot } from './store.js';
import type { DigestMeta, NewsletterSource, ResolvedSourceLink } from './types.js';

export type SourceLinkResolver = (source: NewsletterSource) => ResolvedSourceLink | null;

/** Map the persisted snapshot into the metadata shared by every presentation channel. */
export function digestMetaFromSnapshot(
  snapshot: DigestSnapshot,
  resolveSourceLink?: SourceLinkResolver,
): DigestMeta {
  return {
    ranAt: snapshot.run.ranAt,
    newCount: snapshot.run.newItems,
    runId: snapshot.run.id,
    ...(resolveSourceLink ? { resolveSourceLink } : {}),
    ...(snapshot.run.weather !== undefined ? { weather: snapshot.run.weather } : {}),
    ...(snapshot.run.hackernews !== undefined ? { hackernews: snapshot.run.hackernews } : {}),
  };
}
