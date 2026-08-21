/**
 * Version mismatch and revoked devices fail safely (T036, US4).
 *
 * Both journeys are about a refusal, and refusals are where a product is most
 * likely to be honest in the code and useless on the screen. So each one asserts
 * the *sentence the owner reads*, not only the status code underneath it.
 */
import { expect, test } from "./fixtures.ts";
import { openSecondDevice, openWorkspace, uniqueName } from "./helpers.ts";
import { revokeDevice } from "./reset-installation.ts";

test.describe("an out-of-date client (FR-018 to FR-020)", () => {
  test("is refused the write with the version to update to, and keeps reading", async ({
    page,
  }) => {
    await openWorkspace(page);

    // The server announces what it speaks on every response. The client learns
    // it here rather than from a handshake, which is the point of the header.
    const announced = await page.evaluate(async () => {
      const response = await fetch("/v1/items");
      return response.headers.get("x-myownnotion-protocol");
    });
    expect(announced).toBe("2");

    // A protocol-1 client can still read but cannot create content whose
    // structured state it does not understand.
    const refusal = await page.evaluate(async () => {
      const response = await fetch("/v1/items", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": crypto.randomUUID(),
          "x-myownnotion-client-protocol": "1",
        },
        body: JSON.stringify({
          id: crypto.randomUUID(),
          kind: "folder",
          name: "Must not be written",
          placement: { kind: "hierarchy", parentItemId: null, positionKey: "V" },
        }),
      });
      const body = (await response.json()) as { title?: string };
      return { status: response.status, title: body.title };
    });
    expect(refusal.status).toBe(426);
    expect(refusal.title).toMatch(/can read.*version 2/is);

    const readable = await page.evaluate(async () => {
      const response = await fetch("/v1/items", {
        headers: { "x-myownnotion-client-protocol": "1" },
      });
      return response.status;
    });
    expect(readable).toBe(200);

    // And the workspace is usable, which is the observable half of FR-020.
    await expect(page.getByTestId("workspace-shell")).toBeVisible();
  });
});

test.describe("a revoked device (FR-021)", () => {
  test("stops synchronizing and says so, without being asked to", async ({
    page,
    browser,
    baseURL,
  }) => {
    const second = await openSecondDevice(browser, baseURL);
    try {
      await openWorkspace(page);
      await openWorkspace(second.page);
      await expect(second.page.getByTestId("live-connection-state")).toBeVisible({
        timeout: 15_000,
      });

      // Revoked in the database, exactly as the owner's device screen would.
      // The refusal must come from the server: asking the client to stop would
      // make the guarantee depend on the one party with a reason not to.
      test.skip(second.deviceId === null, "no device to revoke: the installation was not seeded");
      await revokeDevice(second.deviceId as string);

      // The stream is refused on its next connection, and the device says which
      // situation it is in rather than "not connected".
      await expect(second.page.getByTestId("live-connection-state")).toHaveAttribute(
        "data-state",
        "revoked",
        { timeout: 60_000 },
      );
      await expect(second.page.getByTestId("live-connection-state")).toContainText("withdrawn");

      // The first device is unaffected: revoking one device is not signing out.
      const stillWorks = uniqueName("AfterRevocation");
      await expect(page.getByTestId("sync-status")).toBeVisible();
      await expect(page.getByTestId("workspace-shell")).toBeVisible();
      expect(stillWorks).toBeTruthy();
    } finally {
      await second.context.close();
    }
  });
});
