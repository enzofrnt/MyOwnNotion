import { generateUuidV7, type Uuid } from "@myownnotion/domain";

export const DEMO_PASSWORD = "knowledge-graph-demo"; // secret-scan:allow -- Public local demo credential.
export const DEMO_CONFIRMATION = "RESET_LOCAL_KNOWLEDGE_GRAPH_DEMO";
export const DEMO_PUBLIC_ORIGIN = "https://localhost:8443";

export const DEMO_EXPECTED = {
  items: 240,
  relationships: 480,
  documentRelationships: 360,
  explicitRelationships: 120,
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
    const branchIndex = isolated ? null : index % BRANCH_NAMES.length;
    const concept = KNOWLEDGE_CONCEPTS[Math.floor(index / BRANCH_NAMES.length)];
    return {
      id: idFactory(),
      role: "page",
      kind: "page",
      name: isolated
        ? `Scénario isolé — ${ISOLATED_PAGE_NAMES[index - 182] ?? "Note sans lien"}`
        : `${concept?.[0] ?? "Sujet produit"} — ${BRANCH_NAMES[branchIndex ?? 0]}`,
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
    name: `${TASK_ACTIONS[index % TASK_ACTIONS.length]} — ${KNOWLEDGE_CONCEPTS[index % KNOWLEDGE_CONCEPTS.length]?.[0] ?? "Produit"}`,
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
  const relationships: DemoRelationship[] = [];

  const documentSources = 180;
  const connectedPageCount = DEMO_EXPECTED.pages - DEMO_EXPECTED.isolatedItems;
  for (let sourceIndex = 0; sourceIndex < documentSources; sourceIndex += 1) {
    const source = pages[sourceIndex];
    if (source === undefined) throw new Error("demo fixture has no document source");
    const conceptStart = Math.floor(sourceIndex / BRANCH_NAMES.length) * BRANCH_NAMES.length;
    const conceptLength = Math.min(BRANCH_NAMES.length, connectedPageCount - conceptStart);
    const nextPerspective = conceptStart + ((sourceIndex - conceptStart + 1) % conceptLength);
    const nextConcept = (sourceIndex + BRANCH_NAMES.length) % connectedPageCount;
    for (const targetIndex of [nextPerspective, nextConcept]) {
      const target = pages[targetIndex];
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
  const pageFor = (conceptIndex: number, branchIndex: number): DemoItem => {
    const conceptStart = conceptIndex * BRANCH_NAMES.length;
    const candidateIndex = conceptStart + branchIndex;
    return (
      (candidateIndex < connectedPageCount ? pages[candidateIndex] : undefined) ??
      pages[conceptStart] ??
      (pages[0] as DemoItem)
    );
  };
  for (let taskIndex = 0; taskIndex < taskItems.length; taskIndex += 1) {
    const task = taskItems[taskIndex];
    if (task === undefined) throw new Error("demo fixture has no task relationship source");
    const conceptIndex = taskIndex % KNOWLEDGE_CONCEPTS.length;
    const delivery = pageFor(conceptIndex, 4);
    const quality = pageFor(conceptIndex, 5);
    const decision = pageFor(conceptIndex, 7);
    if (taskIndex === 0) {
      addExplicit(task, delivery, "demo:implements");
      addExplicit(task, delivery, "demo:implements");
      addExplicit(delivery, task, "demo:implements");
      continue;
    }
    addExplicit(task, delivery, taskIndex === 1 ? "future:semantic" : "demo:implements");
    addExplicit(task, quality, "demo:verified-by");
    addExplicit(task, decision, "demo:depends-on");
  }

  const documents: DemoPageDocument[] = pages.map((page, index) => {
    const concept = KNOWLEDGE_CONCEPTS[Math.floor(index / BRANCH_NAMES.length)];
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
              ? "Comparer ce sujet avec le point de vue complémentaire"
              : "Poursuivre le raisonnement avec le thème suivant",
        };
      });
    return {
      itemId: page.id,
      heading: page.name,
      summary:
        branch === null || concept === undefined
          ? "Cette note est volontairement sans lien afin de vérifier le filtre des pages isolées. Son contenu reste lisible et identifiable pendant les tests."
          : `Dans le volet « ${branch} », cette note précise ${concept[1]}. Elle relie une décision locale aux autres perspectives du produit.`,
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
    isolatedItemIds: pages.slice(-DEMO_EXPECTED.isolatedItems).map(({ id }) => id),
    trashedItemId: pages[7]?.id ?? (pages[0] as DemoItem).id,
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
