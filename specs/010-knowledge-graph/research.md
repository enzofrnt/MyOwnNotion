# Research: Graphe de connaissances privé

## Decision 1 — Projeter la source locale existante

**Decision**: Construire le graphe depuis `items`, `placements`,
`relationships`, `databases` et `databaseEntries` déjà réconciliés dans Dexie.
Ne créer ni table canonique, ni endpoint `/graph`, ni journal dédié.

**Rationale**: Le snapshot et le flux ordonné transportent déjà toutes les
identités et relations, y compris les écritures optimistes hors ligne. Cette
projection est chiffrée au repos et remplacée atomiquement après compaction ou
restauration. Une seconde persistance devrait reproduire sync, chiffrement,
rotation, backup, rétention et purge tout en pouvant diverger.

**Alternatives considered**:

- une projection PostgreSQL : duplique les données privées et ne résout pas
  l'offline ;
- un endpoint serveur calculant chaque vue : empêche l'exploration hors ligne
  et ferait transiter les filtres privés ;
- un index Dexie spécifique : accélère certaines requêtes, mais ajoute une
  migration et une invalidation inutiles pour la V1.

## Decision 2 — Une frontière algorithmique pure

**Decision**: Confirmer `packages/graph` comme package sans I/O. Il reçoit des
nœuds et arêtes normalisés, puis porte périmètres, BFS, filtres, agrégation,
compteurs et disposition déterministe.

**Rationale**: Ces règles doivent être identiques pour backlinks, vue locale,
vue globale, fixtures de restauration et futurs consommateurs. Les isoler du
React et de Dexie rend les propriétés de convergence testables et évite qu'un
composant définisse une seconde sémantique.

**Alternatives considered**:

- calcul dans les composants React : difficile à tester et couplé au cycle de
  rendu ;
- service serveur autonome : aucune exigence actuelle ne justifie un nouveau
  processus ;
- ajout au domaine général : les algorithmes de projection sont une frontière
  explicite déjà prévue par l'architecture.

## Decision 3 — Normaliser sans modifier les relations canoniques

**Decision**: Conserver chaque `Relationship` comme occurrence orientée.
Projeter les placements hiérarchiques et pièces jointes en arêtes dérivées,
puis agréger les occurrences par source, cible et type avec multiplicité.

**Rationale**: Les backlinks sont l'index inverse de la même occurrence, pas
une relation réciproque écrite. L'agrégation empêche les lignes visuelles
superposées tout en conservant le compte exact. La direction et l'identité
originales restent disponibles pour l'inspection et la reconstruction.

**Alternatives considered**:

- écrire les backlinks : crée deux écritures à maintenir ;
- dédupliquer les occurrences à l'import : perd la multiplicité demandée ;
- rendre chaque occurrence : bruit visuel et DOM non borné.

## Decision 4 — Rendu SVG natif et liste équivalente

**Decision**: Utiliser un SVG contrôlé par React avec une disposition
déterministe calculée par `packages/graph`, accompagné d'une vue liste complète.

**Rationale**: La V1 borne le rendu à 200 nœuds et 400 arêtes, ne propose ni
édition d'arête ni disposition manuelle et doit rester légère. Le SVG natif
fournit pan, zoom, focus, sélection et labels sans introduire un moteur dont le
modèle d'état deviendrait une seconde source. La liste couvre petits écrans,
zoom élevé, clavier et réduction des animations.

**Alternatives considered**:

- moteur force-directed : mouvement instable, coût sur le thread UI et
  dépendance disproportionnée ;
- canvas : performant, mais focus, texte, hit targets et tests sont moins
  prévisibles ;
- bibliothèque de diagramme éditable : capacités whiteboard hors scope.

## Decision 5 — Topologie d'abord, contenu visible ensuite

**Decision**: Lire en premier identités, types, lifecycles, placements,
relations et appartenances ; projeter par lots ; ouvrir les lignes chiffrées
uniquement pour les nœuds retenus et les dimensions de filtre activées.

**Rationale**: Déchiffrer 100 000 titres avant d'afficher quoi que ce soit
retarderait inutilement le premier résultat. Les choix de périmètre, profondeur,
type et relation se décident sur les métadonnées structurelles. Le libellé est
nécessaire uniquement aux éléments affichés.

**Alternatives considered**:

- ouvrir toutes les lignes : simple mais contraire au budget de première vue ;
- stocker les titres en clair dans un index : viole la protection locale ;
- tronquer les sources : rapide mais rend les totaux et l'absence trompeurs.

## Decision 6 — Complétude prouvée par la réconciliation

**Decision**: Une projection est complète quand la projection possède un
curseur de snapshot/catch-up établi et que son périmètre ne dépend pas de
payloads volontairement déchargés. `offline` après un premier snapshot peut
rester complet à ce curseur ; une initialisation interrompue ou un filtre sur
des valeurs absentes est partiel.

**Rationale**: « Hors ligne » décrit la connectivité, pas automatiquement la
couverture. À l'inverse, une interface connectée n'est pas complète tant que le
premier snapshot n'est pas installé. L'état doit donc nommer la preuve et sa
limite plutôt que déduire une vérité du réseau.

**Alternatives considered**:

- complet dès que Dexie contient une ligne : peut masquer des objets jamais
  reçus ;
- partiel chaque fois que le réseau est absent : dégrade à tort un snapshot
  local exhaustif ;
- aucun indicateur : contredit directement le canevas et la spec.

## Decision 7 — Préférences minimales et non sensibles

**Decision**: Persister uniquement le mode canvas/liste, la profondeur, les
types techniques sélectionnés, l'affichage des isolés et le niveau de zoom.
Ne pas persister identités sélectionnées, titres, texte de filtre ou
coordonnées.

**Rationale**: Ces valeurs sont une présentation réinitialisable et ne
révèlent pas le contenu du workspace. Les filtres privés et la sélection
disparaissent avec la session, ce qui réduit les traces et évite toute
migration canonique.

**Alternatives considered**:

- tout enregistrer : meilleure reprise visuelle mais surface de fuite locale
  et contrat de migration plus large ;
- synchroniser les préférences : transforme un état d'appareil en donnée
  canonique sans besoin V1.
