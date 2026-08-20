/**
 * What this server speaks, and what a client may do with it (T001, FR-017 to FR-020).
 *
 * Constants rather than stored values, deliberately: these change when the
 * software changes, and a row could disagree with what the code actually
 * speaks — a deployment claiming compatibility it does not have is worse than
 * one that refuses.
 *
 * **Two thresholds, not one.** A single "minimum supported version" can only
 * express allowed or refused, and refusing everything on a mismatch strands an
 * owner whose reads were perfectly safe on a device that worked yesterday. The
 * pair is what makes read-only mode expressible: between the read minimum and
 * the write minimum, a client may look at its notes and not write to them.
 */

/** The protocol this server speaks. Feature 009 introduces structured state. */
export const PROTOCOL_VERSION = 2;

/** The effective version of clients released before protocol announcements. */
export const LEGACY_PROTOCOL_VERSION = 1;

/**
 * The oldest client whose writes are still safe.
 *
 * Version 1 cannot safely write the structured state introduced by feature 009.
 * It remains inside the two-stable-version window for reads, but becomes
 * read-only instead of risking a write that omits data it cannot represent.
 */
export const MINIMUM_WRITE_VERSION = 2;

/**
 * The oldest client whose reads are still safe.
 *
 * Lower than the write minimum by design. Reading cannot corrupt anything, and
 * an owner who can read can still copy their work out of a device that is
 * behind.
 */
export const MINIMUM_READ_VERSION = 1;

export type ProtocolAccess =
  /** Reads and writes. */
  | { readonly kind: "full" }
  /** May read; a write would risk the content, so it is refused. */
  | { readonly kind: "read-only"; readonly requiredVersion: number }
  /** Too old to trust with either. */
  | { readonly kind: "refused"; readonly requiredVersion: number };

export interface ProtocolWindow {
  readonly minimumRead: number;
  readonly minimumWrite: number;
}

/** The window this build actually enforces. */
export const CURRENT_PROTOCOL_WINDOW: ProtocolWindow = {
  minimumRead: MINIMUM_READ_VERSION,
  minimumWrite: MINIMUM_WRITE_VERSION,
};

/**
 * What a client announcing `clientVersion` is allowed to do.
 *
 * A missing or unparseable version is the legacy protocol, not the current one.
 * Feature 006 initially admitted silent clients because no incompatible change
 * existed yet. Structured state is the first such change: treating silence as
 * current now would let the oldest clients bypass the write gate entirely.
 */
export function protocolAccessFor(
  clientVersion: number | null,
  /**
   * The window to judge against; the current build's by default.
   *
   * A parameter rather than a hard reference to the constants so future
   * compatibility windows remain exhaustively testable without changing global
   * state.
   */
  window: ProtocolWindow = CURRENT_PROTOCOL_WINDOW,
): ProtocolAccess {
  const effectiveVersion =
    clientVersion === null || !Number.isFinite(clientVersion)
      ? LEGACY_PROTOCOL_VERSION
      : clientVersion;
  if (effectiveVersion >= window.minimumWrite) {
    return { kind: "full" };
  }
  if (effectiveVersion >= window.minimumRead) {
    return { kind: "read-only", requiredVersion: window.minimumWrite };
  }
  return { kind: "refused", requiredVersion: window.minimumRead };
}

/**
 * What to tell the owner, naming the version they need.
 *
 * The number is in the sentence because "please update" without it leaves
 * someone comparing two things they cannot see.
 */
export function describeProtocolRefusal(access: ProtocolAccess): string | null {
  switch (access.kind) {
    case "full":
      return null;
    case "read-only":
      return `This device can read your workspace but not change it: it speaks an older protocol than this server. Update it to version ${access.requiredVersion} or later to make changes again. Nothing has been lost.`;
    case "refused":
      return `This device is too old to synchronize with this server safely. Update it to version ${access.requiredVersion} or later. Your content is unchanged on the server.`;
  }
}

/** Parses the header a client sends, without trusting it to be a number. */
export function parseClientVersion(header: string | undefined): number | null {
  if (header === undefined || header.trim() === "") {
    return null;
  }
  const parsed = Number.parseInt(header, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}
