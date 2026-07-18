# Newsletter Digest domain language

## Newsletter

A source-neutral piece of newsletter content stored once in the archive. Its canonical identity is the opaque internal `newsletterId`. Do not call an RFC822 message ID a newsletter ID.

## Source identity

The pair `source.type` + `source.externalId` used by the archive for deduplication. It belongs to a source adapter and is distinct from `newsletterId`.

## Source metadata

Opaque adapter-owned values needed outside the core flow. Gmail metadata contains its RFC822 message ID and IMAP UID so the Gmail adapter can support deep links and cursoring without making them core fields.

## Source cursor

An opaque string published atomically with a snapshot. Only the active source adapter interprets its value; for Gmail it represents the IMAP UID high-water mark.

## Snapshot

An immutable, visible digest run plus its newsletter relations and historical enrichments. Publication atomically commits newsletters, the run, relations and source cursor.

## Newsletter refresh

The use case that fetches source newsletters, extracts and summarizes them, enriches the digest and publishes a snapshot. Delivery runs only after publication and cannot invalidate it.

## Digest archive

The deep interface owning SQLite schema, migrations, deduplication, publication, recovery, snapshots and source cursor. Reader and refresh modules never receive a raw SQLite handle.
