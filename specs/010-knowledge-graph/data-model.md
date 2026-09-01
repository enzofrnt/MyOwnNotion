# Data Model: Graphe de connaissances privé

## 1. Sources existantes

Le graphe ne crée aucune entité persistante. Il lit :

- `LocalItemRow` pour identité, type, lifecycle et présentation ouverte ;
- `LocalPlacementRow` pour hiérarchie et pièces jointes ;
- `LocalRelationshipRow` pour les relations canoniques orientées ;
- `LocalDatabaseRow` pour reconnaître une page-base et ses rôles de tâche ;
- `LocalDatabaseEntryRow` pour reconnaître les pages membres ;
- `META_KEYS.lastChangeCursor` et l'état de sync pour la couverture.

Une restauration, un snapshot compacté ou une migration remplace ces sources,
puis la projection est recalculée. Aucune coordonnée ou arête inverse n'est
requise dans les sauvegardes.

## 2. GraphSourceNode

| Champ | Type | Règle |
| --- | --- | --- |
| `id` | UUID | Identité canonique stable |
| `kind` | page, folder, file, database, task | Rôle de présentation déterministe |
| `canonicalKind` | page, folder, file | Type de l'item source |
| `lifecycle` | active, trashed | Les éléments purgés sont exclus |
| `parentIds` | UUID[] | Parents hiérarchiques actifs, triés |
| `mediaType` | string ou null | Ouvert seulement pour un fichier visible ou filtré |
| `name` | string ou null | Ouvert après sélection de la topologie |
| `icon` | string ou null | Présentation facultative |
| `structured` | métadonnées facultatives | Statut/date/propriétés évaluables localement |

Priorité de rôle : `database`, puis `task`, puis `canonicalKind`. Une identité
reste unique même lorsqu'une page-base est membre d'une autre base.

## 3. GraphSourceEdge

| Champ | Type | Règle |
| --- | --- | --- |
| `id` | string stable | UUID canonique ou identifiant dérivé du placement |
| `sourceId` | UUID | Direction d'origine |
| `targetId` | UUID | Direction d'arrivée |
| `relationType` | chaîne namespacée | Conservée même inconnue |
| `origin` | relationship, hierarchy, attachment | Explique l'éditabilité et la provenance |
| `availability` | active, source-trashed, target-trashed, unavailable | Calculé depuis les endpoints |

Projections de placement :

- hiérarchie : parent → enfant, `hierarchy:contains` ;
- pièce jointe : parent → fichier, `file:attachment`.

Un type doit respecter le contrat namespacé du domaine. Une ligne invalide
produit un `GraphDiagnostic` et n'entre pas dans les arêtes actives.

## 4. AggregatedEdge

| Champ | Type | Règle |
| --- | --- | --- |
| `key` | string | tuple canonique source/cible/type |
| `sourceId` / `targetId` | UUID | Direction inchangée |
| `relationType` | string | Type exact ou générique inconnu |
| `occurrenceIds` | string[] | Identités triées, sans doublon |
| `multiplicity` | entier ≥ 1 | Longueur exacte des occurrences |
| `origins` | origin[] | Ensemble trié des provenances |
| `availability` | état agrégé | État le plus restrictif présent |

Deux relations réciproques donnent deux agrégats. Un backlink n'inverse pas
l'agrégat : il le sélectionne parce que sa cible est l'élément inspecté.

## 5. GraphQuery

```ts
interface GraphQuery {
  scope:
    | { kind: "workspace" }
    | { kind: "branch"; rootId: Uuid }
    | { kind: "neighborhood"; centerId: Uuid; depth: 1 | 2 | 3 }
    | { kind: "selection"; itemIds: Uuid[] };
  filters: {
    nodeKinds: GraphNodeKind[];
    relationTypes: string[];
    attachment: "all" | "only" | "exclude";
    mediaTypes: string[];
    lifecycle: "active" | "including-trashed";
    structured: StructuredGraphFilter[];
    includeIsolated: boolean;
  };
  limits: { maxNodes: number; maxEdges: number };
}
```

Invariants :

- profondeur bornée à 1..3 ;
- sélection dédupliquée et bornée à 200 identités ;
- `maxNodes` borné à 20..200 et `maxEdges` à 20..400 ;
- filtres normalisés, triés et dédupliqués ;
- aucun titre ou texte libre nécessaire dans la requête persistée.

## 6. GraphProjection

| Champ | Type | Règle |
| --- | --- | --- |
| `nodes` | `GraphNode[]` | Candidats visibles, tri stable, ≤ limite |
| `edges` | `AggregatedEdge[]` | Endpoints visibles, tri stable, ≤ limite |
| `summary` | comptes | Candidats, visibles, relations, composantes, isolés |
| `coverage` | complete ou partial | État et code d'explication |
| `truncation` | objet | Limites et nombres omis, jamais silencieux |
| `diagnostics` | objet | Nombre de relations invalides/inconnues, aucun contenu |
| `layout` | positions | Dérivé déterministe, non canonique |

Un nœud contient ses compteurs entrants, sortants et occurrences. Les comptes
sont calculés avant le bornage visuel afin qu'un résumé ne présente pas la
limite comme le total.

## 7. Coverage

```ts
type GraphCoverage =
  | { state: "complete"; cursor: string }
  | {
      state: "partial";
      reason: "initial-sync" | "missing-local-values" | "projection-error";
      cursor: string | null;
    };
```

Une perte de réseau n'altère pas un `complete` déjà prouvé. Un filtre structuré
rencontrant une valeur `offloaded` devient `missing-local-values`. Une erreur
ne remplace jamais la dernière projection complète mémorisée par une projection
partielle prétendument valide.

## 8. PresentationState

| Champ | Persistance | Règle |
| --- | --- | --- |
| mode canvas/liste | appareil | réinitialisable |
| profondeur 1..3 | appareil | défaut 2 |
| types techniques | appareil | liste bornée |
| isolés visibles | appareil | défaut faux |
| zoom | appareil | borné 0,5..2 |
| périmètre courant | mémoire | peut contenir une identité privée |
| sélection | mémoire | non persistée |
| coordonnées/pan | mémoire | jamais canonique |

## 9. Transitions

- ajout/retrait offline : mutation canonique → projection optimiste → nouveau
  calcul ; au redémarrage la source Dexie et l'outbox restituent le même état ;
- changement distant : enveloppe appliquée avec le curseur → événement
  `rebuild` → projection remplacée ;
- corbeille/restauration : lifecycle modifie disponibilité et filtre, jamais
  identité ;
- purge : l'item et ses relations disparaissent des sources ;
- snapshot/restauration : remplacement atomique puis reconstruction totale ;
- erreur : dernière projection conservée, couverture dégradée et reprise
  explicite.
