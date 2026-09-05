import type { DesktopPlatform, KeyAvailability, KeyStateResult } from "./ipc-contract.ts";

export function keyStateFromPlatform(input: {
  readonly encryptionAvailable: boolean;
  readonly hasEnvelope: boolean;
  readonly locked: boolean;
  readonly revoked: boolean;
  readonly platform: DesktopPlatform;
}): KeyStateResult {
  let state: KeyAvailability = "missing";
  if (input.revoked) {
    state = "revoked";
  } else if (!input.encryptionAvailable) {
    state = "unavailable";
  } else if (input.locked) {
    state = "locked";
  } else if (input.hasEnvelope) {
    state = "available";
  }
  return {
    state,
    encryptionAvailable: input.encryptionAvailable,
    platform: input.platform,
  };
}
