/**
 * Previewing a file without handing it the workspace (T025, US3, FR-010, FR-013).
 *
 * The assertion that matters is the negative one: a file that tries to reach
 * the application around it must fail. Everything else here — that a PDF opens,
 * that an unknown type offers a download — is comfort. This is the one where
 * being wrong means an attachment can read everything its owner has written.
 */

import { expect, test } from "./fixtures.ts";
import {
  createRootItem,
  openWorkspace,
  selectItem,
  uniqueName,
  waitForSynchronized,
} from "./helpers.ts";

/** An SVG that tries to read the page it is rendered in. */
const HOSTILE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80">
  <script type="text/javascript">
    try {
      // If this frame were same-origin, both of these would succeed and the
      // file would be reading the owner's workspace.
      const stolen = window.parent.document.body.innerHTML;
      window.parent.postMessage({ stolen: stolen.length }, "*");
    } catch (error) {
      // Expected: the sandbox denies it.
    }
  </script>
  <rect width="80" height="80" fill="currentColor" />
</svg>`;

async function pageWithFile(
  page: import("@playwright/test").Page,
  fileName: string,
  body: string,
  mimeType: string,
): Promise<void> {
  const pageName = uniqueName("PreviewHost");
  await openWorkspace(page);
  await createRootItem(page, "page", pageName);
  await waitForSynchronized(page);
  await selectItem(page, pageName);
  await page.getByTestId("attachment-upload").setInputFiles({
    name: fileName,
    mimeType,
    buffer: Buffer.from(body),
  });
  await expect(page.getByTestId(`attachment-${fileName}`)).toBeVisible({ timeout: 30_000 });
  await waitForSynchronized(page);
}

test.describe("a preview cannot reach the workspace", () => {
  test("script inside a previewed file cannot read the page around it", async ({ page }) => {
    const fileName = `${uniqueName("hostile")}.svg`;
    await pageWithFile(page, fileName, HOSTILE_SVG, "image/svg+xml");

    // Anything the file managed to exfiltrate would arrive as a message.
    const stolen: unknown[] = [];
    await page.exposeFunction("__recordStolen", (value: unknown) => stolen.push(value));
    await page.evaluate(() => {
      window.addEventListener("message", (event) => {
        const data = event.data as { stolen?: number } | null;
        if (data !== null && typeof data === "object" && "stolen" in data) {
          (window as unknown as { __recordStolen: (v: unknown) => void }).__recordStolen(data);
        }
      });
    });

    await page.getByTestId(`preview-file-${fileName}`).click();
    const frame = page.getByTestId("file-preview");
    await expect(frame).toBeVisible({ timeout: 30_000 });

    // The sandbox has no allow-same-origin, so the frame is an opaque origin
    // and the read throws inside it.
    await expect(frame).toHaveAttribute("sandbox", "allow-scripts");
    await page.waitForTimeout(1000);
    expect(stolen).toEqual([]);

    // The workspace is still there and still working.
    await expect(page.getByTestId("attachment-panel")).toBeVisible();
  });

  test("the frame never carries allow-same-origin", async ({ page }) => {
    // Stated as its own assertion because this single token is the difference
    // between an isolated preview and one running as the application.
    const fileName = `${uniqueName("plain")}.png`;
    await pageWithFile(page, fileName, "not really a png", "image/png");

    await page.getByTestId(`preview-file-${fileName}`).click();
    const sandbox = await page.getByTestId("file-preview").getAttribute("sandbox");
    expect(sandbox).not.toContain("allow-same-origin");
  });
});

test.describe("what is previewed and what is not", () => {
  test("an image opens inside the application", async ({ page }) => {
    const fileName = `${uniqueName("picture")}.svg`;
    await pageWithFile(
      page,
      fileName,
      '<svg xmlns="http://www.w3.org/2000/svg"/>',
      "image/svg+xml",
    );

    await page.getByTestId(`preview-file-${fileName}`).click();
    await expect(page.getByTestId("file-preview")).toBeVisible({ timeout: 30_000 });
  });

  test("an unrecognised type states name, type and size, and offers a download", async ({
    page,
  }) => {
    // FR-012. A file the application cannot show is still a file the owner put
    // there, and telling them nothing about it is the failure to avoid.
    const fileName = `${uniqueName("archive")}.bin`;
    await pageWithFile(page, fileName, "opaque bytes", "application/octet-stream");

    await page.getByTestId(`preview-file-${fileName}`).click();
    await expect(page.getByTestId("file-unsupported")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("unsupported-name")).toContainText(fileName);
    await expect(page.getByTestId("unsupported-type")).not.toBeEmpty();
    await expect(page.getByTestId("unsupported-size")).not.toBeEmpty();
    await expect(page.getByTestId("unsupported-download")).toBeVisible();
  });
});

test.describe("the diagram editor never reaches a third party", () => {
  test("no request leaves this origin for diagrams.net while the workspace is used", async ({
    page,
  }) => {
    // The invariant, asserted independently of whether the editor container is
    // running: the failure being guarded against is not "the editor is broken"
    // but "the owner's diagram was sent to someone else", and that shows up as a
    // request rather than as a symptom.
    const foreign: string[] = [];
    page.on("request", (request) => {
      const host = new URL(request.url()).hostname.toLowerCase();
      if (/diagrams\.net$|draw\.io$|jgraph\.com$/.test(host)) {
        foreign.push(request.url());
      }
    });

    const pageName = uniqueName("DiagramHost");
    await openWorkspace(page);
    await createRootItem(page, "page", pageName);
    await waitForSynchronized(page);
    await selectItem(page, pageName);

    const fileName = `${uniqueName("diagram")}.drawio`;
    await page.getByTestId("attachment-upload").setInputFiles({
      name: fileName,
      mimeType: "application/vnd.jgraph.mxfile",
      buffer: Buffer.from('<mxfile><diagram id="a" name="Page-1"></diagram></mxfile>'),
    });
    await expect(page.getByTestId(`attachment-${fileName}`)).toBeVisible({ timeout: 30_000 });
    await page.getByTestId(`preview-file-${fileName}`).click();
    await page.waitForTimeout(1500);

    // Any entry here is a data leak, not a detail.
    expect(foreign).toEqual([]);
  });
});
