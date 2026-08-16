/**
 * File rules that hold everywhere (feature 005).
 *
 * Pure and platform-independent, like `document/`: nothing here may import
 * React, the DOM, or `node:*`. The rules that decide what a deletion destroys
 * and what an eviction may release belong at this level, where being wrong is
 * caught by a test rather than by an owner.
 */
export * from "./deletion.ts";
export * from "./usages.ts";
