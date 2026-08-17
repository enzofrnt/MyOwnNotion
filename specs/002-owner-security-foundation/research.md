# Phase 0 Research: Owner Security Foundation

This research resolves the planning questions raised by the revised
specification. Decisions are deliberately scoped to this feature and do not
alter feature-001's completed canonical model.

## Decision 1: Keep bootstrap recovery outside session authentication

**Decision**: Use a persisted bootstrap attempt capability and a serializable
installation state machine. Credential verification authorizes creation of the
provisional recovery artifact; the attempt capability authorizes its one-time
download and confirmation. A session is not required until the installation is
ready.

**Rationale**: Requiring a session before recovery readiness creates a circular
dependency: a session needs a ready owner, while readiness needs confirmed
recovery. The capability is narrower than a session, expires with the attempt,
is bound to the bootstrap origin/device context, and cannot access content.

**Alternatives considered**: Create a session first (rejected: deadlock and
over-broad privilege); require an administrator CLI for bootstrap download
(rejected: fails first-run usability); persist the kit without confirmation
(rejected: cannot prove offline recovery readiness).

## Decision 2: Consume exactly one provisional download in 15 minutes

**Decision**: Store `download_expires_at`, a hashed one-time download token, and
`download_consumed_at`. One successful artifact stream atomically consumes the
token. Clock-controlled tests cover before expiry, at expiry, replay, lost
download, regeneration, and confirmation. Regeneration supersedes only the
previous provisional artifact; it does not mark the installation ready.

**Rationale**: This makes the usability promise precise and avoids storing a
second copy of recovery material beside the workspace.

**Alternatives considered**: Multiple downloads (rejected: weakens possession
evidence); a long-lived provisional kit (rejected: expands bootstrap exposure);
automatic readiness after download (rejected: download is not offline storage).

## Decision 3: Separate active replacement from bootstrap provisional recovery

**Decision**: Recovery kits use two orthogonal axes. `authorizationState` is
`provisional`, `active`, `superseded`, `revoked`, or `rejected`; `deliveryState`
is `prepared`, `downloadable`, `download-consumed`, `confirmed`, or `expired`.
The schema accepts exactly seven pairs: `provisional/prepared`,
`provisional/downloadable`, `provisional/download-consumed`,
`active/confirmed`, `superseded/confirmed`, `revoked/confirmed`, and
`rejected/expired`; `provisional/expired` and every other combination are
invalid.
Bootstrap moves a kit from `provisional/prepared` through
`provisional/downloadable` and `provisional/download-consumed` to
`active/confirmed`. A lost or expired unconfirmed delivery becomes
`rejected/expired`. After readiness, the existing `active/confirmed` kit remains
valid while a replacement progresses through the provisional delivery states;
confirmation atomically advances the epoch, makes the replacement
`active/confirmed`, and makes the old kit `superseded/confirmed`.

**Rationale**: Replacement must not strand a working owner when a download is
lost. A source-lineage and recovery-epoch check prevents old or cross-install
artifacts from authorizing recovery.

**Alternatives considered**: Invalidate the active kit at generation time
(rejected: unsafe if delivery fails); combine authorization and delivery into a
single `state` (rejected: it permits contradictory or fabricated lifecycle
combinations); make active kits expire by time (rejected: offline recovery is
intentionally non-expiring until revocation or epoch change).

## Decision 4: Regenerate only a rejected bootstrap delivery

**Decision**: Add the session-free `POST
/v1/bootstrap/{attemptId}/recovery/regenerate` operation. It accepts only the
valid `X-Bootstrap-Capability` bound to the same credential-verified attempt,
and only when the previous unconfirmed delivery is `rejected/expired`. It
creates a fresh provisional kit and download opportunity, leaves the old
delivery rejected, and does not create or alter owner/workspace ownership.

**Rationale**: A lost or expired download needs a usable retry without turning
bootstrap into a session flow or allowing a stale capability to revive
material. Keeping regeneration on the same credential-verified attempt also
preserves the one-installation concurrency boundary.

**Alternatives considered**: Revive the old delivery (rejected: replay and
ambiguity); require a new bootstrap attempt (rejected: permits competing
attempts and loses the verified ceremony); issue a session (rejected: readiness
still depends on recovery confirmation).

## Decision 5: Make owner credential management explicit and redacted

**Decision**: Expose an owner-session API for listing redacted passkeys,
starting/completing the existing passkey enrollment flow, removing one selected
passkey, and setting/changing the password alternative. Every mutation requires
the owner session cookie, `X-CSRF-Token`, and recent authentication. No
hosting-administrator HTTP endpoint exists; hosting-admin commands remain local
CLI operations and never create a browser/API session.

**Rationale**: The owner can see and control credentials through one coherent
surface while private key material, password material, and session secrets
remain write-only or redacted. A recent-auth gate protects credential changes
even when a session cookie is stolen.

**Alternatives considered**: Remote administrator credential APIs (rejected:
violates the local-admin boundary); returning public keys or password metadata
needed for authentication (rejected: unnecessary disclosure); allowing
credential mutations with CSRF alone (rejected: insufficient protection for
high-impact changes).

## Decision 6: Use two independent key rotation state machines

**Decision**: `WrappingKeyPolicy` rotates the externally supplied deployment
wrapping-key version and rewraps workspace root keys only. `DataKeyPolicy`
rotates the workspace data-key generation and progressively rewrites encrypted
record envelopes and file chunks. Each has its own operation ID, cursor,
checkpoint digest, due policy, write-block policy, and status.

**Rationale**: A deployment secret change is operational key custody; record
reencryption is a data migration. Combining them would make interruption,
progress, and safety claims ambiguous.

**Alternatives considered**: One generation for both (rejected: requires a
full-data rewrite for every secret deployment change); reencrypt all records in
one transaction (rejected: cannot scale or resume); immediately revoke old
data generations (rejected: interrupted operations need decrypt-only support).

## Decision 7: Model due, overdue-within-grace, emergency, and write-block explicitly

**Decision**: Both policies expose `pre-due`, `due`, `overdue-within-grace`, `emergency`,
`write-block`, `in-progress`, `complete`, and `failed`. The wrapping-key
scheduled default is 365 days with a 7-calendar-day grace; emergency compromise
is due immediately with zero write grace. The data-key policy stores its own
configured due and write-block thresholds. Startup and a daily job recalculate
state using an injectable clock. Valid reads and status/progress remain safe;
protected writes fail exactly at the threshold.

**Rationale**: Operators need warning time without allowing indefinite
post-due writes, and tests need deterministic boundary behavior.

**Alternatives considered**: Reject all reads when due (rejected: unnecessary
availability loss); silently rotate on startup (rejected: no operator control
and hard to audit); use process-local timers only (rejected: missed after
restart).

## Decision 8: Use authenticated envelopes with explicit generation metadata

**Decision**: Use AES-256-GCM with per-record/per-chunk nonce and AAD derived
from installation, workspace, entity, entity type, generation, and record
version. HKDF-SHA-256 derives a data-encryption key from the workspace data-key
generation. Store only envelope metadata and ciphertext; validate with the
JSON Schema contract. Scrypt protects the passphrase-wrapped recovery payload.

**Rationale**: Authenticated encryption detects tampering and wrong-key reads;
explicit generation and AAD prevent cross-entity substitution. The external
wrapping key never becomes part of the envelope or application image.

**Alternatives considered**: Plain AES-CBC (rejected: no authenticity);
one workspace-wide nonce/key without derivation (rejected: unsafe reuse and
poor rotation boundaries); host-volume encryption alone (rejected by the
constitution and insufficient for offline copies).

## Decision 9: Preserve feature-001 identities by reference and digest

**Decision**: Security services accept feature-001 workspace/content/history/file/
mutation IDs as input and attach protection metadata to them. Recovery tests
compare a canonical identity manifest before/after. No security migration may
rename, regenerate, merge, or reinterpret those IDs.

**Rationale**: Stable identity is a product invariant and is required for
offline reconciliation, history, files, and later backup/restore.

**Alternatives considered**: Wrap canonical rows in a new security model
(rejected: duplicate authority); regenerate IDs on recovery (rejected: breaks
lineage); derive IDs from ciphertext (rejected: identity must not depend on
storage representation).

## Decision 10: Use a staged migration with a durable capture boundary

**Decision**: Migration states are `prepare-destinations`, `capture-boundary`,
`backfill`, `verify`, `stop-plaintext-writes`, `encrypted-read-cutover`,
`scrub-plaintext`, and `complete`. Dual-write or an equivalent durable capture
boundary covers changes during backfill. Counts, deterministic digests, and
identity sets are verified before write stop; source remains until cleanup.

**Rationale**: A restartable boundary is required to avoid lost writes and
premature plaintext destruction. Separate cutover and scrub checkpoints make
fault recovery testable.

**Alternatives considered**: Big-bang table rewrite (rejected: no resumability);
read-time encryption (rejected: leaves plaintext writable); delete source after
backfill (rejected: verification and rollback risk).

## Decision 11: Use a production `__Host-` cookie with a separate loopback exception

**Decision**: Production sessions use an opaque server-side
`__Host-mn_session` cookie with `Secure`, `HttpOnly`, `SameSite=Strict`, and
`Path=/`, behind HTTPS. Development may set
`MYOWNNOTION_DEV_LOOPBACK_HTTP_COOKIE=1`; code then issues and accepts only the
separate non-`__Host-` `mn_dev_session` cookie, and only when both the trusted
origin and listener are loopback HTTP. It never issues or accepts
`__Host-mn_session` over HTTP. Non-loopback HTTP cannot use this mode.

**Rationale**: The cookie is resistant to domain/path confusion while the
explicit exception keeps local HTTP development usable. Naming the exception
prevents an accidental global “insecure cookies” switch.

**Alternatives considered**: Bearer tokens in local storage (rejected: XSS and
exfiltration risk); `SameSite=None` (rejected: unnecessary cross-site exposure);
global `COOKIE_SECURE=false` (rejected: weakens non-loopback deployments).

## Decision 12: Treat Compose and release evidence as first-class contracts

**Decision**: Official Compose includes API, web, PostgreSQL, durable file
storage, health checks, mounted secrets, loopback HTTP, trusted-proxy/public-
origin/size settings, and a local-build override. The existing
`.github/workflows/ci.yml` is the only quality-gate workflow. It triggers
directly on every `pull_request` and every `push` to `main`, directly on
`workflow_dispatch` for diagnostics, and exposes `workflow_call` for version
tags; it has no non-`main` branch push trigger. The gate includes a blocking
multi-architecture image build on every candidate, and commit-image publication
to GHCR runs in the same workflow run on `main` only. Manual
diagnostics run the gate only and cannot publish. The same aggregate
`quality-gate` job is used for direct and reusable invocations, so there is one
logical gate and no duplicate gate. `.github/workflows/release.yml` triggers
only on version-tag candidates, with an exact guard for
`^v[0-9]+\.[0-9]+\.[0-9]+$`. Its first job calls the local reusable
`./.github/workflows/ci.yml` at the tag commit and is itself the
`quality-gate` dependency for publication. The reusable workflow exports
`candidate_sha` equal to its `github.sha` (the caller SHA), and release
requires that output to equal its own `github.sha`. Missing, skipped,
cancelled, failed, stale, or different-SHA gate evidence blocks every
publication job.

**Rationale**: The constitution requires actual stack validation and exact
candidate enforcement, not documentation-only claims.

**Trigger semantics**: `ci.yml` runs directly on pull requests, on pushes to
`main`, and on `workflow_dispatch` diagnostics, and exposes `workflow_call`.
A non-`main` branch push starts no run, matching constitution v1.3.0, which
makes the required local checks the pre-push gate and the pull request the first
automated gate. The image build is part of the gate on every candidate: a pull
request builds and scans both platforms and publishes nothing, holding no
`packages: write` permission. Commit-image publication for `main` lives in the
same workflow and the same run as the gate, in a job that depends on the
aggregate `quality-gate` and is guarded by the `main` ref plus gate success, so
a passing gate and its publication can never belong to different commits.
Release runs only on strict version-tag pushes and invokes `ci.yml` once at the
tag commit, so the tag path also executes the gate exactly once. The called gate
is usable only when its result is successful, present, current, and its
`candidate_sha` equals release's `github.sha`; any missing, skipped, cancelled,
failed, stale, or mismatched result is a no-publication result. The required
protected-branch check context is the single aggregate `quality-gate` check from
`ci.yml`.

**Alternatives considered for the `main` publication path**: a `release.yml`
triggered on `main` that re-calls `ci.yml` (rejected: with `ci.yml` triggering
directly on `main`, the gate would execute twice per commit), and a
`workflow_run` trigger chained to the completed CI run (rejected: an indirect
trigger reintroduces stale and foreign-commit gate evidence, which FR-034
forbids). Publishing from inside the gate run is the only topology that
satisfies both the direct `main` trigger and the single-gate-execution rule.

**Alternatives considered**: Publish only source (rejected: not a self-hosted
release); floating `latest` (rejected: non-reproducible); a separate duplicate
required quality-gate workflow (rejected: it could drift from `ci.yml` and
create ambiguous required checks); separate partial checks (rejected: a
missing or skipped check could publish unsafe artifacts); public proxy in
Compose (rejected: product-canvas boundary).

## Decision 13: Persist event timestamps as nullable facts

**Decision**: Persist and return `last_activity_at` and `last_sync_at` as
nullable fields. They remain `null` until their corresponding real activity or
successful synchronization event commits, and no registration or read path
backfills them. Validation explicitly reads a newly authorized device before
events, then verifies persisted and returned timestamps after one real event of
each kind.

**Rationale**: A fabricated timestamp misleads the owner about device use and
can hide synchronization failures. Nullable pre-event state is observable and
supports honest device inventory.

**Alternatives considered**: Set both at authorization (rejected: not an actual
event); use process-local timestamps (rejected: not durable or returned
consistently); make the fields optional (rejected: clients need an explicit
`null` before first event).

## Decision 14: Use a canonical empty validation ledger

**Decision**: `specs/002-owner-security-foundation/validation.md` is the only
feature-level evidence ledger. It begins with `pending` rows, raw evidence
fields, formulas, and artifact links for every FR/SC. No blank row is treated
as a pass. SC-002 uses 20 trials and 5 operators; SC-008 uses 10 participants;
the exact acceptance formulas are recorded there.

**Rationale**: A design update must distinguish planned verification from
completed implementation evidence and leave a handoff artifact for later
tasks.

**Alternatives considered**: Put evidence in plan comments (rejected: not
machine-friendly or durable); claim expected results (rejected: violates the
constitution); use feature-001 validation (rejected: different feature and
scope).

## Decision 15: Make bootstrap promotion explicit and attempt-scoped

**Decision**: Use one canonical table with attempt states `started`,
`credential-verified`, `recovery-prepared`, `download-consumed`, `confirmed`,
`abandoned`, and `rejected`. Every state before `confirmed` stores only
attempt-scoped pending credential material and provisional kit records and
reports `0/0`. Successful one-time download consumption plus explicit offline
confirmation is one serializable transaction that promotes the pending
credential, creates the sole owner, binds the existing feature-001 workspace,
activates/confirms the kit, sets `ready`, and returns `1/1`. No combined
recovery-confirmation state is part of the vocabulary. Regeneration remains on
the same attempt and remains `0/0`.

| Attempt state | Scope and committed counts | Allowed transition / result |
| --- | --- | --- |
| `started` | Attempt only; no owner/workspace rows; `0/0`; installation `uninitialized` | Start one serialized attempt; credential challenge may run |
| `credential-verified` | Attempt-scoped verified credential material only; no owner/workspace rows; `0/0` | Valid credential verification; provisional records may be prepared |
| `recovery-prepared` | Attempt-scoped pending credential, kit, and download capability; no owner/workspace rows; `0/0` | Prepare one provisional kit and one 15-minute opportunity |
| `download-consumed` | Same attempt-scoped material; no owner/workspace rows; `0/0` | One successful download consumption; offline confirmation is still required |
| `confirmed` | Atomic promotion commits the sole owner credential and owner, binds the existing feature-001 workspace, activates/confirms the kit, sets installation `ready`, and changes counts to `1/1` | Only successful download consumption plus explicit offline confirmation |
| `abandoned` | Attempt-scoped records only; no owner/workspace rows; `0/0` | Expired/cancelled attempt that is not eligible for confirmation |
| `rejected` | Attempt-scoped rejected/expired material only; no owner/workspace rows; `0/0` | Invalid, expired, replayed, or otherwise refused attempt; regeneration remains attempt-scoped |

**Rationale**: A committed owner foreign key cannot exist before the first
owner exists. Explicit pending material prevents that circular model while the
atomic promotion preserves the single-owner invariant through crashes and
concurrent attempts.

**Alternatives considered**: Commit a placeholder owner first (rejected:
violates pre-confirmation `0/0`); store credential material globally (rejected:
permits cross-attempt reuse); promote in separate transactions (rejected:
could expose an owner without confirmed offline recovery).

## Decision 16: Evidence every security category as an independent gate

**Decision**: Plan five separately observable blocking jobs: `dependency-
vulnerability-audit` (`pnpm audit --audit-level=high --prod`), `secret-scan`
(`pnpm security:secrets` or full-SHA-pinned scanner action),
`static-security-analysis` (`pnpm security:static` or full-SHA-pinned
CodeQL/Semgrep action), `container-vulnerability-scan` (`trivy image
--severity HIGH,CRITICAL --exit-code 1` before publication), and
`license-policy` (`pnpm security:licenses`). Each emits a candidate-SHA-bound
artifact. The aggregate `quality-gate` fails on any high/critical finding,
policy violation, failure, missing/skipped/cancelled/stale result, or missing
artifact. Third-party actions are pinned by full commit SHA during
implementation; diagnostics may collect artifacts but cannot publish.

**Rationale**: Separate evidence prevents one generic green check from hiding a
missing security category and satisfies the constitution's publication gate.

**Alternatives considered**: One combined scanner command (rejected: missing
category evidence is ambiguous); warning-only findings (rejected: unsafe merge
and publication); manual-only scans (rejected: not reproducible).

## Decision 17: Select log presentation from the output destination

**Decision**: Keep Pino/Fastify as the structured logging source and select a
human renderer only for an interactive terminal. Emit newline-delimited JSON
unchanged for non-TTY output. Expose `MYOWNNOTION_LOG_COLOR=auto|always|never`
and `MYOWNNOTION_LOG_LEVEL`, with `auto` and `info` as safe defaults.

**Rationale**: Container runtimes already collect standard streams and expect
machine-readable records. Embedding ANSI codes in those records harms search,
parsing, and alerting, while raw JSON is unnecessarily hostile during local
terminal work. Destination detection satisfies both audiences without making
development and production call different logging APIs. A single factory also
keeps redaction and request serialization from drifting as features are added.

**Alternatives rejected**:

- Always-pretty output was rejected because orchestrators receive decorated
  text instead of structured records.
- Always-JSON output was rejected because it does not meet the local operator
  readability goal.
- Per-feature loggers and direct `console.*` calls were rejected because each
  becomes a new redaction, metadata, and destination policy.
- File logging inside the container was rejected because it bypasses standard
  container collection and creates rotation/retention state in an ephemeral
  filesystem.

## Resolved planning questions

The plan now fixes the technology, recovery authorization/delivery state axes,
regeneration boundary, owner credential API, installation count branches, grace
periods, cookie exception, migration boundaries, release topology, event-time
semantics, evidence fields, and verification paths needed to implement the
revised spec. There are no unresolved clarification markers in the feature
artifacts.
