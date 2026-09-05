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
