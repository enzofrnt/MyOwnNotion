export type UpdateMachinePhase =
  | "idle"
  | "checking"
  | "available"
  | "deferred"
  | "downloading"
  | "downloaded"
  | "installing"
  | "restarted"
  | "unavailable"
  | "invalid-manifest"
  | "incompatible"
  | "download-failed"
  | "install-failed"
  | "rollback-required";

export interface UpdateContext {
  readonly pendingLocalChanges: boolean;
  readonly migrationActive: boolean;
  readonly ownerConfirmedInstall: boolean;
}

export function canEnterInstalling(context: UpdateContext): boolean {
  if (context.migrationActive) {
    return false;
  }
  if (context.pendingLocalChanges) {
    return false;
  }
  return true;
}

export function nextUpdatePhase(
  current: UpdateMachinePhase,
  event:
    | "check"
    | "found"
    | "none"
    | "invalid"
    | "incompatible"
    | "defer"
    | "download"
    | "downloaded"
    | "install"
    | "installed"
    | "failed-download"
    | "failed-install"
    | "rollback",
  context: UpdateContext,
): UpdateMachinePhase {
  switch (event) {
    case "check":
      return "checking";
    case "found":
      return current === "checking" || current === "idle" ? "available" : current;
    case "none":
      return "idle";
    case "invalid":
      return "invalid-manifest";
    case "incompatible":
      return "incompatible";
    case "defer":
      return current === "available" || current === "downloaded" ? "deferred" : current;
    case "download":
      return current === "available" || current === "deferred" ? "downloading" : current;
    case "downloaded":
      return current === "downloading" ? "downloaded" : current;
    case "install":
      if (current === "downloaded" && canEnterInstalling(context)) {
        return "installing";
      }
      return current;
    case "installed":
      return current === "installing" ? "restarted" : current;
    case "failed-download":
      return "download-failed";
    case "failed-install":
      return "install-failed";
    case "rollback":
      return "rollback-required";
    default:
      return current;
  }
}
