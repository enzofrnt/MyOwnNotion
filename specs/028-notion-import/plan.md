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
  ready state, migrations, external key and rotation/maintenance guards. Take
  FullBackupService024 verified snapshot before writes when canonical items
  exist. Do not add a weaker backup receipt shortcut.
- Submit ordinary create/document/definition/value commands through
  submitCanonicalMutation. File originals and attachments use existing
  ProtectedFileService.ingest and executeImportFile finalization boundaries,
  keeping acceptedWriteGuards, revisions and canonical notifications. Protect
  checkpoints in the same transaction as accepted operations.
- ProtectedRecordService entity `import.job` stores the fingerprint, mapping,
  backup reference and progress. Original source files are encrypted canonical
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
