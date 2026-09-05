import { expect, test } from "@playwright/test";
import { FR_COPY } from "../../apps/web/src/ui/copy/fr.ts";
import { launchDesktopElectron } from "./desktop-electron.ts";
import { applyDesktopJourneySkip } from "./desktop-skip.ts";

applyDesktopJourneySkip();
test("refuses unsupported schemes and remote HTTP before connecting", async () => {
  const session = await launchDesktopElectron();
  try {
    const page = session.window;
    for (const address of ["ftp://files.example.org", "http://notes.example.org"]) {
      await page.getByLabel(FR_COPY.desktop.connection.serverUrl).fill(address);
      await page.getByRole("button", { name: FR_COPY.desktop.connection.submit }).click();
      await expect(page.getByTestId("desktop-connection-error")).toBeVisible();
      await expect(page.getByTestId("desktop-connection-page")).toBeVisible();
      expect(await page.evaluate(() => window.myownnotionDesktop?.getActiveProfile())).toBeNull();
    }
  } finally {
    await session.close();
  }
});
