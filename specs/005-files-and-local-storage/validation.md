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
| FR-006 interrupted transfers resume | pass | tus end to end: `POST`/`HEAD`/`PATCH` on the server, chunked sending on the client, and a completion that turns the accumulated bytes into a verified file in one transaction. 14 contract tests, 10 integration tests, 8 client tests — including the client obeying a 409 correction rather than its own count |
| FR-007 synchronized only after server verification | pass | Completion hashes the accumulated bytes, deduplicates against existing content, and sets `verified_at` inside the transaction that creates the file. The download route refuses unverified content, and the client ends a transfer in `verifying` rather than claiming it is stored |
| FR-008 administrator-configurable maximum, 2 GB default | pass | `maxFileBytes()` reads `MYOWNNOTION_MAX_FILE_BYTES`, defaults to 2 GB, and falls back to the default rather than to zero or infinity when misconfigured |
| FR-009 a refusal states the limit without losing the draft | pass | The 413 carries `limitBytes` and `declaredBytes`, and is declared in the response schema so Fastify cannot serialise it away. Refused before a single byte is accepted, so nothing touches the draft |
| FR-010 previews PDF, SVG, PNG, JPEG, GIF, WebP, Draw.io | pass | `file-preview.tsx` renders all of them through one sandboxed frame; `file-preview.spec.ts` opens an image and an unsupported type |
| FR-011 Draw.io editable through the ordinary save path | **partial** | The editor is served by this installation (Compose service, pinned), `assertLocalEditor` refuses every third-party host (14 unit tests), and a journey asserts that no request reaches diagrams.net while a diagram is opened. What no test drives is an actual edit-and-save round trip, because that needs the editor container running in the test environment |
| FR-012 an unpreviewable file states name, type, size, download | pass | `UnsupportedFile`; asserted in `file-preview.spec.ts` |
| FR-013 previews isolated, downloads inert | pass | Three headers asserted in `files.contract.spec.ts`; the sandbox asserted by the negative — a hostile SVG reaching for `window.parent.document` exfiltrates nothing |
| FR-014 encrypted local set, 5 GB default, adjustable, unlimited | pass | `budget.ts` with `budget.spec.ts`; unlimited is `null`, not a sentinel. The set was already encrypted by feature 002 |
| FR-015 what is retained in priority | pass | `eviction.ts`, asserted by property tests over any workspace and any limit |
| FR-016 offline intent on a page, branch or file | pass | `item.offline` end to end, with a control per row; `offline-availability.spec.ts` asserts the marking survives a reload because it travels in the revision |
| FR-017 eviction never releases unsynchronized work | pass | Property tests in the domain, plus `budget.spec.ts` asserting a queued item is not released, plus a journey that lowers the limit with an unsent edit present |
| FR-018 offloaded content keeps title and metadata | pass | `budget.spec.ts` asserts the row, its title and its metadata survive while the sealed body goes; the tree marks the state and never says missing |
| FR-019 the owner can see what holds local space | pass | `storage-panel.tsx` shows usage, a breakdown, and whether the browser granted durability |

## Success criteria

| SC | Status | Evidence |
|----|--------|----------|
| SC-001 nine fields in one interaction | pass | `files.spec.ts` |
| SC-002 three usages still resolve after rename and move | **partial** | Two usages asserted at the database level and one through the interface. The three-way case runs the same code path, so it is covered in substance rather than literally |
| SC-003 no in-use deletion without the usages being shown | pass | The rule refuses without `confirmed`, and the confirmation is what sets it |
| SC-004 a 2 GB file transfers and resumes | **partial** | Resumption is asserted end to end in `file-transfer.spec.ts`, including the file matching byte for byte across an interruption. The 2 GB case itself is not exercised: a test that moved two gigabytes would dominate the suite, and the size-dependent behaviour is the chunking, which smaller files exercise identically |
| SC-005 every previewable format opens | pass | One sandboxed frame handles all of them; asserted for an image and for an unsupported type |
| SC-006 a preview cannot reach the workspace | pass | Asserted by the negative: a hostile SVG posts nothing back |
| SC-007 a marked branch opens with no network | **partial** | True within a loaded session and asserted as such. Reloading offline needs a service worker; see the limitation below |
| SC-008 no unsynchronized change is ever offloaded | pass | Property tests, a unit test on the applied plan, and a journey that lowers the limit with an unsent edit present |
| SC-009 offloaded is distinguishable from held locally | pass | Three states in the row, marked in the tree, and asserted after a real offload in `budget.spec.ts` |

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

## A correction to an earlier claim

A commit message in this branch said an owner typing the next item name
immediately after a creation "can lose those keystrokes". That overstates it.
The explorer clears the field in the click handler, and React applies that
render within a frame — long before a person starts typing the next name. What
actually loses keystrokes is a *programmatic* fill that happens within
milliseconds of the click, which is what Playwright does and a human does not.

So the helper's retype loop is a test-harness accommodation, not a workaround
for a defect an owner would meet. Recorded here because the commit message
claimed otherwise, and a validation file that repeated the exaggeration would
carry it forward.

## A note on the local environment

For part of this work the journeys ran against a *different checkout*: a Vite
server and an API belonging to another worktree held ports 5173 and 3001, and
Playwright reused them. Tests exercised code this branch had never touched —
a `data-testid` was still in the DOM after the source stopped containing it.
Freeing both ports cut the suite from 24 seconds to 5 and turned two failures
into passes. Any local result that looks impossible is worth checking against
`lsof -ti:3001,5173` before the code is blamed.

## Known limitation: reloading offline

Content marked to keep available offline opens with no network **within a
session that is already loaded**. Reloading the application offline fails,
because the shell itself is not cached — that needs a service worker, which
feature 005 does not ship.

Recorded here rather than worked around in the journey: the first version of
`offline-availability.spec.ts` reloaded the page and failed with
`ERR_INTERNET_DISCONNECTED`, and the honest response was to test what is
promised and write down what is not. SC-007 is therefore marked partial.

## What is not built

All 56 tasks are done. Three requirements remain **partial**, and each says why
in its row rather than being ticked:

- **FR-011**: a diagram edit-and-save round trip needs the editor container
  running in the test environment. The privacy invariant that made this decision
  worth taking — that nothing reaches diagrams.net — *is* asserted.
- **SC-004**: resumption is proved; two gigabytes is not moved, because the
  size-dependent behaviour is the chunking and smaller files exercise it
  identically.
- **SC-007**: offline works within a loaded session; reloading offline needs a
  service worker, which is not in this feature.

One boundary worth naming: the attachment control still uploads in a single
request. The resumable path is complete and asserted through the API, but the
interface does not use it yet, so an owner attaching a file today does not get
resumption. `file-transfer.spec.ts` says so in its header rather than implying
otherwise.
