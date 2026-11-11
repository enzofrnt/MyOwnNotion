import type { GraphEdgeLayer, GraphNodeKind } from "@myownnotion/graph";

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
  database_view: "Vue de base de données",
  task: "Tâche",
};

export const GRAPH_LAYER_LABELS: Readonly<Record<GraphEdgeLayer, string>> = {
  knowledge: "Connaissances",
  hierarchy: "Hiérarchie",
  attachment: "Pièces jointes",
};

/** Plain-language help behind each “i” of the filters panel. */
export const GRAPH_HELP = {
  layers:
    "Un calque est une famille de liens à dessiner. Activez-en plusieurs pour superposer les liens que vous écrivez, le rangement et les fichiers.",
  layer: {
    knowledge:
      "Les liens que vous créez dans le contenu : un lien d’une page vers une autre, ou une propriété de base de données qui pointe vers une page.",
    hierarchy:
      "Le rangement : un dossier, une page ou une base de données relié à ce qu’il contient.",
    attachment: "Les fichiers attachés à une page, reliés à cette page.",
  } satisfies Record<GraphEdgeLayer, string>,
  kinds: "N’affiche que les éléments des types cochés. « Tous » les affiche sans distinction.",
  relations:
    "Un tri plus fin à l’intérieur des calques actifs : parmi les liens dessinés, ne garder que certains types. « Tous » n’en écarte aucun.",
  relation: {
    "page:link": "Un lien écrit dans une page vers une autre page.",
    "database:property": "Une propriété de base de données qui pointe vers une page.",
    "hierarchy:contains": "Un élément rangé dans un dossier, une page ou une base de données.",
    "file:attachment": "Un fichier attaché à une page.",
  } as Readonly<Record<string, string>>,
  isolated: "Affiche aussi les éléments qui n’ont aucun lien dans le périmètre choisi.",
  trashed: "Affiche aussi les éléments placés dans la corbeille.",
} as const;
