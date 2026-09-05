import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { FR_COPY } from "../../apps/web/src/ui/copy/fr.ts";
import { type DesktopElectronSession, launchDesktopElectron } from "./desktop-electron.ts";
import { openWorkspace } from "./helpers.ts";

export async function openDesktopWorkspace(
  baseURL: string,
  cookies: readonly { name: string; value: string }[],
  bootstrapPath?: string,
): Promise<{ session: DesktopElectronSession; page: Page }> {
  const session = await launchDesktopElectron(undefined, bootstrapPath);
  try {
    await expect(session.window.getByTestId("desktop-connection-page")).toBeVisible();
    await session.window.getByLabel(FR_COPY.desktop.connection.serverUrl).fill(baseURL);
    const next = session.app.waitForEvent("window");
    await session.window.getByRole("button", { name: FR_COPY.desktop.connection.submit }).click();
    const page = await next;
    await page.waitForLoadState("domcontentloaded");
    await session.app.evaluate(
      async ({ BrowserWindow }, input) => {
        const window = BrowserWindow.getAllWindows()[0];
        if (window === undefined) throw new Error("Missing desktop window");
        for (const cookie of input.cookies)
          await window.webContents.session.cookies.set({
            url: input.url,
            name: cookie.name,
            value: cookie.value,
            httpOnly: true,
            sameSite: "strict",
            expirationDate: Date.now() / 1000 + 3600,
          });
        await window.webContents.session.cookies.flushStore();
      },
      { url: baseURL, cookies: [...cookies] },
    );
    await page.reload();
    await openWorkspace(page);
    return { session, page };
  } catch (error) {
    await session.close();
    throw error;
  }
}

export async function setDesktopOffline(
  session: DesktopElectronSession,
  offline: boolean,
): Promise<void> {
  await session.app.evaluate(({ BrowserWindow }, value) => {
    const window = BrowserWindow.getAllWindows()[0];
    if (window === undefined) throw new Error("Missing desktop window");
    if (value) {
      window.webContents.session.enableNetworkEmulation({ offline: true });
      window.webContents.session.webRequest.onBeforeRequest((request, callback) => {
        const url = new URL(request.url);
        callback({ cancel: url.pathname.startsWith("/v1/") || url.pathname.startsWith("/health") });
      });
    } else {
      window.webContents.session.disableNetworkEmulation();
      window.webContents.session.webRequest.onBeforeRequest(null);
    }
  }, offline);
}

/** Read the durable encrypted mutation payload, not an in-memory UI counter. */
export async function desktopOutbox(page: Page): Promise<unknown[]> {
  return page.evaluate(async () => {
    return new Promise<unknown[]>((resolve, reject) => {
      const request = indexedDB.open("myownnotion-local");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const transaction = db.transaction("outbox", "readonly");
        const rows = transaction.objectStore("outbox").getAll();
        transaction.oncomplete = () => {
          db.close();
          resolve(rows.result.map((row) => ({ mutationId: row.mutationId, payload: row.payload })));
        };
        transaction.onabort = () => {
          db.close();
          reject(transaction.error);
        };
      };
    });
  });
}
