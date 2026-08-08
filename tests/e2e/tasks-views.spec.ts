import { AxeBuilder } from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import {
  attachReviewScreenshot,
  createRootItem,
  openWorkspace,
  savePageAndSynchronize,
  selectItem,
  uniqueName,
} from "./helpers.ts";

function dateOffset(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

async function createTaskPage(
  page: Page,
  input: {
    pageName: string;
    taskTitle: string;
    status: "todo" | "in_progress" | "completed" | "cancelled";
    dueDate: string | null;
    priority: "none" | "low" | "medium" | "high";
  },
): Promise<void> {
  await createRootItem(page, "page", input.pageName);
  await selectItem(page, input.pageName);
  await page
    .getByRole("toolbar", { name: "Page formatting" })
    .getByRole("button", { name: "Task list" })
    .click();
  await page.keyboard.type(input.taskTitle);
  await page.getByLabel("Task status").selectOption(input.status);
  if (input.dueDate !== null) {
    await page.getByLabel("Task due date").fill(input.dueDate);
  }
  await page.getByLabel("Task priority").selectOption(input.priority);
  await savePageAndSynchronize(page);
}

test.describe("task workspace views (US3)", () => {
  test("classifies, filters, sorts, mirrors board IDs, and opens source tasks", async ({
    page,
  }, testInfo) => {
    await openWorkspace(page);
    const suffix = uniqueName("TaskViews");
    const fixtures = [
      {
        pageName: `${suffix}-OverduePage`,
        taskTitle: `${suffix}-Overdue`,
        status: "todo" as const,
        dueDate: dateOffset(-1),
        priority: "high" as const,
      },
      {
        pageName: `${suffix}-TodayPage`,
        taskTitle: `${suffix}-Today`,
        status: "in_progress" as const,
        dueDate: dateOffset(0),
        priority: "medium" as const,
      },
      {
        pageName: `${suffix}-UpcomingPage`,
        taskTitle: `${suffix}-Upcoming`,
        status: "todo" as const,
        dueDate: dateOffset(1),
        priority: "low" as const,
      },
      {
        pageName: `${suffix}-DonePage`,
        taskTitle: `${suffix}-Done`,
        status: "completed" as const,
        dueDate: dateOffset(0),
        priority: "none" as const,
      },
    ];
    for (const fixture of fixtures) {
      await createTaskPage(page, fixture);
    }

    const workspace = page.getByTestId("task-workspace");
    await workspace.getByPlaceholder("Title or source page").fill(suffix);
    await workspace.getByRole("button", { name: "All", exact: true }).click();
    await expect(workspace.getByTestId("task-count")).toHaveText(/4 tasks/);
    for (const scope of [
      ["Today", "Today"],
      ["Upcoming", "Upcoming"],
      ["Overdue", "Overdue"],
      ["Finished", "Done"],
    ] as const) {
      await workspace.getByRole("button", { name: scope[0], exact: true }).click();
      await expect(workspace.getByTestId("task-count")).toHaveText("1 task");
      await expect(workspace.getByTestId("task-list")).toContainText(`${suffix}-${scope[1]}`);
    }

    await workspace.getByRole("button", { name: "All", exact: true }).click();
    await workspace.getByPlaceholder("Title or source page").fill(`${suffix}-Today`);
    await workspace.getByText("Filters", { exact: true }).click();
    await workspace.getByRole("checkbox", { name: "In progress" }).check();
    await workspace.getByRole("checkbox", { name: "Medium" }).check();
    await expect(workspace.getByTestId("task-count")).toHaveText("1 task");
    await workspace.getByLabel("Sort tasks").selectOption("priority");
    await workspace.getByPlaceholder("Title or source page").fill(suffix);
    await workspace.getByRole("checkbox", { name: "In progress" }).uncheck();
    await workspace.getByRole("checkbox", { name: "Medium" }).uncheck();

    const listIds = await workspace
      .getByTestId("task-list")
      .locator("[data-task-id]")
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-task-id")));
    await workspace.getByRole("button", { name: "Board", exact: true }).click();
    await expect(workspace.getByTestId("task-count")).toHaveText(/4 tasks/);
    const boardIds = await workspace
      .getByTestId("task-board")
      .locator("[data-task-id]")
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-task-id")));
    expect(new Set(boardIds)).toEqual(new Set(listIds));
    await attachReviewScreenshot(page, testInfo, "task-board");

    const overdueFixture = fixtures[0];
    if (overdueFixture === undefined) {
      throw new Error("Task view fixture is missing");
    }
    await workspace
      .getByRole("button", { name: new RegExp(`Open task ${overdueFixture.taskTitle}`) })
      .click();
    await expect(page.getByTestId(`tree-item-${overdueFixture.pageName}`)).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.getByRole("textbox", { name: "Page content" })).toBeFocused();

    await page.getByRole("button", { name: `Trash ${overdueFixture.pageName}` }).click();
    await expect(page.getByTestId(`trash-item-${overdueFixture.pageName}`)).toBeVisible();
    await expect(workspace.getByTestId("task-count")).toHaveText("3 tasks");
    await page.getByRole("button", { name: `Restore ${overdueFixture.pageName}` }).click();
    await expect(workspace.getByTestId("task-count")).toHaveText("4 tasks");
    await workspace.getByPlaceholder("Title or source page").fill(`${suffix}-NoMatch`);
    await expect(workspace.getByTestId("task-count")).toHaveText("0 tasks");
    await expect(workspace.getByTestId("task-empty-state")).toBeVisible();

    const axe = await new AxeBuilder({ page }).include(".task-workspace").analyze();
    expect(axe.violations.filter((violation) => violation.impact === "critical")).toEqual([]);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(24);
  });
});
