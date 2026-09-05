# Validation: storage privacy and coherence

2026-09-05: specification, plan, research, data model, boundary contract and
41 implementation tasks exist. Spec Kit prerequisites and all local document
links pass. Cross-artifact analysis maps every FR/SC with no blocking issue.
The requirements checklist is 16/16 complete. T001 initial evidence inventory
and T002 directly affected shared-artifact references are complete.

T003 implements pure authenticated file-inventory shape rules. All 29 focused
tests and the domain strict type check pass, including 200 generated shape/tail
removal cases up to 2 GiB, malformed provenance, empty files and mixed historical
chunk generations. This is shape validation, not ciphertext or runtime privacy
proof. Source findings and pending proof are explicit in the audit inventory.
Desktop and backup delivery remain separate active work. No user data/keys/live
service was changed by this preparation. Full local/PR/main gates remain pending.

T004 adds reviewed 0015 schema without running it on user data. The 13 focused
migration tests pass, including preservation of historical file UUID/digest and
acknowledged upload offset, format-specific null/lookup guards, invalid chunk
position/length/generation, cascading partial references, and durable transition
backup/replacement/retained-quarantine constraints. Database strict types pass.
Existing legacy candidate/export readers explicitly refuse unresolved encrypted
metadata until T013–T017 connect the protected runtime; no nullable digest is
misreported as an empty digest. The application transition is not implemented yet.

T005 adds single-chunk and backpressured stream operations, upload/content purpose
separation, authenticated inventory matching, progressive mixed-generation reads
and owned-key cleanup. All 33 chunk tests and blob-store strict types pass,
including source/storage interruption, cancellation, tail deletion, substitution,
full digest verification and real 4 MiB boundaries. Existing convenience readers
remain until the protected runtime is connected; this is primitive-level proof.

T006 makes new filesystem publication exclusive, private, verified and fsynced
before returning a durable locator, without overwriting an existing key. Focused
filesystem tests cover concurrent identical writes, empty bytes, corrupt existing
data, root/prefix/file symlinks, byte verification failure, file fsync failure and
directory fsync refusal followed by a safe retry. No full runtime migration or
end-to-end bounded-memory result is claimed by these primitive tests.

T007 adds a root-derived, purpose-bound private content lookup tag and distinct
protected entities for logical-file metadata, upload metadata, completed content
inventories and accepted upload state. The 22 hierarchy/protection integration
tests pass: lookup survives data-key and wrapping-key rotation, never calls the
recovery export accessor, binds length/digest, refuses unavailable keys and keeps
metadata out of raw envelope rows. Missing versions return absence; authenticated
payloads with transplanted inventory versions are refused. A remaining nullable
legacy file route now explicitly refuses unresolved protected content until the
streaming reader replaces it in T012. No deployment occurs at this intermediate
boundary.

T008 adds scoped ordered chunk references, protected upload format/version reads
and bounded verified private-content candidate lookup. Integration cases prove
atomic tail replacement, offset/reference rollback, refusal of scope substitution,
missing uploads and invalid descriptors. A second SQL connection proves that
generation retirement waits for an in-flight publication lock; retired keys
remain readable and reject new writes, while revoked keys refuse reads. The
existing upload lifecycle suite is included. These locks still require the
rotation/revocation orchestration integration tracked by T018.

T009 provides the shared protected file factory/service without changing live
route composition yet. Five real SQL/filesystem integration cases pass, along
with API strict types: multi-chunk content reopens exactly through a fresh
runtime, empty content is authenticated, raw file rows omit digests/locators,
logical envelope/filesystem inspection finds no fixture sentinel, missing keys
refuse before reading input, interrupted/oversized/short streams publish no SQL
content, and missing tails/corrupt bytes refuse. HTTP composition, deduplication,
range reads and historical migration remain the following explicit tasks.

T010's three secured HTTP regressions fail against the still-unmodified route
composition, after successful authentication, upload/download and offset checks:
direct bytes remain readable in the blob directory; filenames remain readable
in item/logical-file/revision rows; acknowledged partial bytes remain readable.
Baseline output is `/tmp/mon-protected-http-before.log` on the development host.
These tests stay strict while T011–T015 replace that composition. All sentinels
are synthetic fixture values; no owner content was used or displayed.

T011 checkpoint: multipart import/replacement now consume bounded streams with
automatic SQL retries disabled, persist protected content and invoke the common
accepted-write/attribution guard. Two targeted secured HTTP cases pass for direct
encrypted bytes/downloads and independent logical identities with physical reuse
and device attribution. Six protected-service cases pass including deliberate
candidate-tag collision and duplicate ciphertext cleanup. The complete HTTP
privacy suite still fails its metadata and resumable-upload cases; T011 remains
open until replacement/refusal checks and the remaining composed paths converge.
