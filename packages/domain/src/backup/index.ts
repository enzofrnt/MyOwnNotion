/**
 * Backup rules that hold everywhere (feature 007).
 *
 * Pure and platform-independent: what a manifest must contain, whether a backup
 * can be read by this installation, and which backups may be deleted. All three
 * decide whether an owner's only remaining copy survives, so all three belong
 * where a test can exhaust them without a server or a destination.
 */

export * from "./archive-manifest.ts";
export * from "./compatibility.ts";
export * from "./retention.ts";
