# Quickstart: validation des clients desktop

## Prerequisites

- Bun `1.4.0` exactement ;
- a running MyOwnNotion API/server from the preceding features;
- a Windows runner for Windows packaging and a macOS runner for macOS signing;
- test certificates/secrets supplied out-of-band for release validation only.

## Local development

```bash
bun ci
bun run --filter @myownnotion/web build
bun run --filter @myownnotion/desktop dev
```

Expected result: one local desktop window opens, loads the local shell, asks
for a server profile when none exists, and reaches the existing bootstrap/login
flow without loading server-provided code.

## Automated validation

```bash
bun run --filter @myownnotion/desktop typecheck
bun run test:unit -- desktop
bun run test:e2e -- --project=chromium-desktop desktop
bun run checks:local
```

The desktop suite must include:

1. first start and profile persistence;
2. local/remote HTTP policy and protocol mismatch;
3. IPC sender validation and blocked navigation;
4. key wrapping/unwrapping and locked-key refusal;
5. offline edit, unexpected restart and reconciliation;
6. revoke/sign-out preservation of unsynchronized data;
7. single-instance and window-state restoration;
8. update available/deferred/installed/failed/rollback states.

## Installed smoke validation

For each Windows x64, macOS x64 and macOS arm64 artifact:

1. Verify the checksum and platform signature.
2. Install on a clean runner and record app version/platform/architecture.
3. Configure a local HTTPS test server and complete device authorization.
4. Read and edit a previously loaded page while offline.
5. Restart the app, reconnect, and verify outbox/conflict state.
6. Revoke the device from the Web client and verify the next protected request
   is refused.
7. Apply a signed update with a pending local mutation and verify identity and
   mutation preservation.

## Evidence

Record command output, artifact names, commit SHA, runner OS/architecture,
signature result, smoke result and any deliberate exception in the feature
validation ledger before marking the release tasks complete.
