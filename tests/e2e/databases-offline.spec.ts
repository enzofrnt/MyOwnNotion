import { expect, type Page, test } from "@playwright/test";
import {
  addDatabaseProperty,
  addDatabaseRecord,
  addSelectOption,
  insertDatabase,
} from "./database-helpers.ts";
import {
  createRootItem,
  openWorkspace,
  selectItem,
  uniqueName,
  waitForSynchronized,
} from "./helpers.ts";

const apiPort = Number(process.env["MYOWNNOTION_API_PORT"] ?? 3001);

async function goOffline(page: Page): Promise<void> {
  await page.route("**/v1/**", (route) => route.abort("connectionrefused"));
  await page.route("**/health", (route) => route.abort("connectionrefused"));
}

async function goOnline(page: Page): Promise<void> {
  await page.unroute("**/v1/**");
  await page.unroute("**/health");
}

function databaseNodes(document: unknown): Array<Record<string, unknown>> {
  const databases: Array<Record<string, unknown>> = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const child of value) visit(child);
      return;
    }
    if (value === null || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    if (record["type"] === "databaseBlock") databases.push(record);
    for (const child of Object.values(record)) visit(child);
  };
  visit(document);
  return databases;
}

test.describe("offline structured databases (US4)", () => {
  test("keeps complete schema, records, relation, removal, and view through reload and reconnect", async ({
    page,
    request,
  }) => {
    await openWorkspace(page);
    const pageName = uniqueName("OfflineDatabase");
    await createRootItem(page, "page", pageName);
    await waitForSynchronized(page);
    const sourceId = await page.getByTestId(`tree-item-${pageName}`).getAttribute("data-item-id");
    if (sourceId === null) throw new Error("Offline database page identity missing");
    await selectItem(page, pageName);
    await goOffline(page);

    const database = await insertDatabase(page);
    await addDatabaseProperty(database, "Status", "select");
    await addDatabaseProperty(database, "Related", "relation");
    await addSelectOption(database, "Status", "Active");
    for (const title of ["Offline Alpha", "Offline Beta", "Remove me"]) {
      await addDatabaseRecord(database, title);
    }
    const betaId = await database
      .getByRole("row", { name: /^Offline Beta / })
      .getAttribute("data-record-id");
    if (betaId === null) throw new Error("Offline relation target identity missing");
    await database
      .getByRole("combobox", { name: "Status for Offline Alpha" })
      .selectOption({ label: "Active" });
    await database.getByRole("listbox", { name: "Related for Offline Alpha" }).selectOption(betaId);
    await database.getByRole("button", { name: "Remove record Remove me" }).click();
    await database.getByRole("button", { name: "Gallery" }).click();
    await page.getByRole("button", { name: "Save page" }).click();
    await expect(page.getByTestId("pending-mutations")).toBeVisible({ timeout: 15_000 });

    await page.reload();
    await expect(page.getByTestId(`tree-item-${pageName}`)).toBeVisible({ timeout: 15_000 });
    await selectItem(page, pageName);
    const reloaded = page.getByTestId("database-block");
    await expect(reloaded.getByRole("button", { name: "Gallery" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(reloaded.getByRole("button", { name: "Open record Offline Alpha" })).toBeVisible();
    await expect(reloaded.getByRole("button", { name: "Open record Remove me" })).toHaveCount(0);

    await goOnline(page);
    await page.reload();
    await openWorkspace(page);
    await waitForSynchronized(page);
    const synchronized = await request.get(`http://127.0.0.1:${apiPort}/v1/items/${sourceId}`);
    expect(synchronized.ok()).toBe(true);
    const body = (await synchronized.json()) as {
      pageDocument: { formatVersion: number; body: unknown };
    };
    expect(body.pageDocument.formatVersion).toBe(5);
    const nodes = databaseNodes(body.pageDocument.body);
    expect(nodes).toHaveLength(1);
    const attrs = nodes[0]?.["attrs"] as
      | {
          records?: Array<{ title?: string; values?: Array<{ type?: string; value?: unknown }> }>;
          view?: { mode?: string };
        }
      | undefined;
    expect(attrs?.records?.map((record) => record.title)).toEqual([
      "Offline Alpha",
      "Offline Beta",
    ]);
    expect(attrs?.records?.[0]?.values).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "relation", value: [betaId] }),
        expect.objectContaining({ type: "select" }),
      ]),
    );
    expect(attrs?.view?.mode).toBe("gallery");
  });

  test("keeps a complete local database recoverable after a competing revision", async ({
    page,
    request,
  }) => {
    await openWorkspace(page);
    const pageName = uniqueName("DatabaseConflict");
    await createRootItem(page, "page", pageName);
    await waitForSynchronized(page);
    const sourceId = await page.getByTestId(`tree-item-${pageName}`).getAttribute("data-item-id");
    if (sourceId === null) throw new Error("Conflict database page identity missing");
    await selectItem(page, pageName);
    await goOffline(page);
    const database = await insertDatabase(page);
    await addDatabaseProperty(database, "Local field", "text");
    await addDatabaseRecord(database, "Keep local record");
    await database
      .getByRole("textbox", { name: "Local field for Keep local record" })
      .fill("Keep local value");
    await database.getByRole("button", { name: "Board" }).click();
    await page.getByRole("button", { name: "Save page" }).click();
    await expect(page.getByTestId("pending-mutations")).toBeVisible({ timeout: 15_000 });

    const current = await request.get(`http://127.0.0.1:${apiPort}/v1/items/${sourceId}`);
    const currentBody = (await current.json()) as { currentRevisionId: string };
    const competing = await request.put(
      `http://127.0.0.1:${apiPort}/v1/pages/${sourceId}/document`,
      {
        headers: { "idempotency-key": crypto.randomUUID() },
        data: {
          baseRevisionId: currentBody.currentRevisionId,
          document: {
            format: "myownnotion.document+json",
            formatVersion: 5,
            body: {
              type: "doc",
              content: [
                { type: "paragraph", content: [{ type: "text", text: "Competing document" }] },
              ],
            },
          },
        },
      },
    );
    expect(competing.ok()).toBe(true);

    await goOnline(page);
    await page.reload();
    await openWorkspace(page);
    await expect(page.getByTestId("conflict-records")).toBeVisible({ timeout: 20_000 });
    await selectItem(page, pageName);
    const preserved = page.getByTestId("database-block");
    await expect(preserved.getByRole("button", { name: "Board" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(
      preserved.getByRole("button", { name: "Open record Keep local record" }),
    ).toBeVisible();
  });
});
