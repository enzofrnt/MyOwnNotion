# Validation: A Transition Witness That Cannot Miss Its State

## Defect evidence

| Fact | Source |
| --- | --- |
| `files.spec.ts:26` failed on WebKit desktop with "No active grid-template-rows transition was found" | runs 43803790517 (2026-11-16 04:23 UTC, commit `9c987ccd`) and 43919332602 (commit `518f081a`) |
| Neither commit touched `files.spec.ts`, `helpers.ts` or the attachments CSS | `git diff --stat` of both branches |
| The production transition is 210 ms (`.collapsible-region`, `navigation.css`) while the journey clicked through the driver and sampled in a second command | code reading |

## Change

`tests/e2e/helpers.ts` / `tests/e2e/files.spec.ts`: see [plan.md](plan.md). No
product change, no assertion weakened: `middle.height` and `closing.height` are
still asserted against the closed and open heights.

## Verification

| Level | Result |
| --- | --- |
| `typecheck`, `lint:ci`, `format:check` | green |
| sensitivity probe: witness asked for a property with no transition | failed with `No active column-gap transition was found` (expected), probe removed |
| `files`, `workspace-shell`, `hierarchy` on WebKit desktop, `--repeat-each=2` | 35 passed |
| same three specs on Chromium desktop, `--repeat-each=2` | 70 passed |

An earlier Chromium run reported 70 failures; it was invalid — a parallel probe
started a second stack on the same port and the application stopped booting
(`workspace-shell` never appeared). Re-run alone, the same specs pass. Recorded
here because a red run that is not understood is not evidence either way.

## Limits

- The witness still needs the transition to be *declared* in CSS: a journey that
  asserts an intermediate frame of an animation that the product does not animate
  will now fail with the naming diagnostic, which is the correct outcome.
- The remaining negative-window limits of feature 060 (L-007) are untouched.

## Ordering

This branch starts from `main` `499b6a49` and does not contain PR #210 (the
draft fix, the constitution amendment and the test-quality skill). The lesson it
applies is recorded there as L-008; the reference becomes resolvable once #210 is
merged. The two branches touch different regions of `tests/e2e/helpers.ts`, so a
rebase after the merge is mechanical.
