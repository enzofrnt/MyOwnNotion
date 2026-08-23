# Contract: The Backup Archive

What an archive contains, how it is checked, and what somebody needs to open it
without this application. Implements FR-001 to FR-004, FR-007 and FR-008.

## Layout

```
myownnotion-backup-<iso8601>-<short-id>.tar
├── manifest.json          # the envelope: versions, cursor, digests
├── canonical-export.json  # feature 001's export manifest, verbatim
├── page-operations.json   # causal page state, present on operational archives
└── files/
    └── <sha256>           # content-addressed, exactly as the content store holds them
```

One tar, not a directory: a backup is one thing to transfer, verify and delete,
and a directory that is half-transferred looks like a smaller backup rather than
a broken one.

Files are named by their digest because the content store already addresses them
that way. A file whose name is its hash cannot be silently substituted, and two
pages embedding the same image cost one copy.

## `manifest.json`

```json
{
  "format": "myownnotion.backup",
  "formatVersion": 1,
  "createdAt": "2026-08-18T04:00:00.000Z",
  "cursor": "22055",
  "applicationVersion": "0.1.0",
  "schemaVersion": 1,
  "recordFormatVersion": 1,
  "canonicalExportDigest": "sha256:…",
  "operationalFormatVersion": 1,
  "operationalStateDigest": "sha256:…",
  "operationalPageCount": 42,
  "operationalCheckpointCount": 57,
  "operationalUpdateCount": 310,
  "files": [{ "digest": "sha256:…", "byteLength": 12345 }],
  "itemCount": 128,
  "fileCount": 17
}
```

The five `operational*` fields are either all present or all absent. When they
are present, `page-operations.json` carries each page state, the current and
retained checkpoints, update receipts and uncompacted payloads, device
frontiers, durable ambiguities, and legacy-conversion receipts. It contains no
key: operational bytes are portable inside the tar, and the tar itself remains
sealed before transfer.

The operational representation is the causal authority for active page bodies;
`canonical-export.json` remains its deterministic, documented projection. Both
are captured in the same repeatable-read transaction. Verification reconstructs
every active operational page and refuses the archive unless its projection and
digest equal the canonical export.

**Every version needed to read it back is in here**, because a reader that has to
consult the application to learn what the archive is has not been given a
portable artefact. `schemaVersion` and `recordFormatVersion` are what a
restoration compares against (FR-016); `cursor` is what places the backup in the
workspace's history.

The manifest carries digests, never content. A manifest that quoted a page title
would leak content into the one part of the archive a reader inspects first.

## Encryption

The tar is encrypted **before** it leaves the machine (FR-007), with the
material established in feature 002. The transferred object is the ciphertext and
nothing else — no plaintext manifest beside it, however convenient that would be
for listing backups, because a manifest is a description of somebody's workspace.

A destination therefore sees an opaque blob and a name. The name carries a date
and an identifier and nothing about the content.

## Verification

Two checks, and they are not the same check run twice:

| Stage | What it reads | What it proves |
| --- | --- | --- |
| after creation | the local artefact | the archive was written completely and its digests match its contents |
| after transfer | the object **read back from the destination** | what arrived is what was sent |

The second must re-read through the destination boundary. Re-hashing the local
file would prove the local file is fine — which the first check already
established — and would report a corrupted upload as a success.

A checkpoint counts as compaction evidence only after the destination read-back
passes and the exact checkpoint ID plus snapshot/canonical digests are recorded.
Retention cannot delete a backup while a checkpoint still names it as its
evidence. A later verified backup may replace that reference.

A verification records a stage, an outcome and a safe reason. It never records a
path, a credential, or anything from inside the archive.

## What is never in an archive

- an authentication secret, a session, or a CSRF token;
- a private key, a wrapping key, or a data key;
- the recovery kit.

The last one is a rule about *where things are kept*, not an oversight: an
encrypted archive and the means to decrypt it in the same place is a single
object that an attacker only has to steal once. Asserted by a test that reads a
produced archive and searches it for the seeded secrets.
