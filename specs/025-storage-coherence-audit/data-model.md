# Data model: protected attachments and transition

## Completed content

Retain `file_contents.id` and every logical/history reference. Add
`storage_format` with `legacy-v1` and `encrypted-chunks-v1`. Legacy rows retain
their raw SHA-256/storage locator until verified cutover. Encrypted rows use a
32-byte keyed `lookup_tag`; plaintext sha256/storage_key become nullable and
must be null under the encrypted format. Keep the actual digest in a protected
`file.content-manifest` envelope. Format-specific checks prevent ambiguous rows.
Authorized read models resolve the real digest; no caller may confuse the lookup
tag with the public SHA-256 contract.

The protected manifest contains format version, plaintext length/SHA-256,
expected chunk count, record version and each chunk's trusted index/length/key
generation. Bind installation/workspace/content identity through envelope AAD.
`protected_blob_chunks` stores immutable ciphertext locators and envelope fields.
A valid manifest must describe indexes 0..N-1, exactly the declared total size,
4 MiB nonfinal parts and at most one shorter final part. Empty content has zero
parts and the authenticated empty-file digest. A removed tail is corruption.

Ciphertext publication is durable before references commit. Logical replacement
creates/reuses a content identity and changes the logical file reference in the
same accepted mutation transaction. Candidate tags narrow lookup; authenticated
stream comparison is still required before physical reuse.

## Partial upload

Retain upload UUID, structural workspace/placement, declared/received lengths,
expiry and completion identity. Add storage_format and protected
`file.upload-metadata` / `file.upload-state` records. Add
`protected_upload_chunks(upload_id, chunk_index, ciphertext locator, salt,
nonce, tag, aad_digest, plaintext_length, key_generation, record_version)` with
unique upload/index and referential cleanup.

The state manifest authenticates accepted length, expected chunk shape and
provenance. A PATCH validates expected offset and current generation under the
upload row lock, decrypts only a short previous tail, publishes fresh encrypted
parts, and commits state/references/offset together. Do not acknowledge physical
bytes alone. Empty and retried PATCH contracts remain those of feature 005.
Finalization rebinds data to completed content, verifies the entire digest and
commits logical file/revision/mutation/change sequence before retiring partial
references. A concurrent completion returns its original durable identity.

`protected_upload_completions` retains that identity, workspace and byte length
atomically with finalization. It contains no user metadata and is removed when
the logical file is purged. HEAD and a retried final PATCH can acknowledge the
completed transfer after its partial state has been removed.

`protected_file_garbage` queues superseded transfer ciphertext in the same
transaction that retires its references. Cleanup first commits expired transfer
retirement, then deletes only unreferenced queued blobs in a separate bounded
transaction under the file-publication and backup-deletion locks. A failed disk
delete can retry without resurrecting a transfer pointing at removed bytes.
Unclassified historical orphans remain reserved for the verified transition.

Historical file restoration resolves the authenticated snapshot through a trusted
server callback inside the mutation transaction. It restores the verified content
pointer and metadata as a new revision; readable SQL snapshots remain neutralized.

## Sensitive metadata

Protect original filename/media type, item name/icon, upload metadata and file
snapshot content through existing protected-record entities or explicitly added
file entities. Structural IDs, lifecycle, byte length and ordering remain
relational. Persist neutral values in legacy-required source fields only until
nullable protected schema permits their removal. Every read/snapshot/export
resolves protected values before constructing the authorized result.

## Key lifecycle

Add a purpose-specific root-derived content index key. It never escapes through
recovery-export APIs and is wiped after use. Data-key generation rewrite/counts
include envelopes, completed chunks and partial chunks. Generation revocation
checks all references while serialized with concurrent writes/rotation; it cannot
revoke a generation with readable data still depending on it. Wrapping-key
rotation preserves the workspace root and ciphertext identity.

## Durable storage transition

Record one transition per installation/source schema with verified source full
backup ID, source inventory digest, phase, per-content/upload cursor, completed
verification and cleanup state in a dedicated `file_storage_transitions` row
introduced by 0015. Keep per-object progress in `file_storage_transition_entries`.
Do not overload security-key rotation state or the SQL migrations ledger.

States: inventoried → backfilling → metadata-protected → verified → cutover →
retiring-sources → complete. Failure preserves the last committed state and
source; restart reauthenticates replacement before cleanup. RUN lock excludes
other transitions/backups, then FILE_MUTATION and BLOB_DELETION coordinate
writers and physical cleanup. App startup and mutation guards reject an
incomplete transition even when its owning process is gone.

Orphan legacy blobs/temporary data are inventoried with original identity and
sealed into recoverable quarantine, not silently deleted. Their private source
mapping is encrypted. Cleanup only removes a source after authenticated
replacement/quarantine verification. Current dumps/logical rows and application
files must contain no private sentinels after completion; historical PG/WAL/host
snapshots are documented separately and are not a forensic-erasure claim.

## Backup inventory compatibility

024 inventory detects schema/format before selecting columns. Legacy sources
keep current physical blob/prefix rules. New sources require every referenced
completed/upload ciphertext blob and encrypted quarantine item. Full backups
remain opaque complete SQL plus file snapshots. Portable export resolves and
streams authorized plaintext directly into sealing, and portable restore writes
through protected ingestion and metadata boundaries.

## Recovery and audit records

Administrative import occupancy remains authoritative: any owner/workspace/item/
protected content refuses adoption. No source device trust is imported. Complete
restore activation remains 024's atomic invalidation flow. Audit findings record
whether a suspect helper is actually reachable through those rules.

## Canonical payload cutover (FR-014)

New secured writes retain structural identity, lineage and placements in SQL.
Current names use the existing U+FFFD scrub marker; icons are null; page bodies
and private relationship metadata use the reserved `{$myownnotionProtected: 1}`
marker; revision snapshots are null. Actual presentation, bodies, snapshots,
definitions, values and metadata reside in authenticated protected envelopes.
Neutral edits and snapshot generation resolve these envelopes first. Missing
protected data behind a marker fails closed. Portable restoration applies the
same boundary before committing; historical copies join the durable transition.
The exact trimmed U+FFFD value is reserved at display-name input boundaries;
names that merely contain that character remain authored content.
An authenticated transition source may record that a V0 plaintext name already
equaled the marker. This provenance authorizes only its first envelope
publication; verification and retirement still require the protected copy.
The exact one-key JSON object `{"$myownnotionProtected":1}` is likewise reserved
for structured neutralization. Objects with additional own keys remain authored
content. A distinct authenticated V0 provenance may authorize an unsealed page
body, retained snapshot body or relationship metadata marker only for its first
publication. Once published, every digest and lifecycle boundary resolves the
protected envelope; the plaintext marker cannot satisfy verification.

Quarantine keeps an explicit content UUID reference as well as current chunk
locators. An empty orphan has one row with a null chunk locator; every nonempty
chunk has a row. The FK prevents ordinary content cleanup from destroying the
recoverable object, and rotation updates its locators atomically. Its manifest
reference names the stable transition replacement envelope, which resolves the
content's current authenticated manifest rather than pinning an obsolete version.
Portable workspace replacement preserves these recovery objects/checkpoints.

The resumable canonical transition inventory is version 2 and carries the
authenticated source-backup ID, installation identity, source provenance,
manifest digest and captured entries. A V0 provenance record is valid only when
the full-backup receipt and manifest agree with the installation and the source
has no migration `0006_installation_application_version`; this record survives
resume and re-inventory. Every completion boundary reopens the captured
protected envelopes, so a missing or changed envelope blocks verification,
cutover and final retirement.

A supported version-1 inventory resumes only after authenticating the same
backup, installation, transition, exact entry set and digests, then persists a
version-2 replacement atomically. Its source may be a modern installation or V0;
V0 is required only for the reserved-marker provenance above. The early
file-only V1 inventory may supplement missing metadata while the phase is still
`inventoried` or `backfilling`; later phases and mismatched evidence never infer
or replace historical provenance.

## Reusable database placement invariant

An independent reusable database source item and its database-entry page items
are canonical records even when no display host currently embeds them. Their
absence of a hierarchy placement is therefore valid after every display host is
purged. Canonical export keeps the exactly-one hierarchy-placement rule for
ordinary active non-file items, while validating source/entry identity, kind,
database membership and view relationships through their dedicated invariants.

Portable archives keep a legacy-compatible V1 interpretation while V2 reserves
the exact protected markers and trimmed placeholder names. Canonical graph and
page-operation content is validated before any archive byte is emitted or any
restore-target mutation begins, and the stream uses strict TAR framing.
Structured versions are positive and canonical/page-operation JSON contains no
U+0000 string value or object key. Initializing and legacy operational states remain empty;
active/blocked state carries a causally contiguous update log. Every retained
blob agrees with its base and cumulative result, every checkpoint frontier
agrees with its covered sequence, no checkpoint is ahead of the update head,
and lifecycle timestamps preserve causal order. History reads and restores
distinguish unavailable protected envelopes from expired snapshots; compaction
and legacy branches do not fall back to raw payloads. The legacy branch requires
an explicit client base document and a bounded retained dependency. The
structured marker matcher examines all own keys, including symbols and
non-enumerable properties.

## Canonical export publication invariant

An export job begins as `pending` and reaches one terminal state, `ready` or
`failed`. Restart recovery may rebuild a pending job, but publication changes a
row only while it is still pending. The same transaction stores the verified
digest and protected manifest; a competing worker that did not perform that
state transition publishes nothing. A late failure likewise updates only a
pending row and cannot replace ready evidence.

The version-2 manifest is projected through its executable response schema
before validation and hashing. Closed objects lose unknown members, while the
database definition and entry-value maps remain deliberately open. The SHA-256
digest therefore describes the exact logical manifest returned to the owner.
Legacy, malformed or digest-divergent stored manifests are refused rather than
adapted during download.
