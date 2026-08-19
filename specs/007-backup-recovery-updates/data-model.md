# Data Model: Backup, Recovery and Updates

Three tables. The shape worth arguing about is the second one, because the
obvious alternative loses information exactly when it matters.

## Already present

| Table | Role here |
| --- | --- |
| `changes` | The ordered feed. A backup names the position it represents (research decision 2). |
| `installations` | Where the running version is recorded, and what the update guard compares against. |
| `exports` | Feature 001's export jobs. A backup reuses the *format*, not this table: an export is something an owner asked for, a backup is something the schedule produced. |

## `backups`

One row per archive produced.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | UUID | |
| `created_at` | timestamptz | |
| `cursor` | text | The change-feed position this archive represents. |
| `application_version` | text | What produced it (FR-003). |
| `schema_version` | integer | What it can be read back into. |
| `record_format_version` | integer | The encrypted-record format inside it. |
| `byte_length` | bigint | |
| `digest` | text | Of the whole archive, so a transfer can be checked against it. |
| `destination` | text | Which destination it was sent to, or null while local only. |
| `remote_name` | text | What it is called there, so retention can delete it. |
| `reason` | text | `scheduled`, `manual`, or `pre-update` — the last one is what an update looks for. |
| `superseded_by_version` | text | For a `pre-update` backup: the version being moved to. |

**No `verified` boolean.** A backup is verified after creation *and* after
transfer, and those are different facts with different failure modes — sound on
disk, corrupt at the destination. A single flag would make an unverified-because-
untransferred backup indistinguishable from a failed one, and FR-011 has to tell
them apart before deleting anything.

## `backup_verifications`

One row per check performed against a backup.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | UUID | |
| `backup_id` | UUID → `backups.id` | |
| `stage` | text | `after-creation` or `after-transfer`. |
| `checked_at` | timestamptz | |
| `outcome` | text | `passed` or `failed`. |
| `detail` | text | A safe reason for a failure. Never a path, never a key, never content. |

**Rows rather than columns**, and this is the decision the table exists to make:
a verification is an event that happened at a time, and a backup can be checked
again later — after a destination outage, or because an owner asked. Columns
would keep only the last answer and would silently overwrite the history of a
backup that passed, then failed.

"A recent verified backup remains" (FR-011) is therefore a question about rows:
is there a backup whose `after-transfer` verification passed, more recent than
the one about to be deleted?

## `restoration_attempts`

| Field | Type | Notes |
| --- | --- | --- |
| `id` | UUID | |
| `backup_id` | UUID → `backups.id` | |
| `started_at` | timestamptz | |
| `finished_at` | timestamptz | Null while running — which is how an interrupted restoration is recognised. |
| `kind` | text | `test` or `destructive`. |
| `outcome` | text | `succeeded`, `failed`, or null while running. |
| `detail` | text | Safe reason. No secret (FR-019). |
| `restored_item_count` | integer | What the owner is shown afterwards. |

A row with `finished_at` null and a process that is no longer running **is** the
interrupted state FR-017 is about. The installation reads it at startup and
refuses to present itself as healthy rather than inferring health from the
absence of an error.

`kind = 'test'` rows are what answer "when did you last rehearse" (FR-019, FR-020).

## What is deliberately not stored

- **No credential for the destination.** It is configuration, mounted like the
  deployment key, and a row holding it would put a live credential in the very
  database the backup exists to reproduce.
- **No copy of the recovery material.** The canvas forbids it, and a table would
  be the easiest place to forget that.
- **No archive contents.** The manifest lives inside the archive; duplicating it
  here would create two answers to "what is in this backup".
