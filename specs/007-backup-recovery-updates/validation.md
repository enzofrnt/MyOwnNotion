# Validation: Backup, Recovery and Updates

**Date**: 2026-08-19
**Branch**: `feat/007-backup-recovery-updates`

This document records evidence against every requirement. A passing targeted
test is useful evidence for the feature; the repository-wide pre-push gate is
recorded separately so it cannot be confused with targeted validation.

## Functional requirements

| Requirement | Status | Evidence |
| --- | --- | --- |
| FR-001 complete portable workspace | met | `restore.integration.spec.ts` and `reference-backups.integration.spec.ts` restore every canonical item, placement, relationship, revision and file; the canonical export includes page content, file metadata and bytes, favourites, offline intent and the currently defined workspace settings. |
| FR-002 integrity manifest | met | `backup-manifest.spec.ts` and `backup-archive.contract.spec.ts`; the TAR contains one digested canonical export and one digest/length entry per content-addressed file, and rejects missing, duplicate, changed or undocumented content. |
| FR-003 application/schema/record versions | met | `backup-archive.contract.spec.ts`; the application build identity, schema version and encrypted-record format version are present in `manifest.json` and the backup row. |
| FR-004 no clear-text secret | met | `backup-archive.contract.spec.ts` decrypts the produced archive before searching for session, key and recovery material; none is present. |
| FR-005 daily 04:00 schedule | met | `backup-schedule.spec.ts` covers the configured zone, late startup and both daylight-saving changes; `server.ts` starts the schedule. |
| FR-006 one consistent moment | met | `buildManifest` uses a read-only PostgreSQL `REPEATABLE READ` transaction and records its change cursor; immutable file bytes are then selected by the digests read in that view. |
| FR-007 encrypt before transfer | met | `BackupService` stages the portable TAR locally, streams it through AES-256-GCM, removes the plaintext stage and gives only the sealed file to the destination; the destination-content contract finds no readable workspace content. |
| FR-008 verify twice | met | `backup-archive.contract.spec.ts`; the sealed local stage is read back and hashed, then the stored destination object is independently read and hashed. A same-length remote mutation is refused, and a destination interrupted after receiving bytes records the local pass and remote failure instead of losing the run. |
| FR-009 replaceable destination | met | `BackupDestination` exposes only `put`, `list`, `read` and `delete`; filesystem and Google Drive pass the same boundary suite in `backup-destinations.spec.ts`. |
| FR-010 configurable 90-day retention | met | `.env.example`, `backup-config.ts` and `retention.spec.ts`. |
| FR-011 keep a newer verified copy | met | `retention.spec.ts` proves the newest verified remote backup is never selected for deletion and no deletion occurs when no verified remote copy exists. |
| FR-012 visible warning after 26 hours | met | `retention.spec.ts`, `backup-panel.spec.ts` and `backup.spec.ts`; the workspace-level alert appears without first opening the backup screen. |
| FR-013 observable backups/verifications | met | `/v1/backups/status`, the workspace and backup-panel UI, `backup run`, and `backup verify`. The status distinguishes the newest attempt's after-creation and after-transfer results from the last successful destination verification, so a fresh transfer failure is visible before the stale threshold. |
| FR-014 isolated/empty/new-machine restore | met | `restore.integration.spec.ts` and the committed reference-backup test use a migrated disposable database and a new blob root. |
| FR-015 six destructive preflight steps | met | `restore-guards.spec.ts` asserts key, integrity, compatibility, scope, safety backup and confirmation in that order, with no write before they pass. |
| FR-016 incompatible version refusal | met | `backup-manifest.spec.ts` and `restore-guards.spec.ts` name both installed and required format versions before writes. |
| FR-017 interrupted restore is unhealthy | met | `restoration-health.spec.ts`; an unfinished attempt makes `/health` return 503 with the documented resume/rollback action. |
| FR-018 rehearsal cannot alter live data | met | The rehearsal accepts only a disposable-workspace factory; `restore.integration.spec.ts` and `backup.spec.ts` confirm live content is unchanged. |
| FR-019 retain safe rehearsal result | met | `restoration_attempts` stores date, outcome and count only; `backup-panel.spec.ts` asserts no secret-shaped field is exposed. |
| FR-020 monthly rehearsal invitation | met | `backup-panel.spec.ts` and `backup.spec.ts`; no prior success or a success older than one month produces the invitation. |
| FR-021 detect version before migration | met | Both migration entry points call `runGuardedMigrations`; published images embed the exact immutable `sha-<commit>` identity, asserted by release contract tests. |
| FR-022 backup version being left first | met | `update-guard.integration.spec.ts`; the verified `pre-update` row records `applicationVersion`, `supersededByVersion` and the matching backup id before the pending migration runs. |
| FR-023 failed backup stops update | met | The same integration test corrupts destination read-back and proves the pending migration table and migration record remain absent. |
| FR-024 migration safety/observability | met | Reviewed numbered SQL remains the only migration source; the existing migration inventory, transactional migration runner and guarded entry points provide idempotence and logs. |
| FR-025 rollback provenance | met | The installation retains the exact previous immutable image tag and matching backup id; that backup retains the old schema and encrypted-record format. `version inspect` reports all four values. |
| FR-026 health plus integrity before success | met | The migration job validates no pending migration, no unfinished restore and a fresh canonical export before committing the version. Compose requires that job to succeed and the API healthcheck to pass before the dependent web service starts. |
| FR-027 administrative capabilities | met | `backup run`, `backup verify`, `restore test`, `restore apply`, `version inspect` and the guarded migration entry point are wired through the host-local CLI. |
| FR-028 help, exit codes, non-interactive use | met | `admin --help`, command parser/renderer contracts and `restore-commands.spec.ts`; JSON mode is non-interactive and preserves stable exit codes. |
| FR-029 destructive simulation/confirmation | met | `restore apply --dry-run` writes nothing; `--yes` is explicit automation consent and a non-TTY invocation without it is refused. |

## Success criteria

| Criterion | Status | Evidence |
| --- | --- | --- |
| SC-001 full restore | met | Live integration and committed reference fixture restore every entity and file named by the archive. |
| SC-002 unattended daily backup | met | Scheduler unit suite plus server wiring. |
| SC-003 nothing readable leaves | met | Destination contract reads the transferred object and finds no workspace content. |
| SC-004 rehearsal leaves live bytes unchanged | met | Restore integration and Chromium rehearsal journey. |
| SC-005 failed update backup runs no migration | met | `update-guard.integration.spec.ts`. |
| SC-006 incompatible restore writes nothing | met | Ordered preflight contract. |
| SC-007 warning within one hour | met | An open workspace refreshes backup status every 15 minutes; domain and Chromium tests cover the 26-hour threshold. |
| SC-008 no secret in archive/manifest/result | met | Decrypted-archive negative contract, safe result models and redacted command output. |
| SC-009 reference restores in CI | met | `reference-backups` is an unconditional required CI job and restores `tests/fixtures/backups/v1-schema1.tar`. |

## Edge cases and operational evidence

- Concurrent scheduled/manual runs are coordinated with a transaction-scoped
  PostgreSQL advisory lock. The loser is refused with a retryable reason before
  creating a staging file (`backup-archive.contract.spec.ts`).
- Archive construction writes one file payload at a time and encryption is
  streamed into the sealed stage. Memory follows the canonical JSON plus the
  largest individual file, not the total backup size.
- A failed archive or encryption write removes both plaintext and sealed partial
  stages. The destination implementations likewise remove partial uploads.
- A destination interrupted after receiving bytes leaves a backup row with a
  passed after-creation verification and a failed after-transfer verification.
  It is not counted as remotely verified, is visible immediately in the backup
  panel, and cannot cause retention to delete the previous verified copy. When
  `put` completed but read-back failed, its destination identity is retained so
  the administrative command can re-check it rather than orphaning the object.
- The Google Drive boundary is covered by a recorded HTTP interaction. A real
  account smoke test remains a release operation because credentials are not
  available to CI and are intentionally never stored in the repository.

## Performance reference

On the local development machine, the real encrypted filesystem path with
1,000 canonical items measured:

| Operation | Result |
| --- | ---: |
| Backup, including TAR construction, streaming encryption, transfer and both verifications | 78.6 ms |
| Restore into a migrated disposable PostgreSQL database | 2,285.3 ms |
| Sealed archive size | 810,012 bytes |

These figures are observations, not release thresholds. The test enforces the
30-second budget for each operation and checks all 1,000 items after restore.

## Executed checks

- Interrupted-transfer/API/panel regression run: **3 files, 30 tests passed**.
- Feature-focused Vitest run: **17 files, 142 tests passed**.
- Chromium backup journeys: **2 passed**.
- Chromium backup accessibility and 320 px journeys: **2 passed**.
- Cross-browser keyboard-navigation stress run: **25 executions passed**
  across all five browser projects.
- Workspace TypeScript check: **passed**.
- Repository-wide `pnpm checks:local`: **passed** on 2026-08-19, including
  coverage (**165 files; 2,159 tests passed; 90.05% statements and lines**),
  database integration (**27 files; 292 tests**), migrations (**6 tests**),
  contracts (**68 files; 963 tests**), all five desktop/mobile E2E projects in
  **832 seconds**, application builds, API and web images for `linux/amd64` and
  `linux/arm64`, security audits, and the Compose contract check.

## Unfinished

No specification requirement is knowingly unfinished. The live-account Google
Drive smoke test is intentionally operational release evidence rather than a
repository or CI requirement.
