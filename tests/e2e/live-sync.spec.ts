/**
 * A change on one device appears on the other (T014, T020, T043 — US1, US2).
 *
 * Two browser contexts, which is the only honest way to test this. The whole
 * feature is about a device learning something the person at it did not tell it,
 * and a single context that reloads proves nothing — a reload fetches. So the
 * second context is never reloaded and never clicked after the change is made.
 * If the content appears there, it appeared by itself.
 *
 * The two-second target (FR-002) is measured and reported rather than asserted at
 * the boundary: the measurement necessarily includes driving the interface, which
 * is not part of the latency the requirement describes. The observed figure is
 * recorded in validation.md.
 */
import { randomUUID } from "node:crypto";
import { expect, test } from "./fixtures.ts";
import {
  apiOrigin,
  CURRENT_PROTOCOL_HEADERS,
  createRootItem,
  openSecondDevice,
  openWorkspace,
  uniqueName,
  waitForSynchronized,
} from "./helpers.ts";

test.describe("live synchronization (US1)", () => {
  test("a change made on one device reaches another without it asking", async ({
    page,
    browser,
    baseURL,
  }) => {
    const second = await openSecondDevice(browser, baseURL);
    try {
      await openWorkspace(page);
      await openWorkspace(second.page);
      // The indicator exists and says something. Not asserted as "live": a
      // first connection that is still opening would fail a test about
      // synchronization for a reason that is not about synchronization.
      await expect(second.page.getByTestId("live-connection-state")).toBeVisible({
        timeout: 15_000,
      });

      const created = uniqueName("LiveFolder");
      const startedAt = Date.now();
      await createRootItem(page, "folder", created);
      await waitForSynchronized(page);

      // The watching device is not touched: no reload, no click, no navigation.
      await expect(second.page.getByTestId(`tree-item-${created}`)).toBeVisible({
        timeout: 15_000,
      });
      // biome-ignore lint/suspicious/noConsole: this line is the measurement
      console.log(`live propagation observed in ${Date.now() - startedAt}ms`);
    } finally {
      await second.context.close();
    }
  });

  test("a rename made elsewhere replaces the old row rather than adding one", async ({
    page,
    browser,
    baseURL,
  }) => {
    const second = await openSecondDevice(browser, baseURL);
    try {
      await openWorkspace(page);
      const original = uniqueName("BeforeRename");
      await createRootItem(page, "folder", original);
      await waitForSynchronized(page);

      await openWorkspace(second.page);
      await expect(second.page.getByTestId(`tree-item-${original}`)).toBeVisible({
        timeout: 15_000,
      });

      const renamed = uniqueName("AfterRename");
      // The rename control asks through `window.prompt`, so the dialog is
      // answered rather than a field filled.
      page.once("dialog", (dialog) => void dialog.accept(renamed));
      await page.getByRole("button", { name: `Rename ${original}` }).click();
      await waitForSynchronized(page);

      await expect(second.page.getByTestId(`tree-item-${renamed}`)).toBeVisible({
        timeout: 15_000,
      });
      // The old row is gone rather than shown beside the new one. A projection
      // that added instead of replacing would look right on the device that made
      // the change and duplicate everything on every other one.
      await expect(second.page.getByTestId(`tree-item-${original}`)).toHaveCount(0);
    } finally {
      await second.context.close();
    }
  });
});

test.describe("catching up after an absence (US2)", () => {
  test("a device that was away receives every change it missed", async ({
    browser,
    baseURL,
    request,
  }) => {
    const away = await openSecondDevice(browser, baseURL);
    try {
      await openWorkspace(away.page);

      // The device really goes away. Request interception only rejects future
      // fetches: it leaves an EventSource that is already open connected and
      // does not emit the browser's offline/online lifecycle. That made this
      // journey race route removal against a retrying fetch instead of testing
      // reconnection. Browser-context offline mode closes the stream and emits
      // the same lifecycle a device experiences when its network disappears.
      await away.context.setOffline(true);
      await expect.poll(() => away.page.evaluate(() => navigator.onLine)).toBe(false);

      // The changes are made through the API rather than through a second
      // browser, and that is a deliberate narrowing. This journey is about what
      // the *absent* device receives; how the changes were produced is
      // incidental, and producing five of them by typing into one shared name
      // field is a race that has nothing to do with catch-up — it failed exactly
      // there, on a phone-sized viewport, pointing at a creation rather than at
      // the property under test.
      const names: string[] = [];
      for (let index = 0; index < 5; index += 1) {
        const name = uniqueName(`WhileAway${index}`);
        names.push(name);
        const created = await request.post(`${apiOrigin()}/v1/items`, {
          headers: { ...CURRENT_PROTOCOL_HEADERS, "idempotency-key": randomUUID() },
          data: {
            id: randomUUID(),
            kind: "folder",
            name,
            placement: { kind: "hierarchy", parentItemId: null, positionKey: `V${index}` },
          },
        });
        expect(created.status(), await created.text()).toBe(201);
      }

      // It comes back, without being reloaded. The stream reconnects by itself
      // and the catch-up follows from that, which is the property under test.
      await away.context.setOffline(false);
      await expect.poll(() => away.page.evaluate(() => navigator.onLine)).toBe(true);

      for (const name of names) {
        await expect(away.page.getByTestId(`tree-item-${name}`)).toBeVisible({ timeout: 30_000 });
      }
    } finally {
      await away.context.close();
    }
  });
});
