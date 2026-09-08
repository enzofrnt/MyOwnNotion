import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { type DesktopElectronSession, launchDesktopElectron } from "./desktop-electron.ts";
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

/** Inspect only this generated fixture's encrypted native storage; never attach its bytes. */
async function nativeKeyCommitState(session: DesktopElectronSession) {
  try {
    const sessionData = await session.app.evaluate(({ app }) => app.getPath("sessionData"));
    const state: unknown = JSON.parse(
      await readFile(path.join(sessionData, "Local State"), "utf8"),
    );
    const protectedKey = (state as { os_crypt?: { encrypted_key?: unknown } })?.os_crypt
      ?.encrypted_key;
    return {
      filePresent: true,
      keyFingerprint:
        typeof protectedKey === "string" && protectedKey.length > 0
          ? createHash("sha256").update(protectedKey).digest("hex")
          : null,
    };
  } catch {
    return { filePresent: false, keyFingerprint: null };
  }
}

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
    const beforeCrash = await nativeKeyCommitState(session);
    if (process.platform === "win32") {
      expect(beforeCrash.filePresent).toBe(true);
      expect(beforeCrash.keyFingerprint !== null).toBe(true);
    }
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
      const afterRestart = await nativeKeyCommitState(restarted);
      await testInfo.attach("native-key-commit-state", {
        body: JSON.stringify({
          beforeCrash: {
            filePresent: beforeCrash.filePresent,
            keyPresent: beforeCrash.keyFingerprint !== null,
          },
          afterRestart: {
            filePresent: afterRestart.filePresent,
            keyPresent: afterRestart.keyFingerprint !== null,
          },
          persistedKeyUnchanged:
            beforeCrash.keyFingerprint !== null &&
            beforeCrash.keyFingerprint === afterRestart.keyFingerprint,
        }),
        contentType: "application/json",
      });
      const state = await restarted.window
        .evaluate(async () => ({
          online: navigator.onLine,
          visibility: document.visibilityState,
          loadingPhases: Array.from(document.querySelectorAll("[data-load-phase]")).map((node) =>
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
      try {
        await tracing.stop({ path: tracePath });
        await testInfo.attach("native-restart-trace", {
          path: tracePath,
          contentType: "application/zip",
        });
      } catch {
        // A disconnected inspector cannot export its trace. Preserve the
        // original failure instead of replacing it with this diagnostic error.
        console.error("[desktop-test] native restart trace unavailable");
      }
      throw error;
    } finally {
      await restarted.close();
    }
  } finally {
    if (!killed) await session.close();
  }
});
