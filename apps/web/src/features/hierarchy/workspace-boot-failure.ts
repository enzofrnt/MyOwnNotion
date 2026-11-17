/**
 * Why the workspace refused to open (feature 063).
 *
 * Initialization used to swallow the exception and show one fixed "local
 * storage is unreachable" sentence for every cause: an IndexedDB refusal, an
 * unreadable vault, a refused Web Lock and an unrelated programming error were
 * indistinguishable, and nothing reached the operator.
 *
 * These helpers classify the failure, name the recovery text that matches it
 * and produce the typed incident published in Réglages › Données locales. They
 * deliberately never expose an error message to the page: the surface test
 * `workspace-shell.spec.ts` forbids leaking internals into the DOM.
 */

import type { SafeError } from "@myownnotion/domain";

export type WorkspaceBootFailureKind = "storage" | "unexpected";

/**
 * `DOMException` names raised by the storage layer (IndexedDB, the vault and
 * Web Locks all surface their refusals this way). Anything else — a type error,
 * a failed import, an unexpected rejection — is not a storage incident.
 */
const STORAGE_FAILURE_NAMES: ReadonlySet<string> = new Set([
  "UnknownError",
  "QuotaExceededError",
  "InvalidStateError",
  "VersionError",
  "NotReadableError",
  "DataCloneError",
  "SecurityError",
]);

/** Safe error codes that already describe a storage refusal. */
const STORAGE_FAILURE_CODES: ReadonlySet<string> = new Set([
  "storage.unavailable",
  "storage.quota-exceeded",
]);

export const STORAGE_BOOT_DETAIL =
  "Le stockage local est inaccessible. Vérifiez l’accès au stockage et au coffre de cet appareil, puis réessayez. Vos données locales sont conservées.";

export const UNEXPECTED_BOOT_DETAIL =
  "L’espace n’a pas pu être chargé. Réessayez ; si le problème persiste, ouvrez Réglages › Données locales. Vos données locales sont conservées.";

const BOOT_FAILURE_TITLE = "L’espace de travail n’a pas pu s’ouvrir.";

function failureName(error: unknown): string | null {
  if (error instanceof DOMException) return error.name;
  if (error instanceof Error) return error.name;
  return null;
}

function failureCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

/**
 * Storage refusals are recognised by their `DOMException` name or by an already
 * typed safe code. Everything else is unknown, and says so instead of blaming
 * the storage.
 */
export function classifyWorkspaceBootFailure(error: unknown): WorkspaceBootFailureKind {
  const name = failureName(error);
  if (name !== null && STORAGE_FAILURE_NAMES.has(name)) return "storage";
  const code = failureCode(error);
  if (code !== null && STORAGE_FAILURE_CODES.has(code)) return "storage";
  return "unexpected";
}

/** The recovery sentence shown in the workspace pane for this kind of failure. */
export function workspaceBootFailureDetail(kind: WorkspaceBootFailureKind): string {
  return kind === "storage" ? STORAGE_BOOT_DETAIL : UNEXPECTED_BOOT_DETAIL;
}

/**
 * The typed incident published through `onProblemChange`, so the failure reaches
 * Réglages › Données locales › Dernier incident with a stable, content-free code.
 */
export function workspaceBootFailureProblem(kind: WorkspaceBootFailureKind): SafeError {
  return {
    code: kind === "storage" ? "storage.unavailable" : "internal.unexpected",
    title: BOOT_FAILURE_TITLE,
  };
}

/**
 * Operator trace. The name and message go to the console — never to the page —
 * matching `ui/error-boundary.tsx`: a stack is for whoever runs the application.
 */
export function describeWorkspaceBootFailure(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  if (typeof error === "string") return error;
  return String(error);
}
