# Feature Specification: Backup, Recovery and Updates

**Feature Branch**: `feat/007-backup-recovery-updates`

**Created**: 2026-08-18

**Status**: Draft

**Input**: User description: "Backup, recovery and updates… Scope is product-canvas sections 27 and 30 to 34. Depends on features 001 to 006, all delivered."

## Product Direction, Dependencies, and Scope

This feature realises sections 27 and 30 to 34 of
[`docs/product/product-canvas.md`](../../docs/product/product-canvas.md), and
feature 007 of the roadmap.

Everything before this feature protected the owner's work from *the software*:
revisions that never overwrite, an outbox that survives a closed tab, envelopes
that keep content unreadable at rest, conflicts that are decided rather than
guessed. None of it protects them from **losing the machine**.

That is the gap this feature closes, and it changes what a failure costs:

1. **A daily backup that leaves the building.** A copy on the same disk as the
   original is not a backup; it is a second file with the same fate.
2. **A restoration somebody has actually performed.** An untested backup is a
   belief, not a capability — and the moment it is needed is the worst moment to
   discover it never worked.
3. **An update that cannot destroy anything.** The riskiest thing this product
   does to an owner's data is migrate it, and the safety net has to be in place
   *before* the migration starts, not after it fails.

**Out of scope**: additional backup destinations beyond the first one (the
provider boundary exists so a second can be added later, but only one is built),
continuous or point-in-time replication, and backup of the recovery kit itself —
which is deliberately the owner's to keep, and is covered by feature 002.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The workspace survives losing the machine (Priority: P1)

The owner's server dies. They install the application on a new machine, supply
the recovery material they kept offline, and restore last night's backup. Their
pages, files, hierarchy, relationships and history come back.

**Why this priority**: This is the feature. Everything else here produces the
backup this story consumes, or protects it from being wrong.

**Independent Test**: Take a backup from one installation, restore it onto an
empty one, and compare the workspace.

**Acceptance Scenarios**:

1. **Given** a verified backup and the recovery material, **When** the owner
   restores onto an empty installation, **Then** every item, file, relationship
   and revision the manifest lists is present and readable.
2. **Given** a backup and *no* recovery material, **When** the owner attempts a
   restoration, **Then** it refuses before touching anything and says exactly
   what is missing.
3. **Given** a backup from a version this installation cannot read, **When** the
   owner attempts a restoration, **Then** it refuses and names both versions.

---

### User Story 2 - A backup happens without being asked, and is verified (Priority: P1)

Every night the installation produces an encrypted backup, checks it, sends it
to the remote destination, and checks it again there. The owner never touches
this, and can see it happened.

**Why this priority**: A backup that depends on somebody remembering is a backup
that stops the week they are busy.

**Independent Test**: Let the schedule fire, then inspect the backup list and
the verification results.

**Acceptance Scenarios**:

1. **Given** a configured destination, **When** the daily time arrives, **Then**
   a backup is produced, encrypted before it leaves the machine, transferred,
   and verified both after creation and after transfer.
2. **Given** a transfer that fails halfway, **When** the run ends, **Then** the
   backup is not counted as verified and the failure is visible.
3. **Given** no verified backup for more than 26 hours, **When** the owner opens
   the workspace, **Then** they are told plainly, without having to look for it.
4. **Given** retention has elapsed for an old backup, **When** the retention
   pass runs, **Then** it is deleted only after confirming a recent verified
   backup still exists.

---

### User Story 3 - A restoration can be rehearsed safely (Priority: P2)

The owner tests a restoration without risking the installation they are using.
The application remembers when they last did it, and asks them again a month
later.

**Why this priority**: An untested backup is a belief. This is what turns the
promise of User Story 1 into something somebody has seen work.

**Independent Test**: Run a test restoration against a live installation and
confirm the live data is untouched.

**Acceptance Scenarios**:

1. **Given** a live installation with content, **When** the owner runs a test
   restoration, **Then** the backup is fully restored into an isolated place and
   the live workspace is unchanged.
2. **Given** a completed test restoration, **When** the owner looks at the
   backup screen, **Then** they see the date and the result, and no secret.
3. **Given** more than a month since the last test, **When** the owner opens the
   backup screen, **Then** they are invited to run one.

---

### User Story 4 - An update cannot lose data (Priority: P2)

A new version is deployed. Before any migration runs, the installation records
the version it is leaving, takes a backup, verifies it, and only then migrates.
If anything in that sequence fails, the update fails and the old version keeps
running.

**Why this priority**: Migration is the most dangerous thing this product does
to an owner's data, and it is the one failure they cannot undo themselves.

**Independent Test**: Deploy a version change with a deliberately failing backup
and confirm no migration ran.

**Acceptance Scenarios**:

1. **Given** a version change, **When** the installation starts, **Then** it
   records the previous version, takes a backup, verifies it, and migrates only
   after both succeed.
2. **Given** a backup that cannot be verified, **When** the update proceeds,
   **Then** the migration does not start and the failure names the reason.
3. **Given** a completed migration, **When** the health and integrity checks
   have not both passed, **Then** the update is not reported as successful.
4. **Given** a migration that failed, **When** the owner asks how to return,
   **Then** the installation names the previous image, the previous format when
   the migration was reversible, and the backup that matches it.

---

### Edge Cases

- **The destination is unreachable for days.** Backups keep being produced and
  verified locally; the owner is warned about the *transfer*, and nothing is
  deleted by retention while the remote copy cannot be confirmed.
- **A backup is corrupted in transit.** Verification after transfer catches it,
  the backup is not counted, and the previous verified one is retained past its
  retention date rather than deleted on schedule.
- **A restoration is interrupted.** The installation does not present itself as
  healthy afterwards: it reports that a restoration is incomplete and offers the
  documented way to resume or roll back.
- **The clock moves.** A daily schedule at 04:00 must not run twice or skip a day
  across a daylight-saving change.
- **Two backups at once.** A scheduled run and a manual one must not produce a
  half-written archive; one waits or is refused with a reason.
- **The disk fills during a backup.** The partial artefact is removed rather than
  left to be mistaken for a backup.

## Requirements *(mandatory)*

**What a backup contains**

- **FR-001**: A backup MUST contain the content, hierarchy, relationships,
  properties, tasks, files, attachments, and the settings required to restore.
- **FR-002**: A backup MUST carry an integrity manifest naming every element and
  a checksum for each.
- **FR-003**: A backup MUST record the application version, the schema version,
  and the encrypted-format versions it was produced with.
- **FR-004**: A backup MUST NOT contain an authentication secret, a private key,
  an active session, or the recovery kit in clear text.

**Producing and keeping backups**

- **FR-005**: A backup MUST be produced automatically once a day at 04:00 in the
  server's configured time zone.
- **FR-006**: A backup MUST be internally consistent — it MUST represent one
  moment, not a mixture of moments.
- **FR-007**: A backup MUST be encrypted before it leaves the machine.
- **FR-008**: A backup MUST be verified after creation and again after transfer.
- **FR-009**: The remote destination MUST be reachable through a boundary that
  allows another destination to be added without changing the backup itself.
- **FR-010**: Retention MUST default to three months and MUST remain
  configurable.
- **FR-011**: A backup MUST NOT be deleted by retention unless at least one more
  recent verified backup remains.
- **FR-012**: The owner MUST be warned visibly when no verified backup has
  succeeded for more than 26 hours.
- **FR-013**: Backups and their verification results MUST be observable from the
  interface and from the administrative commands.

**Restoring**

- **FR-014**: A restoration MUST be possible into an isolated environment, onto
  an empty installation, and onto a machine that never held this workspace.
- **FR-015**: Before a destructive restoration the system MUST verify key
  access, verify the manifest and archive integrity, verify version
  compatibility, show the scope and date of what is being restored, take a
  safety backup of the current state when possible, and require an explicit
  confirmation.
- **FR-016**: A restoration MUST refuse a backup from a version this
  installation cannot read, naming both versions.
- **FR-017**: A failed or interrupted restoration MUST NOT leave the
  installation presented as healthy, and MUST offer a documented way to resume
  or roll back.
- **FR-018**: A test restoration MUST NOT alter the live installation.
- **FR-019**: The date and result of the last test restoration MUST be retained,
  and MUST contain no secret.
- **FR-020**: The owner MUST be invited to perform a test restoration when more
  than a month has passed since the last one.

**Updating**

- **FR-021**: A version change MUST be detected before any migration runs.
- **FR-022**: An update MUST record the version being left, produce a backup
  associated with it, and verify that backup, before any migration starts.
- **FR-023**: An update MUST fail — leaving the previous version running — when
  the backup or its verification fails.
- **FR-024**: Every migration MUST be versioned, idempotent or otherwise
  protected against running twice, and observable while it runs.
- **FR-025**: The information needed to return to the previous image, to the
  previous data format when the migration is reversible, and to the matching
  backup MUST be retained.
- **FR-026**: An update MUST NOT be reported as successful before health and
  integrity checks have both passed.

**Administrative commands**

- **FR-027**: The administrative commands MUST be able to trigger a backup, test
  a restoration, inspect version and compatibility, and run or inspect
  migrations.
- **FR-028**: Each command MUST provide built-in help, a reliable exit code, and
  a non-interactive mode.
- **FR-029**: A destructive command MUST offer a simulation or require an
  explicit confirmation.

### Key Entities

- **Backup**: one consistent, encrypted copy of the workspace at a moment, with
  its manifest, its versions, and the record of where it was transferred.
- **Verification result**: the outcome of checking a backup, recorded separately
  for after-creation and after-transfer, because a backup can be sound on disk
  and corrupt at the destination.
- **Restoration attempt**: what was restored, from which backup, when, whether it
  was a test, and how it ended — the record that makes FR-017 and FR-019
  answerable.
- **Update record**: the version left, the backup taken for it, and what is
  needed to return.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A workspace restored from a backup onto an empty installation
  contains every item, file, relationship and revision the manifest lists.
- **SC-002**: A backup is produced and verified every day without anyone acting.
- **SC-003**: No backup leaves the machine unencrypted, demonstrated by reading
  the transferred artefact and finding no workspace content in it.
- **SC-004**: A test restoration leaves the live workspace byte-identical.
- **SC-005**: An update whose backup fails verification performs no migration.
- **SC-006**: A restoration from an incompatible version is refused before any
  data is written.
- **SC-007**: The owner is warned within one hour of crossing 26 hours without a
  verified backup.
- **SC-008**: No backup, manifest, log or stored result contains a secret, a key,
  or a session identifier.
- **SC-009**: Restoring a reference backup succeeds in continuous integration for
  every supported migration path.

## Assumptions

- **The recovery material stays with the owner.** A backup is encrypted with
  material the owner keeps outside it, per feature 002. This feature does not
  back that material up — doing so would put the lock and the key in the same
  box, and the canvas forbids it.
- **One destination is built, behind a boundary.** The canvas names Google Drive
  first and asks that the provider be isolated. A second destination is not
  built here; what is built is the seam that makes one possible, and a local
  destination used by the tests, which is what makes every backup requirement
  verifiable without a network or an account.
- **"Consistent" means one transaction's view.** The workspace already has an
  ordered change feed with a cursor, so a backup can name the position it
  represents rather than inventing a snapshot mechanism.
- **A test restoration uses a disposable database.** "Without overwriting the
  live installation" is achieved by restoring elsewhere, not by a dry run that
  skips the writing — a rehearsal that does not write proves nothing about
  writing.
- **Update detection is at startup.** The application compares the version it is
  running with the version recorded in the installation, which is where a
  container image change becomes observable.
