import { generateUuidV7, type Uuid } from "@myownnotion/domain";

export const DEMO_PASSWORD = "knowledge-graph-demo"; // secret-scan:allow -- Public local demo credential.
export const DEMO_CONFIRMATION = "RESET_LOCAL_KNOWLEDGE_GRAPH_DEMO";
export const DEMO_PUBLIC_ORIGIN = "https://localhost:8443";

export const DEMO_EXPECTED = {
  items: 240,
  relationships: 243,
  documentRelationships: 201,
  explicitRelationships: 42,
  folders: 8,
  pages: 190,
  databases: 1,
  tasks: 40,
  files: 1,
  isolatedItems: 8,
  trashedItems: 1,
  knowledgeComponents: 5,
  documentSourcesWithTwoLinks: 19,
  documentSourcesWithOneLink: 163,
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

export interface DemoDocumentLink {
  readonly targetItemId: Uuid;
  readonly targetName: string;
  readonly leadIn: string;
}

export interface DemoPageDocument {
  readonly itemId: Uuid;
  readonly heading: string;
  readonly summary: string;
  readonly links: readonly DemoDocumentLink[];
}

export interface KnowledgeGraphDemoFixture {
  readonly summary: typeof DEMO_EXPECTED;
  readonly items: readonly DemoItem[];
  readonly relationships: readonly DemoRelationship[];
  readonly documents: readonly DemoPageDocument[];
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

const KNOWLEDGE_CONCEPTS = [
  ["Vision produit", "la promesse centrale et les limites assumées de l’application"],
  [
    "Problème propriétaire",
    "les difficultés concrètes rencontrées par la personne qui organise ses connaissances",
  ],
  ["Public cible", "les besoins, habitudes et contraintes des premiers utilisateurs"],
  ["Parcours principal", "le chemin qui va de la capture d’une idée à sa réutilisation"],
  ["Navigation", "les repères nécessaires pour circuler sans perdre le contexte"],
  ["Édition par blocs", "la composition et la transformation progressive du contenu"],
  ["Liens internes", "les références explicites entre deux pages du workspace"],
  ["Backlinks", "la lecture des pages qui citent la note courante"],
  ["Graphe de connaissances", "la découverte visuelle des connexions portées par le contenu"],
  ["Recherche", "la manière de retrouver une information précise dans un corpus dense"],
  ["Mode hors ligne", "la continuité du travail lorsque le réseau disparaît"],
  ["Synchronisation", "la propagation fiable des changements entre les appareils"],
  ["Conflits", "la convergence de modifications concurrentes sans perte silencieuse"],
  ["Chiffrement", "la protection du contenu et des secrets détenus par le propriétaire"],
  ["Récupération", "le retour à un état utilisable après une perte d’accès"],
  ["Sauvegarde", "la création d’un historique durable et vérifiable"],
  ["Restauration", "la remise en service d’un workspace à partir d’une sauvegarde"],
  ["Fichiers", "le cycle de vie des pièces jointes liées aux notes"],
  ["Bases et tâches", "le suivi structuré des décisions et du travail à livrer"],
  ["Qualité", "les preuves nécessaires avant de déclarer une fonctionnalité prête"],
  ["Déploiement", "la reconstruction reproductible de l’application et de ses données"],
  ["Observabilité", "les signaux qui expliquent clairement le comportement du serveur"],
  ["Décision V1", "les arbitrages qui déterminent le périmètre de la première version"],
] as const;

const ISOLATED_PAGE_NAMES = [
  "Import non relié",
  "Brouillon sans référence",
  "Note personnelle temporaire",
  "Idée en attente de tri",
  "Archive sans backlink",
  "Compte rendu détaché",
  "Test de page orpheline",
  "Capture rapide isolée",
] as const;

const TASK_ACTIONS = ["Définir", "Prototyper", "Vérifier", "Documenter", "Livrer"] as const;

function branchOf(items: ReadonlyMap<Uuid, DemoItem>, itemId: Uuid): number | null {
  return items.get(itemId)?.branchIndex ?? null;
}

const SECTIONS_PER_BRANCH = 3;
const LEAF_COUNT = 150;

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
  const hubs: DemoItem[] = folders.map((folder, branchIndex) => ({
    id: idFactory(),
    role: "page",
    kind: "page",
    name: `Vue d'ensemble — ${folder.name}`,
    parentId: folder.id,
    branchIndex,
  }));
  const sections: DemoItem[] = hubs.flatMap((hub, branchIndex) =>
    Array.from({ length: SECTIONS_PER_BRANCH }, (_, sectionIndex) => {
      const concept =
        KNOWLEDGE_CONCEPTS[
          (branchIndex * SECTIONS_PER_BRANCH + sectionIndex) % KNOWLEDGE_CONCEPTS.length
        ];
      return {
        id: idFactory(),
        role: "page" as const,
        kind: "page" as const,
        name: `${concept?.[0] ?? "Sujet produit"} — ${BRANCH_NAMES[branchIndex]}`,
        parentId: hub.id,
        branchIndex,
      };
    }),
  );
  const extraLeaves = LEAF_COUNT % sections.length;
  const baseLeaves = Math.floor(LEAF_COUNT / sections.length);
  const leaves: DemoItem[] = sections.flatMap((section, sectionIndex) => {
    const count = baseLeaves + (sectionIndex < extraLeaves ? 1 : 0);
    const conceptName = section.name.split(" — ")[0] ?? "Note";
    const branchName = BRANCH_NAMES[section.branchIndex ?? 0];
    return Array.from({ length: count }, (_, leafIndex) => ({
      id: idFactory(),
      role: "page" as const,
      kind: "page" as const,
      name: `${conceptName} — ${branchName} · ${leafIndex + 1}`,
      parentId: section.id,
      branchIndex: section.branchIndex,
    }));
  });
  const isolatedPages: DemoItem[] = ISOLATED_PAGE_NAMES.map((name) => ({
    id: idFactory(),
    role: "page",
    kind: "page",
    name: `Scénario isolé — ${name}`,
    parentId: null,
    branchIndex: null,
  }));
  const pages = [...hubs, ...sections, ...leaves, ...isolatedPages];
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
    name: `${TASK_ACTIONS[index % TASK_ACTIONS.length]} — ${KNOWLEDGE_CONCEPTS[index % KNOWLEDGE_CONCEPTS.length]?.[0] ?? "Produit"}`,
    parentId: databaseItem.id,
    branchIndex: 4,
  }));
  const fileItem: DemoItem = {
    id: idFactory(),
    role: "file",
    kind: "file",
    name: "jeu-de-donnees-knowledge-graph.md",
    parentId: hubs[0]?.id ?? null,
    branchIndex: hubs[0]?.branchIndex ?? 0,
  };
  const items = [...folders, ...pages, databaseItem, ...taskItems, fileItem];
  const byId = new Map(items.map((item) => [item.id, item]));
  const relationships: DemoRelationship[] = [];

  const addDocument = (source: DemoItem, target: DemoItem): void => {
    relationships.push({
      id: idFactory(),
      sourceItemId: source.id,
      targetItemId: target.id,
      relationType: "page:link",
      origin: "document",
      crossBranch: branchOf(byId, source.id) !== branchOf(byId, target.id),
    });
  };
  hubs.forEach((hub, branchIndex) => {
    const firstSection = sections[branchIndex * SECTIONS_PER_BRANCH];
    if (firstSection !== undefined) addDocument(hub, firstSection);
  });
  sections.forEach((section, sectionIndex) => {
    const hub = hubs[section.branchIndex ?? 0];
    if (hub !== undefined) addDocument(section, hub);
    const localIndex = sectionIndex % SECTIONS_PER_BRANCH;
    if (localIndex < SECTIONS_PER_BRANCH - 1) {
      const next = sections[sectionIndex + 1];
      if (next !== undefined) addDocument(section, next);
    }
  });
  for (const leaf of leaves) {
    const section = byId.get(leaf.parentId ?? (leaf.id as Uuid));
    if (section === undefined) throw new Error("demo leaf has no section parent");
    addDocument(leaf, section);
  }
  for (const [from, to] of [
    [0, 1],
    [2, 3],
    [4, 5],
  ] as const) {
    const source = hubs[from];
    const target = hubs[to];
    if (source === undefined || target === undefined) {
      throw new Error("demo fixture is missing a branch hub for a cross-branch link");
    }
    addDocument(source, target);
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
  const deliveryHub = hubs[4] ?? (hubs[0] as DemoItem);
  for (let taskIndex = 0; taskIndex < taskItems.length; taskIndex += 1) {
    const task = taskItems[taskIndex];
    if (task === undefined) throw new Error("demo fixture has no task relationship source");
    if (taskIndex === 0) {
      addExplicit(task, deliveryHub, "demo:implements");
      addExplicit(task, deliveryHub, "demo:implements");
      addExplicit(deliveryHub, task, "demo:implements");
      continue;
    }
    addExplicit(task, deliveryHub, taskIndex === 1 ? "future:semantic" : "demo:implements");
  }

  const documents: DemoPageDocument[] = pages.map((page) => {
    const branch = page.branchIndex === null ? null : BRANCH_NAMES[page.branchIndex];
    const links = relationships
      .filter(({ origin, sourceItemId }) => origin === "document" && sourceItemId === page.id)
      .map(({ targetItemId }, linkIndex) => {
        const target = byId.get(targetItemId);
        if (target === undefined) throw new Error("demo document points to an unknown page");
        return {
          targetItemId,
          targetName: target.name,
          leadIn:
            linkIndex === 0
              ? "Cette note s’inscrit dans le fil de"
              : "Pour élargir le contexte, voir aussi",
        };
      });
    const parent = page.parentId === null ? null : byId.get(page.parentId);
    return {
      itemId: page.id,
      heading: page.name,
      summary:
        branch === null
          ? "Cette note est volontairement sans lien afin de vérifier le filtre des pages isolées. Son contenu reste lisible et identifiable pendant les tests."
          : parent?.role === "folder"
            ? `Dans le dossier « ${branch} », cette vue d’ensemble oriente le travail de la branche. Les notes filles précisent le sujet sans tout relier à toutes les autres branches.`
            : `Dans le volet « ${branch} », cette note développe un point du dossier « ${parent?.name ?? branch} ». Elle renvoie surtout à sa note parente, comme on le fait en écrivant un arbre de pages.`,
      links,
    };
  });

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
    documents,
    tasks,
    isolatedItemIds: isolatedPages.map(({ id }) => id),
    trashedItemId: leaves[0]?.id ?? (pages[0] as DemoItem).id,
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
