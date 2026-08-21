/**
 * Redaction and safe problem codes (T017, feature 002).
 *
 * Everything the installation emits outward — an HTTP problem body, a log
 * line, an audit row, a diagnostic bundle — passes through here first.
 *
 * The design is deny-by-default in two ways, both deliberate:
 *
 *   1. **Forbidden fields are matched by name, recursively, at any depth**,
 *      including inside arrays and inside strings that turn out to be JSON. A
 *      secret does not become safe by being nested three levels down or by
 *      being stringified on the way out.
 *   2. **Only allowlisted problem codes reach a client.** An unrecognised
 *      internal error becomes `internal_error` with no detail. The alternative
 *      — passing through a message someone wrote for a log — is how content,
 *      paths, and identifiers leak.
 *
 * Redaction replaces a value with a fixed marker rather than deleting the key.
 * A missing key is itself information ("this installation has no password
 * configured"); a uniform marker is not.
 */

/** Replacement for any redacted value. Fixed width, no length signal. */
export const REDACTED = "[redacted]" as const;

/**
 * Field names whose values never leave the process. Matched
 * case-insensitively, ignoring `_`, `-`, and `.`, so `deployment_key`,
 * `deploymentKey`, and `deployment-key` are the same field.
 *
 * Anything that unlocks data, authenticates a request, or *is* owner content
 * belongs here.
 */
export const FORBIDDEN_FIELD_NAMES = [
  // Key material
  "key",
  "keys",
  "secret",
  "secrets",
  "deploymentkey",
  "wrappingkey",
  "datakey",
  "masterkey",
  "recordkey",
  // The wrapped forms, which are the ones that actually exist as columns and
  // therefore the ones most likely to reach a log through a row dump. Wrapped
  // is not safe: it is key material under another key, and whoever holds that
  // key is exactly who a leaked row helps.
  "rootkey",
  "wrappedrootkey",
  "wrappeddatakey",
  "privatekey",
  "keymaterial",
  // Credentials
  "password",
  "passwd",
  "passphrase",
  "credential",
  "credentials",
  "pin",
  // Session and capability material
  "token",
  "tokens",
  "sessiontoken",
  "csrftoken",
  "bootstrapcapability",
  "capability",
  "cookie",
  "authorization",
  // Recovery material
  "recoverykit",
  "kit",
  "kitmaterial",
  "recoverypayload",
  // Plaintext and content
  "plaintext",
  "content",
  "body",
  "document",
  "snapshot",
  "ciphertext",
  // Structured workspace content (feature 009). Stable identifiers remain
  // readable, but every owner-authored label, value and view/query definition
  // is private even when it appears in an application-owned diagnostic object.
  "payload",
  "name",
  "title",
  "label",
  "labels",
  "value",
  "values",
  "definition",
  "properties",
  "options",
  "views",
  "taskroles",
  "filter",
  "filters",
  "sort",
  "sorts",
  "group",
  "groups",
  "query",
  "snippet",
  "results",
  "relationtargets",
  "metadata",
  "configuration",
  "config",
] as const;

/**
 * Field names that look sensitive but are safe and diagnostically necessary.
 * Checked before the forbidden list, so `keyGeneration` survives even though
 * it contains "key".
 *
 * Every entry here is a deliberate exception: a digest or an identifier, never
 * the material itself.
 */
export const ALLOWED_FIELD_NAMES = [
  "keygeneration",
  "keykind",
  "keyid",
  "keypolicystate",
  "supportedkeygenerations",
  "credentialid",
  "credentialiddigest",
  "credentialkind",
  "capabilitydigest",
  "tokencount",
  "contenttype",
  "contentlength",
  "contentid",
  "documentid",
  "snapshotexpiresat",
  "bodybytes",
] as const;

function normalizeFieldName(name: string): string {
  return name.toLowerCase().replaceAll(/[_\-.]/g, "");
}

const forbidden = new Set<string>(FORBIDDEN_FIELD_NAMES);
const allowed = new Set<string>(ALLOWED_FIELD_NAMES);

export function isForbiddenFieldName(name: string): boolean {
  const normalized = normalizeFieldName(name);
  return !allowed.has(normalized) && forbidden.has(normalized);
}

/** Guard against a cyclic or pathologically deep structure. */
const MAX_DEPTH = 12;

/**
 * Recursively redacts forbidden fields.
 *
 * Strings that parse as JSON objects are redacted and re-serialized, because
 * "log the request body as a string" is the most common way a secret escapes
 * a structured redactor.
 */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) {
    return REDACTED;
  }
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value === "string") {
    return redactEmbeddedJson(value, depth);
  }
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return value;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (value instanceof Uint8Array || ArrayBuffer.isView(value)) {
    // Raw bytes in a diagnostic are almost always key or content material.
    return REDACTED;
  }
  if (value instanceof Error) {
    return { name: value.name, message: REDACTED };
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redact(entry, depth + 1));
  }
  if (typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      output[key] = isForbiddenFieldName(key) ? REDACTED : redact(nested, depth + 1);
    }
    return output;
  }
  // Functions, symbols: no safe representation.
  return REDACTED;
}

function redactEmbeddedJson(value: string, depth: number): string {
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    return value;
  }
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (typeof parsed !== "object" || parsed === null) {
      return value;
    }
    return JSON.stringify(redact(parsed, depth + 1));
  } catch {
    return value;
  }
}

/**
 * Whether a redacted structure still contains a forbidden field name with a
 * non-marker value. Used by the property tests and by the audit repository as
 * a last line of defence before a row is written.
 */
export function containsUnredactedField(value: unknown, depth = 0): boolean {
  if (depth > MAX_DEPTH || value === null || value === undefined) {
    return false;
  }
  if (Array.isArray(value)) {
    return value.some((entry) => containsUnredactedField(entry, depth + 1));
  }
  if (typeof value === "object" && !(value instanceof Date)) {
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (isForbiddenFieldName(key) && nested !== REDACTED) {
        return true;
      }
      if (containsUnredactedField(nested, depth + 1)) {
        return true;
      }
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Safe problem codes
// ---------------------------------------------------------------------------

/**
 * The complete set of problem codes the security surface may return.
 *
 * Codes are deliberately coarse. `authentication_failed` covers an unknown
 * credential, a wrong password, and a failed passkey assertion alike: telling
 * the caller which one it was turns the endpoint into an oracle.
 */
export const SAFE_PROBLEM_CODES = [
  "authentication_failed",
  "authentication_required",
  /**
   * This device's access was withdrawn (feature 006, FR-021).
   *
   * Distinct from `authentication_failed`, and this is one of the few places
   * where being specific is right rather than an oracle: the caller already
   * knows which device it is, so the code discloses nothing it did not have.
   * What it buys is that the device can say so and stop writing instead of
   * prompting for a sign-in that will never succeed.
   */
  "device_revoked",
  "recent_authentication_required",
  "csrf_validation_failed",
  "rate_limited",
  "forbidden",
  "not_found",
  "conflict",
  "validation_failed",
  "installation_not_ready",
  "installation_degraded",
  "bootstrap_unavailable",
  "bootstrap_capability_invalid",
  "recovery_unavailable",
  "recovery_material_invalid",
  "rotation_in_progress",
  "write_blocked",
  "migration_in_progress",
  "protected_read_failed",
  "protected_write_failed",
  "internal_error",
] as const;
export type SafeProblemCode = (typeof SAFE_PROBLEM_CODES)[number];

const safeCodes = new Set<string>(SAFE_PROBLEM_CODES);

export function isSafeProblemCode(code: string): code is SafeProblemCode {
  return safeCodes.has(code);
}

export interface SafeProblem {
  readonly code: SafeProblemCode;
  /** Correlation ID: lets an operator find the unredacted server-side log. */
  readonly correlationId: string;
  /** Safe, non-identifying detail. Absent unless it adds owner-actionable value. */
  readonly detail?: string;
}

/**
 * Builds the outward-facing problem.
 *
 * An unrecognised code collapses to `internal_error`, and detail is dropped
 * unless the caller explicitly marked it safe. The default is silence.
 */
export function toSafeProblem(
  code: string,
  correlationId: string,
  options: { safeDetail?: string } = {},
): SafeProblem {
  const resolved: SafeProblemCode = isSafeProblemCode(code) ? code : "internal_error";
  return options.safeDetail === undefined
    ? { code: resolved, correlationId }
    : { code: resolved, correlationId, detail: options.safeDetail };
}
