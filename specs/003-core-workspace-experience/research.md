# Phase 0 Research: Core Workspace Experience

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Date**: 2026-08-15

Six questions had to be answered before the design could be written. Four were
open; two looked open and turned out to be settled by facts already in the
repository. Each is recorded with what was chosen, why, and what was rejected.

---

## 1. Does the stored document use the editor library's format, or our own?

**Decision**: Our own. `myownnotion.document+json` gains `formatVersion: 2`,
whose body is an ordered block tree defined in `@myownnotion/domain`. The
editor library converts to and from it at a boundary in the web app.

**Rationale**: FR-005 requires a documented internal content model with a
defined export path, independent of the editing library, and the constitution
repeats the requirement when it names Tiptap as the *initial candidate*. But
the decisive argument is not compliance, it is FR-006. ProseMirror validates
content against its schema and discards what does not fit; `Node.fromJSON`
throws on an unknown node type outright. If the stored document *were*
ProseMirror JSON, then an unrecognised block would be destroyed by the very act
of opening the page — the schema is the storage format, and there is no layer
left where the original could be kept. Owning the format is what makes the
preservation requirement expressible at all.

**Alternatives considered**:

- *Store ProseMirror JSON directly.* Cheapest by a wide margin, and eliminates
  a conversion layer. Rejected: it makes FR-006 unimplementable and FR-005
  false, and it welds the durable representation of an owner's notes to a
  library's internal schema — the exact lock-in Principle V asks to justify in
  writing.
- *Store Markdown.* Portable and human-legible. Rejected: it cannot represent
  block identity, nested children, or an unknown block, so reordering, stable
  addressing, and preservation all become guesswork. Markdown remains the
  *export* target, which is the role it is good at.
- *Store both, with the model derived from ProseMirror on write.* Rejected as
  two sources of truth that will disagree the first time a conversion is
  imperfect, with no rule for which one wins.

---

## 2. How is an unrecognised block preserved (FR-006, SC-009)?

**Decision**: A dedicated `unknownBlock` ProseMirror node — an atom, not
editable, rendered as a visible "this client cannot display this block"
placeholder — carrying the **original block JSON verbatim** in an attribute.
The conversion back to the model re-emits that stored value rather than
reconstructing it from what was rendered.

**Rationale**: Tiptap does offer detection: `enableContentCheck: true` emits
`contentError` through `onContentError` when initial content does not match the
schema ([Invalid schema handling](https://tiptap.dev/docs/guides/invalid-schema)).
That tells you something was wrong; it does not keep it. The default remains
stripping, and the static renderer's `unhandledNode` escape hatch is not used
by `Node.fromJSON`, which throws instead
([tiptap#6866](https://github.com/ueberdosis/tiptap/issues/6866),
[tiptap#2283](https://github.com/ueberdosis/tiptap/issues/2283)). Preservation
therefore cannot be delegated to the library — it has to happen in our
converter, before ProseMirror ever sees the node.

Keeping the original JSON *verbatim* rather than a parsed copy is what makes
SC-009's "byte for byte" honest: nothing is normalised, no key order is
rewritten, no default is filled in. The block goes out exactly as it came in
because it was never interpreted.

**Alternatives considered**:

- *`enableContentCheck` plus a warning.* Rejected: detects the loss, does not
  prevent it. The owner is told their block was destroyed, which is worse than
  useless.
- *A permissive catch-all ProseMirror node with `attrs: { any }`.* Rejected as
  the same thing with extra steps: content still passes through schema
  normalisation, so "unchanged" would be a claim we could not test.
- *Refuse to open a document containing an unknown block.* Rejected: it makes a
  forward-compatibility problem into an outage, and an owner cannot fix it.

---

## 3. How do existing v1 documents become v2?

**Decision**: They are not converted. A body with no recognised block structure
is read as a **legacy document** and presented as a single read-only code block
containing its JSON. It becomes v2 only when the owner edits it, and the
original body is preserved verbatim until that moment, exactly as an unknown
block is.

**Rationale**: This was the question that looked open and was not. Since
feature 002, the document body is sealed — the server stores an envelope and
does not hold a key. **A server-side data migration is not merely awkward here,
it is impossible by construction**, and that is a property worth keeping, not
working around. Which leaves the client, and a client that rewrites an owner's
stored document during a read is doing something an owner did not ask for and
cannot audit. Deferring the upgrade to the first real edit means every write is
one the owner initiated.

**Alternatives considered**:

- *A server-side migration job.* Rejected: it would require the server to
  decrypt every document body, which is the boundary feature 002 exists to
  establish. Nothing in this feature justifies breaking it.
- *Convert on read and write back immediately.* Rejected: silent writes on
  open, and a bad conversion would be committed before anyone saw it.
- *Best-effort parse of the v1 body into blocks.* Rejected: the v1 body is
  `additionalProperties: true` with no agreed shape, so any parse is a guess,
  and a wrong guess loses content.

---

## 4. Where does the save state come from (FR-007, FR-008)?

**Decision**: Derived from feature 001's outbox, not tracked separately. The
four states map as: **unsaved** = a `pending` row exists for the item;
**sending** = a `sending` row exists; **blocked** = a `blocked` row exists (a
new status, added for server refusals such as a rotation write block);
**saved** = no outbox row for the item *and* the last server response confirmed
the write. Conflicts (`conflict`, already present) surface separately under
FR-011.

**Rationale**: A second source of truth for "is this saved" is how an interface
comes to claim success it has not had — the precise failure FR-008 forbids.
Deriving from the outbox means the statement is a projection of the same rows
the reconciler acts on, so the two cannot disagree. The current status set is
`pending | sending | conflict` (`packages/client-core/src/local-store/schema.ts`),
which has no way to express "the server refused and retrying will not help";
`blocked` is that state, and FR-010 requires it to be distinguishable so the
interface can say what would resolve it.

**Alternatives considered**:

- *A per-document dirty flag in React state.* Rejected: diverges from the
  outbox the moment a tab is closed mid-flight, and FR-009 is specifically
  about that moment.
- *Reuse `conflict` for server refusals.* Rejected: they call for opposite
  responses — a conflict needs the owner to choose between versions, a block
  needs them to unblock something — and FR-010 and FR-011 are separate
  requirements for that reason.

---

## 5. Which editor library?

**Decision**: Tiptap 3 (ProseMirror), used only for editing behaviour, with the
storage format kept out of its hands per decision 1.

**Rationale**: The constitution names it as the initial candidate, and nothing
found in this research contradicts that choice once the format is ours. What it
supplies is the part that is genuinely hard and genuinely not our product:
selection over a nested tree, block transformation, input rules, drag handling,
and a correct undo stack — all of FR-002 to FR-004. Its known weakness,
aggressive schema enforcement, is confined to the rendering side of the
boundary, where discarding an unknown node is harmless because the model still
holds it.

**Alternatives considered**:

- *BlockNote.* Closer to the target interface out of the box and would save
  visible work. Rejected: it owns the document format, which is the one thing
  FR-005 says we must own, and it is a further layer over the same ProseMirror.
- *Editor.js.* Block-native and simple. Rejected: weaker nested-structure and
  selection support, and again a prescribed storage format.
- *Hand-rolled on `contenteditable`.* Rejected in Complexity Tracking: months
  of browser-bug work for a component that is not the product.

---

## 6. How is the accessibility criterion (SC-004) actually verified?

**Decision**: `@axe-core/playwright`, asserting no `critical` or `serious`
violations on the workspace, the editor, and the settings screens, run inside
the existing Playwright suite.

**Rationale**: It is the standard, maintained integration of the standard
engine, and it runs in the harness that already exists rather than adding a
second one. This also honours the standing preference for off-the-shelf tooling
over hand-written equivalents: an accessibility checker we wrote ourselves would
be a rule set we maintain and nobody trusts.

**Alternatives considered**:

- *Hand-written assertions on roles and labels.* Not rejected outright — they
  remain, as the journey tests, because axe cannot tell whether the tree
  *behaves* correctly under arrow keys. But as the audit of SC-004 they were
  rejected: an audit that only checks what its author thought of is not an
  audit.
- *Lighthouse CI.* Rejected: broader remit, noisier signal, and a heavier
  addition to the pipeline for a subset of what axe reports.

---

## Resolved unknowns

## 7. How are internal page links kept separate from hierarchy children?

**Decision**: Store an internal mention as a `pageLink` inline mark carrying
the stable target item ID, and maintain one canonical `page-link` relationship
per source/target pair. The page-document mutation receives the explicit target
set and reconciles relationship rows in the same transaction as the document
revision. The web editor uses a local page picker and renders the mark with a
distinct internal-link affordance.

**Rationale**: A URL-shaped string alone would lose the distinction between an
external link and a canonical page reference, and deriving backlinks by
decrypting every document would violate the existing relationship projection.
Using a relationship row also means rename, move, conversion, trash, export,
and diagnostics continue to address the stable item identity. The relation is
not a placement, so linking to a descendant cannot create a hierarchy cycle.

**Alternatives considered**:

- *Create a hierarchy placement when a page is mentioned.* Rejected: it makes
  ordinary references restructure the workspace and cannot represent a page
  elsewhere without duplication.
- *Store only an internal URL in the document.* Rejected: it conflates page
  references with external links and leaves backlinks without a canonical edge.
- *Keep one relationship per mention.* Rejected: repeated labels in a
  document would create duplicate graph edges; the canonical relation is one
  source/target edge while the document preserves each visible mention.

---

## 8. How should the Tiptap Notion-like ecosystem shape later editor work?

**Decision**: Treat Tiptap's official Notion-like template and UI components as
research-backed accelerators for a later editor-experience feature, not as the
stored format, the product specification, or an automatic runtime dependency.
The default path remains the open-source editor core, selectively adopted
components, the existing MyOwnNotion document model, and the existing
conversion boundary.

**Evidence**:

- Tiptap publishes an official
  [Notion-like editor template](https://tiptap.dev/docs/ui-components/templates/notion-like-editor)
  with block drag and drop, slash and context menus, responsive light/dark UI,
  rich formatting, mentions, emoji, media, collaboration, and AI. This proves
  the target interaction model is practical on the selected editor engine.
- The template requires a Start plan for production and is governed by the
  Tiptap Pro licence. Collaboration and AI configuration use Tiptap services,
  and image upload still requires an application server. It therefore cannot
  be adopted wholesale without a deliberate licence, hosting, privacy, and
  self-hosting decision.
- Tiptap's
  [UI components](https://tiptap.dev/docs/ui-components/getting-started/overview)
  are copied into the consuming project as editable source. Components backed
  by open-source extensions are MIT-licensed; components backed by paid
  features are not open source and commonly depend on Tiptap services. The same
  documentation currently warns that React 19 support is still being improved,
  so compatibility must be proven against the repository's actual runtime
  rather than inferred from the demo.
- The open-source editor remains headless and extension-based. Official
  extensions cover useful Notion-like primitives including
  [drag handles](https://tiptap.dev/docs/editor/extensions/functionality/drag-handle),
  [collapsible details](https://tiptap.dev/docs/editor/extensions/nodes/details),
  [task lists](https://tiptap.dev/docs/editor/extensions/nodes/task-list),
  [tables](https://tiptap.dev/docs/editor/extensions/nodes/table), and
  [file drop/paste events](https://tiptap.dev/docs/editor/extensions/functionality/filehandler).
  File handling deliberately does not upload or persist bytes, which keeps that
  responsibility with feature 005.

**Capability ownership**:

| Capability | Owning work | Reason |
|------------|-------------|--------|
| Slash menu, Markdown shortcuts, block transformation, undo/redo, page links | Feature 003 baseline | Already required and verified here. |
| Contextual block menu, drag handle, floating toolbar, colours, collapsible sections, simple document tables, editor design system | Dedicated editor-experience follow-up | These refine writing without redefining another domain. |
| Images, files, uploads, embeds backed by stored bytes | Feature 005 plus the editor follow-up | The editor renders the interaction; feature 005 owns identity, transfer, availability, and safety. |
| Multi-device editing feedback and conflict interaction | Feature 006 plus the editor follow-up | Feature 006 owns transport, catch-up, causal state, and resolution. |
| Typed properties, database entries, filters, sorting, Kanban, gallery, and calendar views | Separate database feature | These are a data/query domain, even if surfaced inside a custom editor node. |
| Presence, multi-user comments, and real-time co-editing | Out of scope under the constitution | The product is permanently single-owner and does not gain a second editing identity through an editor library. |

**Adoption gate for a later feature**:

1. Specify the user-visible interaction and block catalogue before choosing a
   template or extension.
2. Classify every dependency as open-source/local, commercially licensed, or
   hosted, and record its replacement and offline path.
3. Map every new block or mark into the MyOwnNotion model, validation,
   Markdown export, unknown-content preservation, and version transition.
4. Reuse feature 005 for file bytes and feature 006 for synchronization rather
   than importing a second storage or collaboration source of truth.
5. Re-run keyboard, 320-pixel, accessibility, performance, abrupt-close,
   offline, and multi-device journeys for the richer surface.

**Alternatives considered**:

- *Adopt the complete official template now.* Rejected: it mixes open-source UI
  acceleration with licensed and hosted capabilities, while this feature's
  requirements are already implemented and its human validation remains the
  unfinished work.
- *Copy the visual design but store Tiptap JSON.* Rejected by Decision 1 and
  FR-005: a UI shortcut does not justify changing the owner's durable format.
- *Wait for databases before improving any editor interaction.* Rejected:
  writing ergonomics is independently useful. Only database-backed blocks and
  views need the database feature; the follow-up must keep that boundary clear.

Every `NEEDS CLARIFICATION` from the Technical Context is closed by the
decisions above. No open question blocks Phase 1.

| Unknown | Resolved by |
|---------|-------------|
| Content model ownership and export path | Decision 1, and [data-model.md](./data-model.md) |
| Unknown-block preservation mechanism | Decision 2 |
| v1 → v2 transition, and who performs it | Decision 3 |
| Origin of the four save states | Decision 4, and [contracts/save-state.md](./contracts/save-state.md) |
| Editor library | Decision 5 |
| Accessibility verification method | Decision 6 |
| Internal page-link representation | Decision 7 |
| Notion-like component adoption and sequencing | Decision 8 |
