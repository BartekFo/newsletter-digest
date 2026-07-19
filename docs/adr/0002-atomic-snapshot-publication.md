# ADR 0002: Atomic snapshot publication

## Status

Accepted.

## Context

A newsletter is recoverable only when its content, digest run, snapshot relation and source cursor agree. Advancing the cursor or storing deduplication state before the complete snapshot is visible can permanently hide a fetched newsletter after a failure.

Snapshot relations also need a stable order. Newsletter timestamps are not unique, and an opaque internal identity must not decide presentation order when dates are equal.

## Decision

`DigestArchive.publishSnapshot` owns one SQLite transaction that:

1. stores every new newsletter,
2. creates the successful run,
3. records each run-to-newsletter relation with its publication position, and
4. advances the source cursor.

Any failure rolls back all four operations. A failed refresh may record diagnostics in a separate failed run, but failed runs are not visible as snapshots.

Existing relation rows are assigned positions in the reader's legacy order during migration: newsletter date descending, then Gmail UID descending. Rows without legacy Gmail metadata fall back to their relation order. New relations are stored newest-first and preserve adapter order when dates are equal; the Gmail adapter retains the legacy UID-descending tie-breaker.

## Consequences

- Retrying after source, extraction or publication failure can recover the same newsletters.
- The cursor never points beyond the latest recoverable publication.
- Snapshot order remains stable across identity and schema migrations.
- Publication remains local to one SQLite database and does not require a queue or distributed transaction.
