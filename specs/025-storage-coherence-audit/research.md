# Research: storage privacy and coherence

Date: 2026-09-05. Research used the checked-out implementation and existing
002/005/024 contracts. Spec Kit's research agent inspected attachment boundaries
read-only; the primary agent inspected recovery and UI composition. These are
source findings, not end-to-end proof.

## Protected file service

**Decision**: Put transaction orchestration in an API-level protected attachment
service, composed once for HTTP, CLI, migration and portable restore. Reuse
`EncryptedChunkStore`, `ProtectedRecordService` and `KeyHierarchy`; extend the
blob package with bounded single-chunk/iterator primitives.

**Rationale**: `app.ts`, `admin-cli.ts`, guarded migration and portable rehearsal
currently construct raw ContentStore/PartialUploadStore. Direct import calls
`part.toBuffer()`, tus completion concatenates a whole file, and download buffers
it. Merely swapping one storage adapter cannot enforce privacy or bounded memory.

**Alternatives considered**: Adapter-only encryption leaves metadata and rotation
uncovered. A new independent crypto hierarchy duplicates recovery policy. Whole
file envelopes violate 002's 4 MiB/range-read requirement.

## Authenticated content and partial transfer manifests

**Decision**: Keep content UUIDs; persist completed ciphertext references in
`protected_blob_chunks`, partial references in `protected_upload_chunks`, and
an authenticated protected manifest for each content/transfer. Manifests bind
size, SHA-256, expected chunk count and key/record provenance. Completed and
partial data use distinct entity bindings.

**Rationale**: Existing chunk index/AAD checks reject reordering but need an
expected final count to reject tail deletion. Fixed 4 MiB positions limit SQL
metadata even when the client sends many tiny PATCH requests. Replacing a short
tail publishes fresh ciphertext and commits its reference with the new offset.

**Alternatives considered**: An encrypted append-file format adds a second
storage protocol and makes committed offset recovery harder. Reusing upload
ciphertext under a completed content ID would break authenticated identity.

## Private metadata and deduplication

**Decision**: Protect logical-file metadata, upload metadata and all sensitive
revision snapshots, leaving neutral source fields after atomic writes. Resolve
protected values before creating later snapshots. Use a dedicated root-derived
HMAC candidate tag for deduplication; store the real SHA-256 in the protected
manifest and return it only through authorized content resolution.

**Rationale**: File routes bypass acceptedWriteGuards, and writing an envelope
alone does not clear the relational source. A raw hash can identify a known
private file. A root-derived purpose key survives data-key/wrapping-key rotation
without exposing recovery material. Candidate reuse still requires authenticated
byte-for-byte comparison, preserving 005's collision contract.

**Alternatives considered**: Digest-only equality violates 005. Public digest
indexes reveal known contents. A generation-derived tag loses lookup stability
on routine rotation. Maximal physical deduplication is not required: concurrent
equal imports may safely retain distinct content IDs.

## Durability, migration and backup

**Decision**: Fsync ciphertext files and directories before SQL references;
acknowledge uploads only after committing offset plus authenticated state.
Run resumable backfill after 024's verified pre-update backup and additive
schema migration, before ordinary writes or target-version success. Retain and
verify originals through cutover, then resumably retire readable copies.

**Rationale**: Current filesystem publication lacks fsync. 024's inventory assumes
legacy physical file_contents.storage_key and uploads/<id> prefixes. It must
remain catalogue-aware and branch by storage format, collecting new encrypted
references and preserving historical schema support. Portable backup currently
writes a plaintext tar under os.tmpdir before sealing; it must stream into
encryption. Portable restore must use the same protected ingest boundary.

**Alternatives considered**: Deleting originals before verification creates
irrecoverable interruption points. Blind deletion of unreferenced blobs can
lose recoverable orphan data; preserve such data in an encrypted quarantine
manifest with the source identity. Whole-volume forensic erasure is outside
application migration; document historical MVCC/WAL/snapshot retirement.

## Rotation and revocation

**Decision**: Include completed and partial chunk references in rewrite work,
progress, generation counts and transactional revocation checks. Commit each
new chunk/manifest/reference together; retire replaced ciphertext afterward
under the deletion lock. Preserve RUN → FILE_MUTATION → BLOB_DELETION → row
lock ordering wherever these operations overlap backup/migration.

**Rationale**: Current generation enumeration/counts only protected_envelopes.
Connecting file chunks without updating revocation could destroy readability.
Wrapping-key rotation should rewrap keys without rewriting file ciphertext;
data-key rotation progressively rewrites chunks as already required by 002.

## Recovery coherence

**Decision**: Preserve the administrative import empty-target gate. Remove or
correct the unused inconsistent trust-reset branch after proving all consumers;
keep its public result shape if needed. Verify occupied-target refusal and
atomic identity adoption, and retain 024's separate complete-restore activation.

**Rationale**: resetDeviceTrust sets revoked without revoked_at, but its sole
caller first rejects any owner. Devices require an owner FK, so valid active
rows cannot reach that branch through import. This is an unsafe disconnected
helper, not a demonstrated production recovery failure. Do not weaken the
empty-target rule to make the branch reachable.

## UI and native scaffolding

**Decision**: Restore ordinary click/release cancellation and stabilize affected
form identity across projection updates. Remove the inactive styles.css and
replace its string-matching test with an active browser caret/input journey.
Audit native helpers by callers; remove only proven unused code.

**Rationale**: StableActionButton starts writes on pointerdown, preventing normal
pointer cancellation. main.tsx imports global.css while editor-input.spec.ts
reads styles.css. Desktop single-instance.ts is test-only; session-partition
and vault-profile have live callers, so filenames alone do not prove redundancy.

## Research disposition

All technical choices above are resolved for planning. Remaining runtime
hypotheses are explicit reproduction tasks, not product clarification. No
user installation, keys, data or running services were modified by research.
