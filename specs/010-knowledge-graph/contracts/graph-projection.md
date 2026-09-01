# Contract: Knowledge graph projection

## Public package surface

`@myownnotion/graph` exporte des fonctions pures :

```ts
normalizeGraphSource(input: RawGraphSource): NormalizedGraphSource
projectGraph(source: NormalizedGraphSource, query: GraphQuery): GraphProjection
aggregateEdges(edges: readonly GraphSourceEdge[]): readonly AggregatedEdge[]
layoutGraph(projection: GraphProjection): GraphLayout
describeRelationType(type: string): RelationTypePresentation
```

Toutes les collections de sortie sont triées par clés explicites. Aucune
fonction ne lit l'heure, le réseau, le stockage, la locale globale ou un nombre
aléatoire.

## Normalization

- exclut les éléments purgés ;
- déduplique les mêmes identités et occurrences ;
- refuse les endpoints absents sans interrompre le calcul ;
- conserve un type namespacé inconnu avec `known: false` ;
- isole un type ou une identité invalide dans des compteurs diagnostics ;
- projette les placements avec des identifiants dérivés stables.

## Scope order

1. déterminer les identités candidates du périmètre ;
2. construire le sous-graphe induit ;
3. appliquer types de nœud et lifecycle ;
4. appliquer types de relation, pièce jointe et format ;
5. appliquer les dimensions structurées évaluables ;
6. retirer ou conserver les isolés ;
7. agréger et compter ;
8. limiter le rendu et produire le résumé.

Les filtres ne peuvent jamais ajouter une identité hors périmètre.

## Backlinks

Pour un `itemId`, le contrat retourne :

- `outgoing`: agrégats dont `sourceId === itemId` ;
- `backlinks`: agrégats dont `targetId === itemId` ;
- `unavailable`: agrégats conservés avec endpoint à la corbeille ;
- nombres d'occurrences, pas seulement nombres de couples.

Les tableaux sont triés par libellé de relation connu, identité de l'autre
endpoint, puis clé d'agrégat. Les cycles et relations réciproques n'appellent
aucune récursion non bornée.

## Limits

La projection refuse des limites hors bornes. Quand les candidats dépassent
les limites, elle retourne `truncation.truncated = true`, les nombres omis et
une recommandation de filtre. Aucun candidat ne disparaît des totaux.

## Stability

Pour toute permutation des mêmes sources et requêtes normalisées :

- mêmes identités de nœud ;
- mêmes clés, directions, types et multiplicités d'arête ;
- mêmes compteurs et composantes ;
- mêmes positions à une tolérance flottante documentée.

Appliquer deux fois la même occurrence est équivalent à l'appliquer une fois
si son identité est identique. Deux occurrences d'identités différentes
augmentent la multiplicité à deux.

## Safe diagnostics

Les erreurs exposables contiennent seulement : code stable, étape, compte de
lignes et durée. Elles excluent titres, UUID complets, métadonnées de relation,
valeurs structurées et requêtes de filtre.
