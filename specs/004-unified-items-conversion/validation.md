# Validation: Unified Items and Page/Folder Conversion

**Feature**: [spec.md](./spec.md) | **Date**: 2026-08-16

Evidence per requirement. A row says `pass` only when something automated
asserts it; anything that needs a human says so plainly rather than being
quietly ticked.

## Functional requirements

| FR | Status | Evidence |
|----|--------|----------|
| FR-001 pages and folders share one base | pass | `contracts/item-model.md`; the tree renders both kinds identically (`item-conversion.spec.ts`) |
| FR-002 both hold hierarchy children | pass | `conversion.integration.spec.ts` — children survive in both directions |
| FR-003 only a page holds content and content attachments | pass | `item-conversion.spec.ts` — a folder offers no attachments panel |
| FR-004 kind is changeable after creation | pass | `migrations.integration.spec.ts` converts an item against a real database |
| FR-005 folder → page | pass | `conversion.spec.ts`, `conversion.contract.spec.ts`, `item-conversion.spec.ts` |
| FR-006 page → folder | pass | same three levels |
| FR-007 identity preserved | pass | `conversion.property.spec.ts` (identity and lineage), integration suite |
| FR-008 every hierarchy child preserved | pass | property test over generated inputs; integration test against real rows; journey against the tree |
| FR-009 folder → page destroys nothing, asks nothing | pass | `item-conversion.spec.ts` asserts no dialog appears |
| FR-010 destructive conversion requires confirmation naming the loss | pass | `conversion.spec.ts` (refusal), `item-conversion.spec.ts` (wording) |
| FR-011 confirmation states the retention limit | pass | `item-conversion.spec.ts` asserts the retention notice |
| FR-012 a conversion produces a revision | pass | `conversion-repository.ts` inserts one; integration suite asserts the head moves |
| FR-013 declining changes nothing | pass | `item-conversion.spec.ts` |
| FR-014 guarantees hold in the domain, not the interface | pass | `conversion.contract.spec.ts` refuses at the HTTP surface with no screen involved |
| FR-015 two separate disclosures | pass | `item-conversion.spec.ts` — the filed child is in the tree and not in the attachments region |
| FR-016 a folder has the hierarchy disclosure only | pass | `item-conversion.spec.ts` |
| FR-017 visually distinguishable, reflected without reload | pass | the control's label flips in place; asserted by `convertAndSettle` |
| FR-018 keyboard-completable, announced | pass | `item-conversion.spec.ts` — Escape closes, focus returns, `role="alertdialog"` |
| FR-019 no boundary from feature 002 weakened | pass | the protected envelope is deleted with the document, asserted in `conversion.integration.spec.ts` |
| FR-020 revision lineage and mutation semantics unchanged | pass | the full feature-001 suites still pass unchanged |

## Success criteria

| SC | Status | Evidence |
|----|--------|----------|
| SC-001 convert and write within 30 seconds | **pending** | Needs an unfamiliar owner. The journey shows the path is two clicks, but "without documentation" is a claim about a person, not about code. |
| SC-002 children present, same parent, same order, 100% | pass | property test over generated trees, plus the integration and journey levels |
| SC-003 identity unchanged, references resolve | pass | `conversion.property.spec.ts` |
| SC-004 no destructive conversion without confirmation | pass | `conversion.contract.spec.ts` — refused at the API |
| SC-005 destroyed content restorable for the retention window | **partial** | The revision is produced and the previous state is superseded rather than deleted; a journey restoring it after a destructive conversion is not written. The mechanism is feature 001's and is covered by `revision-restore.spec.ts`. |
| SC-006 the two never appear in the same list | pass | `item-conversion.spec.ts`, both directions |
| SC-007 both conversions keyboard-completable | pass | the control is a button, the dialog traps and returns focus |
| SC-008 no critical or serious accessibility violations | pass | `accessibility.spec.ts` audits the confirmation dialog with axe |
| SC-009 conversion within 2 seconds at 1,000 items | pass | `conversion.perf.spec.ts`; also asserts the cost does not follow the number of children |

## What is deliberately not claimed

**SC-001 needs a person.** It asks whether someone unfamiliar with the product
can do this unaided, which no test can answer. It is left pending rather than
marked pass on the strength of the journey passing.

**SC-005 is partial and says so.** The conversion produces a revision and the
prior state is superseded rather than deleted, which is what makes recovery
possible; feature 001's restore path is separately tested. What is missing is
one journey that destroys content by conversion and restores it, end to end.

**Firefox is covered by CI only.** Its Playwright binary does not launch on the
development machine used for this feature, so local runs exclude it. CI runs all
five projects.
