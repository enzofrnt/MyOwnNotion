# Cross-artifact analysis record

2026-09-05. Spec Kit analysis was read-only; this record preserves its result as
implementation handoff documentation. Required artifacts and local links resolve.
The sole requirements checklist has 16 complete items and zero incomplete items.
No extension hooks are configured. Existing Git/Docker ignore rules cover
secrets, dependencies, generated build/test and local-data artifacts.

## Initial result

No blocking inconsistency or constitution exception. 13 functional requirements,
seven buildable success criteria and 41 ordered tasks are mapped (100%). No
unmapped task, unresolved placeholder or conflicting product boundary remains.
Research clarified that administrative key import refuses occupied targets and
that historical MVCC/WAL erasure is not promised by application-level migration.

Current reconciliation extends that historical baseline to 14 functional
requirements, seven success criteria, 88 ordered tasks and 73 audit findings.
The final code-audit corrections and complete coverage evidence are recorded at
`ca2174cd83fa328f8df808d2ccce5a66061c8999`; exact complete local, PR and main
delivery gates remain open.

| Requirement | Tasks |
| --- | --- |
| FR-001 | T004, T006, T009–T012, T015–T016 |
| FR-002 | T007, T010, T013, T016, T024 |
| FR-003 | T003, T005, T008, T014 |
| FR-004 | T005, T011–T012, T014, T021, T049 |
| FR-005 | T008, T011–T017, T037, T086 |
| FR-006 | T003–T004, T007–T008, T017–T018, T037 |
| FR-007 | T004, T022–T028, T087–T088 |
| FR-008 | T006, T009, T014, T018, T025–T026 |
| FR-009 | T029–T031, T082, T085 |
| FR-010 | T032–T033 |
| FR-011 | T001–T002, T028, T036, T039, T079–T088 |
| FR-012 | T030, T034–T035, T083 |
| FR-013 | T002, T020, T035, T037–T041, T080, T082, T084–T085, T087 |
| FR-014 | T042–T045, T064–T079, T081, T083, T086, T088 |

SC-001 maps to T010/T019/T027; SC-002 to T019; SC-003 to T022/T027; SC-004
to T021/T049; SC-005 to T029/T031/T082/T085; SC-006 to T032/T038; SC-007
to T036/T039/T079–T088.

Proceed through speckit-implement in dependency order. This result says nothing
about implementation correctness or completed delivery; those require the tests,
convergence and CI evidence recorded in tasks/validation.

## Confirmed canonical privacy extension

A17 reproduces retained readable current names and revision snapshots on a
secured installation. FR-014 maps to T042–T045 and extends existing constitution
IV privacy obligations; it changes no product boundary. The updated set has
14 requirements and 45 tasks. T044 includes historical transition as well as
portable restoration, so fresh-write test success cannot close that task.
The implementation must resolve payloads before neutral edits/snapshots and
neutralize source copies within the same transaction. Cross-artifact review
found no contradictory behavior in spec, plan, data model or task dependencies.

## Confirmed boundary follow-ups

T046 removes two uncalled legacy storage functions under FR-001/FR-012 and
tests the active streaming producer. T047 resolves indexed/canonical numeric
equality divergence under FR-011/FR-013. The existing T027 includes both initial
key rotation and failed-operation resumption during a historical transition.
These are corrections to required behavior, without a product scope change.
The updated plan and 47 tasks retain 14 functional requirements; all three
follow-ups block implementation convergence and delivery.

## Authenticated generation reference follow-up

An independent destructive-index fixture confirms A20: current authenticated
file manifests can retain generation references after every mutable chunk-index
row is lost. T048 maps to FR-006/FR-008 and SC-002. The updated plan requires
bounded current-manifest reconciliation under the same FILE lock and transaction
as completion or revocation; index absence must preserve recoverability. The
updated set has 14 requirements and 48 tasks. This P1 blocks convergence and
delivery until completed/partial repair-and-resume regressions pass.

## Measured memory follow-up after convergence

After the read-only convergence review, the full performance command at
75c950ae exposed a reproducible validation gap to investigate: the default 2 GiB
fixture measured 271.8 MiB additional RSS against SC-004's 256 MiB budget.
T049 and the plan's allocation follow-up cover it; there are now 49 tasks.
The runner already uses --smol, while shipped API entrypoints do not. Both
runtime modes require evidence before claiming the server satisfies this limit.

T049 now removes redundant full-payload copies in the shared crypto primitives,
filesystem blob adapter and protected-file equality comparison. It adds no
format, ownership or product-boundary change. Three standard-Bun measurements
(199.5/194.3/193.2 MiB) and three maintained-runner measurements
(218.8/230.1/206.8 MiB) pass the unchanged budget; 52 crypto, 57 blob-store and
36 file API tests plus relevant types pass. The unchanged 2 GiB/hash/range
fixture retains its 5 ms and per-fragment sampling. Validation records all
commands/logs and distinguishes these focused results from the complete
performance and delivery gates still open in T038/T040/T041.

## T045 joined privacy evidence

The bounded review identified two missing combined proofs, already required by
FR-014/T045: canonical SQL inspection after actual offline replay and structured
content in a protected portable target. The existing API/browser fixtures now
cover both, including subsequent edits and retained revisions. Fourteen API
tests and ten journeys across all five profiles pass; relevant types pass.
There is no new product requirement or production change. T045 is complete
with evidence in validation; T038/T040/T041 retain final gate/delivery duties.

## Source consistency review at 38eb48e

At that checkpoint, feature prerequisites passed and the set contained 14
functional requirements, seven success criteria and 79 unique task IDs, with no
unresolved clarification marker. T042–T079 refine already required privacy, migration, archive, history
and performance behavior; they introduce no new product boundary. The final
archive closure validates canonical representability, resumable V1 inventories,
operational lifecycle states, causal receipts, checkpoint sequences and time
order before any archive byte is emitted or any restore-target mutation begins.
Focused implementation and independent review for that checkpoint are complete
at `38eb48e`.
Native image compatibility, complete integrated local gates and PR/main delivery
remain explicitly open in T037/T038/T040/T041.

## T079 — placementless reusable database export

The first exact complete local gate at `b0245c6` stopped during coverage because
canonical export applied the ordinary active-page placement cardinality rule to
the reusable database source and database-entry pages. After every display host
was purged, those independent canonical records legitimately had no hierarchy
placement, but the export validator rejected them. The correction at `38eb48e`
keeps the ordinary-page rule and exempts only the independently represented
database source/entry records while preserving their canonical relationship
checks. The focused canonical purge/restore command passes **2 files / 45
tests**, with durable output in
`integrated-linked-db-canonical-fix-20260913.log`. The failed complete gate is
preserved in `integrated-release-final-b0245c6-20260913.log`; T037/T038/T040/T041
remain open pending a renewed exact gate and delivery evidence.

## T080–T088 — final independent audit closure

The final candidate review found nine bounded implementation or proof gaps, all
within existing FR-005/FR-007/FR-009/FR-011–FR-014 scope. They concern the
coverage budget, table-column mutation atomicity, authenticated recovery-kit
replacement, legacy replay, method-specific readiness, security route
contracts/concurrency, canonical export, the full-backup HTTP contract and
archive/database rejection proofs. No product boundary or release requirement
was added.

Commit `ca2174cd83fa328f8df808d2ccce5a66061c8999` closes the implementation for
T080–T088, and `4da2c2f9aece80b109ec15551b78af1cae4b76eb` completes the direct
missing-parent rollback proof. The exact V2
export uses the same declared JSON serializer for digest and delivery, retaining
open database definition/value maps while stripping closed-object extras. A
conditional `pending` finalization prevents competing resume workers or a late
failure from overwriting a completed artifact. Recovery epoch allocation,
download expiry and promotion share the locked transaction boundary; readiness
is exact by method/path; rotation and audit repository behavior now matches the
public contract. The remaining changes add pre-mutation validation and direct
atomicity/causality coverage.

Focused review passes 188 contract/route tests plus the relevant web ceremony,
and independent Luna review reports no remaining P0/P1/P2 in the reviewed
boundaries. Complete coverage passes 448 files and 4,599 tests with two
platform-specific Windows tests skipped on macOS and the absolute branch budget
unchanged. This is implementation/convergence evidence. T037/T038/T040/T041
still own native architecture parity, the exact complete local gate, PR CI,
merge and post-merge main verification.

## T051 — bounded synchronization convergence

The complementary review checked FR-011/FR-012/FR-013, two relevant plan decisions
(real runtime boundary proofs and unchanged gates), and constitution I/III/IV. It
identified one medium partial-evidence gap: active-response rejection was not
proved to retain the durable checkpoint/cursor/content. Phase 9 appended T051
before implementation. The original missing-acknowledgement case already tested
an active response, so it was strengthened rather than duplicated.

Eight additional public transport cases use real Loro documents and encrypted
IndexedDB. One exposed a confirmed monotonicity defect: empty-batch reconciliation
could replace an already confirmed server vector with an older vector while
advancing the page cursor. No false synchronized result or authored-byte loss
was observed. The minimal guard in `page-reconciler.ts` now refuses that retreat
before any durable change; the fixture verifies unchanged state and healthy
subsequent catch-up. Other cases cover acknowledgement identity/causality, remote
integrity/identity, omitted operations and cursor retreat. The focused source and
proof review finds no remaining T051 gap; full delivery duties remain in
T037/T038/T040/T041. See [the commands, failed reproduction and final evidence](validation.md#t051--active-page-response-rejection-and-frontier-monotonicity).

## T052 pre-implementation integration analysis

The 024 merge adds historical keys to the shared backup service, but T050's
source-archive reader still supplies only the current key. This is a consistency
gap in FR-007/FR-008 recovery, not a new product direction. T052 preserves the
existing pre-SQL verification order and explicit external secret configuration.
The real rotation/transition fixture determines reachability before claiming
a recoverable path. T050 and T051 remain implemented; no threshold or exclusion
change is authorized. The updated task set contains 52 unique IDs.

## T059 — explicit CI gate topology

The final audit cross-check found that `docs/development.md` names
`test:security` and `compose:check` as blocking PR/main responsibilities, while
the reusable CI workflow only ran their neighboring checks and did not expose
either command to `quality-gate`. This is a delivery-evidence gap under
FR-011/FR-013, not a new product requirement. T059 adds one observable job per
entry point, requires both jobs from the aggregate, and adds a contract test for
the declarations, exact commands and dependencies. The focused contract proof
passes; complete local, PR and main gates remain T040/T041.

## T060 — successful response body canceled during navigation

Main run `34707930251` attempt 1 exposed a WebKit mobile page error while the
durable internal-link journey reloaded the editor. The page link had already
persisted and the retry passed, so `--fail-on-flaky-tests` correctly identified
a response-lifecycle race rather than lost content. The old document's workspace
change feed received HTTP 200, then navigation canceled `response.json()` while
the body was being consumed. `ContentApi` caught transport rejection around
`fetch()` but allowed this later rejection to escape.

T060 converts a successful response whose body cannot be consumed into the
existing bounded offline result and never replays the request. The browser
journey now waits for the workspace synchronization barrier before navigation,
checks that no page error occurred during the functional interaction, and then
detaches its old-document listener before reload. The persisted-link assertions
remain unchanged. Focused unit, type and formatting evidence is recorded in
`validation.md`; renewed exact local, PR and main gates remain T040/T041.

## T061–T063 — final storage convergence

The final code audit found one additional P2 durability gap: encrypted chunks
were physically published before their canonical transaction committed, but a
rollback left no bounded cleanup candidate. T061 reuses the existing protected
garbage ledger as a write-ahead intent, acknowledges it in the canonical
transaction, and retains the exclusive maintenance lock plus global reference
check before deletion. The RED rollback fixture reports no deletion on the old
code; the corrected service, upload and rotation paths pass focused PostgreSQL
and filesystem regressions.

The renewed exact local gate then reproduced SC-004 at 268.9 MiB additional RSS.
The allocation shape, rather than the fixture or threshold, remained the only
unresolved variable: Bun 1.4.2 read a plain `Uint8Array` through transient
conversion storage. T062 uses direct `Buffer` storage for the fully verified
positional read and exposes only the existing `Uint8Array` contract. Three
maintained and three ordinary Bun runs pass the unchanged 2 GiB fixture, and
the blob-store ownership/corruption suite remains green. No further functional
gap was found by the independent focused review; exact local, PR and main
delivery evidence remains governed by T040/T041.

That review also identified a P2 concurrency flaw in T061's first implementation:
each canonical transaction retained one primary pool connection while its
write-ahead callback requested a second connection from the same ten-slot pool.
Ten simultaneous writes could therefore consume every slot and leave all ten
waiting for an eleventh. T063 reproduces the stall with nine held clients plus
the active canonical transaction, then routes the short journal transaction
through a single reserved connection owned and closed by `DatabaseHandle`.
The saturated operation completes, while journal ordering, FILE locks and the
canonical commit boundary stay unchanged.

## T064 — protected placeholder collision

The final whole-code review found one P2 collision left by the canonical
privacy cutover. `normalizeDisplayName` accepted the exact U+FFFD character that
protected storage uses as its scrub marker. A new page or file with that name
reached sealing without a prior envelope and failed as an internal error;
renaming or restoring an existing item to it was accepted but resolved back to
the prior title. Resumable uploads also accepted a transfer that could not be
published, and import preview did not report the future refusal.

T064 adds one shared domain marker and reserves only its exact trimmed value.
The HTTP, file, MCP and import paths now converge on that rule; resumable upload
and retained-revision boundaries validate before durable mutation. Internal
scrub and portable restore operations remain explicit storage paths.

Independent review then found that a V0 title or filename already equal to the
marker could not enter the historical transition. T064 records the legacy fact
inside the authenticated source checkpoint, permits it only before its first
envelope publication, and requires protected content for post-write digest,
global verification and retirement. The combined legacy page, file and retained
snapshot transition fails before this correction and passes afterward without
relaxing normal missing-envelope refusal.

Independent review then removed the newly published `item.name` envelope before
global verification. The former comparison re-inventoried the remaining marker
as a legacy source and advanced the transition. The final verifier now opens and
digests every captured metadata source with protected content required; the RED
case advances no phase, and restoring the exact envelope permits completion.

The entry-path GREEN set passes 128/128 and the full canonical migration file
records 10/10 focused cases, with complete workspace types and changed-source
formatting checks. Exact local, PR and main delivery evidence remains governed
by T040/T041.

## T065 — protected structured-payload collision

The final marker review found that the API matcher treated any object containing
`$myownnotionProtected: 1` as neutralized storage. The exact object could be
authored as a page body or relationship metadata: creation returned an internal
error, replacement and history restoration silently retained the prior body,
and an old readable row could not enter the canonical migration. Multi-key user
objects were also vulnerable to misclassification.

T065 defines one domain-owned exact marker and requires exactly one own key.
Page-document and relationship validation reject that object before mutation;
revision restoration reuses the page-document boundary. Objects with additional
fields remain accepted and round-trip through protected storage. A separate
authenticated V0 provenance covers current page bodies, retained snapshots and
ordinary relationship metadata only during their first envelope publication.
All post-publication digests, global verification and retirement require the
envelope, including when the historical authored value equals the marker.

The RED matrix records eight boundary failures; the corrected focused set passes
114/114 across domain and API contracts, including two complete V0 transitions.
Workspace types and formatting checks pass. Exact complete local, PR and main
delivery evidence remains governed by T040/T041.

## T066 — strict envelope revalidation

The migration lifecycle previously trusted the fact that each individual
publication had succeeded. A later deletion or replacement could therefore be
missed at verification, cutover or retirement. The completion boundaries now
reopen every authenticated envelope and compare the captured metadata before
advancing. `ded9429b` and its focused destructive regression establish the
fail-closed behavior; final delivery gates remain open.

## T067 — authenticated V0 provenance

The legacy marker exception is safe only when the source is demonstrably V0.
`983384ba` binds that decision to the full-backup receipt, manifest, installation
identity and absence of migration 0006, then persists the source identity and
provenance in the v2 inventory used by resume. This prevents a modern or
mismatched backup from reusing the exception.

## T068 — portable archive version and streaming boundaries

Portable archives now retain a V1-compatible read path and apply the stricter V2
marker/name rules. Canonical graph and page-operation validation runs before
output begins; the streaming producer and exact TAR framing are covered, with a
real V1 database restore retained as the compatibility proof. The second
archive-hardening pass is still being validated, so this record makes no final
aggregate claim.

## T069 — protected history fail-closed behavior

Protected history now distinguishes a missing envelope (500) from an expired
snapshot (410) on reads and restores. Compaction and legacy-branch conversion do
not recover raw snapshots; the supported legacy path uses an explicit client
base and bounded retention. The focused corrections at `1ac10b32`, `cce42dea`,
`6fb9a8ac` and `38896281` record the boundary.

## T070 — exact own-key matching

The structured marker matcher uses `Reflect.ownKeys` and an exact one-own-key
check, including symbol and non-enumerable properties. Multi-key authored
objects remain ordinary content, closing the remaining classification edge while
leaving final delivery gates to T040/T041.

## T071 — authenticated V1 inventory resume

An authenticated version-1 transition inventory could not resume after the
version-2 provenance format landed, including the early file-only inventory that
predated metadata capture. T071 distinguishes source application provenance
from marker eligibility: modern and V0 sources may resume, while only the V0
marker exception requires V0 evidence. Backup, receipt, installation,
transition, entry set and digest proofs must match before an atomic V2 upgrade;
the early metadata supplement is allowed only in pre-verification phases.
`f78b4594` and its focused migration matrix close A56.

## T072–T078 — final archive and operation closure

The final independent reviews found seven fail-closed gaps rather than new
product scope: SQL-invalid zero structured versions and U+0000 canonical or
operational JSON, a legitimate
empty initialization state rejected by backup, incomplete Loro base/result
verification, a retained checkpoint beyond the update head, reversed lifecycle
timestamps, a checkpoint snapshot ahead of its declared sequence, and a legacy
state carrying operational records.

`037570b` and `e003264` close these boundaries in shared preflight. Canonical
and page-operation JSON are scanned iteratively;
operational blobs reconstruct their cumulative frontiers;
checkpoints bind to their exact sequence; initializing and legacy states have
explicit lifecycle shapes; and chronological invariants are checked before any
archive byte is emitted or any restore-target mutation begins. The final focused
proof passes 168 unit/property/contract
tests, 41 PostgreSQL/API tests, the separate 10,000-change long-offline case,
complete workspace type checking and changed-source formatting. Independent
post-fix reviews found no remaining P0/P1/P2 in these boundaries. Complete local,
PR and main delivery remains T037/T038/T040/T041.
