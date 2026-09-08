import { applyDesktopJourneySkip } from "./desktop-skip.ts";
import { desktopOutbox, openDesktopWorkspace, setDesktopOffline } from "./desktop-workspace.ts";
import { expect, test } from "./fixtures.ts";
import { createRootItem, openWorkspaceDiagnostics, waitForSynchronized } from "./helpers.ts";
import { revokeDevice, seedSessionOnNewDevice } from "./reset-installation.ts";

applyDesktopJourneySkip();

test("revocation blocks protected access after offline work without deleting its queue", async ({
  freshContent,
  baseURL,
}) => {
  if (baseURL === undefined) throw new Error("Missing isolated test server");
  const isolatedDevice = await seedSessionOnNewDevice("Desktop revocation fixture");
  if (!isolatedDevice) throw new Error("Missing isolated device");
  const { session, page } = await openDesktopWorkspace(
    baseURL,
    freshContent.cookies.map((cookie) => ({ ...cookie, value: isolatedDevice.secret })),
  );
  try {
    await createRootItem(page, "page", "Desktop authorized page");
    await waitForSynchronized(page);
    const deviceId = await page.evaluate(async () => {
      const response = await fetch("/v1/auth/session");
      const value = await response.json();
      return value.session.deviceId as string;
    });
    await setDesktopOffline(session, true);
    await createRootItem(page, "folder", "Desktop pending before revoke");
    await openWorkspaceDiagnostics(page);
    await expect(page.getByTestId("pending-mutations")).toBeVisible();
    const databaseNames = await page.evaluate(async () =>
      (await indexedDB.databases()).map((db) => db.name).sort(),
    );
    const before = await desktopOutbox(page);
    expect(before.length).toBeGreaterThan(0);
    expect(JSON.stringify(before)).not.toContain("Desktop pending before revoke");
    await revokeDevice(deviceId);
    await setDesktopOffline(session, false);
    await page.reload();
    await expect(page.getByTestId("workspace-shell")).toBeHidden();
    const status = await page.evaluate(async () => (await fetch("/v1/items")).status);
    expect([401, 403]).toContain(status);
    expect(await desktopOutbox(page)).toEqual(before);
    expect(
      await page.evaluate(async () => (await indexedDB.databases()).map((db) => db.name).sort()),
    ).toEqual(databaseNames);
  } finally {
    await session.close();
  }
});
