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

  const targetItemId = generateUuidV7();
  await expectJson(`${webBaseUrl}/v1/items`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": generateUuidV7(),
    },
    body: JSON.stringify({
      id: targetItemId,
      kind: "page",
      name: "Container link target",
      placement: { kind: "hierarchy", parentItemId: null, positionKey: "a0" },
    }),
  });

  const itemId = generateUuidV7();
  const occurrenceId = generateUuidV7();
  const taskId = generateUuidV7();
  const databaseId = generateUuidV7();
  const statusPropertyId = generateUuidV7();
  const relationPropertyId = generateUuidV7();
  const activeOptionId = generateUuidV7();
  const sourceRecordId = generateUuidV7();
  const targetRecordId = generateUuidV7();
  await expectJson(`${webBaseUrl}/v1/items`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": generateUuidV7(),
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
        formatVersion: 5,
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
            {
              type: "taskList",
              content: [
                {
                  type: "taskItem",
                  attrs: {
                    checked: false,
                    taskId,
                    status: "in_progress",
                    dueDate: "2028-02-29",
                    priority: "high",
                  },
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "Container task fixture" }],
                    },
                  ],
                },
              ],
            },
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: "Container link target",
                  marks: [
                    {
                      type: "wikiLink",
                      attrs: { targetItemId, occurrenceId },
                    },
                  ],
                },
              ],
            },
            {
              type: "databaseBlock",
              attrs: {
                databaseId,
                schemaVersion: 1,
                properties: [
                  {
                    propertyId: statusPropertyId,
                    name: "Status",
                    type: "select",
                    options: [{ optionId: activeOptionId, name: "Active" }],
                  },
                  { propertyId: relationPropertyId, name: "Related", type: "relation" },
                ],
                records: [
                  {
                    recordId: sourceRecordId,
                    title: "Container source record",
                    values: [
                      { propertyId: statusPropertyId, type: "select", value: activeOptionId },
                      {
                        propertyId: relationPropertyId,
                        type: "relation",
                        value: [targetRecordId],
                      },
                    ],
                  },
                  { recordId: targetRecordId, title: "Container target record", values: [] },
                ],
                view: {
                  mode: "board",
                  query: "Container",
                  sortPropertyId: null,
                  sortDirection: "desc",
                  boardGroupPropertyId: statusPropertyId,
                },
              },
            },
          ],
        },
      },
    }),
  });

  compose("down", "--remove-orphans");
  start(false);

  const persisted = await expectJson<{
    id: string;
    pageDocument: {
      formatVersion: number;
      body: {
        content: Array<{ type: string; attrs?: Record<string, unknown>; content?: unknown[] }>;
      };
    };
  }>(`${webBaseUrl}/v1/items/${itemId}`);
  if (persisted.id !== itemId) {
    throw new Error("Restarted composition did not preserve the committed fixture item");
  }
  if (
    persisted.pageDocument.formatVersion !== 5 ||
    persisted.pageDocument.body.content[0]?.type !== "heading"
  ) {
    throw new Error("Restarted composition did not preserve the version 5 editor document");
  }
  const persistedTaskList = persisted.pageDocument.body.content.find(
    (node) => node.type === "taskList",
  );
  const persistedTask = persistedTaskList?.content?.[0] as
    | { attrs?: Record<string, unknown> }
    | undefined;
  if (
    persistedTask?.attrs?.["taskId"] !== taskId ||
    persistedTask.attrs["status"] !== "in_progress" ||
    persistedTask.attrs["dueDate"] !== "2028-02-29" ||
    persistedTask.attrs["priority"] !== "high"
  ) {
    throw new Error("Restarted composition did not preserve task identity and metadata");
  }
  const persistedDatabase = persisted.pageDocument.body.content.find(
    (node) => node.type === "databaseBlock",
  );
  const persistedDatabaseAttrs = persistedDatabase?.attrs as
    | {
        databaseId?: string;
        records?: Array<{ recordId?: string; values?: Array<{ type?: string; value?: unknown }> }>;
        view?: Record<string, unknown>;
      }
    | undefined;
  const persistedSourceRecord = persistedDatabaseAttrs?.records?.find(
    (record) => record.recordId === sourceRecordId,
  );
  if (
    persistedDatabaseAttrs?.databaseId !== databaseId ||
    persistedDatabaseAttrs.records?.some((record) => record.recordId === targetRecordId) !== true ||
    persistedSourceRecord?.values?.some(
      (value) =>
        value.type === "relation" &&
        JSON.stringify(value.value) === JSON.stringify([targetRecordId]),
    ) !== true ||
    persistedDatabaseAttrs.view?.["mode"] !== "board" ||
    persistedDatabaseAttrs.view["query"] !== "Container" ||
    persistedDatabaseAttrs.view["boardGroupPropertyId"] !== statusPropertyId
  ) {
    throw new Error("Restarted composition did not preserve database schema, relation, and view");
  }

  const persistedRelationships = await expectJson<{
    relationships: Array<{
      id: string;
      sourceItemId: string;
      targetItemId: string;
      relationType: string;
    }>;
  }>(`${webBaseUrl}/v1/relationships?itemId=${itemId}`);
  const persistedWikiLink = persistedRelationships.relationships.find(
    (relationship) => relationship.id === occurrenceId,
  );
  if (
    persistedWikiLink?.sourceItemId !== itemId ||
    persistedWikiLink.targetItemId !== targetItemId ||
    persistedWikiLink.relationType !== "link:references"
  ) {
    throw new Error("Restarted composition did not preserve the derived wiki relationship");
  }

  console.info(
    "Container smoke test passed: images, health proxy, migrations, and v5 wiki/task/database persistence.",
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
