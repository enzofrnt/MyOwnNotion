import { expect, type Page, test } from "@playwright/test";
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

async function insertTask(
  page: Page,
  input: { readonly title: string; readonly dueDate: string; readonly priority: "low" | "high" },
): Promise<string> {
  await page
    .getByRole("toolbar", { name: "Page formatting" })
    .getByRole("button", { name: "Task list" })
    .click();
  await page.keyboard.type(input.title);
  const task = page.locator(".ProseMirror li[data-task-id]").filter({ hasText: input.title });
  const taskId = await task.getAttribute("data-task-id");
  if (taskId === null) {
    throw new Error("Offline task has no stable id");
  }
  await page.getByLabel("Task status").selectOption("in_progress");
  await page.getByLabel("Task due date").fill(input.dueDate);
  await page.getByLabel("Task priority").selectOption(input.priority);
  await page.getByRole("button", { name: "Save page" }).click();
  return taskId;
}

function taskNodes(document: unknown): Array<Record<string, unknown>> {
  const tasks: Array<Record<string, unknown>> = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const child of value) visit(child);
      return;
    }
    if (value === null || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    if (record["type"] === "taskItem") tasks.push(record);
    for (const child of Object.values(record)) visit(child);
  };
  visit(document);
  return tasks;
}

test.describe("offline tasks (US4)", () => {
  test("keeps task capture, metadata, view, and removal across offline reloads", async ({
    page,
    request,
  }) => {
    await openWorkspace(page);
    const pageName = uniqueName("OfflineTasks");
    const taskTitle = uniqueName("Prepare offline release");
    await createRootItem(page, "page", pageName);
    await waitForSynchronized(page);
    const sourceId = await page.getByTestId(`tree-item-${pageName}`).getAttribute("data-item-id");
    if (sourceId === null) {
      throw new Error("Created task page has no stable id");
    }
    await selectItem(page, pageName);

    await goOffline(page);
    const taskId = await insertTask(page, {
      title: taskTitle,
      dueDate: "2028-02-29",
      priority: "high",
    });
    await expect(page.getByTestId("pending-mutations")).toBeVisible({ timeout: 15_000 });
    const workspace = page.getByTestId("task-workspace");
    await workspace.getByPlaceholder("Title or source page").fill(taskTitle);
    await expect(workspace.getByTestId("task-count")).toHaveText("1 task");

    await page.reload();
    await expect(page.getByTestId(`tree-item-${pageName}`)).toBeVisible({ timeout: 15_000 });
    await selectItem(page, pageName);
    const reloaded = page.locator(`.ProseMirror li[data-task-id="${taskId}"]`);
    await expect(reloaded).toContainText(taskTitle);
    await expect(reloaded).toHaveAttribute("data-task-status", "in_progress");
    await expect(reloaded).toHaveAttribute("data-task-due-date", "2028-02-29");
    await expect(reloaded).toHaveAttribute("data-task-priority", "high");
    await page
      .getByTestId("task-workspace")
      .getByPlaceholder("Title or source page")
      .fill(taskTitle);
    await expect(page.getByTestId("task-workspace").getByTestId("task-count")).toHaveText("1 task");

    await goOnline(page);
    await page.reload();
    await openWorkspace(page);
    await waitForSynchronized(page);
    const synchronized = await request.get(`http://127.0.0.1:${apiPort}/v1/items/${sourceId}`);
    expect(synchronized.ok()).toBe(true);
    const synchronizedBody = (await synchronized.json()) as {
      pageDocument: unknown;
    };
    const synchronizedTasks = taskNodes(synchronizedBody.pageDocument);
    expect(synchronizedTasks).toHaveLength(1);
    expect(synchronizedTasks[0]?.["attrs"]).toEqual({
      checked: false,
      taskId,
      status: "in_progress",
      dueDate: "2028-02-29",
      priority: "high",
    });

    await selectItem(page, pageName);
    await goOffline(page);
    await page.locator(`.ProseMirror li[data-task-id="${taskId}"] p`).click();
    await page
      .getByRole("toolbar", { name: "Page formatting" })
      .getByRole("button", { name: "Task list" })
      .click();
    await page.getByRole("textbox", { name: "Page content" }).fill("Task removed offline");
    await page.getByRole("button", { name: "Save page" }).click();
    await expect(page.getByTestId("pending-mutations")).toBeVisible({ timeout: 15_000 });
    await page.reload();
    await page
      .getByTestId("task-workspace")
      .getByPlaceholder("Title or source page")
      .fill(taskTitle);
    await expect(page.getByTestId("task-workspace").getByTestId("task-count")).toHaveText(
      "0 tasks",
    );

    await goOnline(page);
    await page.reload();
    await openWorkspace(page);
    await waitForSynchronized(page);
    const removed = await request.get(`http://127.0.0.1:${apiPort}/v1/items/${sourceId}`);
    const removedBody = (await removed.json()) as { pageDocument: unknown };
    expect(taskNodes(removedBody.pageDocument)).toHaveLength(0);
  });

  test("keeps a complete local task recoverable after a competing revision", async ({
    page,
    request,
  }) => {
    await openWorkspace(page);
    const pageName = uniqueName("TaskConflict");
    const taskTitle = uniqueName("Recover local task");
    await createRootItem(page, "page", pageName);
    await waitForSynchronized(page);
    await selectItem(page, pageName);
    const sourceId = await page.getByTestId(`tree-item-${pageName}`).getAttribute("data-item-id");
    if (sourceId === null) {
      throw new Error("Created source has no stable id");
    }

    await goOffline(page);
    const taskId = await insertTask(page, {
      title: taskTitle,
      dueDate: "2028-02-29",
      priority: "low",
    });
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
            formatVersion: 4,
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
    const preserved = page.locator(`.ProseMirror li[data-task-id="${taskId}"]`);
    await expect(preserved).toContainText(taskTitle);
    await expect(preserved).toHaveAttribute("data-task-status", "in_progress");
    await expect(preserved).toHaveAttribute("data-task-due-date", "2028-02-29");
    await expect(preserved).toHaveAttribute("data-task-priority", "low");
    const workspace = page.getByTestId("task-workspace");
    await workspace.getByPlaceholder("Title or source page").fill(taskTitle);
    await expect(workspace.getByTestId("task-count")).toHaveText("1 task");
  });
});
