import { expect, test } from "@playwright/test";
import {
  attachReviewScreenshot,
  createRootItem,
  openWorkspace,
  savePageAndSynchronize,
  selectItem,
  uniqueName,
  waitForSynchronized,
} from "./helpers.ts";

test.describe("task capture (US1)", () => {
  test("creates, toggles, persists, and focuses one stable task", async ({ page }, testInfo) => {
    await openWorkspace(page);
    const folderName = uniqueName("TaskFolder");
    const pageName = uniqueName("TaskCapture");
    const renamedPageName = `${pageName}-renamed`;
    const taskTitle = uniqueName("Durable task");
    await createRootItem(page, "folder", folderName);
    await createRootItem(page, "page", pageName);
    await selectItem(page, pageName);

    const editor = page.getByRole("textbox", { name: "Page content" });
    await page
      .getByRole("toolbar", { name: "Page formatting" })
      .getByRole("button", { name: "Task list" })
      .click();
    await page.keyboard.type(taskTitle);
    const taskItem = page.locator(".ProseMirror li[data-task-id]").filter({ hasText: taskTitle });
    await expect(taskItem).toHaveAttribute("data-task-status", "todo");
    await expect(taskItem).toHaveAttribute("data-task-priority", "none");
    const taskId = await taskItem.getAttribute("data-task-id");
    expect(taskId).toMatch(/^[0-9a-f-]{36}$/);
    await expect(page.getByTestId("task-details")).toBeVisible();

    const checkbox = taskItem.getByRole("checkbox");
    await checkbox.click();
    await expect(taskItem).toHaveAttribute("data-task-status", "completed");
    await checkbox.focus();
    await page.keyboard.press("Space");
    await expect(taskItem).toHaveAttribute("data-task-status", "todo");
    await savePageAndSynchronize(page);
    page.once("dialog", (dialog) => dialog.accept(renamedPageName));
    await page.getByRole("button", { name: `Rename ${pageName}` }).click();
    await expect(page.getByTestId(`tree-item-${renamedPageName}`)).toBeVisible();
    await page.getByRole("button", { name: `Move selected item into ${folderName}` }).click();
    await waitForSynchronized(page);

    await page.reload();
    await openWorkspace(page);
    await selectItem(page, renamedPageName);
    const reloaded = page.locator(`.ProseMirror li[data-task-id="${taskId}"]`);
    await expect(reloaded).toContainText(taskTitle);
    await expect(reloaded).toHaveAttribute("data-task-status", "todo");
    await attachReviewScreenshot(page, testInfo, "task-capture");

    const workspace = page.getByTestId("task-workspace");
    await expect(
      workspace.getByRole("button", { name: new RegExp(`Open task ${taskTitle}`) }),
    ).toBeVisible();
    await workspace.getByRole("button", { name: new RegExp(`Open task ${taskTitle}`) }).click();
    await expect(editor).toBeFocused();
    await expect(page.locator(`.ProseMirror li[data-task-id="${taskId}"]`)).toBeVisible();
  });
});
