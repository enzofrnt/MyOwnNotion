/**
 * Synchronization rules that hold everywhere (feature 006).
 *
 * Pure and platform-independent: the merge decides what happens to an owner s
 * words, and the protocol window decides whether a device may write at all.
 * Both belong where a test can exhaust them without a browser or a server.
 */

export * from "./merge-documents.ts";
export * from "./protocol-version.ts";
