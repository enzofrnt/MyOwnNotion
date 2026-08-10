/**
 * Platform-independent canonical domain (T009).
 *
 * This package must never import Fastify, React, Drizzle, browser APIs, or
 * filesystem APIs. Adapters depend on the domain, never the reverse.
 */

export * from "./content/content-items.ts";
export * from "./content/file-placements.ts";
export * from "./content/hierarchy.ts";
export * from "./content/lifecycle.ts";
export * from "./content/mutations.ts";
export * from "./content/position-key.ts";
export * from "./content/relationships.ts";
export * from "./content/types.ts";
export * from "./export/canonical-export.ts";
export * from "./ids/uuid.ts";
export * from "./revisions/lineage.ts";
export * from "./revisions/retention.ts";
export * from "./revisions/types.ts";
// Platform-independent security rules only. The crypto implementation lives
// behind the `@myownnotion/domain/security` subpath because it needs
// `node:crypto`, which cannot enter a browser bundle.
export * from "./security/invariants.ts";
export * from "./security/redaction.ts";
export * from "./security/rotation-policy.ts";
export * from "./security/types.ts";
