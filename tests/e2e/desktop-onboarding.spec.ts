import type {} from "../../apps/web/src/types/desktop-runtime.d.ts";
import { FR_COPY } from "../../apps/web/src/ui/copy/fr.ts";
import { launchDesktopElectron } from "./desktop-electron.ts";
import { applyDesktopJourneySkip } from "./desktop-skip.ts";
import { expect, test } from "./fixtures.ts";
import { createRootItem, openWorkspace } from "./helpers.ts";

applyDesktopJourneySkip();

test("onboarding preserves an authenticated profile and its page after restart", async ({
  freshContent,
  baseURL,
}) => {
  if (baseURL === undefined) throw new Error("Missing isolated test server");
  const session = await launchDesktopElectron();
  let keep = false;
  try {
    await session.app.evaluate(({ app }) => {
      const observed = globalThis as typeof globalThis & {
        allWindowsClosedDuringOnboarding?: boolean;
      };
      observed.allWindowsClosedDuringOnboarding = false;
      app.on("window-all-closed", () => {
        observed.allWindowsClosedDuringOnboarding = true;
      });
    });
    await expect(session.window.getByTestId("desktop-connection-page")).toBeVisible();
    await session.window.getByLabel(FR_COPY.desktop.connection.serverUrl).fill(baseURL);
    const nextWindow = session.app.waitForEvent("window");
    await session.window.getByRole("button", { name: FR_COPY.desktop.connection.submit }).click();
    const page = await nextWindow;
    await page.waitForLoadState("domcontentloaded");
    expect(
      await session.app.evaluate(({ BrowserWindow }) => ({
        windows: BrowserWindow.getAllWindows().length,
        closedAll: (
          globalThis as typeof globalThis & { allWindowsClosedDuringOnboarding?: boolean }
        ).allWindowsClosedDuringOnboarding,
      })),
    ).toEqual({ windows: 1, closedAll: false });
    await session.app.evaluate(
      async ({ BrowserWindow }, input) => {
        const target = BrowserWindow.getAllWindows()[0];
        if (target === undefined) throw new Error("Missing desktop window");
        for (const cookie of input.cookies)
          await target.webContents.session.cookies.set({
            url: input.url,
            name: cookie.name,
            value: cookie.value,
            httpOnly: true,
            sameSite: "strict",
            expirationDate: Date.now() / 1000 + 3600,
          });
      },
      { cookies: freshContent.cookies, url: baseURL },
    );
    await page.reload();
    await openWorkspace(page);
    await createRootItem(page, "page", "Desktop persisted page");
    await expect(page.getByTestId("tree-item-Desktop persisted page")).toBeAttached();
    await session.close({ keepUserData: true });
    keep = true;
    const restarted = await launchDesktopElectron(session.userData);
    try {
      await openWorkspace(restarted.window);
      await expect(restarted.window.getByTestId("tree-item-Desktop persisted page")).toBeAttached();
      expect(await restarted.app.evaluate(({ app }) => app.getPath("userData"))).toBe(
        session.userData,
      );
      expect(
        await restarted.window.evaluate(() => window.myownnotionDesktop?.getActiveProfile()),
      ).toMatchObject({ serverUrl: baseURL, active: true });
    } finally {
      await restarted.close();
    }
  } finally {
    if (!keep) await session.close();
  }
});
