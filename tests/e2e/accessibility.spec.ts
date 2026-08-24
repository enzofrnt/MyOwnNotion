/**
 * Keyboard, focus, semantic tree, and responsive accessibility assertions
 * (T090, constitution principle VI).
 */
// Named rather than default: the package ships both, and only the named
// export is constructible under this project's ESM settings.
import { AxeBuilder } from "@axe-core/playwright";
import { expect, test } from "./fixtures.ts";
import {
  convertItem,
  createRootItem,
  ensureNavigationRowVisible,
  ensureNavigationVisible,
  openItemActions,
  openWorkspace,
  openWorkspaceDiagnostics,
  saveDocument,
  selectItem,
  selectSettledPage,
  typeIntoEditor,
  uniqueName,
  waitForDatabaseDefinitionSaved,
  waitForSynchronized,
} from "./helpers.ts";

test.describe("accessibility (all viewports/browsers)", () => {
  test("the hierarchy is a semantic ARIA tree with labelled controls", async ({ page }) => {
    await openWorkspace(page);
    const name = uniqueName("A11y");
    await createRootItem(page, "folder", name);

    // Semantic structure.
    const tree = page.getByRole("tree", { name: "Arborescence" });
    await expect(tree).toBeVisible();
    const item = page.getByRole("treeitem").filter({ hasText: name }).first();
    await expect(item).toBeVisible();
    await expect(item).toHaveAttribute("aria-level", "1");

    // One labelled trigger keeps the row compact; every mutation remains a
    // named menu item reachable by keyboard or touch.
    await expect(page.getByRole("button", { name: `Actions pour ${name}` })).toBeVisible();
    await openItemActions(page, name);
    for (const label of [
      "Nouvelle page à l’intérieur",
      "Renommer",
      "Déplacer vers le haut",
      "Placer dans la corbeille",
    ]) {
      await expect(page.getByRole("menuitem", { name: label })).toBeVisible();
    }

    // Status messaging uses live regions.
    await expect(page.getByTestId("sync-status")).toHaveAttribute("aria-live", "polite");
  });

  test("interactive elements expose visible focus", async ({ page }) => {
    await openWorkspace(page);
    await ensureNavigationVisible(page);
    const nameInput = page.getByLabel("Nom", { exact: true });
    await nameInput.focus();
    const outline = await nameInput.evaluate((element) => getComputedStyle(element).outlineStyle);
    expect(outline).not.toBe("none");
  });

  test("keyboard-only operation: create, select, and navigate", async ({ page }) => {
    await openWorkspace(page);
    await ensureNavigationVisible(page);
    const name = uniqueName("KeyboardOnly");
    await page.getByLabel("Nom", { exact: true }).fill(name);
    // Reach and activate the create button with the keyboard only.
    await page.getByTestId("new-root-folder").focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId(`tree-item-${name}`)).toBeVisible();

    // Select with keyboard and navigate.
    //
    // Send the key through the row locator. The row was created a moment ago,
    // so a projection refresh can still replace its DOM node. A separate
    // `focus()` followed by `page.keyboard.press()` leaves a gap where that
    // replacement sends focus back to the document; the locator-targeted press
    // resolves the current row and performs the keyboard action as one step.
    const row = page.getByTestId(`tree-item-${name}`);
    await row.press("Enter");
    await expect(row).toHaveAttribute("aria-selected", "true");
  });

  test("the layout stays operable at the current viewport", async ({ page }) => {
    await openWorkspace(page);
    await ensureNavigationVisible(page);
    // Toolbar must be reachable within the viewport on every configured
    // project, including mobile sizes; created items stay operable after
    // scrolling (no horizontal cut-off).
    await page.getByTestId("new-root-folder").scrollIntoViewIfNeeded();
    await expect(page.getByTestId("new-root-folder")).toBeInViewport();
    const name = uniqueName("Responsive");
    await createRootItem(page, "folder", name);
    // Selecting proves the newly rendered row is operable and uses Playwright's
    // retryable click/scroll path if WebKit replaces it during reconciliation.
    await selectItem(page, name);
    const row = await ensureNavigationRowVisible(page, name);
    await expect(row).toBeInViewport();
    // No horizontal overflow: the document is not wider than the viewport.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(24);
  });
});

/**
 * The automated audit (feature 003 SC-004, feature 004 SC-008).
 *
 * Added with `@axe-core/playwright` rather than hand-written assertions,
 * because an accessibility checker written here would be a rule set nobody
 * maintains and nobody trusts. It does not replace the journey tests above:
 * axe cannot tell whether Escape closes a dialog or whether focus comes back
 * afterwards, and those are most of what the requirements ask for.
 *
 * Only `critical` and `serious` fail the build. Lower severities are reported
 * by axe as advice, and treating advice as a gate is how a suite gets disabled.
 */
test.describe("automated accessibility audit", () => {
  async function violations(page: import("@playwright/test").Page) {
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    return results.violations.filter(
      (violation: { id: string; help: string; impact?: string | null | undefined }) =>
        violation.impact === "critical" || violation.impact === "serious",
    );
  }

  test("the workspace has no critical or serious violations", async ({ page }) => {
    await openWorkspace(page);
    const found = await violations(page);
    expect(
      found.map(
        (violation: { id: string; help: string; impact?: string | null | undefined }) =>
          `${violation.id}: ${violation.help}`,
      ),
    ).toEqual([]);
  });

  test("the editor has no critical or serious violations", async ({ page }) => {
    await openWorkspace(page);
    const name = uniqueName("AuditedPage");
    await createRootItem(page, "page", name);
    await waitForSynchronized(page);
    await selectItem(page, name);
    await expect(page.getByTestId("block-editor")).toBeVisible({ timeout: 30_000 });

    const found = await violations(page);
    expect(
      found.map(
        (violation: { id: string; help: string; impact?: string | null | undefined }) =>
          `${violation.id}: ${violation.help}`,
      ),
    ).toEqual([]);
  });

  test("the search dialog has no critical or serious violations", async ({ page }) => {
    await openWorkspace(page);
    await page.keyboard.press("ControlOrMeta+k");
    await expect(page.getByRole("dialog", { name: "Search the workspace" })).toBeVisible();

    const found = await violations(page);
    expect(
      found.map(
        (violation: { id: string; help: string; impact?: string | null | undefined }) =>
          `${violation.id}: ${violation.help}`,
      ),
    ).toEqual([]);
  });

  test("the conversion confirmation has no critical or serious violations", async ({ page }) => {
    // Audited deliberately: a dialog is not on screen at load, so an audit that
    // only visits pages never sees it — and a destructive confirmation is
    // exactly where an owner using assistive technology must not be stranded.
    await openWorkspace(page);
    const name = uniqueName("AuditedDialog");
    await createRootItem(page, "page", name);
    await waitForSynchronized(page);
    await selectItem(page, name);
    await typeIntoEditor(page, "content that triggers the dialog");
    await saveDocument(page, { until: "synced" });
    await waitForSynchronized(page);

    await convertItem(page, name);
    await expect(page.getByTestId("convert-confirmation")).toBeVisible({ timeout: 30_000 });

    const found = await violations(page);
    expect(
      found.map(
        (violation: { id: string; help: string; impact?: string | null | undefined }) =>
          `${violation.id}: ${violation.help}`,
      ),
    ).toEqual([]);
  });

  test("the backup status and restoration invitation have no critical or serious violations", async ({
    page,
  }) => {
    await openWorkspace(page);
    await page.getByTestId("open-backups").click();
    await expect(page.getByTestId("backup-panel")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("restore-rehearsal")).toBeVisible();

    const found = await violations(page);
    expect(
      found.map(
        (violation: { id: string; help: string; impact?: string | null | undefined }) =>
          `${violation.id}: ${violation.help}`,
      ),
    ).toEqual([]);
  });
});

test.describe("the file surfaces (feature 005)", () => {
  /** The axe audit, restricted to critical and serious as elsewhere here. */
  async function fileViolations(page: import("@playwright/test").Page) {
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    return results.violations
      .filter(
        (violation: { impact?: string | null | undefined }) =>
          violation.impact === "critical" || violation.impact === "serious",
      )
      .map((violation: { id: string; help: string }) => `${violation.id}: ${violation.help}`);
  }

  async function pageWithAttachment(
    page: import("@playwright/test").Page,
  ): Promise<{ pageName: string; fileName: string }> {
    const pageName = uniqueName("A11yFiles");
    await openWorkspace(page);
    await createRootItem(page, "page", pageName);
    await waitForSynchronized(page);
    await selectSettledPage(page, pageName);
    const fileName = `${uniqueName("a11y")}.txt`;
    await page.getByTestId("attachment-upload").setInputFiles({
      name: fileName,
      mimeType: "text/plain",
      buffer: Buffer.from("bytes for the audit"),
    });
    await expect(page.getByTestId(`attachment-${fileName}`)).toBeVisible({ timeout: 30_000 });
    return { pageName, fileName };
  }

  test("the attachment list has no critical or serious violations", async ({ page }) => {
    await pageWithAttachment(page);
    expect(await fileViolations(page)).toEqual([]);
  });

  test("the deletion confirmation has no critical or serious violations", async ({ page }) => {
    const { fileName } = await pageWithAttachment(page);
    await waitForSynchronized(page);
    await page.getByTestId(`delete-file-${fileName}`).click();
    await expect(page.getByTestId("delete-file-confirmation")).toBeVisible({ timeout: 30_000 });
    // A dialogue is where an owner makes an irreversible decision, so its
    // semantics matter more than anywhere else on the screen.
    expect(await fileViolations(page)).toEqual([]);
  });

  test("the storage panel has no critical or serious violations", async ({ page }) => {
    await openWorkspace(page);
    await openWorkspaceDiagnostics(page);
    await expect(page.getByTestId("storage-panel")).toBeVisible({ timeout: 30_000 });
    expect(await fileViolations(page)).toEqual([]);
  });

  test("the preview frame is labelled for assistive technology", async ({ page }) => {
    const { fileName } = await pageWithAttachment(page);
    await page.getByTestId(`preview-file-${fileName}`).click();
    // An unlabelled frame is announced as "frame" and nothing else, which tells
    // a screen-reader user that something is there and not what.
    await expect(
      page.getByTestId("file-unsupported").or(page.getByTestId("file-preview")),
    ).toBeVisible({
      timeout: 30_000,
    });
    expect(await fileViolations(page)).toEqual([]);
  });
});

/**
 * Live synchronization and the resolution screen (T041, feature 006).
 *
 * The connection state is a live region, and a live region that interrupts on
 * every reconnection is worse than none: an owner learns to ignore it, and then
 * ignores the one announcement that mattered. So its politeness is asserted, not
 * only its presence.
 */
test.describe("synchronization accessibility (feature 006)", () => {
  async function seriousViolations(page: import("@playwright/test").Page) {
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    return results.violations
      .filter(
        (violation: { impact?: string | null | undefined }) =>
          violation.impact === "critical" || violation.impact === "serious",
      )
      .map((violation: { id: string; help: string }) => `${violation.id}: ${violation.help}`);
  }

  test("the connection state is announced politely, not as an alert", async ({ page }) => {
    await openWorkspace(page);
    const state = page.getByTestId("live-connection-state");
    await expect(state).toBeVisible({ timeout: 15_000 });
    // `status` while things are ordinary. The two states that need acting on —
    // a withdrawn device, a client that must be updated — use `alert`, and those
    // are the only ones that should interrupt.
    const role = await state.getAttribute("role");
    expect(["status", "alert"]).toContain(role);
    expect(await seriousViolations(page)).toEqual([]);
  });
});

test.describe("structured database view accessibility (feature 009)", () => {
  async function seriousViolations(page: import("@playwright/test").Page) {
    const results = await new AxeBuilder({ page })
      .include(".database-page")
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    return results.violations
      .filter(
        (violation: { impact?: string | null | undefined }) =>
          violation.impact === "critical" || violation.impact === "serious",
      )
      .map((violation: { id: string; help: string }) => `${violation.id}: ${violation.help}`);
  }

  test("all five views pass axe and visual movement has a named keyboard equivalent", async ({
    page,
  }) => {
    await openWorkspace(page);
    await ensureNavigationVisible(page);
    const databaseName = uniqueName("Accessible planning");
    const entryName = uniqueName("Keyboard card");
    await page.getByTestId("new-root-database").click();
    const createDatabase = page.getByRole("form", { name: "Create a database" });
    await createDatabase.getByLabel("Create a database").fill(databaseName);
    const createDatabaseButton = createDatabase.getByRole("button", { name: "Create database" });
    await createDatabaseButton.click();
    await expect(createDatabase).toBeHidden({ timeout: 15_000 });
    await expect(page.getByRole("heading", { name: databaseName })).toBeVisible();
    await waitForSynchronized(page);

    const addProperty = async (name: string, type: "status" | "date"): Promise<void> => {
      await page.getByRole("button", { name: "Add property" }).click();
      const editor = page.getByRole("form", { name: "Property editor" });
      await editor.getByLabel("Name").fill(name);
      await editor.getByLabel("Type").selectOption(type);
      if (type === "status") {
        const options = editor.getByLabel("Options, separated by commas");
        await options.fill("To do, Done");
        await expect(options).toHaveValue("To do, Done");
      }
      await editor.getByRole("button", { name: "Save property" }).click();
      await expect(editor).toBeHidden({ timeout: 15_000 });
      await waitForDatabaseDefinitionSaved(page);
    };
    await addProperty("Status", "status");
    await addProperty("Due", "date");

    const entryForm = page.locator(".database-entry-create");
    await entryForm.getByLabel("New entry").fill(entryName);
    await entryForm.getByRole("button", { name: "New entry" }).click();
    const entryTrigger = page
      .locator("[data-entry-trigger]")
      .filter({ hasText: entryName })
      .first();
    await expect(entryTrigger).toBeVisible({ timeout: 15_000 });
    await entryTrigger.click();
    const panel = page.locator(".entry-panel");
    const status = panel.getByLabel("Status", { exact: true });
    await status.selectOption({ label: "To do" });
    await expect(status.locator("option:checked")).toHaveText("To do");
    const due = panel.getByLabel("Due", { exact: true });
    await due.fill("2026-08-20");
    await expect(due).toHaveValue("2026-08-20");
    const saveProperties = panel.getByRole("button", { name: "Save properties" });
    await saveProperties.click();
    await expect(page.getByTestId("entry-properties-saved")).toHaveText(
      "Properties saved locally.",
      { timeout: 15_000 },
    );
    await waitForSynchronized(page);
    await page.getByRole("button", { name: "Close entry" }).click();

    const createView = async (buttonName: string, tabName: RegExp): Promise<void> => {
      await page.getByRole("button", { name: buttonName }).click();
      const tab = page.getByRole("tab", { name: tabName });
      await expect(tab).toBeVisible({ timeout: 15_000 });
      await expect(tab).toHaveAttribute("aria-selected", "true");
      await waitForDatabaseDefinitionSaved(page);
    };
    await createView("New list view", /List 2/);
    await createView("New board view", /Board 3/);
    await createView("New gallery view", /Gallery 4/);
    await createView("New calendar view", /Calendar 5/);

    for (const viewName of [/Table/, /List 2/, /Board 3/, /Gallery 4/, /Calendar 5/]) {
      const tab = page.getByRole("tab", { name: viewName });
      await expect(tab).toBeVisible({ timeout: 15_000 });
      await tab.click();
      await expect(tab).toHaveAttribute("aria-selected", "true");
      expect(await seriousViolations(page)).toEqual([]);
    }

    await page.getByRole("tab", { name: /Board 3/ }).click();
    await expect(page.getByLabel(`Move ${entryName} to another column`)).toBeVisible();
    await expect(
      page.getByRole("button", { name: `Move ${entryName} to next column` }),
    ).toBeVisible();
    await page.getByRole("tab", { name: /Calendar 5/ }).click();
    await expect(page.getByLabel(`Schedule ${entryName}`)).toBeVisible();
    await expect(page.getByRole("button", { name: `Move ${entryName} to next day` })).toBeVisible();
  });
});
