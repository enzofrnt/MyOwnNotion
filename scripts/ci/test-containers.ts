/**
 * Clean container and Compose smoke test (T097, US7).
 *
 * Builds the API and web images, verifies direct and same-origin health,
 * persists a canonical item across a full Compose stop/start, and removes only
 * the isolated test project's containers and volumes afterward.
 */
import { execFileSync } from "node:child_process";
import process from "node:process";
import { generateUuidV7 } from "@myownnotion/domain";

const projectName = `myownnotion-container-smoke-${process.pid}`;
const portOffset = process.pid % 10_000;
const databasePort = Number(process.env["MYOWNNOTION_SMOKE_DB_PORT"] ?? 20_000 + portOffset);
const apiPort = Number(process.env["MYOWNNOTION_SMOKE_API_PORT"] ?? 30_000 + portOffset);
const webPort = Number(process.env["MYOWNNOTION_SMOKE_WEB_PORT"] ?? 40_000 + portOffset);
const composePrefix = [
  "compose",
  "--project-name",
  projectName,
  "--env-file",
  ".env.prod.example",
  "-f",
  "compose.prod.yaml",
];
const smokeEnvironment = {
  ...process.env,
  MYOWNNOTION_IMAGE_TAG: "local",
  MYOWNNOTION_VCS_REF: process.env["GITHUB_SHA"] ?? "container-smoke",
  MYOWNNOTION_DB_PORT: String(databasePort),
  MYOWNNOTION_API_PORT: String(apiPort),
  MYOWNNOTION_WEB_PORT: String(webPort),
};

function compose(...args: string[]): void {
  execFileSync("docker", [...composePrefix, ...args], {
    env: smokeEnvironment,
    stdio: "inherit",
  });
}

async function expectJson<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response | undefined;
  let lastNetworkError: unknown;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      response = await fetch(url, init);
      break;
    } catch (error) {
      lastNetworkError = error;
      await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
    }
  }
  if (response === undefined) {
    throw lastNetworkError;
  }
  if (!response.ok) {
    throw new Error(`${init?.method ?? "GET"} ${url} failed with HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

function start(build: boolean): void {
  compose("up", "--detach", ...(build ? ["--build"] : []), "--wait", "--wait-timeout", "240");
}

try {
  execFileSync("docker", ["info"], { stdio: "ignore" });
  start(true);

  const apiBaseUrl = `http://127.0.0.1:${apiPort}`;
  const webBaseUrl = `http://127.0.0.1:${webPort}`;
  const directHealth = await expectJson<{ status: string }>(`${apiBaseUrl}/health`);
  const proxiedHealth = await expectJson<{ status: string }>(`${webBaseUrl}/health`);
  if (directHealth.status !== "ready" || proxiedHealth.status !== "ready") {
    throw new Error("API health was not ready through both direct and web-proxied routes");
  }

  const itemId = generateUuidV7();
  const mutationId = generateUuidV7();
  await expectJson(`${webBaseUrl}/v1/items`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": mutationId,
    },
    body: JSON.stringify({
      id: itemId,
      kind: "page",
      name: "Container restart fixture",
      placement: {
        kind: "hierarchy",
        parentItemId: null,
        positionKey: "a0",
      },
      pageDocument: {
        format: "myownnotion.document+json",
        formatVersion: 2,
        body: {
          type: "doc",
          content: [
            {
              type: "heading",
              attrs: { level: 2 },
              content: [
                { type: "text", text: "Container editor fixture", marks: [{ type: "bold" }] },
              ],
            },
            { type: "paragraph", content: [{ type: "text", text: "Persists after restart" }] },
          ],
        },
      },
    }),
  });

  compose("down", "--remove-orphans");
  start(false);

  const persisted = await expectJson<{
    id: string;
    pageDocument: { formatVersion: number; body: { content: Array<{ type: string }> } };
  }>(`${webBaseUrl}/v1/items/${itemId}`);
  if (persisted.id !== itemId) {
    throw new Error("Restarted composition did not preserve the committed fixture item");
  }
  if (
    persisted.pageDocument.formatVersion !== 2 ||
    persisted.pageDocument.body.content[0]?.type !== "heading"
  ) {
    throw new Error("Restarted composition did not preserve the version 2 editor document");
  }

  console.info(
    "Container smoke test passed: images, health proxy, migrations, and v2 editor persistence.",
  );
} catch (error) {
  console.error("Container smoke test failed:", error);
  process.exitCode = 1;
} finally {
  // A failed start can still leave partial resources in this isolated project.
  try {
    compose("down", "--volumes", "--remove-orphans");
  } catch (cleanupError) {
    console.error("Container smoke cleanup failed:", cleanupError);
    process.exitCode = 1;
  }
}
