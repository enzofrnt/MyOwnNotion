/**
 * Node-only security entry point (feature 002).
 *
 * Imported as `@myownnotion/domain/security`, NOT from the package root.
 *
 * Everything reachable from here touches `node:crypto`, so it must never enter
 * a browser bundle: Vite externalises `node:crypto` and the web build fails on
 * the first missing export. The platform-independent security rules — state
 * vocabulary, installation invariants, rotation policy, redaction — live in the
 * root barrel instead and are safe on both sides.
 *
 * Consumers: `apps/api`, `packages/database`, and the local CLI. The web client
 * gets its device-bound encryption from `packages/client-core`, which uses Web
 * Crypto.
 */

export * from "./bootstrap.ts";
export * from "./crypto.ts";
export * from "./envelopes.ts";
export * from "./identity-manifest.ts";
// Re-exported for convenience so a Node consumer needs one import.
export * from "./invariants.ts";
export * from "./recovery-artifacts.ts";
export * from "./redaction.ts";
export * from "./rotation-policy.ts";
export * from "./types.ts";
export * from "./wrapping-key-rotation.ts";
