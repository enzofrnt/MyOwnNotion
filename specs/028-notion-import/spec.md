# Feature Specification: Notion import CLI

**Feature Branch**: `codex/028-notion-import`
**Created**: 2026-09-05
**Status**: Approved for implementation
**Input**: Import native Notion Markdown/CSV exports and an Obsidian-converted local folder through a preview-first local CLI.

## Product direction and clarifications

Canvas sections 6, 17, 27–30, 42, 47 and 49 govern this separate feature. The
owner authorized delivery before V1 on 2026-09-05. Dependencies are canonical
content and encrypted storage, complete backups024, and reusable database
sources026. This feature introduces no UI and no extra account. The owner's
real local folder is read-only and may be inventoried or previewed; applying
that content to the personal installation is outside this task's authorization.

## User Scenarios & Testing

### User Story 1 — Know what will transfer (P1)

The owner runs the local import command with a source directory or ZIP archive.
Without an explicit apply choice, the command only reports the proposed import.

**Independent Test**: Preview synthetic native and converted exports without a
database connection; verify the source bytes and target remain unchanged.

**Acceptance Scenarios**:
1. Every source file is accounted for with content, hierarchy, links, attachments,
   properties and database membership outcomes; unsupported or missing material
   is identified explicitly, including unavailable view/preview configuration.
2. Native Markdown, database CSV rows and linked subpages are recognized, and
   the converted adapter recognizes YAML properties, wikilinks and supported
   Bases membership filters without executing source expressions.
3. Malformed, oversized or unsafe sources fail with a bounded report before
   target writes. Symlinks and archive path escapes are never followed.

### User Story 2 — Import useful canonical knowledge (P1)

The owner explicitly applies the previewed source to a configured installation.
Pages, folders, files and database entries become ordinary editable content.

**Independent Test**: Apply synthetic exports to a disposable encrypted server;
read the resulting pages, file bytes and database membership through normal APIs.

**Acceptance Scenarios**:
1. Page content and hierarchy are preserved; local links and attachments point
   to imported canonical identities. Broken or ambiguous links retain their
   source representation and appear in the report.
2. Properties and membership use the reusable database source model. Source
   values without a faithful typed representation remain available with an
   explicit conversion explanation. Person names remain data, never accounts.
3. Available table presentation is carried over where supported. Absent board,
   calendar, gallery preview, automation, permissions and historical settings
   are reported as unavailable, never reconstructed as if exported.
4. An occupied target receives a verified complete safety backup before the
   first content change. Failed backup, unavailable key, inactive installation,
   pending migration or blocked write policy refuses apply.
5. Original source material and conversion metadata are preserved under the
   encrypted canonical/provenance boundary, and source files remain unchanged.

### User Story 3 — Resume without duplication (P2)

An interrupted import resumes from its protected checkpoint. Repeating a
completed import reports completion without overwriting later owner edits.

**Independent Test**: Interrupt between accepted operations, resume twice and
compare canonical IDs, counts, values and encrypted provenance.

**Acceptance Scenarios**:
1. Stable source and operation identities prevent duplicate items, files,
   relationships or memberships. Progress commits with accepted canonical work.
2. Changed source content or conflicting target identity is detected; resume
   never silently replaces a different import or newer owner content.
3. A process restart can read protected provenance and continue. Errors and
   routine logs expose safe codes and counts, not note text or credentials.

### Edge Cases

Duplicate/ambiguous names; nested folders; URL-escaped Notion identifiers;
Unicode normalization; multiline CSV; YAML aliases/custom tags; missing CSV
subpages; partial exports; orphan files; external links; unsupported Markdown;
unsafe archive paths, symlink entries, ZIP bombs, corrupt archives and size/count
limits; interruption after committed content; concurrent runs; changed source;
read-only sources; absent view configuration and incomplete database mappings.

## Requirements

- **FR-001**: The CLI MUST default to a source-only preview and require an
  explicit apply flag for target writes. A dry-run flag MUST take precedence.
- **FR-002**: Directories and native ZIP exports MUST support Markdown, CSV,
  attachments and converted Obsidian frontmatter, wikilinks and Bases metadata.
- **FR-003**: The report MUST account for every input file and every conversion,
  unresolved link, unsupported configuration and missing dependency.
- **FR-004**: Import MUST preserve content, hierarchy, local references, files,
  property values and resolvable database membership using canonical services.
- **FR-005**: Database sources/embeddings MUST follow026; absent view settings
  MUST be stated explicitly. Default display choices MUST be labeled as such.
- **FR-006**: Apply MUST validate installation/key/write/migration state and make
  a complete verified backup before changing an occupied workspace.
- **FR-007**: Deterministic identities and transactional protected checkpoints
  MUST permit restart and idempotent replay without replacing newer owner edits.
- **FR-008**: Sensitive provenance, source originals, imported files and content
  MUST use application encryption at rest. Routine output MUST avoid secrets.
- **FR-009**: Source access MUST remain read-only and bounded; traversal,
  symlinks, duplicate normalized paths, archive bombs and unsafe YAML MUST fail.
- **FR-010**: Offline clients MUST receive ordinary canonical changes through
  synchronization. Import itself requires the target server storage available.
- **FR-011**: Instructions MUST explain native export, converted input, preview,
  apply, backup, resume and limits, without claiming unavailable export data.

### Key Entities

Source snapshot: normalized paths, immutable bytes, digests and source adapter.
Import report: per-source outcomes, links, property conversions, memberships and
missing configuration. Import job: stable identity, source/plan fingerprint,
canonical identities, safety-backup reference and encrypted checkpoint.

## Success Criteria

- **SC-001**: Synthetic native and converted fixtures transfer all supported
  content categories with no source changes and exhaustive outcome reports.
- **SC-002**: Restart/replay retains identical canonical identities and preserves
  owner edits made after completion.
- **SC-003**: Unsafe archive/source and unavailable-backup cases write no target
  content. SQL/blob inspection finds no imported plaintext outside intentional
  owner-requested report output.
- **SC-004**: The real candidate directory is inventoried and previewed only;
  its data and path names never enter committed fixtures or documentation.

## Assumptions

The export is a snapshot, not an ongoing Notion synchronization. No remote API,
credential collection or network fetching of linked assets is included. Import
creates a dedicated root; it never merges by title into existing owner pages.
An intentional detailed report is owner-directed output, not diagnostic logging.
Source edits require a new explicit import identity and preview; resume is bound
to the exact original snapshot. Unsupported formatting preserves original text
and source material, rather than promising full editor parity.
