# Validation Evidence Ledger: Owner Security Foundation

Status: `pending`

This is the canonical empty evidence template for feature 002. It makes no
claim that application code, Compose, CI, or release evidence exists. Every
row stays `pending` until a reviewer records raw evidence for the exact
candidate. Blank cells are not passes.

## Evidence record requirements

Every evidence record or supporting table must contain or reference all of:

| Field | Required meaning |
| --- | --- |
| Requirement/criterion | Exact `FR-001`–`FR-035`, `SC-001`–`SC-010`, or named criterion |
| Command or test path | Reproducible command, test, workflow, contract, or inspection path |
| Candidate SHA | Exact commit under test; for release, the candidate SHA and caller SHA comparison |
| Controlled clock/configuration | Clock instant/fixture and relevant policy, environment, Compose, or workflow configuration |
| Raw evidence/artifact | Unedited output, report, digest, screenshot, trace, or referenced artifact |
| Reviewer/date | Human reviewer and UTC review date |
| Status | `pending`, `pass`, or `fail`; pending is the only initial status |

The canonical row template is:

| Requirement/criterion | Command or test path | Candidate SHA | Controlled clock/configuration | Raw evidence/artifact | Reviewer/date | Status |
| --- | --- | --- | --- | --- | --- | --- |
|  |  |  |  |  |  | `pending` |

## Functional-requirement ledger

| Requirement/criterion | Command or test path | Candidate SHA | Controlled clock/configuration | Raw evidence/artifact | Reviewer/date | Status |
| --- | --- | --- | --- | --- | --- |
| FR-001 | `packages/database/tests/security-owner.integration.spec.ts` |  |  |  |  | `pending` |
| FR-002 | `apps/api/tests/bootstrap.contract.spec.ts`; `packages/database/tests/bootstrap-concurrency.integration.spec.ts` |  |  |  |  | `pending` |
| FR-003 | `apps/api/tests/authentication.contract.spec.ts` |  |  |  |  | `pending` |
| FR-004 | `apps/api/tests/credential-management.contract.spec.ts` |  |  |  |  | `pending` |
| FR-005 | `apps/api/tests/credential-management.contract.spec.ts`; `tests/e2e/authentication.spec.ts` |  |  |  |  | `pending` |
| FR-006 | `packages/database/tests/session.integration.spec.ts` |  |  |  |  | `pending` |
| FR-007 | `apps/api/tests/session-revocation.integration.spec.ts` |  |  |  |  | `pending` |
| FR-008 | `apps/api/tests/devices.contract.spec.ts` |  |  |  |  | `pending` |
| FR-009 | `packages/database/tests/device-management.integration.spec.ts` |  |  |  |  | `pending` |
| FR-010 | `tests/e2e/devices.spec.ts` |  |  |  |  | `pending` |
| FR-011 | `packages/database/tests/security-crypto.integration.spec.ts` |  |  |  |  | `pending` |
| FR-012 | `packages/client-core/tests/local-encryption.integration.spec.ts` |  |  |  |  | `pending` |
| FR-013 | `tests/contract/compose-security.spec.ts` |  |  |  |  | `pending` |
| FR-014 | `packages/domain/tests/encryption.property.spec.ts` |  |  |  |  | `pending` |
| FR-015 | `packages/database/tests/recovery-kit.integration.spec.ts` |  |  |  |  | `pending` |
| FR-016 | `apps/api/tests/bootstrap-fault-injection.integration.spec.ts` |  |  |  |  | `pending` |
| FR-017 | `packages/database/tests/key-rotation.integration.spec.ts` |  |  |  |  | `pending` |
| FR-018 | `packages/domain/tests/security-recovery.property.spec.ts` |  |  |  |  | `pending` |
| FR-019 | `packages/database/tests/administrative-recovery.integration.spec.ts` |  |  |  |  | `pending` |
| FR-020 | `tests/contract/admin-cli.contract.spec.ts` |  |  |  |  | `pending` |
| FR-021 | `tests/contract/admin-cli.contract.spec.ts` |  |  |  |  | `pending` |
| FR-022 | `packages/database/tests/security-audit.integration.spec.ts` |  |  |  |  | `pending` |
| FR-023 | `packages/domain/tests/redaction.property.spec.ts` |  |  |  |  | `pending` |
| FR-024 | `packages/domain/tests/security-canonical-identities.property.spec.ts` |  |  |  |  | `pending` |
| FR-025 | `packages/domain/tests/rotation-policy.clock.spec.ts` |  |  |  |  | `pending` |
| FR-026 | `apps/api/tests/key-rotation-policy.integration.spec.ts` |  |  |  |  | `pending` |
| FR-027 | `apps/api/tests/key-rotation-write-block.integration.spec.ts` |  |  |  |  | `pending` |
| FR-028 | `packages/database/tests/security-migration.integration.spec.ts` |  |  |  |  | `pending` |
| FR-029 | `apps/api/tests/security-migration-fault-injection.integration.spec.ts` |  |  |  |  | `pending` |
| FR-030 | `tests/contract/compose-security.spec.ts` |  |  |  |  | `pending` |
| FR-031 | `tests/contract/compose-security.spec.ts` |  |  |  |  | `pending` |
| FR-032 | `tests/contract/release-artifacts.spec.ts` |  |  |  |  | `pending` |
| FR-033 | `tests/contract/release-gates.spec.ts` |  |  |  |  | `pending` |
| FR-034 | `tests/contract/release-gates.spec.ts` |  |  |  |  | `pending` |
| FR-035 | `tests/contract/security-api.spec.ts` |  |  |  |  | `pending` |

## Success-criterion ledger

| Requirement/criterion | Command or test path | Candidate SHA | Controlled clock/configuration | Raw evidence/artifact | Reviewer/date | Status |
| --- | --- | --- | --- | --- | --- | --- |
| SC-001 | `packages/database/tests/bootstrap-concurrency.integration.spec.ts`; `tests/e2e/bootstrap.spec.ts` |  | Fresh-install and interruption fixtures |  |  | `pending` |
| SC-002 | 20-trial operator protocol below |  | Clean-install fixture; injected clock |  |  | `pending` |
| SC-003 | `apps/api/tests/authentication.contract.spec.ts`; session/device revocation tests |  | Session/recent-auth configuration |  |  | `pending` |
| SC-004 | Encryption fault and migration tests |  | Key-generation and migration fixtures |  |  | `pending` |
| SC-005 | Recovery-kit and administrative-recovery tests |  | Seven recovery state pairs; lineage/epoch fixtures |  |  | `pending` |
| SC-006 | Independent wrapping/data-key rotation tests |  | Rotation policy and interruption fixtures |  |  | `pending` |
| SC-007 | Compose, admin, workflow, gate, and release tests |  | Exact candidate workflow/configuration |  |  | `pending` |
| SC-008 | 10-participant owner-boundary protocol below |  | Implemented responsive owner/security screens |  |  | `pending` |
| SC-009 | Controlled-clock rotation matrix below |  | Both policies; exact eight states |  |  | `pending` |
| SC-010 | Six migration fault checkpoints below |  | Restart/fault-injection clock and config |  |  | `pending` |

### SC-002 bootstrap usability protocol

At least 20 clean-install trials by at least 5 representative operators are
required. Record every trial, including failures:

| Requirement/criterion | Trial | Command or test path | Candidate SHA | Controlled clock/configuration | Credential verified | Download consumed once | Offline confirmation | Final counts | Raw evidence/artifact | Reviewer/date | Status |
| --- | ---: | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| SC-002 | 01 |  |  |  |  |  |  |  |  |  | `pending` |
| SC-002 | 02 |  |  |  |  |  |  |  |  |  | `pending` |
| SC-002 | 03 |  |  |  |  |  |  |  |  |  | `pending` |
| SC-002 | 04 |  |  |  |  |  |  |  |  |  | `pending` |
| SC-002 | 05 |  |  |  |  |  |  |  |  |  | `pending` |
| SC-002 | 06 |  |  |  |  |  |  |  |  |  | `pending` |
| SC-002 | 07 |  |  |  |  |  |  |  |  |  | `pending` |
| SC-002 | 08 |  |  |  |  |  |  |  |  |  | `pending` |
| SC-002 | 09 |  |  |  |  |  |  |  |  |  | `pending` |
| SC-002 | 10 |  |  |  |  |  |  |  |  |  | `pending` |
| SC-002 | 11 |  |  |  |  |  |  |  |  |  | `pending` |
| SC-002 | 12 |  |  |  |  |  |  |  |  |  | `pending` |
| SC-002 | 13 |  |  |  |  |  |  |  |  |  | `pending` |
| SC-002 | 14 |  |  |  |  |  |  |  |  |  | `pending` |
| SC-002 | 15 |  |  |  |  |  |  |  |  |  | `pending` |
| SC-002 | 16 |  |  |  |  |  |  |  |  |  | `pending` |
| SC-002 | 17 |  |  |  |  |  |  |  |  |  | `pending` |
| SC-002 | 18 |  |  |  |  |  |  |  |  |  | `pending` |
| SC-002 | 19 |  |  |  |  |  |  |  |  |  | `pending` |
| SC-002 | 20 |  |  |  |  |  |  |  |  |  | `pending` |

Acceptance: at least 19 trials complete within 300 seconds after prerequisites,
with credential verification, one-time download, offline confirmation, and
final `1/1`; all pre-confirmation states are `0/0`, and at least 5 operators
have at least one recorded trial.

### SC-008 owner-boundary usability protocol

Record pseudonymous participants `P01`–`P10` and whether each independently
identifies the single-owner boundary, sessions/devices, recovery readiness, and
the unreachable-device erasure limitation.

| Requirement/criterion | Participant | Command or test path | Candidate SHA | Controlled clock/configuration | Four concepts correct | Facilitator explained | Raw evidence/artifact | Reviewer/date | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| SC-008 | P01 |  |  |  |  |  |  |  | `pending` |
| SC-008 | P02 |  |  |  |  |  |  |  | `pending` |
| SC-008 | P03 |  |  |  |  |  |  |  | `pending` |
| SC-008 | P04 |  |  |  |  |  |  |  | `pending` |
| SC-008 | P05 |  |  |  |  |  |  |  | `pending` |
| SC-008 | P06 |  |  |  |  |  |  |  | `pending` |
| SC-008 | P07 |  |  |  |  |  |  |  | `pending` |
| SC-008 | P08 |  |  |  |  |  |  |  | `pending` |
| SC-008 | P09 |  |  |  |  |  |  |  | `pending` |
| SC-008 | P10 |  |  |  |  |  |  |  | `pending` |

Acceptance: at least 9 participants answer all four correctly without
facilitator explanation.

## Exact recovery state-pair evidence

| Requirement/criterion | State pair/scenario | Command or test path | Candidate SHA | Controlled clock/configuration | Raw evidence/artifact | Reviewer/date | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| FR-015/SC-005 | `provisional/prepared` | Recovery-kit integration test |  |  |  |  | `pending` |
| FR-015/SC-005 | `provisional/downloadable` | Recovery-kit download contract test |  |  |  |  | `pending` |
| FR-015/SC-005 | `provisional/download-consumed` | Bootstrap download/confirmation test |  |  |  |  | `pending` |
| FR-015/SC-005 | `active/confirmed` | Bootstrap/replacement confirmation test |  |  |  |  | `pending` |
| FR-016/SC-005 | `superseded/confirmed` | Replacement-kit epoch test |  |  |  |  | `pending` |
| FR-018/SC-005 | `revoked/confirmed` | Revocation/recovery denial test |  |  |  |  | `pending` |
| FR-016/SC-005 | `rejected/expired` | Expiry/regeneration test |  |  |  |  | `pending` |

No other authorization/delivery pair is valid; `provisional/expired` is
invalid, and active confirmed kits do not expire by age.

## Controlled-clock rotation evidence

The matrix contains exactly the required eight policy states for each policy:
pre-due, due, overdue-within-grace, emergency, write-block, in-progress,
complete, and failed. It is intentionally empty.

| Requirement/criterion | Policy | State | Command or test path | Candidate SHA | Controlled clock/configuration | Reads safe? | New protected write result | Raw evidence/artifact | Reviewer/date | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| FR-025–FR-027/SC-009 | wrapping-key | pre-due | `packages/domain/tests/rotation-policy.clock.spec.ts` |  |  |  |  |  |  | `pending` |
| FR-025–FR-027/SC-009 | wrapping-key | due | `packages/domain/tests/rotation-policy.clock.spec.ts` |  |  |  |  |  |  | `pending` |
| FR-025–FR-027/SC-009 | wrapping-key | overdue-within-grace | `packages/domain/tests/rotation-policy.clock.spec.ts` |  |  |  |  |  |  | `pending` |
| FR-025–FR-027/SC-009 | wrapping-key | emergency | `packages/domain/tests/rotation-policy.clock.spec.ts` |  |  |  |  |  |  | `pending` |
| FR-025–FR-027/SC-009 | wrapping-key | write-block | `packages/domain/tests/rotation-policy.clock.spec.ts` |  |  |  |  |  |  | `pending` |
| FR-025–FR-027/SC-009 | wrapping-key | in-progress | `packages/domain/tests/rotation-policy.clock.spec.ts` |  |  |  |  |  |  | `pending` |
| FR-025–FR-027/SC-009 | wrapping-key | complete | `packages/domain/tests/rotation-policy.clock.spec.ts` |  |  |  |  |  |  | `pending` |
| FR-025–FR-027/SC-009 | wrapping-key | failed | `packages/domain/tests/rotation-policy.clock.spec.ts` |  |  |  |  |  |  | `pending` |
| FR-025–FR-027/SC-009 | data-key | pre-due | `packages/domain/tests/rotation-policy.clock.spec.ts` |  |  |  |  |  |  | `pending` |
| FR-025–FR-027/SC-009 | data-key | due | `packages/domain/tests/rotation-policy.clock.spec.ts` |  |  |  |  |  |  | `pending` |
| FR-025–FR-027/SC-009 | data-key | overdue-within-grace | `packages/domain/tests/rotation-policy.clock.spec.ts` |  |  |  |  |  |  | `pending` |
| FR-025–FR-027/SC-009 | data-key | emergency | `packages/domain/tests/rotation-policy.clock.spec.ts` |  |  |  |  |  |  | `pending` |
| FR-025–FR-027/SC-009 | data-key | write-block | `packages/domain/tests/rotation-policy.clock.spec.ts` |  |  |  |  |  |  | `pending` |
| FR-025–FR-027/SC-009 | data-key | in-progress | `packages/domain/tests/rotation-policy.clock.spec.ts` |  |  |  |  |  |  | `pending` |
| FR-025–FR-027/SC-009 | data-key | complete | `packages/domain/tests/rotation-policy.clock.spec.ts` |  |  |  |  |  |  | `pending` |
| FR-025–FR-027/SC-009 | data-key | failed | `packages/domain/tests/rotation-policy.clock.spec.ts` |  |  |  |  |  |  | `pending` |

## Security-gate evidence

Each security category is a separate row and artifact. All are blocking; the
aggregate gate fails for failed, missing, skipped, cancelled, stale, or
artifact-less results.

| Requirement/criterion | Security check and planned command/action | Candidate SHA | Controlled clock/configuration | Blocking severity/policy | Raw evidence/artifact | Reviewer/date | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| FR-033/FR-034/SC-007 | `dependency-vulnerability-audit`: `pnpm audit --audit-level=high --prod` |  |  | High/critical, failure, or unavailable audit blocks | `dependency-audit.json` |  | `pending` |
| FR-033/FR-034/SC-007 | `secret-scan`: `pnpm security:secrets` or full-SHA-pinned scanner action |  |  | Any detected secret or failure blocks | `secret-scan.sarif` |  | `pending` |
| FR-033/FR-034/SC-007 | `static-security-analysis`: `pnpm security:static` or full-SHA-pinned CodeQL/Semgrep action |  |  | High-confidence finding or failure blocks | `static-security.sarif` |  | `pending` |
| FR-033/FR-034/SC-007 | `container-vulnerability-scan`: `trivy image --severity HIGH,CRITICAL --exit-code 1` before publication |  |  | High/critical finding or failure blocks | `container-scan.sarif` |  | `pending` |
| FR-033/FR-034/SC-007 | `license-policy`: `pnpm security:licenses` |  |  | Denied license, missing attribution, or failure blocks | `license-policy.json` |  | `pending` |

Third-party actions must be pinned by full commit SHA in implementation.
Manual `workflow_dispatch` diagnostics may collect these artifacts but cannot
publish.

## Workflow/release evidence

| Requirement/criterion | Candidate type | Command or test path | Candidate SHA | Controlled clock/configuration | Required checks and failure behavior | Raw evidence/artifact | Reviewer/date | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| FR-033/FR-034/SC-007 | branch | `.github/workflows/ci.yml` push to non-main |  |  | Single aggregate gate; any missing/skipped/cancelled/failed/stale result blocks merge |  |  | `pending` |
| FR-033/FR-034/SC-007 | pull request | `.github/workflows/ci.yml` pull_request |  |  | Single aggregate gate; no duplicate gate |  |  | `pending` |
| FR-033/FR-034/SC-007 | manual diagnostic | `.github/workflows/ci.yml` `workflow_dispatch` |  |  | Gate-only; publication is impossible regardless of result |  |  | `pending` |
| FR-033/FR-034/SC-007 | main/version tag | `.github/workflows/release.yml` reusable call to local `ci.yml` |  |  | Verify `candidate_sha == github.sha`; publication requires successful current gate |  |  | `pending` |

## Migration fault evidence

| Requirement/criterion | Fault checkpoint | Command or test path | Candidate SHA | Controlled clock/configuration | Raw evidence/artifact | Reviewer/date | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| FR-028/FR-029/SC-010 | before backfill | migration fault-injection test |  |  |  |  | `pending` |
| FR-028/FR-029/SC-010 | during backfill | migration fault-injection test |  |  |  |  | `pending` |
| FR-028/FR-029/SC-010 | after verification | migration fault-injection test |  |  |  |  | `pending` |
| FR-028/FR-029/SC-010 | after plaintext-write stop | migration fault-injection test |  |  |  |  | `pending` |
| FR-028/FR-029/SC-010 | during encrypted-read cutover | migration fault-injection test |  |  |  |  | `pending` |
| FR-028/FR-029/SC-010 | during scrub/drop cleanup | migration fault-injection test |  |  |  |  | `pending` |

## Rollback image-selection evidence

| Requirement/criterion | Command or test path | Candidate SHA | Controlled clock/configuration | Raw evidence/artifact | Reviewer/date | Status |
| --- | --- | --- | --- | --- | --- | --- |
| FR-032/SC-007 | Immutable Compose image selection and compatible prior-image rollback inspection |  |  | Current/prior refs and digests, pre/post data digests, health, rollback result |  | `pending` |

Backup scheduling, backup transfer, and general restore orchestration are
excluded and remain owned by feature 006. Final V1 cross-feature hardening and
validation remain owned by feature 007; this ledger covers feature 002's
baseline secure delivery foundation only.
