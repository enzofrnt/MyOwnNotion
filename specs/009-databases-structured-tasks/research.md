# Research: Bases de données et tâches structurées

## Decision 1 — Une base est une capacité d'une page canonique

**Decision**: Une base utilise une page hôte dont `itemId` est aussi le
`databaseId`. La capacité est attestée par une ligne `databases`. Une entrée
est une autre page canonique reliée par `database_entries`.

**Rationale**: La page hôte possède déjà le titre, la position, la hiérarchie,
le cycle de vie, les révisions, la recherche et les protections attendues d'un
élément du workspace. Réutiliser cette identité rend renommage, déplacement,
corbeille et références cohérents sans ajouter un quatrième `ItemKind`. La
ligne d'appartenance reste explicitement distincte du placement hiérarchique,
donc déplacer une entrée ne change pas sa base.

**Alternatives considered**:

- Ajouter `database` à `ItemKind` : oblige chaque consommateur de page,
  dossier, fichier et hiérarchie à définir un quatrième comportement, alors
  qu'une base a déjà toutes les capacités structurelles d'une page.
- Créer un objet base avec une page hôte différente : introduit deux identités
  pour ce que le propriétaire perçoit comme un seul objet et complique liens,
  historique et restauration.
- Déduire l'appartenance du parent hiérarchique : un déplacement changerait le
  sens structuré et confondrait deux relations que le canevas impose de séparer.

## Decision 2 — Payloads protégés et projection de requête transitoire

**Decision**: Persister seulement les identités et métadonnées d'intégrité dans
`databases` et `database_entries`. Sceller le schéma, les vues et rôles dans
`database.definition`, puis les valeurs non relationnelles de chaque entrée
dans `database.entry-values`. Construire après ouverture une projection mémoire
atomique indexée par propriété ; ne jamais sérialiser cette projection.

**Rationale**: Les libellés, options, filtres, valeurs et associations de tâche
révèlent le contenu privé et doivent suivre la protection applicative existante.
PostgreSQL documente que `jsonb` et ses index rendent les valeurs
interrogeables, ce qui serait précisément une copie en clair au repos. Une
projection mémoire après authentification est la même frontière de déchiffrement
que l'affichage et la recherche 008. Un payload par entrée limite les ouvertures
et garantit une mise à jour atomique de toutes ses propriétés.

**Alternatives considered**:

- Colonnes ou `jsonb` typés en clair avec index SQL : rapides, mais
  incompatibles avec le chiffrement applicatif des valeurs privées.
- Une enveloppe par cellule : très granulaire, mais multiplie les opérations
  cryptographiques, écritures et versions à l'échelle de 100 000 entrées.
- Un index chiffré sérialisé : ajoute invalidation, migration et rotation d'un
  artefact dérivé volumineux sans nécessité fonctionnelle.
- Déchiffrer toutes les entrées à chaque requête : simple au repos, mais ne peut
  pas satisfaire la cible interactive répétée.

**Sources**:

- PostgreSQL, choix `json`/`jsonb`, concurrence et indexation :
  https://www.postgresql.org/docs/current/datatype-json.html
- PostgreSQL, index sur expressions :
  https://www.postgresql.org/docs/current/indexes-expressional.html

## Decision 3 — Des valeurs discriminées et canoniques

**Decision**: Utiliser une union discriminée commune : texte Unicode, décimal
canonique en chaîne, date civile `YYYY-MM-DD`, instant RFC 3339 UTC, UUID
d'option, ensemble ordonné d'UUID pour multi-sélection, booléen, et relations
canoniques. La propriété titre est virtuelle et lit `item.name`. Une valeur
absente n'est pas encodée comme zéro, faux ou chaîne vide.

Les nombres sont validés, normalisés et comparés avec decimal.js-light 2.5.1 à
partir de chaînes. Les dates civiles ne passent jamais par un instant. Les
instants sont normalisés en UTC ; `Intl.DateTimeFormat` ne sert qu'à
l'affichage.

**Rationale**: Le contrat ne dépend ainsi ni du séparateur décimal local, ni du
fuseau, ni de la précision IEEE-754. L'identité d'option survit aux renommages et
réordonnancements. La distinction absence/valeur rend les filtres `is-empty`
et `is-not-empty` exacts.

**Alternatives considered**:

- `number` JavaScript : une saisie de plus de 15 chiffres peut changer avant
  d'être persistée et diverger entre affichage et filtre.
- ISO datetime pour toute date : une date civile peut changer de jour après un
  changement de fuseau.
- Libellé de sélection comme valeur : renommer une option réécrirait toutes les
  entrées et casserait les références de vues.
- Temporal/polyfill : utile pour les calculs calendaires avancés, mais cette
  feature n'a besoin que de valider une date civile et un instant ; `Intl` et
  des parseurs stricts partagés suffisent.

**Sources**:

- decimal.js-light, décimaux arbitraires et absence de dépendances :
  https://github.com/MikeMcl/decimal.js-light
- `Intl.DateTimeFormat`, formatage local explicite :
  https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Intl/DateTimeFormat

## Decision 4 — Un évaluateur commun, pas les row models de l'interface

**Decision**: Le domaine implémente validation, ALL/ANY, opérateurs typés,
groupes, ordre multi-critères et départage par `entryId`. Serveur et client
local l'utilisent sur leurs projections. TanStack Table reçoit des lignes déjà
filtrées, triées et paginées en modes manuels ; TanStack Virtual réduit seulement
le rendu DOM.

**Rationale**: Une table qui trie seulement les 100 lignes reçues ne produit pas
le même résultat qu'un serveur qui trie 100 000 entrées. Les documents TanStack
séparent explicitement état de table, traitement manuel et virtualisation. Le
moteur headless laisse à MyOwnNotion le balisage, le style et les contrôles.

**Alternatives considered**:

- Row models TanStack côté navigateur : correct uniquement quand toutes les
  données sont présentes, donc faux pour une projection locale partielle ou une
  page serveur.
- Une grille commerciale complète : ajoute licence, modèle d'état et rendu
  difficiles à aligner avec le chiffrement, l'offline et l'identité visuelle.
- Un composant table entièrement maison : reconstruit état de colonnes,
  redimensionnement et virtualisation sans bénéfice produit.

**Sources**:

- TanStack Table, moteur headless :
  https://tanstack.com/table/latest/docs/framework/react/quick-start
- TanStack Table, filtrage manuel serveur :
  https://tanstack.com/table/latest/docs/framework/react/guide/column-filtering
- TanStack Table, tri manuel serveur :
  https://tanstack.com/table/latest/docs/framework/react/guide/sorting
- TanStack Table, pagination manuelle :
  https://tanstack.com/table/v9/docs/framework/react/guide/pagination
- TanStack Table + Virtual, responsabilités séparées :
  https://tanstack.com/table/latest/docs/framework/react/guide/virtualization
- TanStack Virtual React :
  https://tanstack.com/virtual/latest/docs/framework/react/react-virtual

## Decision 5 — Curseurs liés à la génération et à la vue

**Decision**: `POST /v1/databases/{databaseId}/query` accepte une identité de
vue et un curseur opaque. Le curseur est authentifié et lie la base, la vue, la
révision de définition, la génération de projection et la dernière clé d'ordre.
Un changement de ces éléments retourne `database.cursor-stale` ; le client
recharge à partir de la première page en conservant son contexte visible.

L'aperçu d'une modification destructive produit séparément un digest d'impact
déterministe lié à la révision, à la définition candidate et aux identités
affectées. Une projection locale complète peut calculer le même digest hors
ligne. Le serveur le recalcule avant commit et refuse une confirmation devenue
obsolète.

**Rationale**: Un offset sur une collection modifiée crée doublons et omissions.
Une clé seule ne suffit pas si le filtre ou le schéma change. Le curseur ne doit
pas exposer les valeurs privées utilisées pour l'ordre.

**Alternatives considered**:

- Offset/limit : instable sous insertion, suppression ou déplacement Kanban.
- Sérialiser les valeurs de tri dans le curseur : fuite vers historique,
  diagnostics ou outils réseau.
- Session de requête persistée : stocke les filtres privés et ajoute un état à
  expirer alors qu'une signature de curseur suffit.

## Decision 6 — Relations de propriété dans le graphe canonique existant

**Decision**: Représenter chaque cible active d'une valeur relation par un
`Relationship` de type `database:property`. Les métadonnées protégées portent
`databaseId` et `propertyId`. Le payload de valeurs ne duplique pas ces
cibles.

**Rationale**: Les endpoints, révisions, états de suppression et règles de
référence existent déjà. Cette forme garde les relations de propriété visibles
pour la future feature 010 sans créer un second graphe. Renommer ou déplacer la
cible n'affecte pas l'UUID.

**Alternatives considered**:

- UUID de cible dans le JSON de valeurs uniquement : simple pour la vue mais
  invisible aux contrôles de cycle de vie et au futur graphe.
- Écrire à la fois JSON et `relationships` : deux sources canoniques peuvent
  diverger après reprise ou conflit.
- Backlink/propriété réciproque automatique : hors périmètre 009 et impose une
  politique de schéma non demandée.

## Decision 7 — Fusion structurée par identités stables

**Decision**: Étendre la réconciliation avec deux fusions à trois voies :
`DatabaseDefinition` et `EntryValues`. Une modification sur deux identités
ou champs distincts fusionne ; le même champ modifié différemment, ou supprimé
d'un côté et modifié de l'autre, devient un conflit explicite. Une résolution
crée une révision à deux parents.

**Rationale**: Le critère du produit est l'intention, pas le moment d'arrivée.
Les propriétés, vues, options et valeurs ont des UUID qui permettent une fusion
champ par champ sans horloge globale. Réutiliser la lignée 006 garantit que les
versions originales restent atteignables.

**Alternatives considered**:

- Last-write-wins : détruit silencieusement une valeur ou configuration.
- Conflit sur toute modification de la même base : transforme des changements
  indépendants en interruptions inutiles.
- CRDT général : bien plus large que les ensembles de champs typés et n'élimine
  pas les décisions sémantiques comme le changement de type.

## Decision 8 — Accessibilité spécifique à chaque vue

**Decision**: Utiliser un `grid` ARIA uniquement pour la table éditable, avec
navigation par flèches, Entrée/F2 pour entrer en édition et Échap pour revenir à
la cellule. Les autres vues utilisent listes, régions et boutons natifs. Tout
drag-and-drop Kanban ou calendrier a une commande clavier équivalente nommée.

**Rationale**: Le WAI-ARIA APG précise qu'un grid est un widget composite et que
l'auteur doit gérer le focus ; l'appliquer à toutes les cartes ajouterait de la
complexité sans bénéfice. La virtualisation doit conserver `aria-rowcount`,
les indices et le retour de focus même lorsque seules quelques lignes sont
montées.

**Alternatives considered**:

- Table HTML statique : sémantiquement excellente pour la lecture mais chaque
  contrôle éditable rejoint le cycle Tab et devient impraticable à grande
  échelle.
- `grid` sur Kanban, galerie et calendrier : surcharge leurs structures
  naturelles et crée plusieurs modèles de flèches concurrents.
- Glisser-déposer seul : exclut clavier et technologies d'assistance.

**Source**:

- WAI-ARIA Authoring Practices, pattern Grid :
  https://www.w3.org/WAI/ARIA/apg/patterns/grid/

## Decision 9 — Intégrations transversales atomiques

**Decision**: Étendre snapshot, change feed, export, sauvegarde, restauration et
recherche dans la même feature. Une mutation structurée publie ses changements
uniquement après le commit canonique. La recherche reçoit les champs actifs par
identité d'entrée ; les sauvegardes transportent tables, enveloppes, relations
et révisions ; la corbeille d'une base traite hôte et entrées dans une même
transaction.

**Rationale**: Une base visible mais absente d'un snapshot, d'une sauvegarde ou
du rattrapage n'est pas une fonctionnalité local-first. Une mise à jour dérivée
avant commit créerait un résultat fantôme en cas de rollback. L'intégration dans
les frontières existantes garde un seul ordre et une seule preuve de santé.

**Alternatives considered**:

- Sauvegarde ou recherche dans une feature ultérieure : contredit les critères
  explicites FR-041 à FR-045.
- Flux de changements structuré séparé : crée deux curseurs dont l'ordre relatif
  est impossible à reconstruire après une interruption.
- Corbeille entrée par entrée après celle de la base : laisse un état partiel
  observable et rend la restauration ambiguë.
