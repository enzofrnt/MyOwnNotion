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
};

function compose(...args: string[]): void {
  execFileSync("docker", [...composePrefix, ...args], {
    env: smokeEnvironment,
    stdio: "inherit",
  });
}

async function expectJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
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

  const directHealth = await expectJson<{ status: string }>("http://127.0.0.1:3001/health");
  const proxiedHealth = await expectJson<{ status: string }>("http://127.0.0.1:8080/health");
  if (directHealth.status !== "ready" || proxiedHealth.status !== "ready") {
    throw new Error("API health was not ready through both direct and web-proxied routes");
  }

  const itemId = generateUuidV7();
  const mutationId = generateUuidV7();
  await expectJson(`http://127.0.0.1:8080/v1/items`, {
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
        formatVersion: 1,
        body: { type: "doc", content: [] },
      },
    }),
  });

  compose("down", "--remove-orphans");
  start(false);

  const persisted = await expectJson<{ id: string }>(`http://127.0.0.1:8080/v1/items/${itemId}`);
  if (persisted.id !== itemId) {
    throw new Error("Restarted composition did not preserve the committed fixture item");
  }

  console.info("Container smoke test passed: images, health proxy, migrations, and persistence.");
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
