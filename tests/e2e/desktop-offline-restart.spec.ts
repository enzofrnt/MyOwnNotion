import { launchDesktopElectron } from "./desktop-electron.ts";
import { applyDesktopJourneySkip } from "./desktop-skip.ts";
import { openDesktopWorkspace, setDesktopOffline } from "./desktop-workspace.ts";
import { expect, test } from "./fixtures.ts";
import {
  createRootItem,
  ensureNavigationRowVisible,
  openWorkspace,
  openWorkspaceDiagnostics,
  returnToWorkspace,
  selectItem,
  typeIntoEditor,
  waitForSynchronized,
} from "./helpers.ts";

applyDesktopJourneySkip();

test("recovers a durable offline creation after process death and reconciles it once", async ({
  freshContent,
  baseURL,
}, testInfo) => {
  if (baseURL === undefined) throw new Error("Missing isolated test server");
  const { session, page } = await openDesktopWorkspace(baseURL, freshContent.cookies);
  const userData = session.userData;
  let killed = false;
  try {
    await createRootItem(page, "page", "Desktop online page");
    await waitForSynchronized(page);
    await setDesktopOffline(session, true);
    await selectItem(page, "Desktop online page");
    await typeIntoEditor(page, "Text written while the server is unreachable");
    await createRootItem(page, "folder", "Desktop offline creation");
    await openWorkspaceDiagnostics(page);
    await expect(page.getByTestId("pending-mutations")).toBeVisible();
    await returnToWorkspace(page);
    await session.crash();
    killed = true;
    const restarted = await launchDesktopElectron(userData);
    const pageErrors: string[] = [];
    restarted.window.on("pageerror", (error) => {
      if (pageErrors.length < 20) pageErrors.push(error.name);
    });
    const tracing = restarted.app.context().tracing;
    try {
      await tracing.start({ screenshots: true, snapshots: true, sources: true });
      await setDesktopOffline(restarted, true);
      await restarted.window.reload();
      await openWorkspace(restarted.window);
      await ensureNavigationRowVisible(restarted.window, "Desktop offline creation");
      await selectItem(restarted.window, "Desktop online page");
      await expect(
        restarted.window.getByTestId("block-editor").locator(".ProseMirror"),
      ).toContainText("Text written while the server is unreachable");
      await setDesktopOffline(restarted, false);
      await waitForSynchronized(restarted.window);
      await restarted.window.reload();
      await openWorkspace(restarted.window);
      await ensureNavigationRowVisible(restarted.window, "Desktop offline creation");
      await expect(restarted.window.getByTestId("tree-item-Desktop offline creation")).toHaveCount(
        1,
      );
      await tracing.stop();
    } catch (error) {
      const state = await restarted.window
        .evaluate(async () => ({
          online: navigator.onLine,
          visibility: document.visibilityState,
          loadingPhases: [...document.querySelectorAll("[data-load-phase]")].map((node) =>
            node.getAttribute("data-load-phase"),
          ),
          locks: await navigator.locks.query(),
        }))
        .catch(() => ({ unavailable: true }));
      await testInfo.attach("native-restart-state", {
        body: JSON.stringify({ state, pageErrors }),
        contentType: "application/json",
      });
      const tracePath = testInfo.outputPath("native-restart-trace.zip");
      await tracing.stop({ path: tracePath });
      await testInfo.attach("native-restart-trace", {
        path: tracePath,
        contentType: "application/zip",
      });
      throw error;
    } finally {
      await restarted.close();
    }
  } finally {
    if (!killed) await session.close();
  }
});
