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

/** The protocol this server speaks. */
export const PROTOCOL_VERSION = 1;

/**
 * The oldest client whose writes are still safe.
 *
 * The product canvas sets the window at two stable versions: the matching client
 * and the one immediately before it. At version 1 there is no previous stable
 * version, so the two coincide — and they are separate constants so that
 * widening the window later is an edit rather than a redesign.
 */
export const MINIMUM_WRITE_VERSION = 1;

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
 * A missing or unparseable version is treated as **full** access rather than
 * refused, and that is a considered choice: every client before this feature
 * announces nothing, and refusing them would break working installations at
 * upgrade time. The version becomes mandatory when the first incompatible change
 * ships, which is the moment it starts carrying information.
 */
export function protocolAccessFor(
  clientVersion: number | null,
  /**
   * The window to judge against; the current build's by default.
   *
   * A parameter rather than a hard reference to the constants, because at
   * version 1 the refusal branches are unreachable — the minimums and the
   * current version coincide, so no client can be too old yet. Without a way to
   * state a different window, the refusal path would ship untested and would
   * first be exercised on the day it starts refusing real owners' devices.
   */
  window: ProtocolWindow = CURRENT_PROTOCOL_WINDOW,
): ProtocolAccess {
  if (clientVersion === null || !Number.isFinite(clientVersion)) {
    return { kind: "full" };
  }
  if (clientVersion >= window.minimumWrite) {
    return { kind: "full" };
  }
  if (clientVersion >= window.minimumRead) {
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
