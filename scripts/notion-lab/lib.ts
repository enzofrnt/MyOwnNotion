import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { type BrowserContext, chromium } from "@playwright/test";

/**
 * Local measurement workspace for studying Notion.
 *
 * Everything lives under `.notion-lab/`, which is git-ignored: the browser
 * profile holds a live Notion session cookie and must never be committed,
 * copied into a backup, or attached to an issue.
 */
export const labRoot = join(process.cwd(), ".notion-lab");
export const profileDir = process.env["NOTION_LAB_PROFILE"] ?? join(labRoot, "profile");
export const capturesDir = join(labRoot, "captures");

export async function ensurePrivateDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
}

export interface ProfileOptions {
  readonly headless: boolean;
  readonly width?: number;
  readonly height?: number;
  readonly theme?: "light" | "dark";
}

/**
 * Opens the persistent profile. Only one process may hold it at a time, so a
 * previous capture or login window must be closed before starting another.
 */
export async function openNotionProfile(options: ProfileOptions): Promise<BrowserContext> {
  await ensurePrivateDir(profileDir);
  return chromium.launchPersistentContext(profileDir, {
    headless: options.headless,
    viewport: { width: options.width ?? 1440, height: options.height ?? 1000 },
    colorScheme: options.theme ?? "light",
    locale: "fr-FR",
    timezoneId: "Europe/Paris",
    acceptDownloads: false,
  });
}

export function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

/** CLI output: stdout for results, stderr for diagnostics (no console lint noise). */
export function say(message = ""): void {
  process.stdout.write(`${message}\n`);
}

export function warn(message: string): void {
  process.stderr.write(`${message}\n`);
}
