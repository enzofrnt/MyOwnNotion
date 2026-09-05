# Cross-artifact analysis record

2026-09-05. Spec Kit analysis was read-only; this record preserves its result as
implementation handoff documentation. Required artifacts and local links resolve.
The sole requirements checklist has 16 complete items and zero incomplete items.
No extension hooks are configured. Existing Git/Docker ignore rules cover
secrets, dependencies, generated build/test and local-data artifacts.

## Result

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
