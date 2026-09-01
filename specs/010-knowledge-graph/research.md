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

**Decision**: Conserver chaque `Relationship` comme occurrence orientée et
classer chaque arête dans une couche. Les relations canoniques, dont
`page:link`, forment la couche `knowledge` active par défaut. Les placements
hiérarchiques et pièces jointes restent des arêtes dérivées dans les couches
`hierarchy` et `attachment`, désactivées par défaut. Les occurrences visibles
sont ensuite agrégées par source, cible et type avec multiplicité.

**Rationale**: Les backlinks sont l'index inverse de la même occurrence, pas
une relation réciproque écrite. Un dossier parent explique où une page est
rangée, pas ce que son contenu référence. Séparer les couches empêche
l'arborescence de dominer le graphe tout en la gardant disponible comme
contexte. L'agrégation empêche les lignes visuelles superposées tout en
conservant le compte exact. La direction, l'origine et l'identité originales
restent disponibles pour l'inspection et la reconstruction.

**Alternatives considered**:

- écrire les backlinks : crée deux écritures à maintenir ;
- mélanger placements et liens de contenu par défaut : reproduit l'explorateur
  de fichiers au lieu du réseau de connaissances ;
- dédupliquer les occurrences à l'import : perd la multiplicité demandée ;
- rendre chaque occurrence : bruit visuel et DOM non borné.

## Decision 4 — Rendu SVG natif et liste équivalente

**Decision**: Utiliser un SVG contrôlé par React avec une disposition
relationnelle déterministe et stabilisée calculée par `packages/graph`,
accompagné d'une vue liste complète. La disposition part d'une graine stable,
applique un nombre borné d'itérations d'attraction par lien, de répulsion et de
centrage, puis rend des coordonnées fixes ; elle n'anime pas une simulation
permanente.

**Rationale**: La V1 borne le rendu à 200 nœuds et 400 arêtes, ne propose ni
édition d'arête ni disposition manuelle et doit rester légère. Une disposition
guidée par les arêtes rend réellement visibles hubs, ponts et groupes, là où
des anneaux de parcours ressemblent à un arbre. Le calcul déterministe évite le
mouvement continu et reste testable. Le SVG natif fournit pan, zoom, focus,
survol, sélection et labels sans introduire un moteur dont le modèle d'état
deviendrait une seconde source. La liste couvre petits écrans, zoom élevé,
clavier et réduction des animations.

**Alternatives considered**:

- moteur force-directed animé en continu : mouvement instable, coût sur le
  thread UI et dépendance disproportionnée ;
- anneaux BFS seuls : déterministes mais masquent les proximités et groupes du
  réseau global ;
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

## Decision 8 — Reprendre le contrat observable d'Obsidian, pas son apparence

**Decision**: Utiliser comme référence comportementale la documentation et
l'API publiques d'Obsidian : les lignes représentent les liens internes entre
notes, le cache conserve pour chaque source les destinations et nombres de
liens, le local graph suit une profondeur configurable, le survol révèle les
connexions, le clic ouvre la note, la molette zoome et le glisser déplace la
vue. La taille des nœuds varie de façon bornée avec le nombre de références.
MyOwnNotion conserve toutefois le clic simple pour sélectionner et expliquer
la relation dans son inspecteur déjà spécifié ; le double-clic ou le bouton
visible ouvre ensuite la page sans passer par l'arborescence.

**Rationale**: La recherche `org:obsidianmd graph` ne publie pas le moteur de
rendu de l'application ; elle renvoie l'aide officielle, l'API de métadonnées
et les variables de thème. Ces sources suffisent à établir le contrat produit
sans supposer une architecture interne ni copier une présentation. Le modèle
`resolvedLinks[source][destination] = count` confirme que le graphe repose sur
les liens du contenu et que les backlinks en sont la lecture inverse. Les
sources primaires consultées sont l'[aide officielle du graphe](https://github.com/obsidianmd/obsidian-help/blob/a3985b585904ddb9f109bd80849b378085308c15/en/Plugins/Graph%20view.md),
le [contrat public `resolvedLinks`](https://github.com/obsidianmd/obsidian-developer-docs/blob/c56c7e770ba25dd0ea392aacf4588f9425970d36/en/Reference/TypeScript%20API/MetadataCache/resolvedLinks.md)
et les [variables publiques de la vue](https://github.com/obsidianmd/obsidian-developer-docs/blob/c56c7e770ba25dd0ea392aacf4588f9425970d36/en/Reference/CSS%20variables/Plugins/Graph.md).

**Alternatives considered**:

- reproduire visuellement Obsidian : hors scope et sans source publique du
  moteur ;
- déduire des liens par similarité de texte : ajoute des faux positifs et des
  arêtes non explicables ;
- traiter les mentions non liées comme arêtes : Obsidian les sépare des liens
  résolus et son graphe principal ne les présente pas comme des liens certains.

## Decision 9 — Un corpus éditorial cohérent plutôt qu'un générateur de traits

**Decision**: Construire 190 pages autour de 23 concepts transversaux répartis
dans huit branches produit. Cent quatre-vingts pages sources contiennent chacune
deux liens internes visibles : un vers le même concept dans une autre branche
et un vers le concept suivant de leur propre branche. Le corpus produit ainsi
360 relations documentaires, tandis que 120 relations métier relient de façon
explicable tâches, décisions, risques et livrables.

**Rationale**: Cette grille thématique crée des hubs, cycles, passerelles et
liens inter-branches indépendants du rangement. Chaque arête documentaire peut
être vérifiée en ouvrant sa source. Les huit pages isolées restent lisibles mais
sans lien, et les cas de corbeille, fichier, base, tâches, multiplicité et type
futur restent couverts sans gonfler artificiellement le réseau principal.

**Alternatives considered**:

- connexions pseudo-aléatoires : atteignent les compteurs mais ne racontent
  aucune connaissance vérifiable ;
- copier un vault Obsidian tiers : contenu et licence non maîtrisés, données
  non adaptées aux filtres du produit ;
- quelques pages très denses : ne teste ni le voisinage de nombreuses sources
  ni le comportement du graphe global.
