# Validation: storage privacy and coherence

2026-09-05: specification, plan, research, data model, boundary contract and
41 implementation tasks exist. Spec Kit prerequisites and all local document
links pass. Cross-artifact analysis maps every FR/SC with no blocking issue.
The requirements checklist is 16/16 complete. T001 initial evidence inventory
and T002 directly affected shared-artifact references are complete.

T003 implements pure authenticated file-inventory shape rules. All 29 focused
tests and the domain strict type check pass, including 200 generated shape/tail
removal cases up to 2 GiB, malformed provenance, empty files and mixed historical
chunk generations. This is shape validation, not ciphertext or runtime privacy
proof. Source findings and pending proof are explicit in the audit inventory.
Desktop and backup delivery remain separate active work. No user data/keys/live
service was changed by this preparation. Full local/PR/main gates remain pending.

T004 adds reviewed 0015 schema without running it on user data. The 13 focused
migration tests pass, including preservation of historical file UUID/digest and
acknowledged upload offset, format-specific null/lookup guards, invalid chunk
position/length/generation, cascading partial references, and durable transition
backup/replacement/retained-quarantine constraints. Database strict types pass.
Existing legacy candidate/export readers explicitly refuse unresolved encrypted
metadata until T013–T017 connect the protected runtime; no nullable digest is
misreported as an empty digest. The application transition is not implemented yet.

T005 adds single-chunk and backpressured stream operations, upload/content purpose
separation, authenticated inventory matching, progressive mixed-generation reads
and owned-key cleanup. All 33 chunk tests and blob-store strict types pass,
including source/storage interruption, cancellation, tail deletion, substitution,
full digest verification and real 4 MiB boundaries. Existing convenience readers
remain until the protected runtime is connected; this is primitive-level proof.

T006 makes new filesystem publication exclusive, private, verified and fsynced
before returning a durable locator, without overwriting an existing key. Focused
filesystem tests cover concurrent identical writes, empty bytes, corrupt existing
data, root/prefix/file symlinks, byte verification failure, file fsync failure and
directory fsync refusal followed by a safe retry. No full runtime migration or
end-to-end bounded-memory result is claimed by these primitive tests.

T007 adds a root-derived, purpose-bound private content lookup tag and distinct
protected entities for logical-file metadata, upload metadata, completed content
inventories and accepted upload state. The 22 hierarchy/protection integration
tests pass: lookup survives data-key and wrapping-key rotation, never calls the
recovery export accessor, binds length/digest, refuses unavailable keys and keeps
metadata out of raw envelope rows. Missing versions return absence; authenticated
payloads with transplanted inventory versions are refused. A remaining nullable
legacy file route now explicitly refuses unresolved protected content until the
streaming reader replaces it in T012. No deployment occurs at this intermediate
boundary.

T008 adds scoped ordered chunk references, protected upload format/version reads
and bounded verified private-content candidate lookup. Integration cases prove
atomic tail replacement, offset/reference rollback, refusal of scope substitution,
missing uploads and invalid descriptors. A second SQL connection proves that
generation retirement waits for an in-flight publication lock; retired keys
remain readable and reject new writes, while revoked keys refuse reads. The
existing upload lifecycle suite is included. These locks still require the
rotation/revocation orchestration integration tracked by T018.

T009 provides the shared protected file factory/service without changing live
route composition yet. Five real SQL/filesystem integration cases pass, along
with API strict types: multi-chunk content reopens exactly through a fresh
runtime, empty content is authenticated, raw file rows omit digests/locators,
logical envelope/filesystem inspection finds no fixture sentinel, missing keys
refuse before reading input, interrupted/oversized/short streams publish no SQL
content, and missing tails/corrupt bytes refuse. HTTP composition, deduplication,
range reads and historical migration remain the following explicit tasks.

T010's three secured HTTP regressions fail against the still-unmodified route
composition, after successful authentication, upload/download and offset checks:
direct bytes remain readable in the blob directory; filenames remain readable
in item/logical-file/revision rows; acknowledged partial bytes remain readable.
Baseline output is `/tmp/mon-protected-http-before.log` on the development host.
These tests stay strict while T011–T015 replace that composition. All sentinels
are synthetic fixture values; no owner content was used or displayed.

T011 checkpoint: multipart import/replacement now consume bounded streams with
automatic SQL retries disabled, persist protected content and invoke the common
accepted-write/attribution guard. Two targeted secured HTTP cases pass for direct
encrypted bytes/downloads and independent logical identities with physical reuse
and device attribution. Six protected-service cases pass including deliberate
candidate-tag collision and duplicate ciphertext cleanup. The complete HTTP
privacy suite still fails its metadata and resumable-upload cases; T011 remains
open until replacement/refusal checks and the remaining composed paths converge.

T012/T013 checkpoint: 16 protected service/secured HTTP tests pass, including
multi-chunk append across a partial tail, offset rollback on overflow or source
interruption, zero-byte completion, replay after a lost final response, private
current/history metadata and replacement/restoration preserving a duplicate's
independent identity. API strict types pass. Durable completion receipts commit
with the logical file and are removed with its eventual purge. Historical restore
now resolves sealed snapshots inside the mutation and moves the verified file
content pointer as a new revision. Previously the generic restore only changed
name/page body and could not resolve a neutralized file snapshot.

Evidence: `/tmp/mon-protected-http-completion.log` (16 tests),
`/tmp/mon-protected-api-typecheck.log`. T011–T013 remain open: cleanup of abandoned
ciphertext/transfer envelopes, projection/export composition, migration and the
remaining failure/concurrency contracts still require convergence. This checkpoint
has not passed the full local gate and has not been pushed.

T014: 18 protected service/HTTP tests pass with strict API types. Full, prefix,
suffix, open-ended and clamped ranges return exact bytes and lengths; malformed,
unsatisfiable and unsupported multiple ranges return 416. If-Range compares the
opaque content identity and falls back to the full representation on mismatch.
A range crossing the real 4 MiB boundary returns exact bytes; corruption outside
the requested chunks does not force an unrelated read, while a corrupt selected
chunk throws before yielding its bytes. Anonymous range requests refuse with 401.
Evidence: `/tmp/mon-protected-ranges.log`, `/tmp/mon-protected-range-typecheck.log`.
Semantics follow [RFC 9110 sections 13–14](https://www.rfc-editor.org/rfc/rfc9110.html#name-range-requests).

T015–T017 checkpoint: API, administrative commands, rehearsal and migration
composition use the shared protected file runtime. Canonical export resolves
private names/digests; portable restore ingests ciphertext and neutralizes file
metadata. The portable TAR producer streams attachments into the existing sealed
framing without creating a plaintext stage, and pins physical files before its
consistent snapshot until sealing finishes. Producer interruption removes partial
output; an existing destination refuses before consuming input.

Seventeen crypto/secured HTTP tests pass, including an actual portable attachment
restore into an isolated protected runtime and authorized download. Fifteen
existing archive contract tests and three operational backup tests also pass.
Full capture now checks completed/upload/quarantine ciphertext references, skips
nullable protected content locators and distinguishes legacy upload prefixes from
encrypted upload state. Four full/operational cases pass, including exact equality
of every public SQL table before activation, rejection of old authentication,
download of a completed attachment and resumption of an encrypted partial transfer
after fresh authentication. Legacy schema/prefix backup remains covered.

Evidence: `/tmp/mon-protected-portable-restore.log`,
`/tmp/mon-protected-portable-composition.log`, `/tmp/mon-protected-full-restore.log`,
`/tmp/mon-protected-composition-typecheck.log`. These are focused checks; remaining
fixture composition, historical transition and full gates are still open.

Transfer cleanup checkpoint: 20 service/secured HTTP cases and strict API types
pass. Superseded tails are queued atomically, expired transfer retirement commits
before physical deletion, live references prevent deletion, and a simulated disk
failure retains the queue for retry without resurrecting retired upload state.
Startup and bounded minute batches share this path and shutdown awaits active
work. Evidence: `/tmp/mon-protected-cleanup-fixed.log`,
`/tmp/mon-protected-cleanup-typecheck.log`. Unclassified interruption orphans are
retained for the historical transition; this is not forensic storage erasure.

Historical projection/fixture convergence: 34 existing file/tus contract cases
pass with real protected owner fixtures, retaining their placement, copy-on-write
and refusal assertions. Encrypted HEAD uses authenticated committed state and
refuses a contradictory offset; it never adopts unauthenticated stray bytes.
Eleven secured HTTP cases include trashing a folder containing differently named
files and verifying each descendant's own decrypted revision metadata. Two full
backup consistency cases prove capture pins the accepted encrypted prefix while
concurrent finalization waits. Evidence: `/tmp/mon-protected-existing-contracts-fixed.log`,
`/tmp/mon-protected-branch-history.log`, `/tmp/mon-protected-backup-consistency.log`.

T018 read-lifetime checkpoint: completed and partial file readers now hold the
024 FILE lock until their async iterator completes, fails or is cancelled.
Partial reads additionally lock and reload the upload row, preventing an append
from retiring the tail currently being read. Portable backup acquires FILE
before BLOB and reuses its coordinator connection for file reads, avoiding a
second-connection wait behind queued maintenance. Real PostgreSQL tests prove
maintenance exclusion and lock release after cancellation, missing content and
successful consumption. The secured HTTP portable restore and full capture
consistency scenarios remain green: 24 tests in three files, plus API typecheck.
Rotation rewrite/revocation itself is still pending; T018 remains open.

T018 rotation checkpoint: bounded completed/partial chunk rewrite is now composed
into the administrative data-key command, including file counts, checkpoints,
failed-operation resume, immutable IDs/offsets and transactional revocation
rechecks. A real four-chunk fixture interrupts publication after one committed
batch, reads mixed generations, refuses premature revocation, resumes the same
operation and appends after rotation. Revocation waits for an active reader.
Ordinary and batched envelope writes reject a deliberately retired key selection
without publishing a record. Existing rotation/audit and secured file HTTP tests
remain green: 39 tests across four files, plus API typecheck. The final shared
migration/restore and complete gate evidence is still pending; T018 remains open.

T019 duplicate-completion checkpoint: a deterministic interleaving of two real
PATCH requests reproduced HTTP 404 after a concurrent finalizer removed the
partial row. The route now rereads the durable completion receipt after that
wait and returns the same item identity/offset. The fixture downloads the exact
four accepted bytes afterward. Secured file tests plus the existing resumable
contract pass (32 tests); the failing baseline is retained in the task log.

### Canonical payload privacy boundary (A17, FR-014)

A secured ordinary-page SQL sentinel test failed before the change: names and
retained snapshots remained readable despite protected envelopes. New mutation,
page-state history/materialization and portable-restore boundaries now resolve
protected payloads and neutralize their canonical copies atomically. Neutral
favourite/icon/rename/no-op conversion preserves body and icon. Database privacy
checks now include items, revisions and page documents instead of excluding them.

Focused protected/read/structured/restore checks passed 56 tests across six files;
page-history consolidation passed eight after restoring a consistent test clock
at revision expiry. The complete contract run passed 1,448 of 1,449 tests and
identified a remaining file-usage name read using the raw title. That read now
resolves the protected presentation and refuses a missing envelope. Historical
transition, browser parity and the complete audit gate remain unverified.

The corrected file-usage read and missing-envelope refusal pass alongside the
canonical privacy cases (16 tests). API strict TypeScript, changed-source Biome
format/lint and `git diff --check` pass. This checkpoint closes the reproduced
fresh-write defect; it does not close T044's historical migration obligation.

Historical conversion primitives preserve content UUID/reference counts without
merging equal-byte objects, verify original digest/length before changing the
canonical row, and leave source bytes intact for later retirement. Partial
conversion retains upload UUID, expiry, declared length and acknowledged offset;
a truncated prefix rolls back and a converted transfer resumes at that offset.
All 35 focused file/upload/migration tests and API strict types pass. This is
preparation for T023–T027, not a completed guarded transition.

The bounded historical source inventory passes five migration-focused cases,
including complete legacy data, protected-chunk exclusion, acknowledged prefixes,
recoverable extra tails/temporary files, post-inventory substitution refusal,
symlink refusal and invalid-path refusal. File reads use 64 KiB chunks and verify
length/digest at EOF; no historical source is deleted by inventory or conversion.

The transition guard rejects new server startup and rolls back an already-running
server's attempted private write while a transition is incomplete. The migration
can authorize its own transaction with the matching transition ID; that permission
does not survive commit or leak to the next ordinary write. FILE locks serialize
the guard decision with publication and maintenance. Nine targeted migration,
backup-locking and file-rotation tests plus API strict types pass. Guarded update
orchestration and durable checkpoint/cutover recovery remain pending.

Canonical command submission and operational page updates acquire the FILE guard
before editing rows; the accepted callback also guards commands with no protected
payload, such as relationship removal. The corrected migration guard cases pass
six tests; fourteen additional canonical/page-operation/guarded-backup integration
tests pass, including offline convergence and request rollback. No source backup
or current test installation was silently skipped by the startup check.

Durable source publication now has authenticated source/inventory/replacement
records and compare-and-advance checkpoints. Backup-evidence refusal creates no
transition; an interrupted ciphertext write leaves every source checkpoint
unadvanced; restart reuses the original transition and backup ID. Each published
replacement is fully authenticated and compared with original length/digest before
verification advances. Corrupt ciphertext leaves that checkpoint pending until
repaired. Current upload metadata/lifetime and content reference counts are also
part of the authenticated source inventory.

Quarantine references preserve empty and nonempty recovery objects, follow chunk
rotation and survive portable workspace replacement. Twenty-one targeted storage,
portable-restore and backup-locking tests pass; the enhanced seven-case migration
suite additionally passes ciphertext-corruption verification/retry. The additive
schema integration and API strict types pass. These are source/checkpoint proofs;
canonical metadata backfill, global cutover, source retirement, actual 024 receipt
composition and all durable driver interruption tests remain unfinished.

Historical canonical metadata now joins the authenticated inventory with per-source
digests and atomic metadata/checkpoint batches. Backfill preserves authoritative
sealed values over stale readable copies and compares resolved payloads before
and after neutralization. A publication failure rolls back the metadata and its
checkpoint. Ordinary page names/icons/bodies, retained snapshots and relationships
pass SQL sentinel checks; historical database definitions, view labels and entry
values retain byte-equivalent JSON API representations after backfill.

The first historical relation test exposed another raw-read boundary: relationship
listing returned the storage marker. Listing and canonical export now share the
existing protected relationship resolver, including missing-envelope refusal.
Thirty focused metadata/file/read-fault tests pass, followed by both complete
ordinary/structured metadata fixtures. API strict types and changed-source
format/lint pass. The phase now reaches `metadata-protected`; global verification,
cutover, source retirement and guarded-driver composition are still pending.


The complete driver now verifies its authenticated inventory, commits global
cutover, reauthenticates every replacement, durably unlinks its readable source
and checkpoints retirement. Nine injected interruption boundaries all resume,
including unlink before SQL acknowledgement. Shared content identities, partial
upload offsets, unacknowledged tails and empty quarantine objects survive. The
25-case file/canonical/guarded-migration suite passes. The real guarded upgrade
uses the authenticated 024 receipt plus actual archive authentication; replacing
that archive with invalid bytes blocks restart without recording the target
version or creating substitute evidence. Restoring the same archive allows
completion. Fresh empty installations still avoid pre-bootstrap data-key creation.

The isolated 2 GiB ingest/full-read/chunk-crossing-range fixture passes with
64.5 MiB additional RSS (228.3 MiB baseline, 292.8 MiB peak), below the 256 MiB
budget. This first measurement uses the Vitest executable's Node host; the
maintained Bun/--smol invocation is being checked separately. Evidence:
`/tmp/mon-storage-guarded-resume.log`, `/tmp/mon-protected-files-memory.log`.
The source-retirement behavior still needs the remaining explicit key/disk and
end-to-end recovery checks plus the complete feature gate before delivery.

The maintained Bun/--smol runtime also passes the same 2 GiB fixture: 107.0 MiB
baseline RSS, 353.6 MiB peak and 246.6 MiB additional RSS over 12.66 seconds.
This is below the required 256 MiB limit but leaves limited headroom; the full
gate must reproduce it. Log: `/tmp/mon-protected-files-bun-memory.log`.


The pointer-cancellation browser fixture fails on the old pointerdown action,
then passes with semantic click activation. Thirty targeted browser executions
(six journeys on each of five projects) pass: cancellation, single keyboard
activation, real second-device update during a composing dirty field, typed
schema/entry identity and active editor caret/typing in both themes. Firefox
and WebKit use the pinned Linux container. Actual Chromium dark and Firefox
light captures were inspected; no unused stylesheet is used as visual evidence.
The first expanded run was interrupted after an undefined testInfo in the newly
added screenshot capture; the corrected complete matrix passes. Logs:
`/tmp/mon-ui-pointer-baseline.log`, `/tmp/mon-ui-audit-browser-matrix-fixed.log`.

The unused stylesheet and test-only native filesystem lock are removed; their
live global.css/Electron consumers remain. All maintained task and CI ownership
references were updated. Forty-eight focused editor/native/impact-policy tests
pass, as do all workspace strict types after correcting the performance fixture's
old file-based seal callback to the new stream boundary. The UI skill now
explicitly requires release cancellation and semantic activation.

Administrative import still refuses any occupied target before adoption. A new
fixture proves existing real device/session rows remain unchanged; the removed
resetDeviceTrust helper was unreachable under those owner-FK/emptiness invariants.
Twenty-seven recovery tests pass. The strengthened actual full-restore suite
also passes thirteen cases: the old file cookie receives 401, a fresh password
login authorizes exactly one device, and both full and range HTTP reads return
the original protected attachment after restore/activation. Logs:
`/tmp/mon-recovery-trust-audit.log`, `/tmp/mon-full-restore-protected-http.log`.

Twenty historical-storage cases now pass, including unreadable ciphertext,
missing keys and retirement I/O failure after cutover. Each failure preserves
its readable original and incomplete transition; repair permits completion.
Final completion also reconciles every retired checkpoint with the authenticated
inventory and refuses success if a checkpoint disappeared. The recovery test
restores that checkpoint and resumes. The maintained Bun portable backup/restore
benchmark passes after its stream-adapter update (1,000 items: 504 ms backup,
8,763 ms restore). Logs: `/tmp/mon-retirement-final-inventory.log`,
`/tmp/mon-audit-portable-perf.log`.
