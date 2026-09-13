# Storage and interactive boundary contracts

## Authorized file operations

Existing routes, logical/content UUIDs, declared lengths, plaintext SHA-256,
mutation/revision results and resumable offsets remain compatible. The server
must not expose keyed candidate tags, envelope keys or physical locators as user
metadata. Direct and tus writes share protected ingestion and accepted-write
semantics; filenames are resolved only after the shared authentication gate.

Downloads support full content and one satisfiable byte range, returning correct
200/206 lengths and Content-Range. Unsatisfiable/malformed unsupported ranges
receive the documented 416 response; never silently return the wrong byte slice.
Authenticate a complete encrypted chunk before returning any of its bytes.
Failure after earlier valid streamed chunks terminates the response without a
success digest; unauthenticated bytes never leave the server. Conditional/range
behavior must preserve existing clients and attachment previews.

Accepted transfer offsets advance only with durable encrypted references. Restart
and HEAD report that committed offset. Conflicting offsets refuse; repeated
completion returns the same logical identity. Files exceeding the configured
limit refuse without losing the editor draft or advertising completion.

## Migration and operation guards

The guarded update creates/verifies a complete 024 archive before additive SQL
or content migration on a populated source. Storage transition runs before target
application-version success. Ordinary writes remain unavailable while transition
is incomplete; health/diagnostic output reports a safe actionable state.

No missing-key fallback writes readable data. Corruption and incomplete inventory
stop before verified source retirement. Explicit rollback uses the documented
full restore into an empty isolated target, retaining source-version provenance.

## Portable and complete recovery

Portable export remains a documented canonical format, excludes credentials and
streams its private archive directly into encryption. Complete backup remains
full SQL plus durable physical files and provenance. Both support encrypted
completed content, partial state and retained historical generations as specified.
Restored content is exercised through actual authorized reads, not only hashes.

## UI behavior

Normal buttons activate through semantic click/keyboard release. Press, move
outside and release cancels. Disabled/busy controls cannot submit; a single
activation performs at most one mutation. Stable mounted forms retain dirty
fields, focus and IME composition while remote/local projections refresh.

Active `global.css` and shared tokens/primitives govern the result. Verify empty
caret, input state, pointer/touch/keyboard, narrow and wide layouts and all themes
in real rendered journeys following the repo ui-quality skill.

## Audit output

Every finding records ID, boundary, severity, source path, reproduction status,
impact, remedy/disposition and verification. Separate active confirmed defects
from unreachable code and hypotheses. Record reviewed areas and limits even
when no defect is found. No user private data enters fixtures or reports.
