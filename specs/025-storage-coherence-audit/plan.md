# Implementation Plan: Storage privacy and code coherence audit

**Branch**: `codex/025-storage-coherence-audit` | **Date**: 2026-09-05 |
**Spec**: [spec.md](spec.md)

## Summary

Enforce existing attachment privacy and durability through the real composed
runtime, migrate historical readable storage after a verified 024 full backup,
and correct proven recovery/UI/test coherence defects. Publish an evidence-based
audit across the declared boundaries. Follow [research.md](research.md), the
[data model](data-model.md), and the [boundary contract](contracts/storage.md).

## Technical Context

**Language/Version**: TypeScript and exact repository-pinned Bun 1.4.0.

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
