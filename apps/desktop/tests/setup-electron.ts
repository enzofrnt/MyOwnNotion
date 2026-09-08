import { statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

/** Electron downloads on first require; finish once before parallel workers load it. */
export default function prepareElectron(): void {
  const executable: unknown = createRequire(import.meta.url)("electron");
  if (
    typeof executable !== "string" ||
    !path.isAbsolute(executable) ||
    !statSync(executable).isFile()
  ) {
    throw new Error("The pinned Electron executable is unavailable.");
  }
}
