import type { GraphNodeKind } from "@myownnotion/graph";

export const GRAPH_COPY = {
  title: "Graphe de connaissances",
  globalSubtitle: "Explorez les relations de cet espace sans modifier vos contenus.",
  localSubtitle: "Comprenez le voisinage et les références de cet élément.",
  backlinks: "Référencé par",
  outgoing: "Pointe vers",
  empty: "Aucune relation dans ce périmètre.",
  noName: "Élément sans titre",
} as const;

export const GRAPH_KIND_LABELS: Readonly<Record<GraphNodeKind, string>> = {
  page: "Page",
  folder: "Dossier",
  file: "Fichier",
  database: "Base de données",
  task: "Tâche",
};
