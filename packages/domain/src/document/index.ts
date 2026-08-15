/**
 * The document content model (feature 003).
 *
 * Everything here is pure and platform-independent. Nothing in this directory
 * may import React, Tiptap, the DOM, or `node:*` — FR-005 requires the model to
 * be independent of the editing library, and a model that can reach the editor
 * eventually does.
 */

export * from "./block.ts";
export * from "./document.ts";
export * from "./export-markdown.ts";
export * from "./legacy.ts";
export * from "./validate.ts";
