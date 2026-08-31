import { generateUuidV7 } from "@myownnotion/domain";
import { describe, expect, it } from "vitest";
import {
  notePath,
  pageSettingsPath,
  recognizeDestination,
  settingsPath,
} from "../src/routing/paths.ts";
import {
  loginPath,
  safeReturnDestination,
  setupPath,
  workspaceReturnDestinationFromState,
  workspaceReturnState,
} from "../src/routing/return-destination.ts";

describe("canonical application paths", () => {
  it("builds stable note and page-settings paths from canonical identities", () => {
    const itemId = generateUuidV7();

    expect(notePath(itemId)).toBe(`/notes/${itemId}`);
    expect(pageSettingsPath(itemId)).toBe(`/settings/page/${itemId}`);
    expect(settingsPath("storage-sync")).toBe("/settings/storage-sync");
  });

  it.each([
    ["/", { kind: "root", canonicalPath: "/" }],
    ["/setup", { kind: "setup", canonicalPath: "/setup" }],
    ["/login", { kind: "login", canonicalPath: "/login" }],
    ["/notes", { kind: "notes", canonicalPath: "/notes", itemId: null }],
    [
      "/settings/security",
      { kind: "settings", canonicalPath: "/settings/security", section: "security" },
    ],
    [
      "/settings/storage-sync",
      { kind: "settings", canonicalPath: "/settings/storage-sync", section: "storage-sync" },
    ],
    ["/settings", { kind: "settings-root", canonicalPath: "/settings" }],
  ] as const)("recognizes %s", (pathname, expected) => {
    expect(recognizeDestination(pathname)).toEqual(expected);
  });

  it("recognizes canonical content identities and canonicalizes one trailing slash", () => {
    const itemId = generateUuidV7();

    expect(recognizeDestination(`/notes/${itemId}/`)).toEqual({
      kind: "note",
      itemId,
      canonicalPath: `/notes/${itemId}`,
    });
    expect(recognizeDestination(`/settings/page/${itemId}`)).toEqual({
      kind: "page-settings",
      itemId,
      canonicalPath: `/settings/page/${itemId}`,
    });
  });

  it.each([
    "/notes/not-a-uuid",
    "/notes//",
    "/notes/00000000-0000-0000-0000-000000000000/extra",
    "/settings/local-data",
    "/settings/page/not-a-uuid",
    "/SETTINGS/security",
    "/unknown",
  ])("rejects the unknown or malformed destination %s", (pathname) => {
    expect(recognizeDestination(pathname)).toMatchObject({ kind: "not-found", pathname });
  });
});

describe("safe authentication return destinations", () => {
  it("accepts protected routes and keeps only the allowed database view query", () => {
    const itemId = generateUuidV7();
    const viewId = generateUuidV7();

    expect(safeReturnDestination(`/notes/${itemId}?view=${viewId}&entry=${generateUuidV7()}`)).toBe(
      `/notes/${itemId}?view=${viewId}`,
    );
    expect(safeReturnDestination("/settings/storage-sync")).toBe("/settings/storage-sync");
  });

  it.each([
    null,
    "",
    "https://attacker.example/notes",
    "//attacker.example/notes",
    "/login",
    "/setup",
    "/__ui-lab",
    "/unknown",
    "/notes/not-a-uuid",
    "/notes/%E0%A4%A",
  ])("rejects an unsafe return destination %s", (candidate) => {
    expect(safeReturnDestination(candidate)).toBeNull();
  });

  it("encodes a validated return path for setup and login", () => {
    const itemId = generateUuidV7();
    const returnTo = `/notes/${itemId}`;

    expect(loginPath(returnTo)).toBe(`/login?returnTo=${encodeURIComponent(returnTo)}`);
    expect(setupPath(returnTo)).toBe(`/setup?returnTo=${encodeURIComponent(returnTo)}`);
    expect(loginPath("https://attacker.example")).toBe("/login");
  });

  it("round-trips only validated workspace history context", () => {
    const itemId = generateUuidV7();
    const state = workspaceReturnState(`/notes/${itemId}`, 420);
    expect(workspaceReturnDestinationFromState(state)).toEqual({
      path: `/notes/${itemId}`,
      scrollY: 420,
    });
    expect(workspaceReturnState("https://attacker.example", 20)).toBeNull();
    expect(
      workspaceReturnDestinationFromState({
        workspaceReturn: { path: "//attacker.example/notes", scrollY: 20 },
      }),
    ).toBeNull();
  });
});
