import { AxeBuilder } from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import {
  attachReviewScreenshot,
  createRootItem,
  openWorkspace,
  savePageAndSynchronize,
  selectItem,
  uniqueName,
} from "./helpers.ts";

test.describe("task metadata (US2)", () => {
  test("edits status, due date, and priority with consistent semantics", async ({
    page,
  }, testInfo) => {
    await openWorkspace(page);
    const pageName = uniqueName("TaskMetadata");
    const taskTitle = uniqueName("Plan release");
    await createRootItem(page, "page", pageName);
    await selectItem(page, pageName);
    await page
      .getByRole("toolbar", { name: "Page formatting" })
      .getByRole("button", { name: "Task list" })
      .click();
    await page.keyboard.type(taskTitle);

    const taskItem = page.locator(".ProseMirror li[data-task-id]").filter({ hasText: taskTitle });
    await page.getByLabel("Task status").selectOption("in_progress");
    await page.getByLabel("Task due date").fill("2028-02-29");
    await page.getByLabel("Task priority").selectOption("high");
    await expect(taskItem).toHaveAttribute("data-task-status", "in_progress");
    await expect(taskItem).toHaveAttribute("data-task-due-date", "2028-02-29");
    await expect(taskItem).toHaveAttribute("data-task-priority", "high");
    await expect(taskItem.getByRole("checkbox")).not.toBeChecked();
    await attachReviewScreenshot(page, testInfo, "task-metadata");
    await savePageAndSynchronize(page);

    await page.reload();
    await openWorkspace(page);
    await selectItem(page, pageName);
    await page
      .locator(".ProseMirror li[data-task-id]")
      .filter({ hasText: taskTitle })
      .locator("p")
      .click();
    await expect(page.getByLabel("Task status")).toHaveValue("in_progress");
    await expect(page.getByLabel("Task due date")).toHaveValue("2028-02-29");
    await expect(page.getByLabel("Task priority")).toHaveValue("high");

    await page.getByLabel("Task status").selectOption("completed");
    await expect(
      page
        .locator(".ProseMirror li[data-task-id]")
        .filter({ hasText: taskTitle })
        .getByRole("checkbox"),
    ).toBeChecked();
    await page.getByLabel("Task status").selectOption("cancelled");
    await expect(
      page.locator(".ProseMirror li[data-task-id]").filter({ hasText: taskTitle }),
    ).toHaveAttribute("data-task-status", "cancelled");
    await expect(
      page
        .locator(".ProseMirror li[data-task-id]")
        .filter({ hasText: taskTitle })
        .getByRole("checkbox"),
    ).not.toBeChecked();

    const axe = await new AxeBuilder({ page }).include(".page-editor-panel").analyze();
    expect(axe.violations.filter((violation) => violation.impact === "critical")).toEqual([]);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(24);
  });
});
