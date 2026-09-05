# Implementation Plan: Storage privacy and code coherence audit

**Branch**: `codex/025-storage-coherence-audit` | **Date**: 2026-09-05 |
**Spec**: [spec.md](spec.md)

## Summary

Enforce existing attachment privacy and durability through the real composed
runtime, migrate historical readable storage after a verified 024 full backup,
and correct proven recovery/UI/test coherence defects. Publish an evidence-based
audit across the declared boundaries. Follow [research.md](research.md), the
[data model](data-model.md), and the [boundary contract](contracts/storage.md).

## Technical Context

**Language/Version**: TypeScript and exact repository-pinned Bun 1.4.0.

**Primary Dependencies**: Existing Fastify, Drizzle/pg, React/BlockNote,
AES-256-GCM/HKDF security primitives, Vitest and Playwright from bun.lock.

**Storage**: PostgreSQL 18; existing content-addressed filesystem ciphertext
blobs; existing protected envelopes/key hierarchy; encrypted local client stores.

**Testing**: Real secured API/SQL/filesystem tests; property tests for chunk and
range invariants; crash/restart migration/rotation fixtures; browser/desktop
journeys; isolated 2 GiB memory verification; unchanged complete quality gates.

**Target Platform**: Official Linux server images on AMD64/ARM64, five maintained
browser/viewport projects and five desktop OS/architecture targets.

**Project Type**: Existing monorepo web/desktop client and self-hosted service.

**Performance Goals**: 4 MiB authenticated chunks, bounded buffering end-to-end,
under 256 MiB additional server memory for the isolated 2 GiB file workload.

**Constraints**: No plaintext staging, no new key hierarchy, no unrelated live
DB/volume writes, no identity churn, no default bypass for missing encryption.
Preserve 024 lock order and version-independent full recovery.

**Scale/Scope**: Single owner/workspace; existing file-size limit, retained file
history and interrupted uploads; concrete audit boundaries listed in the spec.

## Constitution Check

Before research: PASS by design. This enforces existing canvas 4/15/18–20/28–35
and constitution I/III–VII; no permanent boundary changes or exception needed.
After design: PASS by design, subject to implementation evidence. Private file
bytes and metadata are encrypted before persistence; sensitive candidate lookup
uses a purpose-specific key; historical source retirement is resumable and
preceded by 024 backup. Offline identifiers and sync contracts are preserved.
UI work uses [ui-quality](../../.agents/skills/ui-quality/SKILL.md). Every changed
interactive flow receives real Playwright coverage. No coverage-budget relaxation
or replacement of required local/PR/main checks is permitted.

## Project Structure

### Documentation

`specs/025-storage-coherence-audit/`: spec, plan, research, data-model, contracts,
quickstart, tasks, analysis and validation. Audit evidence lives in
`docs/audits/2026-09-pre-v1.md`; it references canonical requirements rather than
copying them into agent instructions. Update directly affected 002/005/007/024
plans/tasks with the corrected composition and follow-up evidence.

### Source Code

- `packages/blob-store/src/encryption/encrypted-chunk-store.ts`: bounded chunk
  writes/reads, manifest integrity helpers; filesystem durability primitives.
- `packages/database/src/schema/` and `migrations/0015_protected_file_storage.sql`:
  format-aware content/uploads, encrypted upload references, migration progress;
  matching file/security repositories and existing migrations ledger.
- `apps/api/src/files/`: protected-file service, upload state, runtime factory,
  range handling and protected metadata resolution.
- `apps/api/src/security/`: protected content entities, dedicated index-key
  derivation, rotation/count/revocation and storage transition orchestration.
- `apps/api/src/routes/{files,uploads,export}.ts`, content/sync resolution,
  `app.ts`, context and CLI: one protected file boundary.
- `apps/api/src/backup/`: streaming portable seal/restore, format-aware full
  inventory and guarded migration before final version bookkeeping.
- `apps/web/src/ui/stable-action-button.tsx` and database forms: semantic
  activation and stable dirty-form lifecycle; active global.css caret coverage.
- `apps/desktop/src/` and tests: remove only proven unused single-instance
  scaffold; preserve live profile/partition and Electron lock behavior.

**Structure Decision**: SQL/application transactions stay in API/database layers;
blob-store owns only bounded crypto and filesystem primitives. Extend existing
boundaries rather than introduce an independent storage or authorization service.

## Implementation Strategy

1. Record boundary inventory and reproductions before changing behavior.
2. Add format/schema/contracts and bounded authenticated primitives.
3. Wire new direct/resumable writes, range reads, private metadata and revision
   resolution through one protected service; preserve canonical IDs/digests.
4. Integrate portable/full backup, key rotation/revocation and resumable historical
   migration before changing startup behavior. Migration blocks incompatible
   writes until verified cutover and readable-source cleanup finish.
5. Verify recovery contracts and remove misleading unreachable code; fix semantic
   button cancellation/dirty-form stability and inactive CSS test coverage.
6. Complete bounded-memory, corruption, recovery, offline/browser/native proofs,
   run Spec Kit analysis/convergence and all local/PR/main delivery gates.

Native image restoration executes the packaged API/migration/admin entrypoints,
PostgreSQL 18 client and full historical SQL/files restore in both Linux
architectures. A separate blocking CI matrix uses native AMD64 and ARM64 hosts;
multi-platform assembly alone cannot establish runtime recovery. The existing
local `images:build` smoke runs the same script on the host's native architecture.

Each stage keeps independently testable boundaries. Do not deploy a partially
wired encrypted format. Feature 024 must be delivered before this migration.

Direct multipart and resumable HTTP sources are one-shot streams. Their byte
ingestion transactions explicitly disable automatic serialization retries;
a conflict rolls back SQL and is returned for a fresh client request. Replaying
an already consumed stream inside `runMutation` would silently lose bytes.
Durable ciphertext from a rolled-back attempt remains unreferenced and encrypted
until physical cleanup; it is never advertised as accepted upload progress.
Canonical logical-file/placement/revision publication remains transactional.

## Complexity Tracking

No constitution exception. A protected manifest and partial-chunk table are
required to authenticate total shape and acknowledged offsets without whole-file
buffering. Migration quarantine preserves recoverable orphan material instead
of silently discarding it. No generic storage framework is introduced.

File rotation rewrites bounded chunk batches after the envelope sweep. Each
batch atomically replaces authenticated descriptors and the current manifest,
queues superseded ciphertext for deferred GC, and records progress. Remaining
old-generation references are the durable file cursor, so a crash never skips
parts. Completed and partial content retain IDs, lookup tags, sizes and offsets.
Failed data-key operations resume instead of silently advancing to another
source generation; the current writable generation is the rewrite target.
Generation creation and failed-operation resumption take the existing FILE
transition guard before changing key/policy state. Batch rewrite/revocation
already share that guard, so every data-key entry point refuses an incomplete
historical transition without advancing its captured source generations.
Revocation takes FILE maintenance and the generation row lock, then recounts
both envelopes and completed/partial chunks in that transaction. Ordinary and
batched protected-record publication also lock their selected writable generation;
a stale selection fails instead of publishing after retirement.

The mutable chunk index alone cannot establish that a generation is unused.
Before marking rotation complete or revoking a generation, enumerate current
protected content/upload identities from both canonical rows and manifest
envelopes, authenticate their exact current manifest versions, and reconcile
every descriptor against its complete SQL index. Count key references from the
authenticated manifests. Missing indexes, missing manifests or inconsistent
metadata refuse completion/revocation. Use bounded identity batches under FILE;
the final count and completion/revocation commit share the same transaction.

Canonical-copy audit extension (FR-014): cover the same seal-without-neutralize
pattern in ordinary mutations and portable restore, not just attachments.
Reproduce current item/revision exposure through secured HTTP before changing
it. Resolve protected presentation, bodies, structured values and relationship
metadata at the mutation/snapshot boundary; domain logic must never consume a
scrub marker as user content. Neutralize relational payloads in the same accepted
transaction, and extend historical transition metadata coverage. Test subsequent
neutral writes, dirty/offline sync, structured revisions and portable recovery.

T045 joins the previously separate proofs: retain actual offline UI edits,
restart/replay and independent converged-value assertions in the existing
database and page tab journeys, then inspect canonical SQL for their title,
body, definition and value sentinels. Extend the secured portable file round
trip with structured definitions/values and relationship metadata, verify
authorized target reads and clean canonical SQL, then edit the restored data
and check both current and retained revisions. These targeted additions retain
every browser profile and do not replace the complete final gates.

### Historical source inventory detail

The 024 safety archive preserves durable database state and acknowledged upload
prefixes before schema/content writes. Unacknowledged tails and interrupted
`.tmp-*` files have no committed identity. Inventory them without modifying them
and retain their complete original bytes in verified encrypted quarantine before
retirement; they are not silently promoted into an accepted transfer. Source
paths, original digests and checkpoint mappings are protected envelopes. Completed
legacy objects retain their UUID/reference counts; equal bytes do not merge
historical identities during backfill. Upload backfill preserves its acknowledged
offset, declared length and expiry. Every source iterator verifies length/digest
at EOF before the replacement transaction may commit.

### Structured query consistency

The audit reproduced an indexed number equality query returning no rows for
`+02.00` while canonical domain evaluation correctly matches stored `2`. Export
the existing domain operand preparation as one shared normalization boundary;
the server candidate index must use that same value before narrowing rows.
An invalid operand or missing property stays on canonical validation instead of
being accepted by the index. Differential filter, incremental refresh and cursor
tests compare observable ordered results and refusals, without relaxing budgets.

### Bounded file allocations under the shipped runtime

The maintained isolated 2 GiB fixture exceeded its unchanged 256 MiB additional
RSS budget even under the performance runner's existing `--smol` flag. Profile
retained and transient buffers across chunk assembly, encryption, blob writes,
authenticated reads and ranges; remove redundant copies or unbounded retention
in production code. Also run the same fixture under standard Bun, matching API
start/image entrypoints. Forced test-only GC, relaxed thresholds or reduced
sampling cannot establish SC-004. Preserve authenticated chunk boundaries,
one-shot stream behavior, transaction publication and byte-exact range tests.

The measured amplification comes from full-payload input/concat/output copies in
`packages/domain/src/security/crypto.ts`, a second complete persisted-byte read
in `packages/blob-store/src/filesystem-blob-store.ts`, and copied comparison
inputs in `apps/api/src/files/protected-file-service.ts`. Transfer independently
allocated cipher/read output storage as Uint8Array views, authenticate before
returning plaintext, and verify persisted bytes through 64 KiB scratch space.
Keep exact-length/digest checks, short-read handling, fsync and immutable
publication. Verify input/output independence against WebCrypto and real disk
corruption, truncation and extension. Record three isolated runs in each Bun
mode; focused success does not replace the final integrated performance gate.
