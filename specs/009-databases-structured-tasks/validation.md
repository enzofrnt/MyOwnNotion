# Validation — Feature 009

## Checkpoint US1 — collection structurée de pages

**Date**: 2026-08-20

**Résultat**: réussi

Le parcours MVP crée une base comme capacité d'une page canonique, ajoute les
huit types de propriété requis, crée une entrée qui reste une page éditoriale,
enregistre ses valeurs et conserve une relation après renommage et déplacement
de sa cible. Aucun `ItemKind` supplémentaire n'a été introduit.

### Preuves exécutées

| Couche | Preuve | Résultat |
| --- | --- | --- |
| Domaine | Parsing strict, normalisation et rejeu des quatre commandes structurées | 12 tests réussis |
| PostgreSQL | Création, appartenance unique, relations, conversion, rollback et conservation des snapshots | 6 tests réussis |
| API propriétaire | Création/lecture/remplacement de base et d'entrée, aperçu d'impact et erreurs sûres | 4 tests réussis |
| Projection locale | Commit optimiste atomique, préparation crypto hors transaction, rollback et rejeu | 4 tests réussis |
| React | Formulaire, schéma, saisie refusée conservée, valeur décimale et panneau d'entrée | 5 tests réussis |
| Navigateur | Création, huit types, entrée-page, valeurs, relation, renommage et déplacement | 5 profils réussis |

Le parcours navigateur a terminé en 1,8 à 4,2 secondes selon le profil, sous la
limite fonctionnelle de cinq minutes. Il a réussi sur Chromium desktop/mobile,
WebKit desktop/mobile et Firefox desktop dans le conteneur Linux documenté.

### Identités et stockage protégé

- `databaseId === itemId` pour la page hôte ; l'entrée réutilise pareillement
  son `entryId` comme identité de page.
- Le renommage et le déplacement de la cible ne modifient pas l'identité
  stockée par la propriété relation ; le picker résout ensuite le nouveau nom.
- La définition et les valeurs sont scellées avant leur écriture dans les
  projections serveur et navigateur. Les tables structurelles ne portent que
  les identités, versions, états et clés nécessaires aux requêtes.
- Les échecs d'outbox, les fins de transaction injectées et les rejeux ne
  laissent ni demi-base ni doublon observable.

### Corrections issues du parcours réel

- Les imports CommonJS de `decimal.js-light` utilisent désormais un pont ESM
  explicite, vérifié par l'exécution native des migrations et pas seulement par
  le bundler de tests.
- Les requêtes partageant un client PostgreSQL transactionnel sont séquentielles,
  conformément au comportement requis par pg 9.
- Un accusé serveur qui remplace une révision locale pendant une saisie peut
  être rejoué sans perdre le brouillon ; un véritable changement concurrent de
  définition ou de valeurs reste refusé.

## Checkpoint US2 — vues table et liste enregistrées

**Date**: 2026-08-20
**Résultat**: réussi

Une même base est consultée et modifiée dans des vues table et liste sans
dupliquer ses entrées. Les vues enregistrent leur nom, ordre, colonnes,
largeurs, filtres ALL/ANY, tris ordonnés et regroupement. La sélection de vue,
la position interne et le retour de focus survivent à l'ouverture d'une
entrée ; un second navigateur retrouve le même résultat canonique.

### Preuves exécutées

| Couche | Preuve | Résultat |
| --- | --- | --- |
| Projection serveur | Génération atomique, index présence/égalité, upsert, invalidation et reconstruction | 4 tests réussis |
| Contrat API | Query, pagination sans doublon, curseur signé lié à la vue, cursor-stale et degraded | 6 tests réussis |
| Mutation batch | Mise à jour post-commit de la projection après une écriture offline | 10 tests de réconciliation réussis |
| Projection locale | Résultat complet/partiel, parité d'ordre et recalcul après commit | 3 tests réussis |
| Domaine | ALL/ANY, titre contient, tri stable, groupes et opérandes typés | 6 tests réussis |
| React | Barre de vues, période de dates, historique de position, table ARIA et liste sémantique | 8 tests US2 réussis |
| Navigateur | Édition de cellule, filtres, tri, groupe, colonnes, renommage, reload, focus et second appareil | 5 profils réussis |

La matrice navigateur a réussi sur Chromium desktop/mobile, WebKit
desktop/mobile et Firefox desktop dans le conteneur Linux documenté.

### Parité, couverture et persistance

- Le moteur local et la projection serveur utilisent la même définition
  enregistrée et le même départage stable par identité. Un résultat local
  partiel annonce `X/Y` et ne présente jamais son absence ou ses groupes comme
  exhaustifs.
- Les curseurs sont opaques, authentifiés et liés à la base, à la vue, à la
  révision de définition et à la génération. Un curseur périmé recharge la
  première page sans exposer le curseur refusé.
- La table suit le modèle ARIA grid à un seul point d'entrée, flèches,
  Home/End, Entrée/F2, Échap, annonce d'édition et commandes explicites de
  redimensionnement. Les cellules typées peuvent être modifiées directement.
- Le contexte de vue est conservé par onglet sans saturer l'API History de
  WebKit ; le scroll interne et la sélection sont restaurés avant le retour de
  focus. La liste garde une structure native.
- Une projection qui échoue au démarrage reste reconstructible : la première
  mutation confirmée réapplique les changements après commit, et la remise à
  zéro E2E supprime explicitement les anciennes enveloppes protégées.

### Corrections issues de la matrice réelle

- Les mutations batch alimentent désormais la projection structurée comme les
  routes unitaires ; auparavant un client offline pouvait rester bloqué sur
  une projection degraded vide.
- Les contextes de scroll utilisent un stockage de session et limitent les
  écritures History aux changements d'URL. WebKit refusait plus de cent
  `replaceState` en dix secondes et démontait alors la vue.
- Le runner local fournit aussi au pré-migrateur Firefox ses fixtures de clé et
  de sauvegarde jetables, exigées par le garde de migration avant le lancement
  du conteneur.

## Checkpoint US3 — tâches structurées qui restent des pages

**Date**: 2026-08-20
**Résultat**: réussi

Une base peut associer explicitement ses propriétés existantes aux rôles de
statut, échéance et priorité. Ces rôles ne créent aucune donnée parallèle : une
tâche reste l'unique page d'entrée, avec ses propriétés, ses relations et son
document éditorial dans le même parcours. La recherche locale et serveur trouve
les textes et libellés structurés et indique la propriété responsable du match.

### Preuves exécutées

| Couche | Preuve | Résultat |
| --- | --- | --- |
| Domaine | Rôles compatibles, projection sans duplication, recherche structurée, identité unique et checkbox sans commande de base | 31 tests réussis |
| Projection locale | Hydratation active, contenu offloaded non révélé, réindexation après valeur/rôle et fusion locale/serveur | 10 tests réussis |
| Projection serveur | Expansion base-vers-entrées, métadonnées de versions et lecture des enveloppes protégées | 13 tests d'intégration réussis |
| API et contrat | Recherche par valeur, statut renommé, propriété correspondante et schéma OpenAPI | 12 tests API et 35 tests OpenAPI réussis |
| React et worker | Configuration des rôles, panneau tâche/page, index transitoire et libellé de propriété | 24 tests ciblés réussis |
| Navigateur | Rôles, notes, statut, échéance, priorité, relation, recherche et checkbox éditoriale | 5 profils réussis en 24 s |

La matrice navigateur a réussi sur Chromium desktop/mobile, WebKit
desktop/mobile et Firefox desktop dans le conteneur Linux documenté. Format,
lint et typecheck sont également verts ; le lint conserve trois avertissements
de spécificité CSS déjà suivis sans erreur bloquante.

### Invariants vérifiés

- `TaskRoleMapping` référence seulement les identités stables de propriétés
  actives et compatibles ; un renommage conserve le rôle sans remappage par nom.
- L'activation, la désactivation ou le changement d'un rôle ne supprime aucune
  valeur et n'est donc pas classé comme changement destructif. Le retrait ou la
  conversion d'une propriété reste soumis à l'aperçu d'impact.
- Les valeurs d'une entrée offloaded ne sont jamais ouvertes pour enrichir la
  recherche locale. Le serveur et le client reconstruisent leur index en
  mémoire depuis les enveloppes autorisées, sans index privé persistant.
- Une recherche retourne au plus un résultat par identité de page, avec
  `matchedField=property`, `propertyId` et `propertyName` lorsque la propriété
  structurée porte le match.
- Une checkbox TipTap appartient uniquement au document de la page : la cocher
  ne crée ni ne modifie une entrée ou une valeur structurée.

### Corrections issues du parcours réel

- Les sauvegardes successives de rôles sont sérialisées dans l'interface. Les
  contrôles restent désactivés jusqu'à la confirmation locale, ce qui empêche
  deux changements rapides de partir depuis la même ancienne révision.
- Le calcul d'impact distingue désormais un remappage sémantique, qui conserve
  les valeurs, d'un retrait ou changement de type réellement destructif.
- Le parcours accepte aussi bien une entrée déjà convertie au document par
  blocs qu'une ancienne entrée nécessitant encore la conversion explicite.

## Preuves US5 — stockage local structuré

**Date**: 2026-08-20
**État**: stockage, synchronisation, conflits et restauration validés ; parcours
E2E multi-appareils à suivre

- La migration Dexie v5 vers v6 conserve le curseur existant et ajoute les
  stores protégés ainsi que l'index composé `databaseId/availability`.
- Définitions et valeurs restent scellées au repos et sont relues avec la même
  identité après fermeture/réouverture de la projection.
- Une base n'est annoncée prête hors ligne que si sa définition et toutes ses
  appartenances attendues possèdent des valeurs présentes. Une valeur
  déchargée conserve son appartenance mais rend la couverture partielle.
- L'intention hors ligne épingle les valeurs structurées. Sans épinglage, le
  déchargement est refusé dès qu'une mutation ou un conflit local touche la
  base ou l'entrée.
- Un échec de préparation cryptographique ou un arrêt simulé entre préparation
  et transaction ne laisse aucun item, placement, schéma, révision ou message
  d'outbox partiel. Le rejeu d'une création d'entrée conserve déjà la même
  mutation et les mêmes révisions locales.

Les 9 tests ciblés de stockage et mutation locale réussissent, ainsi que le
typecheck complet du monorepo.

### Transport et application atomique du rattrapage

- Le change feed transporte avec chaque séquence les items affectés, les
  relations actives, les définitions versionnées et les appartenances avec le
  payload `EntryValues` complet. Les nouveaux champs restent optionnels à la
  lecture pour accepter un serveur antérieur à 009.
- Le snapshot émet toujours les quatre ensembles triés. Son SHA-256 utilise un
  ordre canonique des clés, donc il est recalculable depuis la réponse JSON et
  ne dépend pas de l'ordre interne des objets TypeScript.
- Les métadonnées de relation, définitions et valeurs sont ouvertes par la même
  couche protégée que les lectures unitaires avant d'entrer dans le transport.
- Dexie prépare les enveloppes avant la transaction, remplace les ensembles
  canoniques et le curseur ensemble, et ne touche ni à l'outbox ni aux conflits.
  Une enveloppe de changement remplace aussi l'ensemble sortant de relations de
  sa source, ce qui transporte une suppression sans faux état intermédiaire.

Le test contrat API complet de réconciliation (11 scénarios), le test
d'intégration PostgreSQL du change feed, les 22 tests ciblés de projection et
réconciliation locale, ainsi que le typecheck complet réussissent.

### Fusion et résolution structurées

- Les définitions fusionnent par identités stables de propriété et de vue ; les
  valeurs et relations fusionnent par identité de propriété. Deux champs
  distincts sont rebasés automatiquement sur la tête distante.
- Une divergence sur le même champ conserve durablement l'ancêtre, la version
  locale et la version distante dans le conflit. Une mutation ne peut être
  fusionnée automatiquement qu'une fois par passe de réconciliation.
- La résolution compare les trois versions champ par champ pour schéma, vue,
  valeur et relation. Les choix explicites de l'utilisateur s'appliquent aux
  seuls champs divergents tandis que les changements compatibles des deux
  appareils restent dans le résultat revu avant sauvegarde.
- Les commandes de résolution de définition et de valeurs exigent exactement
  deux révisions distinctes, deviennent la nouvelle tête et écrivent deux
  arêtes parentes. Le conflit local n'est supprimé qu'après l'écriture durable
  de la résolution dans l'outbox.
- Une résolution de schéma destructive repasse par l'aperçu d'impact et exige
  le choix explicite de préserver ou de supprimer les valeurs incompatibles.

Les 25 tests domaine ciblés de commandes et fusion, les 36 tests client ciblés
de réconciliation/outbox/résolution, les 7 tests d'intégration PostgreSQL des
bases, les 2 tests React de résolution structurée et le typecheck complet
réussissent. Le lint ne signale que les trois avertissements CSS préexistants.

### Export et sauvegarde restaurable

- Le format canonique d'export passe en version 2 et transporte, dans un ordre
  stable, les définitions de base et les appartenances avec leurs valeurs. Les
  relations de propriété restent dans l'ensemble canonique des relations afin
  de ne pas dupliquer leur source de vérité.
- Les définitions et valeurs sont ouvertes par la couche de contenu protégé
  avant export. Le digest canonique couvre donc leur contenu lisible et détecte
  toute altération de l'archive complète.
- Le manifeste de sauvegarde ajoute les comptes de bases et d'entrées ainsi
  qu'un digest structuré indépendant. Leur présence groupée permet de lire les
  anciennes archives tout en refusant un manifeste 009 partiel ou incohérent.
- La restauration vide les tables structurées dans l'ordre des dépendances,
  recrée leurs enveloppes protégées, leurs relations et leurs révisions, puis
  reconstruit le snapshot courant utilisé par les mutations suivantes.
- La sauvegarde de référence antérieure à 009 reste restaurable et produit
  explicitement zéro base et zéro entrée structurée.

Les 32 tests domaine ciblés d'export et de manifeste, les 40 tests contrat API
d'export/archive/restauration et les 6 tests d'intégration PostgreSQL de
restauration réussissent. Le typecheck complet et le lint réussissent ; le lint
ne signale que les trois avertissements CSS préexistants.
