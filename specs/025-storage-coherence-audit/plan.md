# Implementation Plan: Storage privacy and code coherence audit

**Branch**: `codex/025-storage-coherence-audit` | **Date**: 2026-09-05 |
**Spec**: [spec.md](spec.md)

## Summary

Follow-up A35: `PageTitleEditor` currently measures its textarea only when the
draft changes. Real narrow-view screenshots show a wrapped title clipped after
resizing without editing. Observe the title's available inline size and repeat
the existing height measurement on width changes; keep the live textarea,
selection and draft authoritative. Verify actual browser overflow and return to
wide layout, with no timeout, typography or screenshot masking changes.

Follow-up A36: the native Firefox hierarchy-file upload at 14:53:06.989 UTC
received HTTP 500; the isolated PostgreSQL log at 14:53:07.031 UTC records
SQLSTATE 40001 while reading protected envelopes. Multipart ingestion correctly
uses one transaction attempt because its stream cannot be replayed server-side.
Return a dedicated safe 409 for an exhausted serialization/deadlock conflict in
file import/replacement. The browser may retry only that explicit response, at
most three requests with bounded backoff, fresh multipart bodies and the same
mutation identity and File. Keep SERIALIZABLE isolation, streaming bounds,
rollback, stale-revision refusal and all other errors unchanged. Test a real
transaction rollback after consuming encrypted bytes, subsequent same-identity
success, exact content, bounded client retries and the original browser journey.
Accepted replacement replay must return the same result only for its original
workspace, command type and file revision. Reusing its identity for another file
or reusing an import identity for a replacement is refused before consumption.

Follow-up A37: WebKit's failed property click spans the actual editor skeleton
replacement, with `workspace-main.scrollTop` changing from 453 to 421 between
pointer targeting and release. Both skeleton and text surface reserve 18 rem,
but the ready editor's first history toolbar has a negative top margin that can
collapse through its parent. Reproduce with a delayed real page checkpoint and
a held pointer, then establish a formatting context at the page editor so the
toolbar still occupies the caption row without moving the surrounding anchor.

Enforce existing attachment privacy and durability through the real composed
runtime, migrate historical readable storage after a verified 024 full backup,
and correct proven recovery/UI/test coherence defects. Publish an evidence-based
audit across the declared boundaries. Follow [research.md](research.md), the
[data model](data-model.md), and the [boundary contract](contracts/storage.md).

## Technical Context

**Language/Version**: TypeScript and exact repository-pinned Bun 1.4.2.

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

The delivery inventory is executable at every required stage: PR and `main` CI
must expose dedicated blocking jobs for `test:security` and `compose:check`,
and `quality-gate` must require both jobs. Contract tests assert the job names,
commands and aggregate dependencies so a future workflow edit cannot silently
drop either responsibility. This keeps the explicit CI evidence aligned with
the local gate and `docs/development.md` without changing the test selection
policy for the existing affected suites.

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

T058: the integrated Bun 1.4.2 run measured 265.5 MiB additional RSS
(90.8 MiB baseline, 356.4 MiB peak), exceeding SC-004 during reads.
Investigate filesystem read allocation: allocate the stat-sized destination
once and read directly into it, handling short reads, premature EOF and growth
without returning unauthenticated bytes. Preserve independent caller ownership
and the existing digest, regular-file and symlink checks. Validate disk races
and repeat the unchanged 2 GiB fixture in both runtime modes before renewing
the full delivery gate. No threshold, sampling or test-only GC changes.

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

### Resumed transition before additional schema migrations

Independent review reproduced a pending historical transition followed by a
new SQL migration: the guard skipped a new backup, applied that migration, and
only then rejected the corrupted original archive. Authenticate the pending
transition's original pre-update archive under the existing RUN lock before
calling the SQL migrator or any schema/bootstrap writer. Reuse the same archive
identity, receipt, digest and installation checks at both entry and storage
transition preparation. Missing or corrupt recovery material must leave the SQL
migration ledger, canonical data, transition state and original blobs unchanged.
After repairing the exact original archive, the same invocation may apply the
new migration and complete the existing transition with the original backup ID.

## Active page response refusal evidence (T051)

Exercise the public `PageReconciler.synchronize()` boundary with encrypted
disposable IndexedDB and genuine Loro transactions. Extend the existing missing
acknowledgement case with durable-state and recovery assertions; add foreign
acknowledgements, incompatible/retreating causal proofs, reused local identities,
corrupted remote digests, omitted frontier data and retreating server cursors.
All other response fields derive from valid server-side fixture documents.
Refused responses must leave the prior sealed checkpoint/cursor unchanged and
retain local authored bytes. Passive catch-up failures can retry with a corrected
response; blocked write batches remain recoverable and must not be reset through
unconnected repository helpers merely to demonstrate retry. Use no private
method access, internal mocks, coverage exclusions or changes to production unless
a concrete defect is reproduced. Full delivery gates remain T037/T038/T040/T041.

The transport regression fixture confirmed that passive catch-up accepted a
server vector older than the already sealed `serverVersionVector` and advanced
the local cursor. `page-reconciler.ts` must reject that retreat before importing
or persisting the response; per-update acknowledgement proofs alone cannot
protect an empty batch. This T051 correction preserves the existing blocked
response outcome, with subsequent healthy passive pulls still permitted.

### T052: historical source-backup authentication after wrapping rotation

Integrate 024 T028 (`56135049`) while retaining the T050 resumed-archive verifier
before the first SQL migration under RUN and T051 frontier monotonicity. The
verifier obtains owned current/historical key buffers from `FullBackupService`
and passes the current key plus historical candidates to `VerifiedFullArchive`;
all owned buffers must be cleared even when archive opening or identity checks
fail. Receipt discovery uses the same configured history. No live root-key
fallback, archive rewrite or new secret store is introduced.

Before adapting the reader, drive the real security CLI on a fixture interrupted
after storage cutover. Establish whether wrapping-key rotation is actually
permitted there (data-key rotation already has a separate transition guard).
If A→B succeeds, retain A explicitly, authenticate the original A backup with B
as current deployment key, resume the same transition and compare exact protected
file bytes under B. Missing/corrupted source archives must still leave new SQL,
ledger, canonical rows, transition and source blobs unchanged. Use only generated
keys/disposable PostgreSQL on port 55433. Record A23 as corrected by 024 plus
this integration and A24 using T051's existing real transport proof; no full
gate or delivery claim belongs to the focused correction. Canvas 28.4/28.5 and
30, constitution IV, and existing FR-007/FR-008 remain unchanged.

### T053: selective graph test coverage

Reproduce the selective PR launcher omitting the declared `graph` Vitest project
for `packages/graph/src/layout.ts`. Keep the existing impact policy and full-run
commands intact; add the missing project to unit dependency selection. Verify
the generated command includes every declared non-database unit project and
execute its actual graph-related tests. This closes a test blind spot under
FR-011/FR-012 without changing product behavior. Root desktop validation stays
on its immutable commit; this correction belongs to the integrated audit gate.

### T056 — touch target geometry

The A37 held-pointer regression also exposes a separate 12 px residual shift
on touch WebKit: its toolbar buttons expand from 32 to 44 px while the negative
toolbar margin stays 32 px. Share the toolbar row-height token with that margin
and select the existing 44 px target for coarse pointers. Keep both activation
and release-outside cancellation, followed by keyboard activation, in the native
regression across all five profiles.

### T057: observe the bounded multipart retry contract in the browser

The integrated WebKit run on 210ea535 records an injected 409, a second real
`file.concurrent-write` 409, then a successful 201, all with the same mutation
identity. Its fixture incorrectly requires exactly two requests even though
T055 permits up to three. Retain the strict three-attempt bound, verify every
intermediate response has the explicit retryable code, require the final 201
and identical nonempty mutation identities, and retain the unique hierarchy
entry/no-attachment assertions. Do not change production retries or accept other
failures. Replay the real browser journey before renewed complete delivery.
