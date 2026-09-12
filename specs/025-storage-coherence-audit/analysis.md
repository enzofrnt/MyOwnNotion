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

| Requirement | Tasks |
| --- | --- |
| FR-001 | T004, T006, T009–T012, T015–T016 |
| FR-002 | T007, T010, T013, T016, T024 |
| FR-003 | T003, T005, T008, T014 |
| FR-004 | T005, T011–T012, T014, T021, T049 |
| FR-005 | T008, T011–T017, T037 |
| FR-006 | T003–T004, T007–T008, T017–T018, T037 |
| FR-007 | T004, T022–T028 |
| FR-008 | T006, T009, T014, T018, T025–T026 |
| FR-009 | T029–T031 |
| FR-010 | T032–T033 |
| FR-011 | T001–T002, T028, T036, T039 |
| FR-012 | T030, T034–T035 |
| FR-013 | T002, T020, T035, T037–T041 |

SC-001/002 map to T010/T019/T027; SC-003 to T022/T027; SC-004 to T021/T049;
SC-005 to T029/T031; SC-006 to T032/T038; SC-007 to T036/T039.

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

## Final source consistency review at 82df5084

Feature prerequisites pass. The final set contains 14 functional requirements,
seven success criteria and 49 unique task IDs, with no unresolved clarification
marker. T042–T049 refine already required privacy, query and performance behavior;
they introduce no new product boundary. Their implementation and targeted proof
are complete, including the full nine-suite performance command on 83726de3.
Review of the recorded code boundaries and joined T045 proofs finds no further
untracked implementation gap, so no new convergence phase is appended. The
audit inventory closes T036. Native image compatibility, complete integrated
local gates and PR/main delivery remain explicitly open in T037/T038/T040/T041.

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
