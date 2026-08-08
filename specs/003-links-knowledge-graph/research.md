# Research: Links and Knowledge Graph

## Decision 1: Version the canonical document extension

**Decision**: Introduce document format version 3 for the `wikiLink` mark and continue to normalize versions 1 and 2 for editing.

**Rationale**: An older client must not mistake a new linked-text structure for content it fully understands. A version bump makes compatibility explicit while preserving non-destructive loading and incremental upgrade.

**Alternatives considered**: Adding the mark to version 2 would make the same version mean two different allow-lists; storing only rendered HTML would break the documented canonical JSON boundary.

## Decision 2: Store stable occurrence and target identities in the mark

**Decision**: Each wiki-link mark contains `targetItemId` and `occurrenceId`; its text remains the author-visible label.

**Rationale**: Target identity survives rename/move, occurrence identity permits exact add/remove reconciliation, and plain text remains useful in copy/export and editable without a custom atom node.

**Alternatives considered**: Resolving by page name is ambiguous and breaks on rename; a target-only mark cannot distinguish repeated occurrences; an atom node makes inline editing and plain-text behavior less predictable.

## Decision 3: Derive typed relationships atomically from documents

**Decision**: Page-document replacement reconciles `link:references` rows in the same transaction as the document and revision.

**Rationale**: Backlinks and graph views must never observe an accepted document without its matching relationship projection. The existing transaction boundary and relationship table already support the required identities and endpoint lifecycle.

**Alternatives considered**: Separate client mutations create recoverable but user-visible partial states; parsing every document at graph-read time is expensive and bypasses the canonical relationship model.

## Decision 4: Synchronize relationship projections with item changes

**Decision**: Verified snapshots hydrate all relationships, while a change envelope for a changed source page contains the complete active derived wiki relationship set for that source.

**Rationale**: Replacing a per-source set handles both additions and removals idempotently, keeps payloads bounded to affected sources, and lets an offline client rebuild the exact graph without querying the server.

**Alternatives considered**: Snapshot-only relationship updates make long-lived clients stale; a separate relationship cursor adds a second ordering protocol without current need; always returning the complete workspace graph inflates every change.

## Decision 5: Use the installed suggestion engine for `[[`

**Decision**: Configure the existing Tiptap Suggestion utility with the multi-character `[[` trigger and local page candidates.

**Rationale**: The installed version supports escaped multi-character triggers, managed positioning, keyboard lifecycle, and synchronous item filtering already exercised by slash commands.

**Alternatives considered**: A bespoke input scanner duplicates selection, composition, and popup lifecycle logic; a network search would violate offline behavior.

## Decision 6: Build graph models in the domain and render with SVG

**Decision**: Create a pure deterministic graph builder/aggregator and a small native SVG renderer with a semantic-list peer.

**Rationale**: The acceptance size is bounded, the graph is navigational rather than a physics canvas, and avoiding a graph dependency reduces bundle growth and keeps the data model independently testable.

**Alternatives considered**: Force simulation adds nondeterminism and accessibility work; canvas alone lacks a natural semantic fallback; a remote graph database or service violates the smallest-architecture principle.

## Decision 7: Resolve lifecycle without mutating references

**Decision**: Graph and backlink models join local item lifecycle with stable relationship endpoints. Trashed/unavailable targets remain explicit and non-navigable until restored.

**Rationale**: This preserves diagnosability and prevents a deleted page name or placement from redirecting an existing relationship.

**Alternatives considered**: Cascading deletion hides surviving references; name-based fallback can silently resolve to the wrong page.

## Decision 8: Keep operational topology unchanged

**Decision**: Rebuild the existing API/web images, extend container persistence coverage for version 3, and publish Playwright image/trace evidence through the existing GitHub workflow.

**Rationale**: No new storage or runtime service is required. Reusing the production-like composition provides the requested clean-host validation without expanding deployment risk.

**Alternatives considered**: A dedicated graph service or database has no scale or query requirement in this release; committing test screenshots as product source would create noisy binary history compared with review artifacts.
