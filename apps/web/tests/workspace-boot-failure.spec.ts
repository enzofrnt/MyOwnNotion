import { describe, expect, it } from "vitest";
import {
  classifyWorkspaceBootFailure,
  describeWorkspaceBootFailure,
  STORAGE_BOOT_DETAIL,
  UNEXPECTED_BOOT_DETAIL,
  workspaceBootFailureDetail,
  workspaceBootFailureProblem,
} from "../src/features/hierarchy/workspace-boot-failure.ts";

describe("workspace boot failure classification", () => {
  it("recognises storage refusals by exception name or by safe code", () => {
    for (const name of [
      "UnknownError",
      "QuotaExceededError",
      "InvalidStateError",
      "VersionError",
    ]) {
      expect(classifyWorkspaceBootFailure(new DOMException("refused", name))).toBe("storage");
    }
    expect(classifyWorkspaceBootFailure({ code: "storage.unavailable" })).toBe("storage");
    expect(classifyWorkspaceBootFailure({ code: "storage.quota-exceeded" })).toBe("storage");
  });

  it("does not blame the storage for anything else", () => {
    expect(classifyWorkspaceBootFailure(new TypeError("x is not a function"))).toBe("unexpected");
    expect(classifyWorkspaceBootFailure(new Error("failed to fetch module"))).toBe("unexpected");
    expect(classifyWorkspaceBootFailure(undefined)).toBe("unexpected");
    expect(classifyWorkspaceBootFailure({ code: "database.not-found" })).toBe("unexpected");
  });

  it("names a typed incident with a stable, content-free code", () => {
    expect(workspaceBootFailureProblem("storage")).toEqual({
      code: "storage.unavailable",
      title: "L’espace de travail n’a pas pu s’ouvrir.",
    });
    expect(workspaceBootFailureProblem("unexpected")).toEqual({
      code: "internal.unexpected",
      title: "L’espace de travail n’a pas pu s’ouvrir.",
    });
  });

  it("gives each cause its own recovery sentence, pointing at the diagnostics for the unknown case", () => {
    expect(workspaceBootFailureDetail("storage")).toBe(STORAGE_BOOT_DETAIL);
    expect(workspaceBootFailureDetail("unexpected")).toBe(UNEXPECTED_BOOT_DETAIL);
    expect(UNEXPECTED_BOOT_DETAIL).toContain("Données locales");
    // Neither sentence may claim a mechanism the classifier cannot prove.
    expect(UNEXPECTED_BOOT_DETAIL).not.toContain("stockage local est inaccessible");
  });

  it("keeps the operator trace to the error name and message", () => {
    expect(describeWorkspaceBootFailure(new DOMException("nope", "UnknownError"))).toBe(
      "UnknownError: nope",
    );
    expect(describeWorkspaceBootFailure("plain failure")).toBe("plain failure");
  });
});
