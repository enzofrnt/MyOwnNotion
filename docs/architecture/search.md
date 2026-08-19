# Search architecture and operations

Workspace search is a derived, transient projection. The server builds it from
the canonical PostgreSQL records after the protection layer has opened them;
the browser builds a smaller copy from the already-open local projection. Both
use the same domain extraction, normalisation and ranking rules. Neither index
is serialized to PostgreSQL, IndexedDB, a file, a backup, or a log.

This boundary avoids creating a second source of truth containing private
titles and page text. Canonical server records and local browser records remain
protected at rest by their existing envelopes. After a restart, unlock or
restore, search pays the deliberate cost of rebuilding from those protected
sources.

## Generations and freshness

The server lifecycle is `cold`, `building`, `ready` or `degraded`. A rebuild
creates a separate index, validates every readable source, replays canonical
changes committed while it was building, and publishes the replacement in one
atomic generation change. The search route never exposes the partial index. If
there is no ready generation, it returns a safe `search.building` or
`search.degraded` problem with `Retry-After: 1`.

Normal mutations update search only after their database transaction returns
successfully. The committed sequence is the source version: an old or replayed
notification cannot replace a newer document. Renames and conversions are
upserts of the same item identity; trash and purge are removals; restore is an
upsert. Paths are hydrated from the current hierarchy at query time, so moving
a branch cannot leave a historical path in the index.

An incremental failure invalidates the active generation and starts a clean
rebuild. The accepted canonical mutation still succeeds: search is recoverable
derived state and cannot roll back data that was already committed.

The browser follows the same rule at the local transaction boundary. Its
worker receives updates only after the local projection and pending mutation
are durable. It is cleared on lock, key loss, logout and session teardown.

## Startup, restoration and recovery

The API starts a rebuild without blocking unrelated routes. A restored feature
007 archive contains all canonical inputs, not an index snapshot; search stays
`building` until every restored active page, folder and file has been read and
the new generation is complete.

Operators can inspect `/health`. Its optional `search` object contains only:

- `state`;
- `generation`;
- `indexedCount` and `expectedCount`;
- a stable `failureCode` such as `search.rebuild-failed` or
  `search.incremental-update-failed`.

No query, title, path, snippet or key is diagnostic data. A `degraded` search
does not make the rest of `/health` unhealthy because canonical content remains
usable, but callers of `POST /v1/search` receive 503 instead of a falsely
complete result.

For recovery, first repair the reported canonical dependency: database access,
deployment key availability, or an unreadable protected record. Restarting the
API then performs a clean rebuild. A later committed mutation also retries a
failed transient build. Rebuilds are read-only with respect to canonical data,
so repeating one is safe.

## Privacy boundary

Private search uses an authenticated `POST /v1/search` JSON body. The shared
request logger removes query strings from logged URLs and centrally redacts
query, title, snippet and result fields. Search errors contain stable codes and
counts only. Opaque pagination cursors are signed, generation-bound
fingerprints; they do not contain the query text.

Snippets are plain text, never trusted HTML. The extraction layer indexes only
content the current document model knows how to render and excludes link URLs,
identifiers, unknown block payloads and hidden metadata.

## Reference volume and memory

The reference benchmark builds 100,000 pages containing ten flattened block
segments each (one million visible blocks) plus 50,000 file names. On the
development reference run of 2026-08-19, the transient server index built in
2.18 seconds and added about 333 MiB of heap. The first 20 server results were
returned at 1.4 ms p50 and 4.3 ms p95. A 10,000-item browser index returned its
first 20 results at 0.2 ms p50 and 0.3 ms p95; local upserts were 0.1 ms p95.

These measurements are regression evidence, not deployment limits. Memory is
proportional to searchable text and unique terms. The index intentionally
stores flattened visible text in process memory so it can produce snippets;
an operator sizing an unusually large workspace should leave headroom above
the measured heap and rerun the benchmark on the target runtime.

The implementation bounds queries to 512 Unicode characters, defaults pages to
20 results and caps them at 50. It hydrates paths only for retained candidates
and does not persist precomputed paths or ancestor lists.
