# Validation: Verifiable Test Evidence and a Preserved Draft

## Evidence of the defect

| Fact | Source |
| --- | --- |
| Nightly run 43856315749, job `Playwright journeys (webkit-desktop 3/3)`, `databases-tasks.spec.ts:35`, `toHaveValue("Notes")` received `""` for 10 s | job log and `error-context.md` |
| At failure the composer is **open** (`th` carries `--adding`, the type menu is rendered) and its field is **empty** (`value: ""`) | trace `frame-snapshot` of the failure |
| Same assertion, same empty value, same gesture failed on 2026-11-14 in `database-form-lifecycle.spec.ts:143` | `docs/audits/2026-11-wait-contracts/evidence/errors/43587332746-1-132424695799.txt` |
| Product behaviour: `"Notes"` typed → press outside → composer closed → reopening gives `""` | temporary probe (removed): `{"afterFill":"Notes","openAfterOutsideClick":false,"reopened":true,"valueAfterReopen":""}` |
| 16 local repetitions of the journey in the same Linux WebKit image were green | local matrix, `--repeat-each=8`, both variants |

Conclusion: a product defect, not a test defect and not a runner flake. The
journeys were right to fail; they were fragile only in *where* their press
landed.

## Product change

`apps/web/src/features/databases/table-view.tsx`:

- the open handler no longer resets the name or the icon;
- creation clears the draft (the property exists now);
- `Escape` clears the draft (explicit abandonment);
- an implicit close (outside press, re-render, scroll) keeps it.

## Tests

| Level | Test | Result |
| --- | --- | --- |
| component | `apps/web/tests/database-new-property-draft.spec.tsx` — outside press keeps, creation clears, `Escape` clears | passes; fails without the fix (`reopening resumes the draft: expected '' to be 'Notes'`) |
| journey | `databases-tasks.spec.ts` « keeps a property action stable … permits cancellation » | 4/4 on WebKit desktop and 4/4 on Chromium desktop |
| journey | `database-form-lifecycle.spec.ts` « cancels a pressed property action … » | same run, green |
| journey | sibling database journeys (`database-entry-properties`, `databases-schema`, `databases-views`, `database-multi-select-board`) | 8/8 Chromium desktop |
| unit | whole web suite | 1 156 tests, 180 files, green |
| contract | `workspace-contract` | 377 tests green |
| static | `format:check`, `lint:ci`, `typecheck` | green |

No sleep, retry, skip or weakened assertion was introduced: `git diff` on the two
journeys touches only the wait/restore step, and the draft assertion is
unchanged.

## Guidance

| Artifact | State |
| --- | --- |
| `.specify/memory/constitution.md` | amended, 4.0.0 → 4.1.0, article III, Sync Impact Report present |
| `.agents/skills/test-quality/SKILL.md` | new maintained skill: Speckit gates, checklist, escalation path |
| `.agents/skills/test-quality/lessons.md` | new append-only journal, `L-001`…`L-007` |
| `AGENTS.md` | required workflow loads the skill for any test work |
| `docs/testing/wait-contracts.md` | points at the skill; normative rule unchanged |

## Limits

- The exact press geometry that triggered the nightly is not reconstructed: the
  fix removes the consequence (draft loss), not the geometry. The journeys no
  longer depend on it.
- `apps/api/tests/realtime-page-sync.contract.spec.ts` (negative window, 20 ms)
  and the late-caller case of `synchronize-serialization.spec.ts` remain declared
  limits of feature 060 (lessons L-007).
- The first pull-request CI run of this branch failed on
  `offline-reconciliation.spec.ts:41` (workspace did not boot within 45 s on
  WebKit desktop) — a different journey, in a lane this change does not touch.
  It is investigated separately and is not evidence about this fix.
