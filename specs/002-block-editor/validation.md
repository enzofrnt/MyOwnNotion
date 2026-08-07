# Validation Evidence: Block Editor

**Date**: 2026-08-07
**Branch**: `codex/block-editor`
**Local toolchain**: Node.js 24.14.0, pnpm 10.33.3, macOS

## Outcome

The block editor implementation satisfies the executable acceptance criteria on the local reference environment. The full Chromium desktop/mobile journeys, coverage threshold, production build, and isolated production-Compose smoke test pass. Firefox and WebKit remain CI-authoritative because their local macOS sandbox startup is blocked before the first test, as already documented for the content-foundations feature.

## Quality gates

| Gate | Evidence | Result |
| --- | --- | --- |
| Formatting | `format:check` checked 176 files | Pass |
| Lint and formatting CI | Biome checked 177 files with no fixes | Pass |
| Workspace typecheck | All eight workspace projects | Pass |
| Root typecheck | Root TypeScript project with no emit | Pass |
| Coverage | 37 files / 277 tests; statements 90.82%, branches 88.62%, functions 91.81%, lines 90.82% | Pass |
| Domain v2 safety | 34 editor-document cases, including every supported node/mark and malformed external fixtures | Pass |
| Database and API | Database integration, API contract, export, logging, and OpenAPI projects included in the 277-test coverage run | Pass |
| Performance | Real 2,000-block Tiptap keystroke-to-visible-DOM p95 16.2 ms; canonical preparation p95 2.0 ms; existing 1,000-mutation p95 10.9 ms | Pass |
| Playwright Chromium | 32 journeys on desktop and 31 applicable journeys on the Pixel 7 viewport; the reference-device performance journey is intentionally desktop-only | Pass (63 passed, 1 expected skip) |
| Accessibility | Keyboard/focus/overflow journeys and Axe critical scan included on desktop and mobile | Pass |
| Production build | API bundle, migration bundle, web bundle, PWA service worker | Pass |
| Production Compose smoke | Built isolated API/web images, checked direct/proxied health, migrations, v2 persistence across restart, then removed only smoke resources | Pass |
| Toolchain policy | Exact pnpm lock/pin and TypeScript-only policy | Pass |
| Shell policy | Gate starts, but pinned `shellcheck` 0.11.0 and `shfmt` 3.12.0 are not installed on this host | CI required |
| Firefox/WebKit matrix | Local browser process is blocked by the known macOS sandbox limitation before test execution | CI required |

The Vite production build emits its existing advisory that the main JavaScript chunk exceeds 500 kB. It does not fail the build or the feature's specified performance criterion; code splitting remains a later optimization candidate.

## Quickstart scenarios

1. **Rich page editing**: every supported heading, block, mark, order, and checked state round-trips through save/reload; undo/redo, plain-text clipboard, and page-only visibility also pass.
2. **Commands and shortcuts**: all ten slash catalogue entries, filtering/navigation/dismissal/mobile positioning, and every documented positive, negative, and undo Markdown fixture pass.
3. **Offline durability**: edit, reload while offline, reconnect, single synchronization, competing revision, and local recovery pass.
4. **Keyboard and responsive operation**: one pointer-free journey creates the complete requested page, and the active block remains visible without page-level horizontal overflow on desktop and mobile.

## Container isolation

The smoke test derives a unique Compose project name and temporary host ports, waits for health, retries only transient network connection failures after restart, and removes that project's containers, network, and volumes. The user's production composition on ports 5432, 3001, and 8080 was not stopped or modified.

## CI handoff

The pull-request CI must provide the final Linux evidence for the pinned shell tools and the configured Firefox/WebKit projects. No product-code waiver is recorded for either gate.
