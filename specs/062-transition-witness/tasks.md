# Tasks: A Transition Witness That Cannot Miss Its State

- [X] T001 Establish the failure class: two identical WebKit failures on untouched commits (43803790517, 43919332602), recorded as lessons L-008.
- [X] T002 Migrate `files.spec.ts` to the in-page witnesses (opening: mounted; closing: in-page).
- [X] T003 Replace both frame budgets with a 5 s maximum bound with a naming diagnostic.
- [X] T004 Delete `sampleCssTransition`.
- [X] T005 Prove sensitivity: a probe with a property that has no transition fails with "No active column-gap transition was found".
- [X] T006 Validate the three consuming specs on WebKit desktop (35 tests) and Chromium desktop (70 tests), with repetitions.
- [ ] T007 Pull-request CI green on the final commit.
