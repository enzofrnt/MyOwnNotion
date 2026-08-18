# Research: Multi-Device Synchronization

Five decisions. The first is the one that would be expensive to reverse; the
last is the one most likely to be got wrong quietly.

## Decision 1 — Transport: server-sent events over WebSocket

**Decision**: Deliver change notifications with server-sent events (SSE) on a
single `GET` that stays open, rather than a WebSocket.

**Rationale**: The traffic this feature needs is entirely one-directional. The
server tells devices that the stream advanced; devices send their changes
through the existing mutation routes, which already handle idempotency, causal
checks, sealing, and rotation blocks. A WebSocket would add a second write path
whose only distinguishing feature is that none of those protections are wired
into it — and the previous feature found exactly that defect in the batch route,
where a write path had drifted from the guarantees the others enforced.

SSE also reconnects by itself, and its `Last-Event-ID` header is the same
"where was I" question the change cursor already answers. Reconnection and
catch-up therefore become one mechanism rather than two, which matters because
FR-005 forbids losing an event and two mechanisms are two chances to lose one.

Behind a reverse proxy SSE is ordinary HTTP: no upgrade handshake to configure,
no proxy that silently drops a protocol it was not told about.

**Alternatives considered**:

- *WebSocket.* Justified when the client pushes a high rate of small messages —
  cursor positions, presence, keystrokes. This product has none of those: it is
  single-owner, so there is no presence, and the constitution rules out
  real-time co-editing permanently. The cost is a second write path.
- *Long polling.* Works and reconnects, but each cycle is a fresh request with
  its own handshake; under the two-second target that is a lot of connections to
  achieve what one open one does.
- *Polling faster.* The honest baseline, and it fails FR-002 unless the interval
  is short enough to be indistinguishable from a busy loop against the database.

**Consequence**: the notification carries the new stream position and nothing
else. Devices then fetch through `/v1/changes`, which they already do — so the
push path cannot deliver content the pull path would have refused.

## Decision 2 — The notification carries a position, not a payload

**Decision**: An event says "the stream is now at N". It does not carry the
changed content.

**Rationale**: This is what keeps one authority. A payload pushed over SSE would
bypass `resolveProtectedContent`, the sealed-envelope resolution, and the
protocol-version check that `/v1/changes` performs — and a device that applied it
would hold content that never passed those gates. The failure would be silent
and per-device, which is the worst combination for something an owner cannot
inspect.

It also makes idempotency free (FR-007): a position is a fact, not an operation,
so receiving "now at 41" twice is receiving it once. A payload would need its own
deduplication, and the existing mutation identities are not visible on the read
path.

**Alternatives considered**:

- *Push the change envelope.* One round trip fewer per change, at the cost of a
  second content path with different protections. Rejected for the reason
  feature 005 documented: the busiest path must not be the one whose guarantees
  drifted.
- *Push a summary and let the client decide whether to fetch.* All of the risk
  and most of the complexity, for a saving that only appears when a device is
  uninterested in what changed — which for a single-owner workspace is rare.

## Decision 3 — Conflict detection stays where it is; only presentation is new

**Decision**: Do not add conflict detection. Feature 001's causal check already
decides, and it already distinguishes "behind" from "diverged".

**Rationale**: FR-011 — a device that is merely behind must never produce a
conflict — is *already true*, because a stale device's write is rejected with
competing revision identities only when the bases actually diverge. Building a
second detector would create the possibility of the two disagreeing, and the one
an owner sees would then depend on which ran.

What is genuinely missing is the resolution: features 001 and 003 retain a
conflict durably and make it visible, and neither offers the owner a way to
decide. That is the work.

**Alternatives considered**:

- *Vector clocks or a CRDT.* Would let more changes merge automatically. It is
  also a different content model, and the spec's assumption is explicit that
  merging is per block. Adopting a CRDT here would be choosing it by accident
  rather than as a decision.
- *Last-write-wins with a "conflicts" log.* Simple, and it silently destroys one
  side. FR-016 forbids exactly this.

## Decision 4 — Merge granularity: the block, because blocks have identities

**Decision**: Two devices editing different blocks of one page is a compatible
change and merges automatically. Two devices editing the same block is a
conflict presented for resolution.

**Rationale**: The document is a list of blocks with stable ids, so this rule is
computable from the model already in place: take the common ancestor, and any
block changed on only one side takes that side. It is also the rule an owner
would guess, which matters more than elegance for something that decides what
happens to their words.

Character-level merging inside a block would need operation history rather than
document states, which the revision model deliberately does not keep.

**Alternatives considered**:

- *Whole-document conflict.* What effectively happens today. Correct and
  needlessly painful: two devices editing different paragraphs of a long page is
  the commonest divergence and the safest to merge.
- *Line or character merging.* Better outcomes when it works, and it needs a
  content model this product does not have.

**Consequence**: the merge is a pure function over three document states —
ancestor, local, remote — which is where it will live and how it will be tested.

## Decision 5 — Protocol version: announced on every response, enforced on writes

**Decision**: The server states its protocol version in a response header on
every request, and refuses writes from clients outside the compatibility
window. Reads stay open when they are safe, which is what puts an old client in
read-only mode rather than locking it out.

**Rationale**: FR-018 is about preventing corruption, and corruption comes from
writes. Refusing reads as well would turn a recoverable "please update" into an
owner who cannot see their own notes on a device that was working yesterday —
and a device that can read is a device from which they can still copy something
out.

Announced on every response rather than on a dedicated endpoint so a client
cannot be compatible at handshake and incompatible later: a server upgraded
under a long-lived connection changes the header, and the next write is
evaluated against the new value.

**Alternatives considered**:

- *Version in the URL path.* Already there (`/v1`), and it is too coarse: this
  window has to move between stable releases without minting a new path each
  time.
- *Refuse everything on mismatch.* Simpler, and it strands an owner whose reads
  were perfectly safe.

## Resolved unknowns

| Question | Answer |
| --- | --- |
| Which transport | Server-sent events over the existing HTTP surface |
| What an event carries | The new stream position; content still comes from `/v1/changes` |
| How conflicts are detected | They already are, by feature 001's causal check |
| What merges automatically | Different blocks of one page; same block is a conflict |
| How versions are policed | Header on every response, enforced on writes, reads stay open |
