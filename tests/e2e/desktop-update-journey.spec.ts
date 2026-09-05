import { execFileSync } from "node:child_process";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { FR_COPY } from "../../apps/web/src/ui/copy/fr.ts";
import { launchDesktopElectron } from "./desktop-electron.ts";
import { applyDesktopJourneySkip } from "./desktop-skip.ts";
import { openDesktopWorkspace } from "./desktop-workspace.ts";
import { expect, test } from "./fixtures.ts";
import { openSettingsSection, waitForSynchronized } from "./helpers.ts";

applyDesktopJourneySkip();

test("an unsigned development build refuses update installation through the real bridge", async () => {
  const session = await launchDesktopElectron();
  try {
    await expect(session.window.getByTestId("desktop-connection-page")).toBeVisible();
    const checked = await session.window.evaluate(async () =>
      window.myownnotionDesktop?.update.check(),
    );
    expect(checked?.phase).toBe("unavailable");
    const installed = await session.window.evaluate(async () =>
      window.myownnotionDesktop?.update.install(),
    );
    expect(installed?.phase).toBe("unavailable");
    expect(installed?.pendingLocalChanges).toBe(true);
  } finally {
    await session.close();
  }
});

test("signed update UI defers, rejects corrupt bytes and retries a verified native handoff", async ({
  baseURL,
  freshContent,
}) => {
  if (!baseURL) throw new Error("Missing test server");
  const build = await mkdtemp(path.join(os.tmpdir(), "mon-update-build-"));
  const keys = generateKeyPairSync("ed25519");
  const source = Buffer.from("Non-executable installer fixture");
  const extension =
    process.platform === "darwin" ? "dmg" : process.platform === "win32" ? "exe" : "AppImage";
  const artifact = `MyOwnNotion-999.0.0-${process.platform}-${process.arch}.${extension}`;
  const manifest = JSON.stringify({
    format: "myownnotion.desktop-update.v1",
    version: "999.0.0",
    channel: "stable",
    platform: process.platform,
    architecture: process.arch,
    artifactUrl: `https://github.com/enzofrnt/MyOwnNotion/releases/download/v999.0.0/${artifact}`,
    artifactSha512: createHash("sha512").update(source).digest("hex"),
    releaseNotesUrl: "https://github.com/enzofrnt/MyOwnNotion/releases/tag/v999.0.0",
    minimumServerProtocol: "3",
    maximumServerProtocol: "3",
  });
  const signature = sign(null, Buffer.from(manifest), keys.privateKey).toString("base64");
  execFileSync("bun", ["apps/desktop/build.ts"], {
    env: {
      ...process.env,
      MYOWNNOTION_DESKTOP_BUILD_OUTDIR: build,
      DESKTOP_UPDATE_PUBLIC_KEY: keys.publicKey.export({ type: "spki", format: "pem" }).toString(),
    },
    stdio: "pipe",
  });
  const { session, page } = await openDesktopWorkspace(
    baseURL,
    freshContent.cookies,
    path.join(build, "bootstrap.js"),
  );
  try {
    await waitForSynchronized(page);
    await session.app.evaluate(
      ({ shell }, input) => {
        const state = globalThis as typeof globalThis & {
          updateFixture: { corrupt: boolean; opened: string[] };
        };
        state.updateFixture = { corrupt: true, opened: [] };
        const globals = globalThis as unknown as {
          fetch: (request: RequestInfo | URL) => Promise<Response>;
        };
        globals.fetch = async (request) => {
          const url = String(request);
          if (url.endsWith(".json.sig"))
            return new Response(Buffer.from(input.signature, "base64"));
          if (url.endsWith(".json")) return new Response(input.manifest);
          return new Response(state.updateFixture.corrupt ? "Corrupted download" : input.source);
        };
        shell.openPath = async (file) => {
          state.updateFixture.opened.push(file);
          return "";
        };
        shell.showItemInFolder = (file) => {
          state.updateFixture.opened.push(file);
        };
      },
      { manifest, signature, source: source.toString() },
    );
    await openSettingsSection(page, "security");
    const phase = page.getByTestId("desktop-update-phase");
    const panel = page.getByTestId("desktop-update-panel");
    await expect(phase).toHaveAttribute("data-phase", "available");
    await panel.getByRole("button", { name: FR_COPY.desktop.update.defer }).click();
    await expect(phase).toHaveAttribute("data-phase", "deferred");
    await panel.getByRole("button", { name: FR_COPY.desktop.update.install }).click();
    await expect(phase).toHaveAttribute("data-phase", "download-failed");
    expect(
      await session.app.evaluate(
        () =>
          (globalThis as typeof globalThis & { updateFixture: { opened: string[] } }).updateFixture
            .opened,
      ),
    ).toEqual([]);
    await session.app.evaluate(() => {
      (
        globalThis as typeof globalThis & { updateFixture: { corrupt: boolean } }
      ).updateFixture.corrupt = false;
    });
    await panel.getByRole("button", { name: FR_COPY.desktop.update.install }).click();
    await expect(phase).toHaveAttribute("data-phase", "installing");
    const destination = path.join(session.userData, "updates", artifact);
    expect(await readFile(destination)).toEqual(source);
    expect(
      await session.app.evaluate(
        () =>
          (globalThis as typeof globalThis & { updateFixture: { opened: string[] } }).updateFixture
            .opened,
      ),
    ).toEqual([destination]);
  } finally {
    await session.close();
    await rm(build, { recursive: true, force: true });
  }
});
