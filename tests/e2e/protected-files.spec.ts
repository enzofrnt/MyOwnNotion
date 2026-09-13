import { withBoundedDatabaseClient } from "./bounded-database.ts";
import { expect, test } from "./fixtures.ts";
import {
  apiOrigin,
  createRootItem,
  openAttachmentDetails,
  openPageAttachments,
  openWorkspace,
  renameItem,
  selectSettledPage,
  uniqueName,
  waitForSynchronized,
} from "./helpers.ts";

const API = apiOrigin();

test("protects a UI attachment and preserves its loaded preview through offline and reconnect", async ({
  page,
  context,
  request,
}) => {
  await openWorkspace(page);
  const host = uniqueName("Protected attachment host");
  const name = `${uniqueName("protected-preview")}.svg`;
  const bytes = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="80"><text x="5" y="35">Private preview</text></svg>',
  );
  await createRootItem(page, "page", host);
  await waitForSynchronized(page);
  await selectSettledPage(page, host);
  await openPageAttachments(page, host);
  const uploaded = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" && new URL(response.url()).pathname === "/v1/files",
  );
  await page
    .getByTestId("attachment-upload")
    .setInputFiles({ name, mimeType: "image/svg+xml", buffer: bytes });
  const response = await uploaded;
  expect(response.status()).toBe(201);
  const itemId = (await response.json()).item.id as string;
  await expect(page.getByTestId(`attachment-${name}`)).toBeVisible();
  await waitForSynchronized(page);
  const storage = await withBoundedDatabaseClient(
    "protected-attachment-e2e",
    async (client) =>
      (
        await client.query(
          "SELECT i.name, f.original_name, c.storage_format, c.storage_key, c.sha256 FROM logical_files f JOIN items i ON i.id = f.item_id JOIN file_contents c ON c.id = f.content_id WHERE f.item_id = $1",
          [itemId],
        )
      ).rows[0],
  );
  expect(storage).toMatchObject({
    name: "�",
    original_name: "�",
    storage_format: "encrypted-chunks-v1",
    storage_key: null,
    sha256: null,
  });
  await openAttachmentDetails(page, name);
  await page.getByTestId(`preview-file-${name}`).click();
  const preview = page.getByTestId("file-preview");
  await expect(preview).toHaveAttribute("sandbox", "allow-scripts");
  await expect(preview).toHaveAttribute("src", /^blob:/);
  await expect(page.frameLocator('[data-testid="file-preview"]').locator("text")).toHaveText(
    "Private preview",
  );
  await context.setOffline(true);
  try {
    // This proves the already loaded preview; reopening an uncached file is a distinct boundary.
    await expect(page.frameLocator('[data-testid="file-preview"]').locator("text")).toHaveText(
      "Private preview",
    );
  } finally {
    await context.setOffline(false);
  }
  const downloaded = await request.get(`${API}/v1/files/${itemId}/content`);
  expect(downloaded.status()).toBe(200);
  expect(await downloaded.body()).toEqual(bytes);
});

test("resumes protected chunks after reload, renames one canonical file and reads an authenticated crossing range", async ({
  page,
  request,
}) => {
  await openWorkspace(page);
  const name = `${uniqueName("protected-resume")}.txt`;
  const renamed = `${uniqueName("renamed-protected")}.txt`;
  const boundary = 4 * 1024 ** 2;
  const bytes = Buffer.alloc(boundary + 137, "r");
  bytes.write("authenticated crossing", boundary - 10);
  const created = await request.post(`${API}/v1/uploads`, {
    headers: {
      "upload-length": String(bytes.length),
      "upload-metadata": `filename ${Buffer.from(name).toString("base64")},mediaType ${Buffer.from("text/plain").toString("base64")}`,
    },
  });
  expect(created.status()).toBe(201);
  const location = created.headers()["location"];
  expect(
    (
      await request.patch(`${API}${location}`, {
        headers: { "content-type": "application/offset+octet-stream", "upload-offset": "0" },
        data: bytes.subarray(0, boundary),
      })
    ).status(),
  ).toBe(204);
  await page.reload();
  await openWorkspace(page);
  await expect(page.getByTestId(`tree-item-${name}`)).toHaveCount(0);
  const head = await request.head(`${API}${location}`);
  expect(head.headers()["upload-offset"]).toBe(String(boundary));
  const completed = await request.patch(`${API}${location}`, {
    headers: {
      "content-type": "application/offset+octet-stream",
      "upload-offset": String(boundary),
    },
    data: bytes.subarray(boundary),
  });
  expect(completed.status()).toBe(201);
  const itemId = (await completed.json()).itemId as string;
  await expect(page.getByTestId(`tree-item-${name}`)).toBeAttached({ timeout: 15_000 });
  await renameItem(page, name, renamed);
  await expect(page.getByTestId(`tree-item-${renamed}`)).toHaveAttribute("data-item-id", itemId);
  const range = await request.get(`${API}/v1/files/${itemId}/content`, {
    headers: { range: `bytes=${boundary - 10}-${boundary + 20}` },
  });
  expect(range.status()).toBe(206);
  expect(range.headers()["content-range"]).toBe(
    `bytes ${boundary - 10}-${boundary + 20}/${bytes.length}`,
  );
  expect(await range.body()).toEqual(bytes.subarray(boundary - 10, boundary + 21));
  const item = await request.get(`${API}/v1/items/${itemId}`);
  expect(item.status()).toBe(200);
  expect((await item.json()).name).toBe(renamed);
});
