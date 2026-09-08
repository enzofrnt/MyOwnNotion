# Implementation Plan: Notion import CLI

**Branch**: `codex/028-notion-import` | **Date**: 2026-09-05 | **Spec**: [spec.md](spec.md)

## Summary and technical context

Bun1.4/TypeScript, existing Fastify-independent canonical mutation services,
PostgreSQL/Drizzle and protected record/file services. A standalone local CLI
entrypoint is preview-only by default and opens no target connection until
explicit apply. No new HTTP/UI surface. Native Markdown/CSV and converted
Obsidian directories normalize to one immutable import plan.

## Constitution check

All eight principles considered: one independent spec, source ownership,
canonical offline/sync projection, private encrypted storage, bounded untrusted
input, incremental tests, Bun-only runtime and recorded product direction.
No user UI is added, so CLI/API tests cover the changed journey; the integration
branch retains the full local delivery gates. No exception is requested.

## Architecture

- `apps/api/src/imports/notion/source.ts`: bounded immutable source inventory.
  Directories use lstat, realpath containment and no-follow file handles; ZIP
  central-directory metadata is inspected before any decompression. Yauzl lazy
  entry processing validates sizes; reject symlink/special/encrypted entries,
  escapes, normalization collisions and excessive compression ratios. Archives
  are read in memory, never extracted as plaintext on the target filesystem.
- `model.ts`, `plan.ts`, `markdown.ts`: normalize native CSV/Markdown, YAML
  frontmatter and Obsidian Bases/wikilinks. Maintained parsers are
  mdast-util-from-markdown with GFM, csv-parse and yaml (alias budget zero).
  No evaluation of YAML tags, Bases formula expressions or embedded HTML.
  Unsupported Markdown is preserved as inert source text plus original file.
- IDs derive from a caller-visible import UUID and normalized source identity;
  operation IDs are deterministic. The snapshot and plan digests bind resume.
  All files, local links, property conversions, memberships and unsupported
  settings receive report records. Summary output contains counts/safe codes;
  explicit JSON report contains owner-directed source paths and mappings.
- `apply.ts`: obtain a PostgreSQL advisory lock per import job; validate target
  ready state, migrations, external key and rotation/maintenance guards. Reuse
  assertFullRestoreActivated at target open and before every operation, including
  resumed jobs that retain their first backup. Take
  FullBackupService024 verified snapshot before every new job, including an
  empty workspace. This covers concurrent owner writes without an occupancy
  check race; resumed jobs retain their first verified receipt.
- Submit ordinary create/document/definition/value commands through
  submitCanonicalMutation. File originals and attachments use existing
  ProtectedFileService.ingest and the shared publishCanonicalFile finalization
  used by ordinary resumable uploads,
  keeping acceptedWriteGuards, revisions and canonical notifications. Protect
  checkpoints in the same transaction as accepted operations.
- ProtectedRecordService entity `import.job` stores fingerprint, backup reference
  and completion; `import.provenance` stores the full report, `import.step` one
  accepted operation, and `import.head` each last imported revision. Separate
  operation records avoid repeatedly rewriting a growing checkpoint. Source
  heads use026 definitionRevisionId; editorial pages use currentRevisionId. Original source files are encrypted canonical
  attachments in the dedicated import root so complete portable exports retain
  every unsupported source representation. No SQL migration expected;0018 is
  reserved only if concrete storage evidence requires it.
- Database creation requires026's independent source and hostPageId embedding.
  Entry pages use database.entry.create and definitionRevisionId for updates.
  Infer only safely typed scalar values; preserve ambiguous values as text.
  Property labels, status option labels and view order follow exported data.
  Persons are ordinary values. Absent view/preview/task-role settings are marked
  missing; a baseline table is labeled as an import default.
- `cli.ts`: `--source PATH [--id UUID] [--json] [--dry-run] [--apply]`.
  Apply requires explicit import ID and configured DATABASE_URL/blob/key paths;
  no fallback to a developer database. Dry-run overrides apply. Error output
  contains only fixed codes; a new ID is an explicit separate import, never an
  implicit title-based merge. Compile as `dist/imports/notion/cli.js` and expose
  root `import:notion` command.

## Bounds and recovery

Initial documented limits:10,000 source entries,32 path levels,8 MiB per text
file,64 MiB per file/archive,256 MiB expanded total and100:1 compression ratio.
No network fetching; unsupported nested archives stay opaque attachments.
Snapshot bytes are immutable for the run; resume refuses changed fingerprints.
New imported content is grouped under one root. Committed progress is durable;
replay never overwrites a completed operation or newer owner edits. Safety
backup is preserved independently from later import failure.

## Validation

Synthetic native ZIP/CSV and Obsidian fixtures; malformed CSV/YAML/archives,
symlink/traversal/bomb/normalization conflicts; exact reports and source hashes;
encrypted disposable integration for ordinary readback/files/database026,
backup-before-write failure, interruption/replay and conflicting fingerprints.
The real folder is inventory/preview only, with no private fixtures committed.

## Implementation decisions

Bases displays share a source only when their normalized exported membership
reference matches. Identical current member sets are insufficient. Each display
retains its own first table name and property order. Other exported settings
are reported and kept in the encrypted original; missing original Notion
settings are listed separately. No0018 migration was required.

The parser accounts for empty source directories as well as files. Pages added
for missing CSV bodies or display hosts are identified as synthesized in the
report. Detailed reports expose canonical page/file parents, memberships and
property conversions intentionally to the owner; ordinary output uses counts.

## Separate-process change notification

The CLI commits the ordinary durable change feed but its in-process notifier
cannot reach the API process. The existing SSE heartbeat therefore verifies
revocation, reads the canonical current sequence, and announces an advanced
cursor only when it exceeds the latest announced value. Local notifications
keep their immediate path. A single pending heartbeat prevents overlapping
reads; completed work after closure is ignored. Errors close the stream without
logging sensitive data so ordinary reconnection rechecks access and catches up
from the durable cursor. No bus or additional infrastructure is introduced.

A real Bun child writer and an already-open API SSE connection demonstrate the
process boundary. Reconnection announces the canonical position; the client's
existing online handler performs its ordinary workspace synchronization. An
idle stream emits keep-alives without redundant advanced events.

## T020 — Native CSV membership scope

A synthetic export containing `Tasks.csv`, `Task.md` and
`Tasks/Task <notion-id>.md` reproduces a wrong membership without any blocking
notice: global title resolution chooses the unrelated root note. Native CSV
matching must first inspect same-title pages in the CSV's corresponding export
folder. One match wins; several matches are ambiguous and block apply even if
a globally unique note exists. Only absence of local matches permits the
existing explicit-link/global fallback. Preserve originals, deterministic page
IDs and properties; never coalesce entries from different database folders by
title. No source writes or personal apply are needed to prove this correction.
