# Validation: Files and Local Storage

**Feature**: [spec.md](./spec.md) | **Date**: 2026-08-17

Evidence per requirement. A row says `pass` only when something automated
asserts it. Requirements belonging to user stories that are not built yet say
so plainly rather than being left blank, so this file can be read as a status
rather than as a claim.

## Functional requirements

| FR | Status | Evidence |
|----|--------|----------|
| FR-001 attach, embed, or place a file in the hierarchy | pass | Attachment and hierarchy placements from feature 001; `fileEmbed` added to the block model with `document-validate` coverage |
| FR-002 the attachment list states nine fields | pass | `attachment-list.tsx`; `files.spec.ts` asserts type, size, location, availability, sync state and usages per row |
| FR-003 rename and move break no reference | pass | `file-references.integration.spec.ts` — asserted against real rows after a rename and a move, plus a journey that reloads and re-resolves |
| FR-004 deletion shows usages and requires confirmation | pass | `file-deletion.spec.ts` for the rule, `files.spec.ts` for the dialogue: it names the page, declining changes nothing, confirming reaches the trash |
| FR-005 a file reports every usage, each reachable | pass | `file-usages.property.spec.ts`, `file-usages.integration.spec.ts`, `files.contract.spec.ts`; the journey clicks a usage and lands on the page |
| FR-006 interrupted transfers resume | **not built** | Phase 7. The contract is written in `contracts/file-transfer.md`; no code yet |
| FR-007 synchronized only after server verification | **partial** | `file_contents.verified_at` is set by feature 001 and is what the client reports; the resumable path that would set it after a resumed upload does not exist yet |
| FR-008 administrator-configurable maximum, 2 GB default | **not built** | Phase 7 |
| FR-009 a refusal states the limit without losing the draft | **not built** | Phase 7 |
| FR-010 previews PDF, SVG, PNG, JPEG, GIF, WebP, Draw.io | **not built** | US3 |
| FR-011 Draw.io editable through the ordinary save path | **not built** | US3 |
| FR-012 an unpreviewable file states name, type, size, download | **not built** | US3 |
| FR-013 previews isolated, downloads inert | **not built** | US3. The decision is recorded in `research.md`; nothing is implemented, so nothing is claimed |
| FR-014 encrypted local set, 5 GB default, adjustable, unlimited | **not built** | US4 |
| FR-015 what is retained in priority | **not built** | US4 |
| FR-016 offline intent on a page, branch or file | **partial** | Stored end to end — column, snapshot, contract, local row — so it reaches every device; no interface sets it yet |
| FR-017 eviction never releases unsynchronized work | **not built** | US4. The rule is specified in `data-model.md` and will be a pure function with property tests |
| FR-018 offloaded content keeps title and metadata | **partial** | The three availability states exist in the local row and render distinctly; nothing offloads yet |
| FR-019 the owner can see what holds local space | **not built** | US4 |

## Success criteria

| SC | Status | Evidence |
|----|--------|----------|
| SC-001 nine fields in one interaction | pass | `files.spec.ts` |
| SC-002 three usages still resolve after rename and move | **partial** | Two usages asserted at the database level and one through the interface; the three-way case is covered by the same code path |
| SC-003 no in-use deletion without the usages being shown | pass | The rule refuses without `confirmed`, and the confirmation is what sets it |
| SC-004 a 2 GB file transfers and resumes | **not built** | Phase 7 |
| SC-005 every previewable format opens | **not built** | US3 |
| SC-006 a preview cannot reach the workspace | **not built** | US3 |
| SC-007 a marked branch opens with no network | **not built** | US4 |
| SC-008 no unsynchronized change is ever offloaded | **not built** | US4 |
| SC-009 offloaded is distinguishable from held locally | **partial** | Distinguishable in the model and in the row rendering; not yet reachable, because nothing offloads |

## Defects found in existing code

**Imported attachments reported "used nowhere else".** The usage was recorded
when a placement was *added* but not when a file was *imported*, which is how
most attachments actually arrive. That is the under-reporting direction — the
one that tells an owner it is safe to destroy something a page still shows.

**The item DTO never carried the file's media type.** The read model has had it
since feature 001; only the contract omitted it, so an attachment list could
show a name and a size but not the type the server stored.

**Deleting a file through `item.trash` fails with a 500.** Feature 001 models a
file's lifecycle through its placements, and the item-level trash does not
apply. Recorded here because the failure is a server error rather than a
refusal, which reads as a bug rather than as a rule.

## A note on the local environment

For part of this work the journeys ran against a *different checkout*: a Vite
server and an API belonging to another worktree held ports 5173 and 3001, and
Playwright reused them. Tests exercised code this branch had never touched —
a `data-testid` was still in the DOM after the source stopped containing it.
Freeing both ports cut the suite from 24 seconds to 5 and turned two failures
into passes. Any local result that looks impossible is worth checking against
`lsof -ti:3001,5173` before the code is blamed.

## What is not built

US3 (previewing and editing), US4 (offline availability), and phase 7
(resumable transfer). 20 of 56 tasks are done: setup, foundations, and the
two P1 stories that make up the MVP — files that are findable, truthfully
described, and safe to move or delete.
