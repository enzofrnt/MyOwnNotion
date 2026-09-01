import { randomBytes, scryptSync } from "node:crypto";
import { generateUuidV7, type MutationCommand, type Uuid } from "@myownnotion/domain";
import pg from "pg";
import {
  assertKnowledgeGraphDemoTarget,
  buildKnowledgeGraphDemoFixture,
  DEMO_CONFIRMATION,
  DEMO_EXPECTED,
  DEMO_PASSWORD,
  DEMO_PUBLIC_ORIGIN,
} from "./knowledge-graph-demo-fixture.ts";

const databaseUrl = process.env["DATABASE_URL"] ?? "";
const apiOrigin = "http://127.0.0.1:3001";
const demoDeviceBindingId = "web-39a88270-225f-4ec4-9548-aebfa39fb55e";
const protocolHeaders = {
  origin: DEMO_PUBLIC_ORIGIN,
  "x-forwarded-host": "localhost:8443",
  "x-forwarded-proto": "https",
  "x-myownnotion-client-protocol": "3",
};

function fail(message: string): never {
  throw new Error(`knowledge graph demo seed failed: ${message}`);
}

function encodePassword(password: string): string {
  const N = 16_384;
  const r = 8;
  const p = 1;
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, 64, { N, r, p, maxmem: 256 * N * r });
  return [
    "scrypt",
    String(N),
    String(r),
    String(p),
    salt.toString("base64url"),
    derived.toString("base64url"),
  ].join("$");
}

async function responseJson(response: Response): Promise<Record<string, unknown>> {
  const body = (await response.json()) as Record<string, unknown>;
  if (!response.ok) fail(`${response.status} ${JSON.stringify(body)}`);
  return body;
}

interface BatchResult {
  readonly mutationId: Uuid;
  readonly status: "accepted" | "already-accepted" | "rejected" | "conflict";
  readonly revisionIds?: readonly Uuid[];
  readonly problem?: unknown;
}

interface AuthenticatedApi {
  readonly headers: Record<string, string>;
  batch(commands: readonly MutationCommand[]): Promise<readonly BatchResult[]>;
}

async function authenticate(): Promise<AuthenticatedApi> {
  const login = await fetch(`${apiOrigin}/v1/auth/login/password`, {
    method: "POST",
    headers: { ...protocolHeaders, "content-type": "application/json" },
    body: JSON.stringify({
      password: DEMO_PASSWORD,
      device: {
        deviceBindingId: demoDeviceBindingId,
        name: "Navigateur de démonstration",
        platform: "Local development",
      },
    }),
  });
  const body = await responseJson(login);
  const cookie = login.headers.get("set-cookie")?.split(";", 1)[0];
  const csrfToken = body["csrfToken"];
  if (cookie === undefined || typeof csrfToken !== "string") fail("login returned no session");
  const headers = {
    ...protocolHeaders,
    cookie,
    "x-csrf-token": csrfToken,
  };
  return {
    headers,
    batch: async (commands) => {
      const results: BatchResult[] = [];
      for (let start = 0; start < commands.length; start += 40) {
        const chunk = commands.slice(start, start + 40);
        const response = await fetch(`${apiOrigin}/v1/mutations/batch`, {
          method: "POST",
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify({
            mutations: chunk.map((command) => {
              const { type, ...payload } = command;
              return {
                mutationId: generateUuidV7(),
                commandType: type,
                baseRevisionIds: [],
                payload,
              };
            }),
          }),
        });
        const responseBody = await responseJson(response);
        const chunkResults = responseBody["results"];
        if (!Array.isArray(chunkResults)) fail("mutation batch returned no results");
        for (const result of chunkResults as BatchResult[]) {
          if (result.status !== "accepted" && result.status !== "already-accepted") {
            fail(
              `mutation ${result.mutationId} was ${result.status}: ${JSON.stringify(result.problem)}`,
            );
          }
          results.push(result);
        }
      }
      return results;
    },
  };
}

async function createOwner(
  client: pg.Client,
  installationId: string,
  workspaceId: string,
): Promise<void> {
  const ownerId = generateUuidV7();
  const deviceId = generateUuidV7();
  await client.query("BEGIN");
  try {
    await client.query(
      `INSERT INTO owners (id, installation_id, state) VALUES ($1, $2, 'active')`,
      [ownerId, installationId],
    );
    await client.query(
      `UPDATE installations
          SET state = 'ready', owner_id = $1, workspace_id = $2, updated_at = now()
        WHERE id = $3`,
      [ownerId, workspaceId, installationId],
    );
    await client.query(
      `INSERT INTO authorized_devices (id, owner_id, device_binding_id, name, state)
       VALUES ($1, $2, $3, 'Navigateur de démonstration', 'active')`,
      [deviceId, ownerId, demoDeviceBindingId],
    );
    await client.query(
      `INSERT INTO password_credential_versions
         (id, owner_id, password_hash, hash_algorithm, state)
       VALUES ($1, $2, $3, 'scrypt', 'active')`,
      [generateUuidV7(), ownerId, encodePassword(DEMO_PASSWORD)],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

function itemCommands(
  fixture: ReturnType<typeof buildKnowledgeGraphDemoFixture>,
): MutationCommand[] {
  return fixture.items
    .filter(({ role }) => role === "folder" || role === "page")
    .map((item, index) => ({
      type: "item.create" as const,
      id: item.id,
      kind: item.kind as "page" | "folder",
      name: item.name,
      placement: {
        id: generateUuidV7(),
        kind: "hierarchy" as const,
        parentItemId: item.parentId,
        positionKey: `D${index.toString(36)}x`,
      },
    }));
}

function databaseDefinition(fixture: ReturnType<typeof buildKnowledgeGraphDemoFixture>) {
  const database = fixture.database;
  const propertyPresentation = [
    { propertyId: database.titlePropertyId, visible: true, positionKey: "a" },
    { propertyId: database.statusPropertyId, visible: true, positionKey: "b" },
    { propertyId: database.dueDatePropertyId, visible: true, positionKey: "c" },
    { propertyId: database.priorityPropertyId, visible: true, positionKey: "d" },
  ];
  const options = (values: readonly { readonly id: Uuid; readonly label: string }[]) =>
    values.map((option, index) => ({
      ...option,
      positionKey: String.fromCharCode(97 + index),
      tone: ["slate", "blue", "amber", "green"][index] ?? "slate",
      state: "active" as const,
    }));
  return {
    format: "myownnotion.database-definition+json" as const,
    formatVersion: 1 as const,
    databaseId: database.itemId,
    properties: [
      {
        id: database.titlePropertyId,
        name: "Titre",
        type: "title" as const,
        positionKey: "a",
        state: "active" as const,
        config: {},
      },
      {
        id: database.statusPropertyId,
        name: "Statut",
        type: "status" as const,
        positionKey: "b",
        state: "active" as const,
        config: { options: options(database.statusOptions) },
      },
      {
        id: database.dueDatePropertyId,
        name: "Échéance",
        type: "date" as const,
        positionKey: "c",
        state: "active" as const,
        config: { mode: "date" as const },
      },
      {
        id: database.priorityPropertyId,
        name: "Priorité",
        type: "select" as const,
        positionKey: "d",
        state: "active" as const,
        config: { options: options(database.priorityOptions) },
      },
    ],
    views: [
      {
        id: database.viewId,
        name: "Livraison",
        type: "table" as const,
        positionKey: "a",
        state: "active" as const,
        properties: propertyPresentation,
        filter: { mode: "all" as const, criteria: [] },
        sorts: [],
        group: null,
        options: { density: "comfortable" as const, freezeTitle: true },
      },
    ],
    taskRoles: {
      statusPropertyId: database.statusPropertyId,
      dueDatePropertyId: database.dueDatePropertyId,
      priorityPropertyId: database.priorityPropertyId,
    },
  };
}

async function uploadDemoFile(
  api: AuthenticatedApi,
  fixture: ReturnType<typeof buildKnowledgeGraphDemoFixture>,
): Promise<void> {
  const file = fixture.items.find(({ role }) => role === "file");
  if (file === undefined || file.parentId === null) fail("fixture file has no attachment parent");
  const form = new FormData();
  form.append(
    "file",
    new File(
      ["# Jeu de données Knowledge Graph\n\nFichier factice attaché au workspace local.\n"],
      file.name,
      { type: "text/markdown" },
    ),
  );
  form.append("itemId", file.id);
  form.append(
    "placement",
    JSON.stringify({ kind: "attachment", parentItemId: file.parentId, positionKey: "Dfilex" }),
  );
  const response = await fetch(`${apiOrigin}/v1/files`, {
    method: "POST",
    headers: { ...api.headers, "idempotency-key": generateUuidV7() },
    body: form,
  });
  await responseJson(response);
}

async function verifyDemo(
  client: pg.Client,
  fixture: ReturnType<typeof buildKnowledgeGraphDemoFixture>,
  api: AuthenticatedApi,
): Promise<void> {
  const { rows } = await client.query<{
    item_count: string;
    relationship_count: string;
    document_count: string;
    explicit_count: string;
    folder_count: string;
    entry_count: string;
    file_count: string;
    trashed_count: string;
    orphan_count: string;
    duplicate_count: string;
    reciprocal_count: string;
    owner_count: string;
    password_count: string;
    session_count: string;
    device_count: string;
    attachment_count: string;
  }>(`
    SELECT
      (SELECT count(*) FROM items)::text AS item_count,
      (SELECT count(*) FROM relationships WHERE removed_revision_id IS NULL)::text AS relationship_count,
      (SELECT count(*) FROM relationships WHERE removed_revision_id IS NULL AND relation_type = 'page:link')::text AS document_count,
      (SELECT count(*) FROM relationships WHERE removed_revision_id IS NULL AND relation_type <> 'page:link')::text AS explicit_count,
      (SELECT count(*) FROM items WHERE kind = 'folder')::text AS folder_count,
      (SELECT count(*) FROM database_entries)::text AS entry_count,
      (SELECT count(*) FROM logical_files)::text AS file_count,
      (SELECT count(*) FROM items WHERE lifecycle = 'trashed')::text AS trashed_count,
      (SELECT count(*) FROM relationships r
        LEFT JOIN items source ON source.id = r.source_item_id
        LEFT JOIN items target ON target.id = r.target_item_id
        WHERE source.id IS NULL OR target.id IS NULL)::text AS orphan_count,
      (SELECT count(*) FROM (
        SELECT source_item_id, target_item_id, relation_type
          FROM relationships WHERE removed_revision_id IS NULL
          GROUP BY source_item_id, target_item_id, relation_type HAVING count(*) > 1
      ) duplicates)::text AS duplicate_count,
      (SELECT count(*) FROM relationships first
        JOIN relationships reverse
          ON reverse.source_item_id = first.target_item_id
         AND reverse.target_item_id = first.source_item_id
         AND reverse.removed_revision_id IS NULL
        WHERE first.removed_revision_id IS NULL)::text AS reciprocal_count,
      (SELECT count(*) FROM owners WHERE state = 'active')::text AS owner_count,
      (SELECT count(*) FROM password_credential_versions WHERE state = 'active')::text AS password_count,
      (SELECT count(*) FROM sessions WHERE state = 'active')::text AS session_count,
      (SELECT count(*) FROM authorized_devices WHERE state = 'active')::text AS device_count,
      (SELECT count(*) FROM placements WHERE kind = 'attachment' AND removed_at IS NULL)::text AS attachment_count
  `);
  const row = rows[0];
  if (
    Number(row?.item_count) !== DEMO_EXPECTED.items ||
    Number(row?.relationship_count) !== DEMO_EXPECTED.relationships ||
    Number(row?.document_count) !== DEMO_EXPECTED.documentRelationships ||
    Number(row?.explicit_count) !== DEMO_EXPECTED.explicitRelationships ||
    Number(row?.folder_count) !== DEMO_EXPECTED.folders ||
    Number(row?.entry_count) !== DEMO_EXPECTED.tasks ||
    Number(row?.file_count) !== DEMO_EXPECTED.files ||
    Number(row?.trashed_count) !== DEMO_EXPECTED.trashedItems ||
    Number(row?.orphan_count) !== 0 ||
    Number(row?.duplicate_count) < 1 ||
    Number(row?.reciprocal_count) < 1 ||
    Number(row?.owner_count) !== 1 ||
    Number(row?.password_count) !== 1 ||
    Number(row?.session_count) !== 1 ||
    Number(row?.device_count) !== 1 ||
    Number(row?.attachment_count) !== 1
  ) {
    fail(`verification mismatch: ${JSON.stringify(row)}`);
  }
  const isolated = await client.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM items i
       JOIN placements p ON p.item_id = i.id AND p.removed_at IS NULL
      WHERE i.id = ANY($1::uuid[]) AND p.parent_item_id IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM relationships r
           WHERE r.removed_revision_id IS NULL
             AND (r.source_item_id = i.id OR r.target_item_id = i.id)
        )`,
    [fixture.isolatedItemIds],
  );
  if (Number(isolated.rows[0]?.count) !== DEMO_EXPECTED.isolatedItems) {
    fail("the eight root isolation cases were not preserved");
  }
  const future = await client.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM relationships
      WHERE relation_type = 'future:semantic' AND removed_revision_id IS NULL`,
  );
  if (Number(future.rows[0]?.count) < 1) fail("future relation type is missing");

  const storedDocumentLinks = await client.query<{ source_id: string; target_id: string }>(`
    SELECT source_item_id::text AS source_id, target_item_id::text AS target_id
      FROM relationships
     WHERE relation_type = 'page:link' AND removed_revision_id IS NULL
     ORDER BY source_item_id, target_item_id
  `);
  const storedDocumentLinkKeys = storedDocumentLinks.rows.map(
    ({ source_id: sourceId, target_id: targetId }) => `${sourceId}/${targetId}`,
  );
  const expectedDocumentLinkKeys = fixture.relationships
    .filter(({ origin }) => origin === "document")
    .map(({ sourceItemId, targetItemId }) => `${sourceItemId}/${targetItemId}`)
    .sort();
  if (
    storedDocumentLinkKeys.length !== expectedDocumentLinkKeys.length ||
    storedDocumentLinkKeys.some((key, index) => key !== expectedDocumentLinkKeys[index])
  ) {
    fail("the stored page:link graph does not match the links authored in the demo documents");
  }

  const crossBranchIds = fixture.relationships
    .filter(({ origin, crossBranch }) => origin === "explicit" && crossBranch)
    .map(({ id }) => id);
  const crossBranch = await client.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM relationships
      WHERE id = ANY($1::uuid[]) AND removed_revision_id IS NULL`,
    [crossBranchIds],
  );
  if (crossBranchIds.length === 0 || Number(crossBranch.rows[0]?.count) !== crossBranchIds.length) {
    fail("cross-branch relationships are incomplete");
  }

  const topology = await client.query<{ source_id: string; target_id: string }>(`
    SELECT source_item_id::text AS source_id, target_item_id::text AS target_id
      FROM relationships
     WHERE removed_revision_id IS NULL AND relation_type = 'page:link'
  `);
  const adjacency = new Map<string, Set<string>>();
  for (const { source_id: sourceId, target_id: targetId } of topology.rows) {
    const sourceNeighbors = adjacency.get(sourceId) ?? new Set<string>();
    const targetNeighbors = adjacency.get(targetId) ?? new Set<string>();
    sourceNeighbors.add(targetId);
    targetNeighbors.add(sourceId);
    adjacency.set(sourceId, sourceNeighbors);
    adjacency.set(targetId, targetNeighbors);
  }
  const remaining = new Set(
    fixture.items
      .filter(({ role, branchIndex }) => role === "page" && branchIndex !== null)
      .map(({ id }) => id as string),
  );
  let componentCount = 0;
  while (remaining.size > 0) {
    componentCount += 1;
    const first = remaining.values().next().value;
    if (first === undefined) break;
    remaining.delete(first);
    const stack = [first];
    while (stack.length > 0) {
      const current = stack.pop();
      if (current === undefined) break;
      for (const neighbor of adjacency.get(current) ?? []) {
        if (remaining.delete(neighbor)) stack.push(neighbor);
      }
    }
  }
  if (componentCount !== 1) {
    fail("the content-authored page graph must form one connected knowledge component");
  }

  const response = await fetch(`${apiOrigin}/v1/databases/${fixture.database.itemId}`, {
    headers: api.headers,
  });
  const database = await responseJson(response);
  const definition = database["definition"] as
    | { taskRoles?: unknown; properties?: unknown[] }
    | undefined;
  if (
    definition?.taskRoles === null ||
    definition?.taskRoles === undefined ||
    definition.properties?.length !== 4
  ) {
    fail("structured task roles were not readable through the authenticated API");
  }
  const taskEntries = await Promise.all(
    fixture.tasks.map(async (task) => {
      const entryResponse = await fetch(
        `${apiOrigin}/v1/databases/${fixture.database.itemId}/entries/${task.itemId}`,
        { headers: api.headers },
      );
      return await responseJson(entryResponse);
    }),
  );
  const structuredValuesValid = taskEntries.every((entry, index) => {
    const values = entry["values"] as Record<string, Record<string, unknown>> | undefined;
    const task = fixture.tasks[index];
    return (
      task !== undefined &&
      values?.[fixture.database.statusPropertyId]?.["optionId"] === task.statusOptionId &&
      values?.[fixture.database.dueDatePropertyId]?.["date"] === task.dueDate &&
      values?.[fixture.database.priorityPropertyId]?.["optionId"] === task.priorityOptionId
    );
  });
  if (!structuredValuesValid) fail("one or more structured task values are incomplete");
}

async function main(): Promise<void> {
  if (databaseUrl.length === 0) fail("DATABASE_URL is missing");
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const initial = await client.query<{
      installation_id: string;
      workspace_id: string;
      installation_count: string;
      owner_count: string;
      item_count: string;
    }>(`
      SELECT
        (SELECT id::text FROM installations LIMIT 1) AS installation_id,
        (SELECT id::text FROM workspaces LIMIT 1) AS workspace_id,
        (SELECT count(*) FROM installations)::text AS installation_count,
        (SELECT count(*) FROM owners)::text AS owner_count,
        (SELECT count(*) FROM items)::text AS item_count
    `);
    const state = initial.rows[0];
    if (state?.installation_id === undefined || state.workspace_id === undefined) {
      fail("the disposable installation has not been initialized by the API");
    }
    assertKnowledgeGraphDemoTarget({
      confirmation: process.env["MYOWNNOTION_DEMO_CONFIRMATION"] ?? "",
      nodeEnv: process.env["NODE_ENV"],
      publicOrigin: process.env["MYOWNNOTION_PUBLIC_ORIGIN"],
      databaseUrl,
      installationCount: Number(state.installation_count),
      ownerCount: Number(state.owner_count),
      itemCount: Number(state.item_count),
    });
    await createOwner(client, state.installation_id, state.workspace_id);
    const api = await authenticate();
    const fixture = buildKnowledgeGraphDemoFixture();

    const creates = itemCommands(fixture);
    const createResults = await api.batch(creates);
    const revisions = new Map<Uuid, Uuid>();
    creates.forEach((command, index) => {
      if (command.type !== "item.create") return;
      const revision = createResults[index]?.revisionIds?.[0];
      if (revision === undefined) fail(`creation returned no revision for ${command.id}`);
      revisions.set(command.id, revision);
    });

    const database = fixture.database;
    const databaseCreate: MutationCommand = {
      type: "database.create",
      id: database.itemId,
      name: "Plan de livraison",
      placement: {
        id: generateUuidV7(),
        parentItemId: fixture.items.find(({ id }) => id === database.itemId)?.parentId ?? null,
        positionKey: "Ddatabasex",
      },
      titlePropertyId: database.titlePropertyId,
      titlePropertyName: "Titre",
      initialViewId: database.viewId,
      initialViewName: "Livraison",
    };
    const databaseCreated = await api.batch([databaseCreate]);
    const databaseRevision = databaseCreated[0]?.revisionIds?.[0];
    if (databaseRevision === undefined) fail("database creation returned no revision");
    await api.batch([
      {
        type: "database.definition.replace",
        databaseId: database.itemId,
        baseRevisionId: databaseRevision,
        definition: databaseDefinition(fixture),
      },
    ]);

    await api.batch(
      fixture.tasks.map((task, index) => ({
        type: "database.entry.create" as const,
        databaseId: database.itemId,
        id: task.itemId,
        title: fixture.items.find(({ id }) => id === task.itemId)?.name ?? `Tâche ${index + 1}`,
        placement: {
          id: generateUuidV7(),
          parentItemId: database.itemId,
          positionKey: `T${index.toString(36)}x`,
        },
        values: {
          [database.statusPropertyId]: { kind: "status" as const, optionId: task.statusOptionId },
          [database.dueDatePropertyId]: { kind: "date" as const, date: task.dueDate },
          [database.priorityPropertyId]: {
            kind: "select" as const,
            optionId: task.priorityOptionId,
          },
        },
        relationTargets: {},
      })),
    );
    await uploadDemoFile(api, fixture);

    const documentCommands: MutationCommand[] = fixture.documents.map((document) => {
      const baseRevisionId = revisions.get(document.itemId);
      if (baseRevisionId === undefined) fail(`page ${document.itemId} has no base revision`);
      return {
        type: "page.document.replace",
        itemId: document.itemId,
        baseRevisionId,
        document: {
          format: "myownnotion.document+json",
          formatVersion: 2,
          body: {
            blocks: [
              {
                type: "heading",
                id: generateUuidV7(),
                level: 2,
                content: [{ text: document.heading }],
              },
              {
                type: "paragraph",
                id: generateUuidV7(),
                content: [{ text: document.summary }],
              },
              ...document.links.map((link) => ({
                type: "paragraph" as const,
                id: generateUuidV7(),
                content: [
                  { text: `${link.leadIn} : ` },
                  {
                    text: link.targetName,
                    marks: [{ type: "pageLink" as const, targetItemId: link.targetItemId }],
                  },
                  { text: "." },
                ],
              })),
            ],
          },
        },
        pageLinkTargetIds: document.links.map(({ targetItemId }) => targetItemId),
      };
    });
    await api.batch(documentCommands);
    await api.batch(
      fixture.relationships
        .filter(({ origin }) => origin === "explicit")
        .map(({ id, sourceItemId, targetItemId, relationType }, index) => ({
          type: "relationship.create" as const,
          id,
          sourceItemId,
          targetItemId,
          relationType,
          metadata: { scenario: "knowledge-graph-demo", sequence: index + 1 },
        })),
    );
    await api.batch([{ type: "item.trash", itemId: fixture.trashedItemId }]);
    await verifyDemo(client, fixture, api);

    console.info("Knowledge Graph demo workspace is ready and verified.");
    console.info(`Open: ${DEMO_PUBLIC_ORIGIN}`);
    console.info(`Demo password: ${DEMO_PASSWORD}`);
    console.info("Clear the browser site data before testing a redeployment.");
  } finally {
    await client.end();
  }
}

await main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  console.error(
    `The demo was not declared ready. Rerun the full reset command with ${DEMO_CONFIRMATION}.`,
  );
  process.exit(1);
});
