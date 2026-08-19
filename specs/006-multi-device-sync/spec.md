# Feature Specification: Multi-Device Synchronization

**Feature Branch**: `feat/006-multi-device-sync`

**Created**: 2026-08-17

**Status**: Draft

**Input**: User description: "Multi-device synchronization: real-time transport, catch-up, client-server compatibility, file synchronization, device revocation, history and visual conflict resolution… Scope is product-canvas sections 9 and 17 to 20. Depends on features 001 to 005, all delivered."

## Product Direction, Dependencies, and Scope

This feature realises sections 9 and 17 to 20 of
[`docs/product/product-canvas.md`](../../docs/product/product-canvas.md), and
feature 006 of the roadmap.

Features 001 to 005 already deliver the parts that make synchronization
possible, and this feature does not rebuild them: revisions with causal bases,
a durable outbox that survives a closed tab, reconciliation that records
conflicts rather than resolving them silently, per-item save state derived from
the outbox, and authorised devices with their own keys.

What is missing is everything that makes several devices feel like one
workspace:

1. **Changes arrive without being asked for.** Today a device learns about a
   change when it next polls. The product promises a change made on one device
   appears on another in under two seconds.
2. **A device that was away catches up completely.** Not "mostly": an event
   that is missed is a change the owner made and cannot see.
3. **A conflict is resolvable.** Feature 001 records conflicts durably and
   feature 003 makes them visible; neither lets the owner *decide*.
4. **A version mismatch is refused, not survived.** A client that writes with a
   protocol the server does not understand corrupts content rather than failing.

The product remains strictly single-owner. "Multi-device" means several devices
belonging to one person, never several people — there is no presence, no
awareness of who is typing, and no real-time co-editing.

**Out of scope**: real-time collaborative editing between people (permanently
out of scope per the constitution), search indexing (feature 008), and the
desktop clients that will consume this transport (feature 014). Device
authorisation and revocation mechanics come from feature 002; this feature
specifies what synchronization must do *when* a device is revoked.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A change appears on the other device (Priority: P1)

The owner edits a page on their laptop. Their phone, open on the same page,
shows the change without being touched. The same holds for a new page, a
rename, a move, a file, and a relationship.

**Why this priority**: This is the feature. Everything else here supports it or
protects it.

**Independent Test**: Open the workspace on two devices, change something on
one, and observe the other without interacting with it.

**Acceptance Scenarios**:

1. **Given** two connected devices, **When** the owner edits a page on one,
   **Then** the other shows the change within two seconds.
2. **Given** two connected devices, **When** the owner creates, renames, moves,
   or trashes an item on one, **Then** the other reflects it within two seconds.
3. **Given** two connected devices, **When** a file finishes uploading on one,
   **Then** the other lists it and can open it.
4. **Given** a device with no network, **When** the connection returns,
   **Then** it reconnects without the owner doing anything.

### User Story 2 - A device that was away misses nothing (Priority: P1)

A device closed for a week reopens. It receives everything that happened while
it was away, in order, and ends in exactly the state the other devices are in.

**Why this priority**: The same priority as live delivery, because a change
that never arrives is worse than one that arrives late. An owner who finds a
device permanently behind stops trusting every device.

**Independent Test**: Take a device offline, make a hundred changes elsewhere,
bring it back, and compare its state with the server's.

**Acceptance Scenarios**:

1. **Given** a device that has been away, **When** it reconnects, **Then** it
   receives every change since its last known position, in order.
2. **Given** a device whose position is too old to serve incrementally,
   **When** it reconnects, **Then** it is resynchronised from a snapshot rather
   than left inconsistent.
3. **Given** a transport interrupted midway through catching up, **When** it
   resumes, **Then** it continues from where it stopped and no event is
   delivered twice in a way that changes the outcome.
4. **Given** a device that has caught up, **When** its content is compared with
   the server's, **Then** they agree exactly.

### User Story 3 - A real conflict is resolvable, a stale device is not a conflict (Priority: P1)

The owner edits the same page on two devices while one is offline. On
reconnection they are shown both versions and their common ancestor, and they
decide — keeping parts of each, or one wholesale. Nothing is destroyed before
they choose, and the choice creates a new version rather than overwriting
either.

Meanwhile a device that is merely behind is never presented as a conflict.

**Why this priority**: Feature 001 already keeps conflicting work safely and
feature 003 makes it visible. This is the part that lets an owner act, and
without it a conflict is a permanent state rather than a moment.

**Independent Test**: Produce a genuine divergence on two devices, resolve it
in the comparison screen, and confirm both original versions still exist
afterwards.

**Acceptance Scenarios**:

1. **Given** a device that is simply behind, **When** it catches up, **Then**
   no conflict is reported.
2. **Given** the same page edited independently on two devices, **When** they
   reconcile, **Then** a conflict is reported with both versions and their
   common state.
3. **Given** a reported conflict, **When** the owner resolves it, **Then** the
   result is a new version and both sources remain in the history.
4. **Given** a reported conflict, **When** the owner has not resolved it,
   **Then** neither version is destroyed and neither is silently preferred.
5. **Given** a resolution in progress, **When** the owner reviews it before
   committing, **Then** they see exactly what will be saved.

### User Story 4 - Version mismatch and revoked devices fail safely (Priority: P2)

An out-of-date client refuses to write rather than corrupting content, and says
what to update. A revoked device stops synchronizing and says why.

**Why this priority**: Lower than the three above because it protects against
situations an owner meets rarely — but when they do meet them, the cost of
getting it wrong is corrupted content or a device that keeps syncing after its
access was withdrawn.

**Independent Test**: Point a client at a server announcing an incompatible
protocol version, and separately revoke a device while it is connected.

**Acceptance Scenarios**:

1. **Given** a server announcing a protocol version this client does not
   support, **When** the client connects, **Then** it refuses to write, says
   what update is needed, and does not corrupt anything.
2. **Given** a client one stable version behind, **When** the protocol is still
   compatible, **Then** it synchronizes normally.
3. **Given** a client too old to write safely but able to read, **When** it
   connects, **Then** it is placed in read-only mode rather than refused
   outright.
4. **Given** a connected device that is revoked, **When** the revocation takes
   effect, **Then** that device stops receiving and sending changes and states
   that its access was withdrawn.

### Edge Cases

- Two devices write the same field within the same second.
- A change arrives while the receiving device is in the middle of an edit to the
  same page.
- The transport reconnects repeatedly on a flapping connection.
- A device's position refers to a change that has since been purged.
- A conflict on an item that is deleted before the owner resolves it.
- A file is still uploading on one device when another asks for it.
- The server restarts while devices are connected.
- A device's clock is significantly wrong.

## Requirements *(mandatory)*

### Functional Requirements

**Live delivery**

- **FR-001**: A change accepted by the server MUST reach every other connected
  device without that device asking for it.
- **FR-002**: A textual change MUST appear on another connected device in under
  two seconds in at least 95% of measured cases, under normal network
  conditions.
- **FR-003**: The transport MUST reconnect automatically after an interruption,
  without the owner acting.
- **FR-004**: Items, page content, files, and relationships MUST all
  synchronize.

**Catch-up and completeness**

- **FR-005**: A device MUST receive every change since its last known position,
  in order, with no event lost.
- **FR-006**: A device whose position can no longer be served incrementally
  MUST be resynchronised from a snapshot rather than left inconsistent.
- **FR-007**: Delivery MUST be idempotent: receiving the same change twice MUST
  NOT change the outcome.
- **FR-008**: An interrupted catch-up MUST resume from where it stopped.

**Visible state**

- **FR-009**: Each modifiable content MUST be able to present: saved locally,
  waiting to synchronize, synchronizing, synchronized, recoverable error, and
  conflict needing action.
- **FR-010**: The interface MUST show whether this device is currently
  connected and, when it is not, that changes are being kept locally.

**Conflicts**

- **FR-011**: A device that is merely behind MUST NOT produce a conflict.
- **FR-012**: A conflict MUST be reported only when the same content evolved
  independently on more than one device since their last common state.
- **FR-013**: Compatible changes MUST merge without asking the owner.
- **FR-014**: When a safe merge is impossible, the owner MUST be shown the
  local version, the remote version, and their common state.
- **FR-015**: The owner MUST be able to choose parts of each version, take one
  wholesale, reorder the result, and review it before committing.
- **FR-016**: No version MUST be destroyed before the owner resolves, and the
  resolution MUST produce a new version leaving both sources intact.

**Compatibility**

- **FR-017**: The server MUST announce a protocol version.
- **FR-018**: A client that cannot write safely under the announced version
  MUST refuse to write and MUST state what update is required.
- **FR-019**: A stable server MUST accept the matching stable client and the
  immediately preceding stable client while their protocol remains compatible.
- **FR-020**: A client able to read but not write safely MUST be placed in
  read-only mode rather than refused entirely.

**Devices and history**

- **FR-021**: A revoked device MUST stop synchronizing and MUST state that its
  access was withdrawn.
- **FR-022**: History MUST identify at least the date, the device, and the
  nature of each change.
- **FR-023**: History MUST NOT record technical secrets in clear text.

### Key Entities

- **Change event**: one accepted mutation as it is delivered — its position in
  the ordered stream, the revisions it produced, and the items it touched.
- **Stream position**: how far a device has consumed. The single value that
  decides between incremental catch-up and a snapshot resynchronisation.
- **Protocol version**: what the server speaks, and what a client must
  understand to write.
- **Conflict**: two revisions of one item descending independently from a
  common ancestor, with all three retained.
- **Resolution**: a new revision whose parents are both conflicting versions,
  leaving each untouched.
- **Device session**: a connected device, its position, and whether it may still
  read and write.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: With two devices connected, a textual change appears on the other
  in under two seconds in at least 95% of measured attempts.
- **SC-002**: A device offline for a hundred changes reconnects and ends
  byte-identical to the server for every affected item.
- **SC-003**: No measured catch-up loses an event, across repeated
  interruptions at random points.
- **SC-004**: A device that is only behind produces zero conflicts.
- **SC-005**: A genuine divergence produces exactly one conflict, with both
  versions and their common ancestor reachable.
- **SC-006**: After a resolution, both original versions are still retrievable
  from history.
- **SC-007**: A client announcing an unsupported protocol version performs no
  write, and the message names the required update.
- **SC-008**: A revoked device performs no further read or write within one
  minute of revocation.
- **SC-009**: Every entry in the history states a date, a device, and what
  changed, and none contains key material or a session identifier.

## Assumptions

- **The existing change feed is the ordering authority.** Feature 001 already
  records changes with a cursor; live delivery notifies devices about that
  stream rather than inventing a second one. Two orderings would eventually
  disagree, and the one an owner sees would then depend on which arrived first.
- **"Real-time" means server-pushed, not peer-to-peer.** Devices do not talk to
  each other. The server is already the authority on ordering and the only
  party that can enforce the causal check.
- **Merging is per block, not per character.** The document model is a list of
  blocks with stable identities, so two devices editing different blocks is a
  compatible change and two editing the same block is not. Character-level
  merging would require a different content model and belongs to a feature that
  chooses one deliberately.
- **The compatibility window is two stable versions**, per the product canvas:
  the matching client and the one before it.
- **Clock skew does not decide anything.** Ordering comes from the server's
  stream position, never from a device's clock, so a wrong clock affects what
  history *displays* and not what wins.
- **Revocation is enforced server-side.** A revoked device is refused by the
  server; the client's own behaviour on learning it was revoked is a courtesy,
  not the mechanism.
