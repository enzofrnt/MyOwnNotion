/**
 * Retained-revision restore and stale-head conflict journeys (T080, US5).
 */
import { expect, test } from "@playwright/test";
import {
  addCanvasPageCard,
  addCanvasTextCard,
  connectCanvasCards,
  drawCanvasStroke,
  insertCanvas,
} from "./canvas-helpers.ts";
import {
  addDatabaseProperty,
  addDatabaseRecord,
  addSelectOption,
  insertDatabase,
} from "./database-helpers.ts";
import {
  createRootItem,
  openWorkspace,
  savePageAndSynchronize,
  selectItem,
  uniqueName,
  waitForSynchronized,
} from "./helpers.ts";

const apiPort = Number(process.env["MYOWNNOTION_API_PORT"] ?? 3001);

test.describe("revision history (US5)", () => {
  test("restores a linked document and its backlink projection together", async ({
    page,
    request,
  }) => {
    await openWorkspace(page);
    const sourceName = uniqueName("RestoreLinkSource");
    const targetName = uniqueName("RestoreLinkTarget");
    await createRootItem(page, "page", targetName);
    await createRootItem(page, "page", sourceName);
    await waitForSynchronized(page);
    await selectItem(page, sourceName);
    const editor = page.getByRole("textbox", { name: "Page content" });
    await editor.focus();
    await page.keyboard.type(`[[${targetName.slice(0, 10)}`);
    await page.getByRole("option", { name: new RegExp(targetName) }).click();
    await savePageAndSynchronize(page);
    const sourceId = await page.getByTestId(`tree-item-${sourceName}`).getAttribute("data-item-id");
    if (sourceId === null) {
      throw new Error("Created source has no stable id");
    }
    const linked = await request.get(`http://127.0.0.1:${apiPort}/v1/items/${sourceId}`);
    const linkedRevisionId = (await linked.json()) as { currentRevisionId: string };

    await editor.fill("Link temporarily removed");
    await savePageAndSynchronize(page);
    await selectItem(page, sourceName);
    await page.getByTestId("revision-id-input").fill(linkedRevisionId.currentRevisionId);
    await page.getByTestId("preview-revision").click();
    await expect(page.getByTestId("revision-preview")).toBeVisible();
    await page.getByTestId("restore-revision").click();
    await expect(page.getByTestId("restore-feedback")).toContainText("history unchanged");

    await page.reload();
    await openWorkspace(page);
    await selectItem(page, sourceName);
    await expect(page.locator("a[data-wiki-link]")).toContainText(targetName);
    await selectItem(page, targetName);
    await expect(page.getByRole("region", { name: "Backlinks" })).toContainText(sourceName);
  });

  test("restores version 4 task identity and metadata into the planning view", async ({
    page,
    request,
  }) => {
    await openWorkspace(page);
    const pageName = uniqueName("RestoreTask");
    const taskTitle = uniqueName("Restored task");
    await createRootItem(page, "page", pageName);
    await selectItem(page, pageName);
    await page
      .getByRole("toolbar", { name: "Page formatting" })
      .getByRole("button", { name: "Task list" })
      .click();
    await page.keyboard.type(taskTitle);
    const task = page.locator(".ProseMirror li[data-task-id]").filter({ hasText: taskTitle });
    const taskId = await task.getAttribute("data-task-id");
    expect(taskId).toMatch(/^[0-9a-f-]{36}$/);
    await page.getByLabel("Task status").selectOption("in_progress");
    await page.getByLabel("Task due date").fill("2028-02-29");
    await page.getByLabel("Task priority").selectOption("high");
    await savePageAndSynchronize(page);
    const sourceId = await page.getByTestId(`tree-item-${pageName}`).getAttribute("data-item-id");
    const withTask = await request.get(`http://127.0.0.1:${apiPort}/v1/items/${sourceId}`);
    const withTaskBody = (await withTask.json()) as { currentRevisionId: string };

    await page.getByRole("textbox", { name: "Page content" }).fill("Task temporarily removed");
    await savePageAndSynchronize(page);
    await selectItem(page, pageName);
    await page.getByTestId("revision-id-input").fill(withTaskBody.currentRevisionId);
    await page.getByTestId("preview-revision").click();
    await page.getByTestId("restore-revision").click();
    await expect(page.getByTestId("restore-feedback")).toContainText("history unchanged");

    await page.reload();
    await openWorkspace(page);
    await selectItem(page, pageName);
    const restored = page.locator(`.ProseMirror li[data-task-id="${taskId}"]`);
    await expect(restored).toContainText(taskTitle);
    await expect(restored).toHaveAttribute("data-task-status", "in_progress");
    await expect(restored).toHaveAttribute("data-task-due-date", "2028-02-29");
    await expect(restored).toHaveAttribute("data-task-priority", "high");
    const workspace = page.getByTestId("task-workspace");
    await workspace.getByPlaceholder("Title or source page").fill(taskTitle);
    await expect(workspace.getByTestId("task-count")).toHaveText("1 task");
  });

  test("restores an exact version 5 database identity, relation, and view", async ({
    page,
    request,
  }) => {
    await openWorkspace(page);
    const pageName = uniqueName("RestoreDatabase");
    await createRootItem(page, "page", pageName);
    await selectItem(page, pageName);
    const database = await insertDatabase(page);
    const databaseId = await database.getAttribute("data-database-id");
    await addDatabaseProperty(database, "Status", "select");
    await addDatabaseProperty(database, "Related", "relation");
    await addSelectOption(database, "Status", "Active");
    await addDatabaseRecord(database, "Restored Alpha");
    await addDatabaseRecord(database, "Restored Beta");
    const betaId = await database
      .getByRole("row", { name: /^Restored Beta / })
      .getAttribute("data-record-id");
    if (betaId === null) throw new Error("Restored relation target identity missing");
    await database
      .getByRole("combobox", { name: "Status for Restored Alpha" })
      .selectOption({ label: "Active" });
    await database
      .getByRole("listbox", { name: "Related for Restored Alpha" })
      .selectOption(betaId);
    await database.getByRole("button", { name: "Gallery" }).click();
    await savePageAndSynchronize(page);
    const sourceId = await page.getByTestId(`tree-item-${pageName}`).getAttribute("data-item-id");
    const withDatabase = await request.get(`http://127.0.0.1:${apiPort}/v1/items/${sourceId}`);
    const withDatabaseBody = (await withDatabase.json()) as { currentRevisionId: string };

    await page.getByRole("textbox", { name: "Page content" }).fill("Database temporarily removed");
    await savePageAndSynchronize(page);
    await selectItem(page, pageName);
    await page.getByTestId("revision-id-input").fill(withDatabaseBody.currentRevisionId);
    await page.getByTestId("preview-revision").click();
    await page.getByTestId("restore-revision").click();
    await expect(page.getByTestId("restore-feedback")).toContainText("history unchanged");

    await page.reload();
    await openWorkspace(page);
    await selectItem(page, pageName);
    const restored = page.getByTestId("database-block");
    await expect(restored).toHaveAttribute("data-database-id", databaseId ?? "");
    await expect(restored.getByRole("button", { name: "Gallery" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(
      restored.getByRole("button", { name: "Open record Restored Alpha" }),
    ).toBeVisible();
  });

  test("restores an exact version 6 canvas and its page-card relationship", async ({
    page,
    request,
  }) => {
    await openWorkspace(page);
    const sourceName = uniqueName("RestoreCanvas");
    const targetName = uniqueName("RestoreCanvasTarget");
    await createRootItem(page, "page", targetName);
    await createRootItem(page, "page", sourceName);
    await waitForSynchronized(page);
    await selectItem(page, sourceName);
    const canvas = await insertCanvas(page);
    const canvasId = await canvas.getAttribute("data-canvas-id");
    const textCard = await addCanvasTextCard(canvas, "Restored spatial idea");
    const textCardId = await textCard.getAttribute("data-card-id");
    const pageCard = await addCanvasPageCard(canvas, targetName);
    const pageCardId = await pageCard.getAttribute("data-card-id");
    await connectCanvasCards(canvas, "Restored spatial idea", targetName, "explains");
    const connectionId = await canvas
      .locator("[data-connection-id]")
      .getAttribute("data-connection-id");
    await canvas.getByRole("button", { name: "Zoom canvas in" }).click();
    await drawCanvasStroke(page, canvas, "8");
    const strokeId = await canvas.locator("[data-stroke-id]").getAttribute("data-stroke-id");
    await savePageAndSynchronize(page);
    const sourceId = await page.getByTestId(`tree-item-${sourceName}`).getAttribute("data-item-id");
    if (sourceId === null) throw new Error("Canvas restore page identity missing");
    const withCanvas = await request.get(`http://127.0.0.1:${apiPort}/v1/items/${sourceId}`);
    const withCanvasBody = (await withCanvas.json()) as { currentRevisionId: string };

    await page.getByRole("textbox", { name: "Page content" }).fill("Canvas temporarily removed");
    await savePageAndSynchronize(page);
    await selectItem(page, sourceName);
    await page.getByTestId("revision-id-input").fill(withCanvasBody.currentRevisionId);
    await page.getByTestId("preview-revision").click();
    await page.getByTestId("restore-revision").click();
    await expect(page.getByTestId("restore-feedback")).toContainText("history unchanged");

    await page.reload();
    await openWorkspace(page);
    await selectItem(page, sourceName);
    const restored = page.getByTestId("canvas-block");
    await expect(restored).toHaveAttribute("data-canvas-id", canvasId ?? "");
    await expect(
      restored.getByRole("button", { name: "Text card: Restored spatial idea" }),
    ).toHaveAttribute("data-card-id", textCardId ?? "");
    await expect(
      restored.getByRole("button", { name: `Page card: ${targetName}` }),
    ).toHaveAttribute("data-card-id", pageCardId ?? "");
    await expect(restored.locator(`[data-connection-id="${connectionId}"]`)).toBeVisible();
    await expect(
      restored.locator(`[data-connection-id="${connectionId}"]`).getByRole("textbox", {
        name: "Connection name",
      }),
    ).toHaveValue("explains");
    await expect(restored.locator(`[data-stroke-id="${strokeId}"]`)).toContainText("thick");
    await expect(restored.getByRole("status", { name: "Canvas zoom" })).toHaveText("125%");
    await selectItem(page, targetName);
    await expect(page.getByRole("region", { name: "Backlinks" })).toContainText(sourceName);
  });

  test("restores retained content as a new descendant revision", async ({ page }) => {
    await openWorkspace(page);
    const pageName = uniqueName("HistoryPage");
    await createRootItem(page, "page", pageName);
    await waitForSynchronized(page);

    // Select the page; note the original head.
    await selectItem(page, pageName);
    await expect(page.getByTestId("revision-restore")).toBeVisible();
    const originalHead = await page.getByTestId("current-head").textContent();

    // Edit the document to supersede the original revision.
    const saved = page.waitForResponse(
      (response) => response.url().includes("/v1/mutations/batch") && response.ok(),
    );
    await page.getByRole("textbox", { name: "Page content" }).fill("Version 2 content");
    await page.getByRole("button", { name: "Save page" }).click();
    await saved;
    await waitForSynchronized(page);
    await selectItem(page, pageName);

    // Preview and restore the superseded revision (retained 24h).
    await page.getByTestId("revision-id-input").fill(originalHead ?? "");
    await page.getByTestId("preview-revision").click();
    await expect(page.getByTestId("revision-preview")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("revision-snapshot")).toContainText(pageName);

    await page.getByTestId("restore-revision").click();
    await expect(page.getByTestId("restore-feedback")).toContainText("history unchanged", {
      timeout: 15_000,
    });
  });

  test("a stale head yields an explicit conflict instead of silent overwrite", async ({
    page,
    request,
  }) => {
    await openWorkspace(page);
    const pageName = uniqueName("StaleHeadPage");
    await createRootItem(page, "page", pageName);
    await waitForSynchronized(page);

    await selectItem(page, pageName);
    const itemId = await page.getByTestId(`tree-item-${pageName}`).getAttribute("data-item-id");
    const originalHead = await page.getByTestId("current-head").textContent();

    // Edit once so the original head is restorable history.
    const saved = page.waitForResponse(
      (response) => response.url().includes("/v1/mutations/batch") && response.ok(),
    );
    await page.getByRole("textbox", { name: "Page content" }).fill("Version two");
    await page.getByRole("button", { name: "Save page" }).click();
    await saved;
    await waitForSynchronized(page);
    await selectItem(page, pageName);

    // Preview the original revision.
    await page.getByTestId("revision-id-input").fill(originalHead ?? "");
    await page.getByTestId("preview-revision").click();
    await expect(page.getByTestId("revision-preview")).toBeVisible();

    // Another device advances the head between preview and restore.
    const current = await request.get(`http://127.0.0.1:${apiPort}/v1/items/${itemId}`);
    const currentBody = (await current.json()) as { currentRevisionId: string };
    const competing = await request.put(`http://127.0.0.1:${apiPort}/v1/pages/${itemId}/document`, {
      headers: { "idempotency-key": crypto.randomUUID() },
      data: {
        baseRevisionId: currentBody.currentRevisionId,
        document: {
          format: "myownnotion.document+json",
          formatVersion: 2,
          body: {
            type: "doc",
            content: [{ type: "paragraph", content: [{ type: "text", text: "Competing edit" }] }],
          },
        },
      },
    });
    expect(competing.status()).toBe(200);

    // Restore now conflicts explicitly (the UI's head is stale).
    await page.getByTestId("restore-revision").click();
    await expect(page.getByTestId("restore-feedback")).toContainText("current head changed", {
      timeout: 15_000,
    });
  });
});
