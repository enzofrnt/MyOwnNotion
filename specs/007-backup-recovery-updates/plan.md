# Implementation Plan: Backup, Recovery and Updates

**Branch**: `feat/007-backup-recovery-updates` | **Date**: 2026-08-18 | **Spec**: [spec.md](./spec.md)

## Summary

A backup is the existing canonical export, plus the file bytes, plus the
versions needed to read it back, sealed as one archive and verified twice. A
restoration is that archive applied to an empty workspace behind the same
guards. An update is a version change that refuses to migrate until a verified
backup for the version it is leaving exists.

The load-bearing decision is **not to invent a second serialization**. Feature
001 already produces a canonical export with a manifest and a checksum per
element, and it is already exercised by contract tests. A backup format of its
own would be a second description of the same workspace, and the two would
disagree the first time either changed.

## Technical Context

**Language/Version**: TypeScript on Node.js 24, strict.

**Primary Dependencies**: none new for the format — `@myownnotion/domain`'s
canonical export, `@myownnotion/blob-store` for file bytes, the existing
envelope crypto from feature 002. A Google Drive client is added behind the
destination boundary and is the only new third-party dependency.

**Storage**: PostgreSQL for backup records and their verification results; the
filesystem for staging an archive before transfer; the remote destination for
the copy that matters.

**Testing**: Vitest for the pure rules and the repositories, contract tests for
the administrative commands, an integration test that restores into a
disposable database, and a Playwright journey for what the owner sees.

**Target Platform**: the single-owner Linux server this product ships as.

**Project Type**: web service plus administrative CLI.

**Performance Goals**: a nightly backup must not make the workspace unusable
while it runs. Streaming rather than buffering is the constraint that follows.

**Constraints**: the archive must be encrypted before any byte leaves the
machine; nothing in it may carry a secret; a restoration must be interruptible
without leaving a workspace that claims to be healthy.

**Scale/Scope**: one owner, one workspace, backups measured in gigabytes because
files are included.

## Constitution Check

| Principle | How this feature meets it |
| --- | --- |
| I. User Ownership and Local Resilience | This *is* the principle: the owner can leave with their data and can survive losing the machine. The archive is documented and readable without this application. |
| III. Incremental, Verifiable Delivery | Four user stories, each independently testable; the local destination makes every backup requirement verifiable without an account or a network. |
| IV. Privacy and Security by Default | Encrypted before transfer; no secret, key or session in the archive, the manifest, the logs or the stored results — asserted by a test that greps the artefacts. |
| V. Simple, Modular Architecture | One destination boundary, one archive format, and the format is the existing export rather than a new one. |
| VII. Reproducible Toolchains | CI restores reference backups across supported migration paths, which is what keeps FR-024 honest over time. |

**No violations.** One thing worth naming: adding a Google Drive client brings a
third-party dependency into a product that has almost none. It is confined to a
single module behind the destination interface, and every test uses the local
destination instead — so the dependency is never on the path that proves the
feature works.

## Project Structure

### Documentation (this feature)

```
specs/007-backup-recovery-updates/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── contracts/
│   ├── backup-archive.md
│   └── admin-commands.md
├── quickstart.md
└── tasks.md
```

### Source Code (repository root)

```
packages/domain/src/backup/
├── archive-manifest.ts     # what an archive claims, and how to check it
├── retention.ts            # which backups may be deleted, and which may not
└── compatibility.ts        # whether this installation can read that backup

packages/database/src/repositories/
└── backup-repository.ts    # backups, verification results, restoration attempts

apps/api/src/backup/
├── backup-service.ts       # produce, verify, transfer
├── restore-service.ts      # the six pre-flight steps, then the writing
├── destinations/
│   ├── destination.ts      # the boundary
│   ├── filesystem.ts       # the one every test uses
│   └── google-drive.ts     # the one the canvas names
├── schedule.ts             # 04:00, and the staleness warning
└── update-guard.ts         # no migration without a verified backup

apps/api/src/admin/commands/
├── backup-run.ts
├── backup-verify.ts
├── restore-test.ts
└── version-inspect.ts

apps/web/src/features/backup/
├── backup-panel.tsx        # when, whether verified, and the warning
└── restore-rehearsal.tsx   # the invitation, the date, the result
```

## Phase 0 — Research

See [research.md](./research.md). Five decisions, the first two expensive to
reverse:

1. the archive is the canonical export plus files, not a new format;
2. consistency comes from the change cursor, not from a snapshot mechanism;
3. the destination boundary is four small operations, chosen so a filesystem
   implementation is not a lie;
4. a test restoration writes to a real disposable database, because a rehearsal
   that does not write proves nothing about writing;
5. the update guard runs at startup, before the migrator, because that is the
   only place a container image change is observable.

## Phase 1 — Design

- [data-model.md](./data-model.md): three new tables — `backups`,
  `backup_verifications`, `restoration_attempts` — and why the verifications are
  separate rows rather than columns.
- [contracts/backup-archive.md](./contracts/backup-archive.md): the archive
  layout, the manifest, and what a reader needs to know to open it without this
  application.
- [contracts/admin-commands.md](./contracts/admin-commands.md): the four
  commands, their exit codes, and which of them refuse to act without
  confirmation.
- [quickstart.md](./quickstart.md): produce a backup, verify it, rehearse a
  restoration, and read the result.

## Complexity Tracking

| Addition | Why it is not avoidable | What was rejected |
| --- | --- | --- |
| Three tables | A backup, its verifications and a restoration attempt have different lifetimes and different failure modes. | One table with nullable columns, which would make "verified after transfer" and "verified after creation" indistinguishable when one is absent. |
| A Google Drive client | The canvas names it as the first destination. | Shipping only the local destination, which would meet every test and none of the point. |
| A scheduler | FR-005 is a time, and time has to come from somewhere. | Reusing the rotation scheduler, which evaluates daily for a different reason and would tie two unrelated schedules together. |
