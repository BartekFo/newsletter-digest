# ADR 0001: Source-neutral newsletter identity

## Status

Accepted.

## Context

The original archive used Gmail RFC822 message IDs as item primary keys and IMAP UIDs directly in the reader model. That couples archive relations, chat and presentation to one source adapter.

## Decision

Each newsletter receives an opaque internal `newsletter_id`. Source identity is stored separately as `source_type`, `source_external_id` and `source_cursor`; adapter-specific values remain metadata used for cursoring and deep links.

The migration follows expand–migrate–contract:

1. Add and backfill internal identity and source metadata while legacy columns still work.
2. Move publication, snapshot relations, reader, chat and delivery to `newsletter_id`.
3. Remove Gmail identifiers from source-neutral core interfaces, retaining them only in Gmail adapter metadata.

Existing snapshot relations are backfilled during schema initialization. Internal IDs are opaque and must not encode Gmail semantics.

The final schema uses `newsletter_id` as the item and snapshot relation key. The source adapter returns a generic string cursor and generic metadata; only `GmailSourceAdapter` interprets IMAP UIDs, RFC822 message IDs and Gmail deep-link formatting.

## Consequences

- Gmail remains the only source in the current scope.
- Adding another source does not require changing reader or archive identity.
- Gmail deep links remain available through adapter metadata.
- Legacy databases migrate in place without losing items or snapshots.
