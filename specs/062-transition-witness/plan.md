# Implementation Plan: A Transition Witness That Cannot Miss Its State

**Spec**: [spec.md](spec.md) · **Lessons**: L-008 (journal of the test-quality skill, PR #210)

## Constitution check

- III. Incremental, Verifiable Delivery: the witness now observes the real state
  in the same browser task; the bound fails with a diagnostic. First application
  of the amended article after feature 061.
- VII: no new timeout budget on the gate, no retry.

## Approach

`tests/e2e/helpers.ts` already had two witnesses that click and observe inside
one browser task (`triggerAndSampleCssTransitions`,
`triggerAndSampleMountedCssTransition`); `files.spec.ts` used the third one,
`sampleCssTransition`, which clicked through the driver and sampled afterwards.
A 210 ms production transition (`.collapsible-region` in `navigation.css`) can
finish during that round trip on a loaded runner.

| Change | Why |
| --- | --- |
| `files.spec.ts` uses the mounted witness for the opening (the region mounts after the click) and the in-page witness for the closing (the region exists before the click) | removes the round trip |
| the frame budget (12 frames ≈ 200 ms) becomes a 5 s maximum bound named `TRANSITION_WITNESS_TIMEOUT_MS` | a slow commit must not be reported as a missing transition; expiry still fails loudly |
| `sampleCssTransition` deleted | the unsound pattern cannot be reintroduced |

No product change: the transitions are production CSS and are still exercised.
