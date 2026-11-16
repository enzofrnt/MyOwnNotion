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

- The exact press geometry that triggered the nightly is not reconstructed: the
  fix removes the consequence (draft loss), not the geometry. The journeys no
  longer depend on it.
- `apps/api/tests/realtime-page-sync.contract.spec.ts` (negative window, 20 ms)
  and the late-caller case of `synchronize-serialization.spec.ts` remain declared
  limits of feature 060 (lessons L-007).
## CI runs of this branch, and why three failures were not this change

`main` before this branch: `499b6a49`.

| Run | Commit | Outcome | Diagnosis |
| --- | --- | --- | --- |
| 43898767141 | `669ebceb` | failure | one journey, `offline-reconciliation.spec.ts:41`, WebKit desktop. The failure screenshot and `error-context.md` show the application's own error state: « L'espace n'a pas pu être chargé — Le stockage local est inaccessible. » Local storage could not be opened in that WebKit instance; the journey waited for a title that could not appear. Engine/storage unavailability, not this diff. |
| 43909551678 (attempt 1) | `d1fc582e` | failure | `desktop / windows-11-arm`: the runtime failed to create its own stdio pipe — `error: Failed to connect` at `net.connect` inside `child_process` `#createStdioObject`, during `spawn`, before any assertion of the fixture. `chromium-desktop 2/3` never started: `apt-get update` stalled and the lane hit its 30-minute `timeout-minutes` (`##[error]The operation was canceled` after 1 792 s of system-package installation, no blob report produced). Both are runner-level; this change has no `apps/desktop` and no workflow diff. |
| 43909551678 (attempt 2) | `d1fc582e` | cancelled | aborted by the push of `fff46ef6` (concurrency cancels an in-progress attempt) |
| 43915711937 | `fff46ef6` | **success, first attempt** | full gate, no job re-run: 350 journeys per project, 0 failed, 0 flaky, 0 not run |
| 43919332602 | `518f081a` | failure | `files.spec.ts:26` on WebKit desktop: `No active grid-template-rows transition was found` — the same message as run `43803790517` (2026-11-16 04:23 UTC) on a commit this branch does not touch. A witness defect: the helper samples a ~210 ms CSS transition after the fact. Recorded as lessons L-008 and scheduled as a follow-up (`sampleCssTransition` and its eight call sites), not fixed here. |

The three failures are recorded here rather than silently re-run: a green re-run
is not a correction (constitution article III, lessons L-004 and L-005). They
were diagnosed from retained evidence before the re-run, and none of them is
attributable to this change.

## Limits, honestly

- The exact press geometry that triggered nightly run 43856315749 is not
  reconstructed: the fix removes the consequence (draft loss), not the geometry.
  The journeys no longer depend on it.
- `apps/api/tests/realtime-page-sync.contract.spec.ts` (negative window, 20 ms)
  and the late-caller case of `synchronize-serialization.spec.ts` remain declared
  limits of feature 060 (lessons L-007).
- The WebKit storage failure, the two runner-level failures and the
  `sampleCssTransition` witness are not fixed by this branch; they are documented
  with their evidence. If they recur, they need their own investigation (engine
  storage in the container, runner package mirrors, Windows ARM pipe creation)
  or their own fix (`sampleCssTransition`: record the transition before the
  action that produces it — lessons L-008).
