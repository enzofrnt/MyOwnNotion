import { isUuid, type Uuid } from "@myownnotion/domain";

export type SettingsRouteSection = "security" | "navigation" | "backups" | "storage-sync" | "trash";

export type ApplicationDestination =
  | { readonly kind: "root"; readonly canonicalPath: "/" }
  | { readonly kind: "setup"; readonly canonicalPath: "/setup" }
  | { readonly kind: "login"; readonly canonicalPath: "/login" }
  | { readonly kind: "notes"; readonly itemId: null; readonly canonicalPath: "/notes" }
  | { readonly kind: "note"; readonly itemId: Uuid; readonly canonicalPath: string }
  | { readonly kind: "settings-root"; readonly canonicalPath: "/settings" }
  | {
      readonly kind: "settings";
      readonly section: SettingsRouteSection;
      readonly canonicalPath: string;
    }
  | { readonly kind: "page-settings"; readonly itemId: Uuid; readonly canonicalPath: string }
  | { readonly kind: "not-found"; readonly pathname: string; readonly reason: string };

const SETTINGS_SECTIONS = new Set<SettingsRouteSection>([
  "security",
  "navigation",
  "backups",
  "storage-sync",
  "trash",
]);

function withoutSingleTrailingSlash(pathname: string): string {
  if (pathname.length <= 1 || !pathname.endsWith("/") || pathname.endsWith("//")) {
    return pathname;
  }
  return pathname.slice(0, -1);
}

function notFound(pathname: string, reason: string): ApplicationDestination {
  return { kind: "not-found", pathname, reason };
}

export function notePath(itemId: Uuid): `/notes/${string}` {
  return `/notes/${itemId}`;
}

export function settingsPath(section: SettingsRouteSection): `/settings/${SettingsRouteSection}` {
  return `/settings/${section}`;
}

export function pageSettingsPath(itemId: Uuid): `/settings/page/${string}` {
  return `/settings/page/${itemId}`;
}

export function recognizeDestination(pathname: string): ApplicationDestination {
  if (!pathname.startsWith("/") || pathname.startsWith("//")) {
    return notFound(pathname, "invalid-path");
  }

  const canonicalCandidate = withoutSingleTrailingSlash(pathname);
  if (canonicalCandidate === "/") return { kind: "root", canonicalPath: "/" };
  if (canonicalCandidate === "/setup") return { kind: "setup", canonicalPath: "/setup" };
  if (canonicalCandidate === "/login") return { kind: "login", canonicalPath: "/login" };
  if (canonicalCandidate === "/notes") {
    return { kind: "notes", itemId: null, canonicalPath: "/notes" };
  }
  if (canonicalCandidate === "/settings") {
    return { kind: "settings-root", canonicalPath: "/settings" };
  }

  const segments = canonicalCandidate.split("/").slice(1);
  if (segments.length === 2 && segments[0] === "notes") {
    const itemId = segments[1];
    if (!isUuid(itemId)) return notFound(pathname, "invalid-item-id");
    return { kind: "note", itemId, canonicalPath: notePath(itemId) };
  }

  if (segments.length === 2 && segments[0] === "settings") {
    const section = segments[1];
    if (!SETTINGS_SECTIONS.has(section as SettingsRouteSection)) {
      return notFound(pathname, "unknown-settings-section");
    }
    return {
      kind: "settings",
      section: section as SettingsRouteSection,
      canonicalPath: settingsPath(section as SettingsRouteSection),
    };
  }

  if (segments.length === 3 && segments[0] === "settings" && segments[1] === "page") {
    const itemId = segments[2];
    if (!isUuid(itemId)) return notFound(pathname, "invalid-item-id");
    return { kind: "page-settings", itemId, canonicalPath: pageSettingsPath(itemId) };
  }

  return notFound(pathname, "unknown-path");
}

export function isProtectedDestination(
  destination: ApplicationDestination,
): destination is Extract<
  ApplicationDestination,
  { readonly kind: "notes" | "note" | "settings-root" | "settings" | "page-settings" }
> {
  return (
    destination.kind === "notes" ||
    destination.kind === "note" ||
    destination.kind === "settings-root" ||
    destination.kind === "settings" ||
    destination.kind === "page-settings"
  );
}
