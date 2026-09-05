import { randomBytes, scryptSync } from "node:crypto";
import pg from "pg";
import { expect, test } from "./fixtures.ts";
import {
  apiOrigin,
  createUnopenedPage,
  expectNoHorizontalOverflow,
  openSettingsSection,
} from "./helpers.ts";

async function openPanel(page: import("@playwright/test").Page) {
  await page.goto("/");
  await expect(page.getByTestId("workspace-shell")).toBeVisible({ timeout: 30_000 });
  await openSettingsSection(page, "security");
  const panel = page.getByTestId("mcp-panel");
  await expect(panel.getByRole("button", { name: "Actualiser les accès" })).toBeEnabled();
  return panel;
}

test("owner grants a branch, exchanges once and revokes a real assistant", async ({
  page,
  request,
}, testInfo) => {
  const branch = await createUnopenedPage(request, "Notes partagées avec mon assistant");
  const privateBranch = await createUnopenedPage(request, "Mes notes privées");
  const panel = await openPanel(page);
  const label = `Assistant de rédaction ${testInfo.project.name}`;
  await panel.getByLabel("Nom de la connexion").fill(label);
  await panel.getByRole("checkbox", { name: "Notes partagées avec mon assistant" }).check();
  await panel.getByRole("checkbox", { name: "Modifier et renommer" }).check();
  const authorize = panel.getByTestId("mcp-authorize");
  await authorize.scrollIntoViewIfNeeded();
  const box = await authorize.boundingBox();
  if (box === null) throw new Error("Authorization control has no bounds");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(0, 0);
  await page.mouse.up();
  await expect(panel.getByTestId("mcp-code")).toHaveCount(0);
  await authorize.focus();
  await page.keyboard.press("Enter");
  await expect(panel.getByTestId("mcp-code")).toBeVisible();
  const code = await panel.getByLabel("Code temporaire").inputValue();
  await panel.getByTestId("mcp-code").screenshot({
    path: testInfo.outputPath("mcp-code-instructions.png"),
    mask: [panel.getByLabel("Code temporaire")],
  });
  const inventory = await request.get(`${apiOrigin()}/v1/mcp/connections`);
  const connection = (await inventory.json()).connections.find(
    (entry: { label: string }) => entry.label === label,
  );
  expect(connection.scope).toEqual({
    actions: ["search", "read", "edit"],
    allContent: false,
    branchRootIds: [branch.itemId],
    files: false,
  });
  expect(Date.parse(connection.expiresAt) - Date.parse(connection.createdAt)).toBe(90 * 86_400_000);
  const exchanged = await request.post(`${apiOrigin()}/mcp/exchange`, { data: { code } });
  expect(exchanged.status()).toBe(200);
  const token = (await exchanged.json()).accessToken as string;
  const replay = await request.post(`${apiOrigin()}/mcp/exchange`, { data: { code } });
  expect(replay.ok()).toBe(false);
  const call = (itemId: string) =>
    request.post(`${apiOrigin()}/mcp`, {
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": "2025-11-25",
      },
      data: {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "read_item", arguments: { itemId } },
      },
    });
  const allowed = await call(branch.itemId);
  expect(allowed.status()).toBe(200);
  expect((await protocolBody(allowed)).result.isError).not.toBe(true);
  const denied = await call(privateBranch.itemId);
  expect((await protocolBody(denied)).result.isError).toBe(true);
  await panel.getByRole("button", { name: "Actualiser les accès" }).click();
  const row = panel.getByTestId("mcp-connection").filter({ hasText: label });
  await expect(row).toContainText("Actif");
  await expect(panel.getByTestId("mcp-code")).toHaveCount(0);
  await panel.getByText("Journal des accès", { exact: true }).click();
  await expect(panel.locator(".mcp-audit")).toContainText("Code échangé");
  await page.emulateMedia({ colorScheme: "light" });
  await panel.getByRole("heading", { name: "Accès des assistants" }).click();
  await panel.screenshot({ path: testInfo.outputPath("mcp-light.png") });
  await page.setViewportSize({ width: 320, height: 900 });
  await page.emulateMedia({ colorScheme: "dark" });
  await expectNoHorizontalOverflow(page);
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  await panel.screenshot({ path: testInfo.outputPath("mcp-dark-narrow.png") });
  await row.getByRole("button", { name: "Révoquer", exact: true }).click();
  const dialog = page.getByTestId("mcp-revoke-dialog");
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(row.getByRole("button", { name: "Révoquer", exact: true })).toBeFocused();
  await page.keyboard.press("Space");
  await dialog.getByRole("button", { name: "Révoquer cet accès" }).click();
  await expect(row).toContainText("Révoqué");
  expect((await call(branch.itemId)).status()).toBe(401);
});

test("refused authorization preserves the scope, retries, and keeps codes out of storage", async ({
  page,
}) => {
  const panel = await openPanel(page);
  await panel.getByLabel("Nom de la connexion").fill("Assistant temporaire");
  await panel.getByRole("checkbox", { name: "Tout l’espace" }).check();
  await panel.getByRole("checkbox", { name: "Sans expiration", exact: true }).check();
  const authorize = panel.getByTestId("mcp-authorize");
  await authorize.click();
  await expect(panel.getByTestId("mcp-code")).toHaveCount(0);
  await panel.getByRole("checkbox", { name: "Je comprends" }).check();
  await page.route("**/v1/mcp/connections", (route) =>
    route.request().method() === "POST"
      ? route.fulfill({
          status: 428,
          contentType: "application/problem+json",
          body: JSON.stringify({ code: "recent_authentication_required", status: 428 }),
        })
      : route.continue(),
  );
  await authorize.click();
  await expect(panel.getByTestId("mcp-reauth")).toBeVisible();
  await expect(panel.getByLabel("Nom de la connexion")).toHaveValue("Assistant temporaire");
  await page.unroute("**/v1/mcp/connections");
  await page.route("**/v1/mcp/connections", (route) =>
    route.request().method() === "POST" ? route.abort() : route.continue(),
  );
  await authorize.click();
  await expect(panel.getByTestId("mcp-message")).toContainText("Rien n’a été mis en attente");
  await page.unroute("**/v1/mcp/connections");
  await authorize.click();
  const code = await panel.getByLabel("Code temporaire").inputValue();
  expect(
    await page.evaluate(
      (secret) =>
        Object.values(localStorage).some((value) => value.includes(secret)) ||
        Object.values(sessionStorage).some((value) => value.includes(secret)),
      code,
    ),
  ).toBe(false);
  await page.reload();
  await expect(page.getByTestId("settings-shell")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("mcp-panel")).toBeVisible();
  await expect(page.getByTestId("mcp-code")).toHaveCount(0);
  const row = page.getByTestId("mcp-connection").filter({ hasText: "Assistant temporaire" });
  await expect(row).toContainText("Sans expiration");
  await row.getByRole("button", { name: "Renouveler par un nouvel accès" }).click();
  await expect(page.getByLabel("Nom de la connexion")).toHaveValue("Assistant temporaire");
  await expect(page.getByLabel("Durée en jours")).toHaveValue("90");
  await expect(page.getByTestId("mcp-message")).toContainText("L’ancien accès reste inchangé");
});

async function protocolBody(response: import("@playwright/test").APIResponse) {
  const body = await response.text();
  const data = body.split("\n").find((line) => line.startsWith("data: "));
  return JSON.parse(data === undefined ? body : data.slice(6)) as { result: { isError?: boolean } };
}

test("stale owner confirms a real password without losing the grant draft", async ({ page }) => {
  const panel = await openPanel(page);
  const password = "mcp recent proof password";
  const salt = randomBytes(16);
  const encoded = `scrypt$16384$8$1$${salt.toString("base64")}$${scryptSync(password, salt, 32, { N: 16384, r: 8, p: 1 }).toString("base64")}`;
  const db = new pg.Client({
    connectionString: process.env["DATABASE_URL"],
    connectionTimeoutMillis: 10_000,
    query_timeout: 10_000,
  });
  await db.connect();
  try {
    await db.query("DELETE FROM password_credential_versions");
    await db.query(
      `INSERT INTO password_credential_versions (id, owner_id, password_hash, hash_algorithm, state) SELECT gen_random_uuid(), id, $1, 'scrypt', 'active' FROM owners LIMIT 1`,
      [encoded],
    );
    await db.query(
      "UPDATE sessions SET recent_auth_at = now() - interval '30 minutes' WHERE state = 'active'",
    );
  } finally {
    await db.end();
  }
  await panel.getByLabel("Nom de la connexion").fill("Accès après confirmation");
  await panel.getByRole("checkbox", { name: "Tout l’espace" }).check();
  await panel.getByTestId("mcp-authorize").click();
  await expect(panel.getByTestId("mcp-reauth")).toBeVisible();
  await panel.getByLabel("Mot de passe actuel").fill(password);
  await panel.getByRole("button", { name: "Confirmer avec le mot de passe" }).click();
  await expect(panel.getByTestId("mcp-message")).toContainText("Identité confirmée");
  await expect(panel.getByLabel("Nom de la connexion")).toHaveValue("Accès après confirmation");
  await expect(panel.getByTestId("mcp-code")).toHaveCount(0);
  await panel.getByTestId("mcp-authorize").click();
  await expect(panel.getByTestId("mcp-code")).toBeVisible();
});
