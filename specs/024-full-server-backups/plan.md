# Implementation Plan: Complete server backups

**Branch**: `codex/024-full-server-backups` | **Date**: 2026-09-05 | **Spec**: [spec.md](spec.md)

## Summary

Introduce a complete PostgreSQL 18 custom dump and durable file recovery artifact,
streamed through authenticated encryption, independent of current-schema content
repositories. Protect migrations before their first mutation, keep verified local
copies, schedule from successful protection and restore into an empty target.
Canvas traceability: sections 4, 28 and 30–34; feature 007 retains the portable format.

## Technical Context

**Language/Version**: TypeScript strict; Bun 1.4.0; PostgreSQL 18 tools.
**Primary Dependencies**: Existing `node:crypto`, streams, filesystem, child_process,
database connection and backup destination interfaces; no new service.
**Storage**: PostgreSQL application database, configured blob root and backup root;
versioned encrypted full archives and durable receipts independent of DB catalogue.
**Testing**: Vitest unit/integration/contracts, real PG18 dump/restore, failure and
concurrency tests, Playwright backup settings, image/Compose runtime verification.
**Target Platform**: Linux amd64/arm64 production; native development and CI with
matching PostgreSQL client tools. Restore may cross host architectures.
**Constraints**: No decrypted dump staging, no secrets in argv/logs, no backup
inside blob root, no live-target restore, no skipped required gate.
**Scale/Scope**: Streaming database and file bytes; work scales with backup size,
not in-memory materialization of all records or file contents.

## Constitution Check

Before research and after design: PASS. I/IV preserve offline work and encrypted
recovery with external keys; II/VIII keep 024 canonical and align canvas/007;
III requires actual restoration/failure evidence and full delivery gates; V adds
no separate backup service; VI keeps outcomes in dedicated settings with clear
states; VII ships tools in the real pinned Bun runtime. No exception is requested.

## Project Structure

- `packages/domain/src/backup/full-manifest.ts`: versioned manifest validation.
- `apps/api/src/backup/full/{crypto,archive,postgres,source,service,restore,receipts}.ts`:
  stream framing/authentication, external process boundary, source inspection,
  backup orchestration and independent restore/catalogue.
- `apps/api/src/backup/full/locks.ts`: schema-independent shared/exclusive advisory locks.
- `apps/api/src/routes/uploads.ts`, blob GC/storage integration: coherent file boundary.
- `apps/api/src/backup/guarded-migration.ts`: full backup before any mutation.
- `apps/api/src/backup/schedule.ts`, `server.ts`: daily success, retry and catch-up.
- `apps/api/src/admin/full-backup-commands.ts`: route before current context creation.
- `apps/api/src/routes/backups.ts`, contracts and web backup panel: distinct full status.
- `docker/api.Dockerfile`, `.env.example`, `compose.yaml`, CI runtime setup:
  matching PG18 tools, configurable time zone and durable backup directory.

## Data ownership and coherence

Full archives preserve the entire application database, including otherwise
unknown tables. Database identity and installed-version inspection use catalogue
queries only. Export a repeatable-read snapshot and pass it to pg_dump. Acquire
locks in one documented order: run/migration coordination, file mutation/deletion,
then upload row locks. The backup freezes mutable prefix changes while taking
its snapshot/copy and keeps referenced immutable blobs from deletion through copy.
Never silently swallow a missing committed file or permission/read failure.

The full archive and authenticated manifest are self-contained. Backup success
receipts may accelerate status but cannot be required for restoration. Keep
portable page-operation archive retention evidence until equivalent full-backup
coverage is explicitly established; do not compact operational history merely
because a full dump exists.

## Migration and restore boundaries

The guard inspects without creating current tables, backs up nonempty sources,
then invokes migrations and integrity checks before recording the target version.
Use the installed version when present, otherwise V0/unknown plus actual migrations.
A reviewed additive migration records known installed commit/image and a
separate previous full-archive identity. Do not insert full artifacts into the
portable backup catalogue or make old-schema safety depend on this migration.

Restore first authenticates the entire artifact, validates format/compatibility,
source installation identity, target emptiness and paths. Lineage records remain
in the complete SQL dump and are compared in the all-table recovery proof.
Then it streams a second verified
read to pg_restore and writes files under an isolated staging directory. Reject
active database identity, existing content, symlinks, traversal and extra entries.
Use single-transaction restore without `--clean`; an interrupted multi-resource
restore retains a durable incomplete marker and cannot pass health checks.
Before service resumes, explicit recovery activation invalidates historical
sessions/trust while preserving device identity and newer offline recovery paths.
The local `restore full activate --yes` command invalidates sessions and marks
previously active/pending devices `reauthorization-required`; already revoked
devices remain revoked. It authenticates a complete marker bound to the target
PostgreSQL cluster/database before removing the startup barrier. Fresh owner
login uses the existing binding to reauthorize each device explicitly.
Activation also invalidates historical bootstrap capabilities, pending challenges
and download tokens; provisional recovery kits expire while active kits retain
their independent recovery role. Full backups from another PostgreSQL major are
rejected by the manifest reader before any target write.

## Scheduling, remote copies and status

Calculate the most recent due local calendar deadline (04:00 default) in the
validated IANA zone. Last verified full backup, not attempt start or portable
export, satisfies it. Retry a failed run on the five-minute tick; catch up at boot.
Use interprocess locking and durable outcomes to avoid duplicate concurrent runs.
Keep local success on remote failure, retry remote protection and preserve the
latest verified artifact through retention. Expose full/local/remote/portable
states separately; 26-hour stale protection is based on complete backups.

## UI and validation

Load the [UI quality skill](../../.agents/skills/ui-quality/SKILL.md) for backup
settings changes. Cover empty, recent, stale, running, local-only, remote-failed,
corrupt and incomplete-rehearsal states, keyboard and narrow layout. Verification
belongs in actual behavior/restore tests, not copied style assertions.

Implement US1's format and real restore first, US2 guard second, US3 scheduling
third, then US4 inspection/settings. Follow the current full `checks:local` gate,
container Trivy when runtime changes, every PR check and post-merge main CI.


## Storage audit follow-up — feature 025

Feature 025 follows delivery of this feature. Its historical storage transition requires a verified full pre-update artifact. Full inventory becomes format-aware for encrypted completed/upload chunks and quarantine while retaining legacy-schema recovery; complete archive format remains opaque SQL plus durable files.

See the [canonical plan](../025-storage-coherence-audit/plan.md) and
[implementation tasks](../025-storage-coherence-audit/tasks.md). This reference
does not mark that follow-up implemented or delivered.
