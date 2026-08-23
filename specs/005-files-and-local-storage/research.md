# Research: Files and Local Storage

Six decisions, each recorded with what it rules out. Resumable transfer is a
durable protocol choice. Diagram editing is deliberately not one yet: the
earlier container-based decision was reversed before V1 so an optional editor
cannot complicate the application's essential deployment and synchronization
foundations.

## Decision 1 — Resumable upload protocol: tus over a hand-rolled scheme

**Decision**: Implement the server side of the [tus 1.0 resumable upload
protocol](https://tus.io/protocols/resumable-upload) for file content, rather
than inventing a chunk-and-offset scheme.

**Rationale**: FR-006 asks for resumability "where the protocol allows it",
which is really a request not to lose a 2 GB upload to a dropped connection.
The hard parts are not the happy path: they are what happens when the client
and server disagree about how many bytes arrived, when two uploads of the same
file race, and when a half-written upload has to expire. tus answers all three
with `HEAD` returning the authoritative offset, and it is a small protocol —
`POST` to create, `PATCH` at an offset, `HEAD` to resume.

Writing our own would mean re-deriving those answers, and the failure mode of
getting them subtly wrong is a file that reports success and is corrupt.

**Alternatives considered**:

- *Single `POST` with a large body, as today.* Adequate for small attachments
  and hopeless for the 2 GB the spec commits to: any interruption restarts from
  zero, which on a domestic connection can mean never finishing.
- *`Content-Range` on `PUT`.* Fewer moving parts, but the range semantics for
  partial uploads are not standardised the way tus's are, so client and server
  would carry a private agreement anyway — a hand-rolled scheme wearing an HTTP
  header.
- *Multipart with client-side part tracking.* Shifts the bookkeeping to the
  client, which is exactly where it survives least: a closed tab loses it.

**Consequence**: uploads gain a lifecycle of their own — created, partially
received, completed, expired — which the data model has to hold. Expiry is
mandatory, not optional: an abandoned upload otherwise occupies storage no
screen accounts for.

## Decision 2 — Diagram editing: deferred, internal, and never a service

**Decision**: Feature 005 stores and downloads `.drawio` files as ordinary
opaque attachments. It does not preview or edit them. The Compose stack has no
Draw.io service, and the document model has no Draw.io remote-embed provider.

If diagram editing is specified after the V1 editor and synchronization
foundations, its runtime must execute inside MyOwnNotion and use the same local
durability, synchronization, history and backup paths as other content.

**Rationale**: A public `diagrams.net` iframe sends private diagram content to a
third party and fails offline. A separate self-hosted container avoids that leak
but still turns an optional future editing surface into another deployed
application with its own origin, startup, health, updates and failure modes.
That is the wrong trade while the core editor and multi-device convergence are
still being established.

The project is pre-V1, so the earlier container decision is removed rather than
kept as compatibility debt. A `.drawio` file remains safe and recoverable: it
can be uploaded, synchronized and downloaded without pretending an editor
exists.

**Alternatives considered**:

- *Public embed at `embed.diagrams.net`.* Rejected on privacy and offline
  behaviour.
- *Separate self-hosted Draw.io container.* Previously selected, now rejected
  because it expands the essential stack for a deferred feature.
- *Internal engine now.* Deferred so synchronization and the primary editor
  remain the development priority.

**Consequence**: future compatibility may import/export the Draw.io file format,
but no current runtime, environment variable, container or remote provider is
reserved for it.

## Decision 3 — Preview isolation: sandboxed iframe on a separate origin-like context

**Decision**: Render every preview inside a `sandbox`ed iframe that receives
the file as an opaque blob, with no same-origin access to the application.
Downloads are served with `Content-Disposition: attachment` and
`X-Content-Type-Options: nosniff`, under a `Content-Security-Policy` that
forbids script execution for file responses.

**Rationale**: FR-013 exists because a file is arbitrary bytes an owner
obtained from somewhere else, and two of the formats the product commits to
previewing — SVG and PDF — can carry script. An SVG rendered in the
application's own document is script running with the application's privileges,
against a workspace that holds everything the owner has written.

The layered answer matters: sandboxing stops execution from reaching the
workspace, `nosniff` stops a file being reinterpreted as something executable,
and `Content-Disposition` stops a download being rendered inline in the first
place. Any one of them alone has a known bypass shape.

**Alternatives considered**:

- *Sanitise SVG and strip active content.* Sanitisers are a moving target and a
  bypass is silent. Worth doing *in addition*, never instead.
- *`<img>` for images, native viewer for PDF.* Fine for raster images, which
  cannot execute; insufficient for SVG and PDF.
- *Serve files from a genuinely separate domain.* The strongest isolation, and
  it is rejected only because it conflicts with the deployment story: the
  product promises to run behind one administrator-managed reverse proxy on one
  origin. Revisit if a second hostname ever becomes acceptable.

## Decision 4 — Usages: derived by indexing, not maintained by hand

**Decision**: Record a file's usages by indexing the places that reference it —
attachment placements, hierarchy placements, and embeds inside page documents —
and recompute that index when a document changes, rather than asking every
writer to maintain a reference list.

**Rationale**: FR-004 refuses a deletion until the owner has seen every usage,
so an incomplete index is worse than none: it produces a confirmation that
claims a file is unused when it is not, and the owner then destroys something
they still need. Hand-maintained back-references drift the moment one write
path forgets to update them, and there are three such paths already.

Placements are already rows and already exact. Embeds are inside the document
body, so they need extraction on write — a pure function over the block
document, which is testable in isolation and lives in the domain package where
the document model already lives.

**Alternatives considered**:

- *`reference_count` alone, which the schema already carries.* It answers "is
  this used" and cannot answer "used where", which is the question FR-004 asks.
  Kept for storage reclamation; not sufficient for the confirmation dialogue.
- *Scan every document at deletion time.* Correct and unboundedly slow; the
  scan a deletion needs is the one an owner is waiting on.

## Decision 5 — Local budget: `navigator.storage` for measurement, application policy for eviction

**Decision**: Measure with `navigator.storage.estimate()`, request durability
with `navigator.storage.persist()`, and make every eviction decision in
application code against the owner's configured limit.

**Rationale**: FR-014 to FR-018 describe a policy with an explicit priority
order, including content the client may never evict. Browser-driven eviction
knows none of that: it can discard an origin's storage wholesale, taking
unsynchronized changes with it — precisely what FR-017 forbids. So the browser
is used for the two things it alone can do, reporting space and granting
persistence, and the policy stays where the requirements are.

**Alternatives considered**:

- *Let the browser evict.* Simple, and it violates FR-017 the first time it
  runs.
- *Track bytes ourselves without `estimate()`.* Our own accounting drifts from
  what the device actually reports, and the number an owner is shown is then
  fiction.

**Consequence**: offloading is an application operation with a record, which is
what lets FR-018 keep titles and metadata while dropping content, and lets
FR-019 explain where the space went.

## Decision 6 — Offline intent is content, not device preference

**Decision**: Store "always available offline" on the server as part of the
item, alongside favourites, rather than in the device-local navigation state.

**Rationale**: The same reasoning feature 003 applied to favourites applies
here, and the spec's own wording settles it: the instruction is about *what
matters to the owner*, not about one device's ergonomics. An owner who marks a
branch for offline use on their laptop means it on their phone too — that is
the whole point of marking a branch rather than opening it.

The device-local part is what follows from the intent: whether this particular
device has actually fetched the content yet. That is genuinely per-device and
stays in the local projection.

**Alternatives considered**:

- *Per-device intent.* Would require the owner to repeat the same instruction
  on every device, and would make "always available offline" mean something
  different on each — a setting that cannot be reasoned about.

## Resolved unknowns

| Question | Answer |
| --- | --- |
| Which resumable protocol | tus 1.0, server-side |
| Where diagram editing runs | Deferred; future engine inside MyOwnNotion, never a separate service |
| How previews are isolated | Sandboxed iframe, `nosniff`, `Content-Disposition: attachment` |
| How usages are known | Derived index over placements and document embeds |
| How local space is measured | `navigator.storage.estimate()`, policy in application code |
| Where offline intent lives | Server, with the item; fetch state stays local |
