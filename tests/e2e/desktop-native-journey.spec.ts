import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { launchDesktopElectron } from "./desktop-electron.ts";
import { applyDesktopJourneySkip } from "./desktop-skip.ts";

applyDesktopJourneySkip();
test("native file selection returns chosen bytes and blocks dangerous external links", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "mon-native-file-"));
  const file = path.join(directory, "sample.txt");
  await writeFile(file, "Chosen test file");
  const session = await launchDesktopElectron();
  try {
    const page = session.window;
    await expect(page.getByTestId("desktop-connection-page")).toBeVisible();
    await session.app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
    }, file);
    const chosen = await page.evaluate(async () => {
      const result = await window.myownnotionDesktop?.chooseFile({
        filters: [{ name: "Text", extensions: ["txt"] }],
      });
      return result?.ok && !result.canceled
        ? { name: result.name, content: new TextDecoder().decode(result.bytes) }
        : null;
    });
    expect(chosen).toEqual({ name: "sample.txt", content: "Chosen test file" });
    const destination = path.join(directory, "recovery-kit.txt");
    await session.app.evaluate(({ dialog }, destination) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: destination });
    }, destination);
    expect(
      await page.evaluate(() =>
        window.myownnotionDesktop?.saveFile({
          defaultName: "recovery-kit.txt",
          bytes: new TextEncoder().encode("Recovery fixture"),
        }),
      ),
    ).toMatchObject({ ok: true, canceled: false });
    expect(await readFile(destination, "utf8")).toBe("Recovery fixture");
    await session.app.evaluate(({ dialog }) => {
      dialog.showSaveDialog = async () => ({ canceled: true, filePath: "" });
    });
    expect(
      await page.evaluate(() =>
        window.myownnotionDesktop?.saveFile({
          defaultName: "recovery-kit.txt",
          bytes: new TextEncoder().encode("Must not replace"),
        }),
      ),
    ).toMatchObject({ ok: true, canceled: true });
    expect(await readFile(destination, "utf8")).toBe("Recovery fixture");
    for (const url of ["file:///etc/passwd", "javascript:alert(1)", "data:text/html,hello"]) {
      expect(
        await page.evaluate((url) => window.myownnotionDesktop?.openExternal({ url }), url),
      ).toMatchObject({ ok: false });
    }
    await session.app.evaluate(({ shell }) => {
      const state = globalThis as typeof globalThis & { openedUrls: string[] };
      state.openedUrls = [];
      shell.openExternal = async (url) => {
        state.openedUrls.push(url);
      };
    });
    const windows = session.app.windows().length;
    await page.evaluate(() => window.open("https://example.org"));
    expect(session.app.windows()).toHaveLength(windows);
    await expect
      .poll(() =>
        session.app.evaluate(
          () => (globalThis as typeof globalThis & { openedUrls: string[] }).openedUrls,
        ),
      )
      .toContain("https://example.org/");
  } finally {
    await session.close();
    await rm(directory, { recursive: true, force: true });
  }
});
