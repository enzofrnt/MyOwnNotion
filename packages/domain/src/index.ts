/**
 * Platform-independent canonical domain (T009).
 *
 * This package must never import Fastify, React, Drizzle, browser APIs, or
 * filesystem APIs. Adapters depend on the domain, never the reverse.
 */

export * from "./content/content-items.ts";
export * from "./content/conversion.ts";
export * from "./content/file-placements.ts";
export * from "./content/hierarchy.ts";
export * from "./content/lifecycle.ts";
export * from "./content/mutations.ts";
export * from "./content/position-key.ts";
export * from "./content/relationships.ts";
export * from "./content/types.ts";
// The block content model (feature 003). Pure and library-independent by
// construction: nothing under `document/` may import React, Tiptap, or the DOM.
export * from "./document/index.ts";
export * from "./export/canonical-export.ts";
export * from "./files/index.ts";
export * from "./ids/uuid.ts";
export * from "./revisions/lineage.ts";
export * from "./revisions/retention.ts";
export * from "./revisions/types.ts";
// Platform-independent security rules only. The crypto implementation lives
// behind the `@myownnotion/domain/security` subpath because it needs
// `node:crypto`, which cannot enter a browser bundle.
export * from "./security/bootstrap.ts";
export * from "./security/data-key-rotation.ts";
// The canonical AAD only: no key material and no `node:crypto`, so the browser
// client can bind its local envelopes exactly as the server binds its own.
export * from "./security/device-state.ts";
export * from "./security/envelope-binding.ts";
export * from "./security/invariants.ts";
export * from "./security/migration.ts";
export * from "./security/redaction.ts";
export * from "./security/rotation-policy.ts";
export * from "./security/session-policy.ts";
export * from "./security/types.ts";
export * from "./security/wrapping-key-rotation.ts";
export * from "./sync/index.ts";
