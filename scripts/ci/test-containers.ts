/**
 * Clean container and Compose smoke test (T097, US7).
 *
 * Builds the API and web images, verifies direct and same-origin health,
 * persists a canonical item across a full Compose stop/start, and removes only
 * the isolated test project's containers and volumes afterward.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { isDeepStrictEqual } from "node:util";
import {
  type CanonicalExportManifest,
  generateUuidV7,
  validateCanonicalRecovery,
} from "@myownnotion/domain";

const projectName = `myownnotion-container-smoke-${process.pid}`;
const portOffset = process.pid % 5_000;
const databasePort = Number(process.env["MYOWNNOTION_SMOKE_DB_PORT"] ?? 20_000 + portOffset);
const apiPort = Number(process.env["MYOWNNOTION_SMOKE_API_PORT"] ?? 30_000 + portOffset);
const webPort = Number(process.env["MYOWNNOTION_SMOKE_WEB_PORT"] ?? 40_000 + portOffset);
const restoreDatabasePort = Number(
  process.env["MYOWNNOTION_SMOKE_RESTORE_DB_PORT"] ?? 25_000 + portOffset,
);
const restoreApiPort = Number(
  process.env["MYOWNNOTION_SMOKE_RESTORE_API_PORT"] ?? 35_000 + portOffset,
);
const restoreWebPort = Number(
  process.env["MYOWNNOTION_SMOKE_RESTORE_WEB_PORT"] ?? 45_000 + portOffset,
);
const hostPorts = [
  databasePort,
  apiPort,
  webPort,
  restoreDatabasePort,
  restoreApiPort,
  restoreWebPort,
];
if (
  hostPorts.some((port) => !Number.isSafeInteger(port) || port < 1_024 || port > 65_535) ||
  new Set(hostPorts).size !== hostPorts.length
) {
  throw new Error("Container smoke source and restore host ports must be valid and disjoint");
}
const restoreProjectName = `${projectName}-restore`;
const backupHostRoot = mkdtempSync(path.join(os.tmpdir(), "myownnotion-backup-smoke-"));
const backupSecretsDirectory = path.join(backupHostRoot, "secrets");
const backupDestination = path.join(backupHostRoot, "repository");
const resticPasswordPath = path.join(backupSecretsDirectory, "restic-password");
mkdirSync(backupSecretsDirectory, { recursive: true });
mkdirSync(backupDestination, { recursive: true });
chmodSync(backupHostRoot, 0o755);
chmodSync(backupSecretsDirectory, 0o755);
chmodSync(backupDestination, 0o777);
writeFileSync(resticPasswordPath, "container-smoke-restic-password\n", { mode: 0o644 });
const sourceRevision = /^[a-f0-9]{7,64}$/.test(process.env["GITHUB_SHA"] ?? "")
  ? (process.env["GITHUB_SHA"] as string)
  : "c".repeat(40);
const smokeEnvironment = {
  ...process.env,
  MYOWNNOTION_IMAGE_TAG: "local",
  MYOWNNOTION_VCS_REF: sourceRevision,
  MYOWNNOTION_DB_PORT: String(databasePort),
  MYOWNNOTION_API_PORT: String(apiPort),
  MYOWNNOTION_WEB_PORT: String(webPort),
  MYOWNNOTION_BACKUP_SECRETS_DIR: backupSecretsDirectory,
  MYOWNNOTION_BACKUP_DESTINATION: backupDestination,
  MYOWNNOTION_RESTIC_REPOSITORY: "/var/lib/myownnotion/backup-destination",
};
const restoreEnvironment = {
  ...smokeEnvironment,
  MYOWNNOTION_DB_PORT: String(restoreDatabasePort),
  MYOWNNOTION_API_PORT: String(restoreApiPort),
  MYOWNNOTION_WEB_PORT: String(restoreWebPort),
};

interface ComposeContext {
  readonly projectName: string;
  readonly environment: NodeJS.ProcessEnv;
}

const sourceContext: ComposeContext = { projectName, environment: smokeEnvironment };
const restoreContext: ComposeContext = {
  projectName: restoreProjectName,
  environment: restoreEnvironment,
};

function composeArguments(context: ComposeContext, args: readonly string[]): string[] {
  return [
    "compose",
    "--project-name",
    context.projectName,
    "--env-file",
    ".env.prod.example",
    "-f",
    "compose.prod.yaml",
    ...args,
  ];
}

function composeFor(context: ComposeContext, ...args: string[]): void {
  execFileSync("docker", composeArguments(context, args), {
    env: context.environment,
    stdio: "inherit",
  });
}

function composeOutputFor(context: ComposeContext, ...args: string[]): string {
  return execFileSync("docker", composeArguments(context, args), {
    env: context.environment,
    encoding: "utf8",
  });
}

function compose(...args: string[]): void {
  composeFor(sourceContext, ...args);
}

function composeOutput(...args: string[]): string {
  return composeOutputFor(sourceContext, ...args);
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

async function expectExactFile(
  url: string,
  expected: Uint8Array,
  range?: { readonly start: number; readonly endInclusive: number },
): Promise<void> {
  let response: Response | undefined;
  let lastNetworkError: unknown;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      response = await fetch(url, {
        ...(range === undefined
          ? {}
          : { headers: { range: `bytes=${range.start}-${range.endInclusive}` } }),
      });
      break;
    } catch (error) {
      lastNetworkError = error;
      await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
    }
  }
  if (response === undefined) throw lastNetworkError;
  const expectedStatus = range === undefined ? 200 : 206;
  if (response.status !== expectedStatus) {
    throw new Error(`File retrieval returned HTTP ${response.status}`);
  }
  const observed = new Uint8Array(await response.arrayBuffer());
  const selected =
    range === undefined ? expected : expected.slice(range.start, range.endInclusive + 1);
  if (
    createHash("sha256").update(observed).digest("hex") !==
      createHash("sha256").update(selected).digest("hex") ||
    observed.byteLength !== selected.byteLength
  ) {
    throw new Error("Object-backed file retrieval changed bytes");
  }
}

interface SafeOperationOutput {
  readonly status?: string;
  readonly snapshotId?: string;
  readonly failureCode?: string | null;
  readonly snapshots?: Array<{ snapshotId?: string }>;
  readonly counts?: Record<string, number>;
}

function runOperation(
  context: ComposeContext,
  ...args: string[]
): {
  readonly exitCode: number;
  readonly result: SafeOperationOutput;
  readonly serialized: string;
} {
  const executed = spawnSync("docker", composeArguments(context, ["run", "--rm", ...args]), {
    env: context.environment,
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
  });
  if (executed.error !== undefined) throw executed.error;
  const serialized = executed.stdout
    .trim()
    .split("\n")
    .findLast((line) => line.trim().startsWith("{"));
  if (serialized === undefined) {
    throw new Error(`Operations command emitted no safe JSON result (exit ${executed.status})`);
  }
  return {
    exitCode: executed.status ?? 1,
    result: JSON.parse(serialized) as SafeOperationOutput,
    serialized,
  };
}

function expectOperationSuccess(context: ComposeContext, ...args: string[]): SafeOperationOutput {
  const observed = runOperation(context, ...args);
  if (observed.exitCode !== 0 || observed.result.status !== "succeeded") {
    throw new Error(
      `Operations command failed safely: ${observed.result.failureCode ?? "unknown"} (exit ${observed.exitCode})`,
    );
  }
  return observed.result;
}

async function createCanonicalExport(baseUrl: string): Promise<CanonicalExportManifest> {
  const created = await expectJson<{ exportId: string }>(`${baseUrl}/v1/export`, {
    method: "POST",
    headers: { "idempotency-key": generateUuidV7() },
  });
  let status = "pending";
  for (let attempt = 0; attempt < 80 && status === "pending"; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    const observed = await expectJson<{ status: string }>(
      `${baseUrl}/v1/export/${created.exportId}`,
    );
    status = observed.status;
  }
  if (status !== "ready") throw new Error(`Canonical export ended in ${status}`);
  return expectJson<CanonicalExportManifest>(`${baseUrl}/v1/export/${created.exportId}/artifact`);
}

function start(build: boolean, context: ComposeContext = sourceContext): void {
  composeFor(
    context,
    "up",
    "--detach",
    ...(build ? ["--build"] : []),
    "--wait",
    "--wait-timeout",
    "240",
  );
}

try {
  execFileSync("docker", ["info"], { stdio: "ignore" });
  compose("build", "operations");
  start(true);

  const apiBaseUrl = `http://127.0.0.1:${apiPort}`;
  const webBaseUrl = `http://127.0.0.1:${webPort}`;
  const directHealth = await expectJson<{ status: string }>(`${apiBaseUrl}/health`);
  const proxiedHealth = await expectJson<{ status: string }>(`${webBaseUrl}/health`);
  if (directHealth.status !== "ready" || proxiedHealth.status !== "ready") {
    throw new Error("API health was not ready through both direct and web-proxied routes");
  }
  const objectContainerId = composeOutput("ps", "--quiet", "object-storage").trim();
  const portBindings = JSON.parse(
    execFileSync(
      "docker",
      ["inspect", "--format", "{{json .HostConfig.PortBindings}}", objectContainerId],
      { encoding: "utf8" },
    ),
  ) as Record<string, unknown> | null;
  if (portBindings !== null && Object.values(portBindings).some((binding) => binding !== null)) {
    throw new Error("Private object storage unexpectedly publishes a host port");
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
  const canvasId = generateUuidV7();
  const canvasTextCardId = generateUuidV7();
  const canvasPageCardId = generateUuidV7();
  const canvasConnectionId = generateUuidV7();
  const canvasStrokeId = generateUuidV7();
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
        formatVersion: 6,
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
            {
              type: "canvasBlock",
              attrs: {
                canvasId,
                schemaVersion: 1,
                cards: [
                  {
                    cardId: canvasTextCardId,
                    kind: "text",
                    text: "Container spatial idea",
                    x: 40,
                    y: 80,
                    width: 240,
                    height: 160,
                  },
                  {
                    cardId: canvasPageCardId,
                    kind: "page",
                    targetItemId,
                    x: 420,
                    y: -120,
                    width: 280,
                    height: 180,
                  },
                ],
                connections: [
                  {
                    connectionId: canvasConnectionId,
                    sourceCardId: canvasTextCardId,
                    targetCardId: canvasPageCardId,
                    label: "documents",
                  },
                ],
                strokes: [
                  {
                    strokeId: canvasStrokeId,
                    width: 8,
                    points: [
                      { x: -40, y: 20 },
                      { x: 10, y: 90 },
                      { x: 180, y: 30 },
                    ],
                  },
                ],
                viewport: { x: -160, y: 240, zoom: 1.5 },
              },
            },
          ],
        },
      },
    }),
  });

  const fileItemId = generateUuidV7();
  const fileBytes = new TextEncoder().encode(
    `container-object-storage-${generateUuidV7()}-0123456789`,
  );
  const fileUpload = new FormData();
  fileUpload.set(
    "placement",
    JSON.stringify({ kind: "hierarchy", parentItemId: null, positionKey: "b0" }),
  );
  fileUpload.set("itemId", fileItemId);
  fileUpload.set(
    "file",
    new Blob([fileBytes], { type: "application/octet-stream" }),
    "container-private.bin",
  );
  const importedFile = await expectJson<{ revisionIds: string[] }>(`${webBaseUrl}/v1/files`, {
    method: "POST",
    headers: { "idempotency-key": generateUuidV7() },
    body: fileUpload,
  });
  const fileRevisionId = importedFile.revisionIds[0];
  if (fileRevisionId === undefined) {
    throw new Error("Container file import returned no revision");
  }
  const fileUrl = `${webBaseUrl}/v1/files/${fileItemId}/content?revisionId=${fileRevisionId}`;
  await expectExactFile(fileUrl, fileBytes);
  await expectExactFile(fileUrl, fileBytes, { start: 10, endInclusive: 23 });

  compose("down", "--remove-orphans");
  start(false);

  await expectExactFile(fileUrl, fileBytes);
  await expectExactFile(fileUrl, fileBytes, { start: 10, endInclusive: 23 });

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
    persisted.pageDocument.formatVersion !== 6 ||
    persisted.pageDocument.body.content[0]?.type !== "heading"
  ) {
    throw new Error("Restarted composition did not preserve the version 6 editor document");
  }

  const auditOutput = composeOutput(
    "run",
    "--rm",
    "operations",
    "storage",
    "audit",
    "--limit",
    "0",
  );
  const auditLine = auditOutput
    .trim()
    .split("\n")
    .findLast((line) => line.trim().startsWith("{"));
  if (auditLine === undefined) {
    throw new Error("Storage audit emitted no safe JSON result");
  }
  const audit = JSON.parse(auditLine) as {
    status?: string;
    counts?: { referenced?: number; missing?: number; mismatched?: number };
  };
  if (
    audit.status !== "succeeded" ||
    audit.counts?.referenced !== 1 ||
    audit.counts.missing !== 0 ||
    audit.counts.mismatched !== 0
  ) {
    throw new Error("Storage audit did not verify the persisted object");
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
  const persistedCanvas = persisted.pageDocument.body.content.find(
    (node) => node.type === "canvasBlock",
  );
  const persistedCanvasAttrs = persistedCanvas?.attrs as
    | {
        canvasId?: string;
        cards?: Array<Record<string, unknown>>;
        connections?: Array<Record<string, unknown>>;
        strokes?: Array<Record<string, unknown>>;
        viewport?: Record<string, unknown>;
      }
    | undefined;
  if (
    persistedCanvasAttrs?.canvasId !== canvasId ||
    !isDeepStrictEqual(persistedCanvasAttrs.cards, [
      {
        cardId: canvasTextCardId,
        kind: "text",
        text: "Container spatial idea",
        x: 40,
        y: 80,
        width: 240,
        height: 160,
      },
      {
        cardId: canvasPageCardId,
        kind: "page",
        targetItemId,
        x: 420,
        y: -120,
        width: 280,
        height: 180,
      },
    ]) ||
    !isDeepStrictEqual(persistedCanvasAttrs.connections, [
      {
        connectionId: canvasConnectionId,
        sourceCardId: canvasTextCardId,
        targetCardId: canvasPageCardId,
        label: "documents",
      },
    ]) ||
    !isDeepStrictEqual(persistedCanvasAttrs.strokes, [
      {
        strokeId: canvasStrokeId,
        width: 8,
        points: [
          { x: -40, y: 20 },
          { x: 10, y: 90 },
          { x: 180, y: 30 },
        ],
      },
    ]) ||
    !isDeepStrictEqual(persistedCanvasAttrs.viewport, { x: -160, y: 240, zoom: 1.5 })
  ) {
    throw new Error("Restarted composition did not preserve the complete canvas atom");
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
  const persistedCanvasPage = persistedRelationships.relationships.find(
    (relationship) => relationship.id === canvasPageCardId,
  );
  if (
    persistedCanvasPage?.sourceItemId !== itemId ||
    persistedCanvasPage.targetItemId !== targetItemId ||
    persistedCanvasPage.relationType !== "link:references"
  ) {
    throw new Error("Restarted composition did not preserve the canvas page-card relationship");
  }

  const sourceExport = await createCanonicalExport(webBaseUrl);
  compose("run", "--rm", "--entrypoint", "restic", "backup-operations", "init");
  const createdBackup = expectOperationSuccess(
    sourceContext,
    "backup-operations",
    "backup",
    "create",
  );
  const backupSnapshotId = createdBackup.snapshotId;
  if (backupSnapshotId === undefined) {
    throw new Error("Complete backup returned no snapshot identity");
  }
  const listedBackups = expectOperationSuccess(
    sourceContext,
    "backup-operations",
    "backup",
    "list",
  );
  if (
    listedBackups.snapshots?.some((snapshot) => snapshot.snapshotId === backupSnapshotId) !== true
  ) {
    throw new Error("Complete backup was absent from the selectable snapshot list");
  }
  expectOperationSuccess(sourceContext, "backup-operations", "backup", "check", "--read-data");

  writeFileSync(resticPasswordPath, "intentionally-wrong-password\n", { mode: 0o644 });
  const wrongSecret = runOperation(
    restoreContext,
    "backup-operations",
    "restore",
    "verify",
    "--snapshot",
    backupSnapshotId,
  );
  if (
    wrongSecret.exitCode === 0 ||
    wrongSecret.result.status !== "failed" ||
    /container-smoke-restic-password|intentionally-wrong-password|storageKey|DATABASE_URL/.test(
      wrongSecret.serialized,
    )
  ) {
    throw new Error("Wrong-secret restore verification did not fail safely");
  }
  writeFileSync(resticPasswordPath, "container-smoke-restic-password\n", { mode: 0o644 });

  expectOperationSuccess(
    restoreContext,
    "backup-operations",
    "restore",
    "verify",
    "--snapshot",
    backupSnapshotId,
  );
  const appliedRestore = expectOperationSuccess(
    restoreContext,
    "backup-operations",
    "restore",
    "apply",
    "--snapshot",
    backupSnapshotId,
    "--confirm-empty",
  );
  if (appliedRestore.counts?.["objects"] !== 1) {
    throw new Error("Restore did not report the complete file-object inventory");
  }

  start(false, restoreContext);
  const restoreWebBaseUrl = `http://127.0.0.1:${restoreWebPort}`;
  const restoreApiBaseUrl = `http://127.0.0.1:${restoreApiPort}`;
  const restoredExport = await createCanonicalExport(restoreWebBaseUrl);
  if (validateCanonicalRecovery(sourceExport, restoredExport).length !== 0) {
    throw new Error("Clean-target restore changed the canonical export");
  }
  await expectExactFile(
    `${restoreWebBaseUrl}/v1/files/${fileItemId}/content?revisionId=${fileRevisionId}`,
    fileBytes,
  );

  composeFor(restoreContext, "down", "--remove-orphans");
  start(false, restoreContext);
  const restartedRestoreExport = await createCanonicalExport(restoreWebBaseUrl);
  if (validateCanonicalRecovery(sourceExport, restartedRestoreExport).length !== 0) {
    throw new Error("Restored canonical export changed after target restart");
  }
  await expectExactFile(
    `${restoreWebBaseUrl}/v1/files/${fileItemId}/content?revisionId=${fileRevisionId}`,
    fileBytes,
  );

  compose(
    "run",
    "--rm",
    "--entrypoint",
    "sh",
    "backup-operations",
    "-c",
    'pack=$(find /var/lib/myownnotion/backup-destination/data -type f | head -n 1); test -n "$pack"; printf \'CORRUPTED-RESTIC\' | dd of="$pack" bs=1 seek=0 conv=notrunc',
  );
  const corrupted = runOperation(
    restoreContext,
    "backup-operations",
    "restore",
    "verify",
    "--snapshot",
    backupSnapshotId,
  );
  if (corrupted.exitCode === 0 || corrupted.result.status !== "failed") {
    throw new Error("Corrupted encrypted repository was accepted for restore");
  }
  composeFor(
    restoreContext,
    "run",
    "--rm",
    "--entrypoint",
    "sh",
    "operations",
    "-c",
    "test ! -e /var/lib/myownnotion/operations/.restore-in-progress",
  );

  composeFor(restoreContext, "stop", "api", "web");
  composeFor(
    restoreContext,
    "run",
    "--rm",
    "--entrypoint",
    "sh",
    "operations",
    "-c",
    "touch /var/lib/myownnotion/operations/.restore-in-progress",
  );
  composeFor(restoreContext, "up", "--detach", "--force-recreate", "api");
  await new Promise((resolve) => setTimeout(resolve, 2_000));
  let guardedReady = false;
  try {
    guardedReady = (await fetch(`${restoreApiBaseUrl}/health`)).ok;
  } catch {
    guardedReady = false;
  }
  const guardedLogs = composeOutputFor(restoreContext, "logs", "--no-color", "api");
  if (
    guardedReady ||
    !guardedLogs.includes("restore is in progress") ||
    /\.restore-in-progress|container-smoke-restic-password|DATABASE_URL/.test(guardedLogs)
  ) {
    throw new Error("Restore guard did not block API readiness with a redacted diagnostic");
  }
  composeFor(restoreContext, "stop", "api");
  composeFor(
    restoreContext,
    "run",
    "--rm",
    "--entrypoint",
    "sh",
    "operations",
    "-c",
    "rm /var/lib/myownnotion/operations/.restore-in-progress",
  );
  start(false, restoreContext);
  const recoveredHealth = await expectJson<{ status: string }>(`${restoreApiBaseUrl}/health`);
  if (recoveredHealth.status !== "ready") {
    throw new Error("API did not recover after the isolated guard rehearsal");
  }

  console.info(
    "Container smoke test passed: private object storage, encrypted backup, clean-target exact restore/restart, wrong-secret/corruption faults, restore guard, audit, health proxy, migrations, and v6 wiki/task/database/canvas persistence.",
  );
} catch (error) {
  console.error("Container smoke test failed:", error);
  process.exitCode = 1;
} finally {
  // A failed start can still leave partial resources in this isolated project.
  try {
    composeFor(restoreContext, "down", "--volumes", "--remove-orphans");
  } catch (cleanupError) {
    console.error("Restore smoke cleanup failed:", cleanupError);
    process.exitCode = 1;
  }
  try {
    compose("down", "--volumes", "--remove-orphans");
  } catch (cleanupError) {
    console.error("Container smoke cleanup failed:", cleanupError);
    process.exitCode = 1;
  }
  rmSync(backupHostRoot, { recursive: true, force: true });
}
