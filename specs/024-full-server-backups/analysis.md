# Cross-artifact analysis

2026-09-05, before implementation. Sources: constitution, updated canvas/007,
024 spec, plan, research, data model, CLI contract, quickstart and tasks.

| Requirements | Story | Implementation and proof |
| --- | --- | --- |
| FR-001–FR-008, FR-015–FR-017 | US1 | T003–T012; real full restore, corruption and concurrency |
| FR-009–FR-011 | US2 | T013–T015; old schema unchanged on failure |
| FR-012–FR-014 | US3 | T016–T018; clock, retry, retention and remote failure |
| FR-018–FR-020 | US4 | T019–T021; status and actual isolated rehearsal |
| FR-021 | Foundations | T006, T023; runtime/image tools on both architectures |
| SC-001–SC-006 | All | T007, T012–T013, T016, T018, T023 |

No uncovered requirement or unresolved high-impact inconsistency. Two earlier
007 conflicts are amended: a portable serialization cannot represent all tables,
and encrypted historical security records are permitted while usable external
keys and plaintext secrets remain excluded. Unknown source version is explicit,
not inferred from the target. Exact historical restore is verified before the
separate security reactivation boundary; identity preservation does not grant
old sessions trust. No live-data migration or restore is authorized by these
fixture validation tasks. Required gates are retained and not replaced by CI.

## T028 pre-implementation consistency review

The review reproduced a 024 recovery defect: after A→B rotation, A archives,
receipts and activities remain encrypted with A while readers try only B; the
rotation CLI additionally tells the operator to destroy A. New B scheduling
works, but historical catalogue/retry/retention and eventual recovery fail.
T028 refines FR-004/FR-006/FR-014/FR-018 and canvas 28.4 without changing release
scope. Historical files are explicit external secrets; only read authentication
uses them. No fallback is added to live data-key access or actual CLI restore.
The full SQL dump's root-key envelopes require the corresponding original
wrapping key as well. No unresolved product ambiguity or constitution exception.

### T028 convergence result

PASS for the bounded correction: spec/plan/contract and current implementation
agree on explicit external history, current-only writes, immutable archives,
conservative catalogue/retention, and explicit actual restore/activation keys.
The real integration test additionally covers outer archive A with SQL root
keys already rewrapped B: activation authenticates/removes the A marker, then
the B-configured application opens protected content and passes health.
Configuration, API/CLI/scheduler/migration wiring, Compose mounts, operational
docs and tests are included. No unbuilt T028 requirement remains; T023/T024
are deliberately left pending for integration/full delivery gates. Feature 025
readers are reviewed by the integrating agent, outside this 024-based commit.
