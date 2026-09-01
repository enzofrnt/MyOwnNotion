import { generateUuidV7, type Uuid } from "@myownnotion/domain";

export const DEMO_PASSWORD = "knowledge-graph-demo";
export const DEMO_CONFIRMATION = "RESET_LOCAL_KNOWLEDGE_GRAPH_DEMO";
export const DEMO_PUBLIC_ORIGIN = "https://localhost:8443";

export const DEMO_EXPECTED = {
  items: 240,
  relationships: 480,
  documentRelationships: 120,
  explicitRelationships: 360,
  folders: 8,
  pages: 190,
  databases: 1,
  tasks: 40,
  files: 1,
  isolatedItems: 8,
  trashedItems: 1,
} as const;

export type DemoItemRole = "folder" | "page" | "database" | "task" | "file";

export interface DemoItem {
  readonly id: Uuid;
  readonly role: DemoItemRole;
  readonly kind: "page" | "folder" | "file";
  readonly name: string;
  readonly parentId: Uuid | null;
  readonly branchIndex: number | null;
}

export interface DemoRelationship {
  readonly id: Uuid;
  readonly sourceItemId: Uuid;
  readonly targetItemId: Uuid;
  readonly relationType: string;
  readonly origin: "document" | "explicit";
  readonly crossBranch: boolean;
}

export interface DemoTask {
  readonly itemId: Uuid;
  readonly status: string;
  readonly statusOptionId: Uuid;
  readonly dueDate: string;
  readonly priority: string;
  readonly priorityOptionId: Uuid;
}

export interface KnowledgeGraphDemoFixture {
  readonly summary: typeof DEMO_EXPECTED;
  readonly items: readonly DemoItem[];
  readonly relationships: readonly DemoRelationship[];
  readonly tasks: readonly DemoTask[];
  readonly isolatedItemIds: readonly Uuid[];
  readonly trashedItemId: Uuid;
  readonly database: {
    readonly itemId: Uuid;
    readonly titlePropertyId: Uuid;
    readonly statusPropertyId: Uuid;
    readonly dueDatePropertyId: Uuid;
    readonly priorityPropertyId: Uuid;
    readonly statusOptions: readonly { readonly id: Uuid; readonly label: string }[];
    readonly priorityOptions: readonly { readonly id: Uuid; readonly label: string }[];
    readonly viewId: Uuid;
  };
}

const BRANCH_NAMES = [
  "Produit",
  "Recherche",
  "Design",
  "Architecture",
  "Livraison",
  "Qualité",
  "Support",
  "Décisions",
] as const;

const PAGE_TOPICS = [
  "Vision",
  "Hypothèse",
  "Parcours",
  "Décision",
  "Expérience",
  "Composant",
  "Risque",
  "Compte rendu",
] as const;

function branchOf(items: ReadonlyMap<Uuid, DemoItem>, itemId: Uuid): number | null {
  return items.get(itemId)?.branchIndex ?? null;
}

export function buildKnowledgeGraphDemoFixture(
  idFactory: () => Uuid = generateUuidV7,
): KnowledgeGraphDemoFixture {
  const folders: DemoItem[] = BRANCH_NAMES.map((name, branchIndex) => ({
    id: idFactory(),
    role: "folder",
    kind: "folder",
    name,
    parentId: null,
    branchIndex,
  }));
  const pages: DemoItem[] = Array.from({ length: DEMO_EXPECTED.pages }, (_, index) => {
    const isolated = index >= DEMO_EXPECTED.pages - DEMO_EXPECTED.isolatedItems;
    const branchIndex = isolated ? null : index % folders.length;
    return {
      id: idFactory(),
      role: "page",
      kind: "page",
      name: isolated
        ? `Démo isolée ${index - (DEMO_EXPECTED.pages - DEMO_EXPECTED.isolatedItems) + 1}`
        : `${PAGE_TOPICS[index % PAGE_TOPICS.length]} ${Math.floor(index / folders.length) + 1}`,
      parentId: branchIndex === null ? null : (folders[branchIndex]?.id ?? null),
      branchIndex,
    };
  });
  const databaseItem: DemoItem = {
    id: idFactory(),
    role: "database",
    kind: "page",
    name: "Plan de livraison",
    parentId: folders[4]?.id ?? null,
    branchIndex: 4,
  };
  const taskItems: DemoItem[] = Array.from({ length: DEMO_EXPECTED.tasks }, (_, index) => ({
    id: idFactory(),
    role: "task",
    kind: "page",
    name: `Tâche ${String(index + 1).padStart(2, "0")} — ${PAGE_TOPICS[index % PAGE_TOPICS.length]}`,
    parentId: databaseItem.id,
    branchIndex: 4,
  }));
  const fileItem: DemoItem = {
    id: idFactory(),
    role: "file",
    kind: "file",
    name: "jeu-de-donnees-knowledge-graph.md",
    parentId: pages[0]?.id ?? null,
    branchIndex: pages[0]?.branchIndex ?? 0,
  };
  const items = [...folders, ...pages, databaseItem, ...taskItems, fileItem];
  const byId = new Map(items.map((item) => [item.id, item]));
  const connected = items.filter((item) => item.role !== "page" || item.branchIndex !== null);
  const relationships: DemoRelationship[] = [];

  for (let sourceIndex = 0; sourceIndex < 40; sourceIndex += 1) {
    const source = pages[sourceIndex];
    if (source === undefined) throw new Error("demo fixture has no document source");
    for (let offset = 1; offset <= 3; offset += 1) {
      const target = pages[(sourceIndex * 5 + offset * 11) % 182];
      if (target === undefined) throw new Error("demo fixture has no document target");
      relationships.push({
        id: idFactory(),
        sourceItemId: source.id,
        targetItemId: target.id,
        relationType: "page:link",
        origin: "document",
        crossBranch: branchOf(byId, source.id) !== branchOf(byId, target.id),
      });
    }
  }

  const addExplicit = (source: DemoItem, target: DemoItem, relationType: string): void => {
    relationships.push({
      id: idFactory(),
      sourceItemId: source.id,
      targetItemId: target.id,
      relationType,
      origin: "explicit",
      crossBranch: branchOf(byId, source.id) !== branchOf(byId, target.id),
    });
  };
  const first = pages[0];
  const second = pages[1];
  const crossBranch = pages[31];
  const futureTarget = pages[70];
  if (
    first === undefined ||
    second === undefined ||
    crossBranch === undefined ||
    futureTarget === undefined
  ) {
    throw new Error("demo fixture does not contain its required graph anchors");
  }
  addExplicit(first, second, "demo:supports");
  addExplicit(first, second, "demo:supports");
  addExplicit(second, first, "demo:supports");
  addExplicit(first, crossBranch, "demo:depends-on");
  addExplicit(second, futureTarget, "future:semantic");

  const explicitTypes = ["demo:supports", "demo:depends-on", "link:references"] as const;
  while (
    relationships.filter(({ origin }) => origin === "explicit").length <
    DEMO_EXPECTED.explicitRelationships
  ) {
    const index = relationships.filter(({ origin }) => origin === "explicit").length;
    const source = connected[index % connected.length];
    let target = connected[(index * 7 + 13) % connected.length];
    if (source === undefined || target === undefined) throw new Error("demo fixture is incomplete");
    if (source.id === target.id) target = connected[(index * 7 + 14) % connected.length] ?? target;
    addExplicit(source, target, explicitTypes[index % explicitTypes.length] ?? "demo:supports");
  }

  const statusOptions = ["À faire", "En cours", "Bloquée", "Terminée"].map((label) => ({
    id: idFactory(),
    label,
  }));
  const priorityOptions = ["Basse", "Normale", "Haute"].map((label) => ({
    id: idFactory(),
    label,
  }));
  const tasks: DemoTask[] = taskItems.map((item, index) => {
    const status = statusOptions[index % statusOptions.length];
    const priority = priorityOptions[index % priorityOptions.length];
    if (status === undefined || priority === undefined)
      throw new Error("demo task options are missing");
    return {
      itemId: item.id,
      status: status.label,
      statusOptionId: status.id,
      dueDate: `2026-${String((index % 12) + 1).padStart(2, "0")}-${String((index % 27) + 1).padStart(2, "0")}`,
      priority: priority.label,
      priorityOptionId: priority.id,
    };
  });

  return {
    summary: DEMO_EXPECTED,
    items,
    relationships,
    tasks,
    isolatedItemIds: pages.slice(-DEMO_EXPECTED.isolatedItems).map(({ id }) => id),
    trashedItemId: pages[7]?.id ?? first.id,
    database: {
      itemId: databaseItem.id,
      titlePropertyId: idFactory(),
      statusPropertyId: idFactory(),
      dueDatePropertyId: idFactory(),
      priorityPropertyId: idFactory(),
      statusOptions,
      priorityOptions,
      viewId: idFactory(),
    },
  };
}

export interface DemoTarget {
  readonly confirmation: string;
  readonly nodeEnv: string | undefined;
  readonly publicOrigin: string | undefined;
  readonly databaseUrl: string;
  readonly installationCount: number;
  readonly ownerCount: number;
  readonly itemCount: number;
}

export function assertKnowledgeGraphDemoTarget(target: DemoTarget): void {
  if (target.confirmation !== DEMO_CONFIRMATION) {
    throw new Error(`demo reset requires the exact confirmation ${DEMO_CONFIRMATION}`);
  }
  if (target.nodeEnv !== "development") {
    throw new Error("knowledge graph demo data is restricted to NODE_ENV=development");
  }
  if (target.publicOrigin !== DEMO_PUBLIC_ORIGIN) {
    throw new Error(`knowledge graph demo data requires ${DEMO_PUBLIC_ORIGIN}`);
  }
  const database = new URL(target.databaseUrl);
  if (
    database.protocol !== "postgres:" ||
    !["postgres", "127.0.0.1", "localhost"].includes(database.hostname) ||
    database.pathname !== "/myownnotion"
  ) {
    throw new Error("knowledge graph demo data refuses a remote or unexpected database target");
  }
  if (target.installationCount !== 1 || target.ownerCount !== 0 || target.itemCount !== 0) {
    throw new Error("knowledge graph demo data requires one empty disposable installation");
  }
}
