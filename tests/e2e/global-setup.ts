/**
 * Playwright global setup: start each end-to-end run from empty canonical
 * content so journeys are deterministic.
 *
 * Global setup runs once per run, not per project. Per-project isolation comes
 * from the `reset-*` setup projects declared in playwright.config.ts (T106).
 */
import { resetCanonicalContent } from "./reset-content.ts";

export default async function globalSetup(): Promise<void> {
  await resetCanonicalContent();
}
