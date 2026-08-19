/**
 * Platform-independent workspace search primitives.
 *
 * Search implementations stay behind this boundary so Node and browser
 * adapters can share matching rules without sharing storage concerns.
 */

export * from "./document-text.ts";
export * from "./normalise.ts";
export * from "./search-index.ts";
export * from "./types.ts";
