/**
 * Device-bound local encryption for the web client (feature 002).
 *
 * Wraps the feature-001 local projection without changing its identities: the
 * local store keeps the same records and IDs, encrypted at rest under a
 * device-bound key.
 */

export * from "./device-key-binding.ts";
export * from "./local-encryption.ts";
export * from "./local-key-state.ts";
export * from "./local-record-codec.ts";
export * from "./reauthorization.ts";
