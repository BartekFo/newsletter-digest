# ADR 0003: Post-publication delivery

## Status

Accepted.

## Context

Static HTML export and optional e-mail are delivery channels, not part of archive correctness. If either channel consumes in-flight values or controls refresh success, a delivery error can disagree with or appear to invalidate an already durable digest.

## Decision

The newsletter refresh publishes a snapshot before starting delivery. It then reloads that snapshot through `DigestArchive.getSnapshot` and derives all delivery inputs from the reloaded newsletters and run metadata, including run identity, publication time, counts, weather and Hacker News.

Source deep links are resolved by the active source adapter. Presentation and e-mail receive a source-neutral resolver result containing the URL and user-facing label, and do not interpret Gmail metadata or provider names.

Export and e-mail failures are logged independently after publication. They do not roll back or mark the snapshot as failed. An empty refresh creates neither a new snapshot nor delivery.

## Consequences

- Every delivery channel describes the same persisted snapshot visible in the reader.
- A failed export or e-mail leaves the local digest and cursor valid.
- Delivery can be retried or changed without weakening publication invariants.
- Gmail-specific deep-link semantics stay inside the Gmail adapter.
