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
}) => {
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
    const exited = new Promise<void>((resolve) =>
      session.app.process().once("exit", () => resolve()),
    );
    session.app.process().kill("SIGKILL");
    await exited;
    killed = true;
    const restarted = await launchDesktopElectron(userData);
    try {
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
    } finally {
      await restarted.close();
    }
  } finally {
    if (!killed) await session.close();
  }
});
