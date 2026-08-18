# Research: Backup, Recovery and Updates

Five decisions. The first two are expensive to reverse; the fourth is the one
most likely to be got wrong in a way that looks fine.

## Decision 1 — The archive is the canonical export plus the files

**Decision**: A backup archive contains the existing canonical export manifest
from feature 001, the file bytes from the content store, and a small envelope
naming the versions. No new serialization of the workspace is written.

**Rationale**: Feature 001 already produces a canonical export with a manifest
and a checksum per element, validated by `validateCanonicalExport` and exercised
by contract tests. A backup format of its own would be a *second description of
the same workspace*, and two descriptions drift the first time either side
changes — with the drift surfacing only when somebody restores, which is the
worst moment to discover it.

It also means the portability requirement (canvas section 27) and the backup
requirement (section 30) are satisfied by one artefact rather than two that must
be kept in step.

**Alternatives considered**:

- *A database dump.* Simple, and it ties the backup to PostgreSQL's version and
  to this schema. Restoring onto "an explicitly compatible version" would then
  mean matching a database engine rather than an application format.
- *A new backup-specific format.* More freedom, and the freedom is the problem:
  nothing would force it to stay in step with the export that owners are also
  told to trust.

**Consequence**: what a backup can restore is exactly what the export can
describe. Anything the export omits is a gap in both, which makes the gap
visible in one place.

## Decision 2 — Consistency comes from the change cursor

**Decision**: A backup records the change-feed position it represents, and its
contents are read within one transaction at that position.

**Rationale**: FR-006 asks for a backup that represents one moment. The
workspace already has an ordered feed with a monotonic cursor, so "one moment"
is a number that already exists. Inventing a snapshot mechanism would add a
second notion of "the state at a time" beside the one the whole product already
uses — and the two could disagree about what was included.

Naming the position also makes a restored workspace *placeable*: an owner can
say what they lost, in changes, rather than in minutes.

**Alternatives considered**:

- *Filesystem or volume snapshots.* Genuinely consistent and outside the
  application's control, so untestable in CI and unavailable on some hosts.
- *Quiescing writes during the backup.* Correct and unacceptable: the workspace
  would be unwritable for the duration, nightly, forever.

## Decision 3 — The destination boundary is three methods

**Decision**: A destination can `put(name, stream)`, `list()` and `delete(name)`.
Nothing else.

**Rationale**: The boundary exists so a second destination can be added (FR-009),
and a boundary is only worth having if the simplest implementation is honest.
Three methods are what a filesystem directory can implement without pretending —
no folder ids, no resumable-upload tokens, no revisions. Anything richer would
be Google Drive's interface wearing a generic name, and the filesystem
implementation would become a stub that passes tests the real one would fail.

Verification after transfer reads back through the same boundary, which is what
makes it a genuine check rather than a re-hash of the local file.

**Alternatives considered**:

- *A rich interface with resumable uploads and quotas.* Better for large files
  on a flaky link, and it makes the local destination a fiction.
- *No boundary; call Google Drive directly.* Less code today, and every test
  would then need an account or a mock of a third-party HTTP API.

## Decision 4 — A test restoration writes, into a disposable database

**Decision**: A rehearsal restores into a database created for the purpose and
dropped afterwards, not into the live one, and not as a dry run that validates
without writing.

**Rationale**: This is the decision most likely to be got wrong in a way that
looks fine. A "dry run" that checks the manifest, verifies checksums and stops
proves that the archive is *readable* — it proves nothing about whether it can be
*written back*, which is the only question a rehearsal is asked. Constraint
violations, ordering problems and schema mismatches all surface at write time.

The cost is a real database per rehearsal. The test harness already creates
disposable PostgreSQL databases for every integration suite, so the machinery
exists.

**Alternatives considered**:

- *Restore into the live database inside a rolled-back transaction.* Writes for
  real and cannot be trusted: a rollback that fails, or a migration that commits
  on its own, would corrupt the live workspace during a *rehearsal*.
- *A dry run.* Cheap, safe, and answers a different question than the one asked.

**Consequence**: FR-018 is structural rather than promised — the live database is
not open during a rehearsal, so it cannot be altered by one.

## Decision 5 — The update guard runs at startup, before the migrator

**Decision**: The application compares its own version with the version recorded
in the installation at startup, and refuses to run migrations until a verified
backup exists for the recorded version.

**Rationale**: A container image change is invisible to the running process that
is being replaced; it is visible to the one starting up. Startup is therefore the
only place where "the version changed" is a fact rather than a guess.

Placing the guard *before* the migrator, rather than inside it, is what makes
FR-023 enforceable: a migrator that checks its own precondition is a migrator
that a future entry point can bypass.

**Alternatives considered**:

- *A deployment-time check in Compose.* Correct for this deployment and absent
  for any other way of starting the application.
- *Checking inside each migration.* Every migration would carry the same
  precondition, and a new one would eventually omit it.

**Consequence**: an installation whose backup cannot be verified does not start
its migrations, and says so — it does not start and quietly serve the old schema
under a new binary.

## Open question deferred to implementation

How large a workspace the nightly archive can handle before streaming becomes
mandatory rather than preferable. The design streams from the start, so the
answer changes nothing structurally; it changes only what the validation
measures.
