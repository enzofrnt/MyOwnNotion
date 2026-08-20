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
**État**: stockage, synchronisation, conflits, restauration et parcours
multi-appareils validés

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

### Compatibilité du protocole 2

- Le serveur et le client web courant annoncent le protocole 2 sur leurs
  requêtes. Un client sans en-tête est interprété comme le client historique de
  protocole 1 plutôt que comme un client courant implicite.
- Le protocole 1 reste autorisé en lecture mais reçoit une réponse 426 avant
  toute écriture, avec la version 2 requise et une explication indiquant que le
  contenu n'est pas perdu.
- Un test de contrat tente une création de base depuis un client 1, vérifie le
  refus, puis confirme que la lecture reste disponible et qu'aucune base n'a été
  créée. Le parcours E2E de compatibilité exerce la même fenêtre depuis le
  navigateur.
- Le harnais API annonce le protocole courant par défaut ; le test de la barrière
  est le seul à contrôler manuellement l'en-tête, notamment pour prouver le cas
  du client historique silencieux.

Les 10 tests ciblés de protocole, les 1 032 tests de contrat API et workspace,
les 1 262 tests unitaires, le typecheck complet et le format réussissent.

### Confidentialité des surfaces serveur

- Le sérialiseur de requête retire toujours la chaîne de requête et n'autorise
  que méthode, chemin sans paramètres et identité de corrélation. Les requêtes
  structurées privées restent dans un corps POST authentifié.
- La redaction récursive couvre désormais définitions, propriétés, options,
  vues, rôles de tâche, libellés, valeurs, relations, filtres, tris, groupes et
  métadonnées, y compris lorsqu'ils sont imbriqués dans un objet applicatif.
- Les erreurs conservent leur type mais perdent message, pile et cause. Le cas
  `logger.error(error)`, où Pino aurait promu le message privé en message de
  journal, reçoit un libellé fixe ; les messages statiques explicites restent
  disponibles pour le diagnostic.
- Les codes d'erreur et de dégradation de projection structurée appartiennent
  au vocabulaire sûr du domaine. La route de requête les convertit par le même
  chemin de problème allowlisté que les autres erreurs, sans refléter curseur,
  filtre, libellé ou valeur.
- Des sentinelles placées dans une définition, un libellé d'option, une valeur,
  un filtre, une relation et un message d'erreur sont absentes des journaux et
  réponses ; les UUID, compteurs et codes nécessaires au diagnostic restent
  présents.

Les 49 tests ciblés domaine/API, les 264 tests de sécurité, l'analyse statique de
571 fichiers, le scan de secrets de 799 fichiers et le typecheck complet
réussissent. Les suites complètes repassent également avec 1 263 tests unitaires
et 1 034 tests de contrat ; le lint ne conserve que les trois avertissements CSS
préexistants.

### Parcours complet hors ligne et deux appareils

- Un premier appareil modifie hors ligne la définition, la présentation d'une
  vue et une valeur, redémarre avec le réseau toujours coupé et retrouve ses
  changements dans la projection locale protégée.
- Un second appareil modifie un champ distinct. La reconnexion fusionne les deux
  intentions sans intervention ; le rebase crée une nouvelle identité de
  mutation afin que l'idempotence serveur ne rejoue pas le refus terminal de la
  commande d'origine.
- Deux changements incompatibles du même champ produisent un conflit durable.
  L'écran de résolution présente ancêtre, local et distant, puis la résolution
  choisie devient une révision à exactement deux parents.
- Une valeur structurée déchargée conserve l'identité et l'appartenance de la
  page, mais la vue hors ligne annonce explicitement `Local data partial: 0 of
  1` et n'affiche pas une absence comme un résultat complet.
- Chaque profil joint la mesure brute de propagation distante au rapport
  Playwright. Cette mesure de parcours n'est pas utilisée seule comme preuve du
  p95 de SC-004, qui appartient au benchmark de performance dédié.
- Les diagnostics d'échec du parcours ne collectent que types de commande,
  codes, identités de révision, chemins et raisons sûres ; aucune définition ni
  valeur privée n'est attachée.

| Couche | Preuve rejouée | Résultat |
| --- | --- | --- |
| Client local | Stockage, crash atomique, fusion, rebase, outbox et résolution | 42 tests réussis |
| API | Flux ordonné, snapshot vérifié et export structuré | 12 tests réussis |
| PostgreSQL | Change feed, sauvegarde de référence et garde de migration | 3 tests réussis |
| Navigateur | Redémarrage offline, fusion, conflit, résolution, propagation et couverture partielle | 10 tests réussis sur 5 profils |

La matrice navigateur a réussi sur Chromium desktop/mobile, WebKit
desktop/mobile et Firefox desktop en 41 secondes. Le parcours a aussi révélé et
verrouillé deux cas de compatibilité : une fusion rebasée ne réutilise plus
l'identité d'une mutation déjà refusée, et la sauvegarde préalable à la
migration 009 traite une installation antérieure aux tables structurées comme
un export vide au lieu d'interroger des tables encore absentes.

## Checkpoint US4 — cinq vues sur une identité canonique

**Date**: 2026-08-20
**Résultat**: réussi

Kanban, galerie et calendrier complètent table et liste sans créer de copie des
pages ni de commande spécialisée. Une carte déplacée change la valeur ordinaire
de statut/sélection ou de date ; la même identité et la même valeur deviennent
immédiatement observables dans les cinq vues.

### Preuves exécutées

| Couche | Preuve | Résultat |
| --- | --- | --- |
| React | Colonnes vides/manquantes, déplacement typé, propriétés galerie, aperçu sûr, dates civiles/instants, fuseau et zone non planifiée | 9 tests US4 réussis |
| Accessibilité | Audit axe critique/sérieux des cinq vues et présence des alternatives nommées au drag-and-drop | 5 profils réussis en 27 s |
| Parcours visuel | Pointeur, clavier, identité unique, retour de focus, largeur 320 px et zoom 200 % | 5 profils réussis en 26 s |
| Performance | Premières 100 lignes sur 100 000, propagation entre deux projections et 10 100 opérations locales mixtes | 3 benchmarks réussis |

La matrice couvre Chromium desktop/mobile, WebKit desktop/mobile et Firefox
desktop. Le responsive ne crée pas de scroll horizontal du document à 320 px
et zoom 200 % ; chaque surface longue possède son propre scroll. La règle
globale `prefers-reduced-motion` reste appliquée aux nouvelles vues.

### Vues et interactions

- Le Kanban dérive toutes les colonnes actives de la propriété statut ou
  sélection, conserve leur ordre enregistré et ajoute la colonne sans valeur.
  Drag-and-drop, sélecteur et boutons précédent/suivant produisent la même
  commande de valeur et annoncent la cible atteinte.
- La galerie n'affiche que les propriétés choisies. Un aperçu de page provient
  uniquement du document déjà autorisé et présent ; un fichier n'est rendu que
  depuis une URL locale `blob:` ou une image raster `data:` sûre. Tous les
  autres cas ont un fallback explicite.
- Le calendrier groupe les dates civiles sans conversion et les instants dans
  le fuseau courant. Déplacer un instant conserve son heure locale ; les pages
  sans date restent actionnables dans la zone non planifiée.
- Les cartes longues de table, Kanban et galerie sont virtualisées avec
  overscan. Le tableau conserve `aria-rowcount`/`aria-rowindex`; les listes
  conservent `aria-setsize`/`aria-posinset`, l'identité stable et l'élément
  focalisé même lorsqu'il sort de la fenêtre rendue.

### Budgets mesurés et optimisations

- p95 première page 100/100 000 : table 177,5 ms, liste 175,0 ms, Kanban
  173,9 ms, galerie 173,9 ms, calendrier 172,8 ms, pour une cible inférieure à
  1 000 ms.
- p95 de propagation vers la seconde projection : 446,6 ms, pour une cible
  inférieure à 2 000 ms.
- p95 des commits locaux structurés pendant 10 100
  créations/éditions/rejeux/corbeilles/restaurations : 2,6 ms, pour une cible
  inférieure à 300 ms, sans identité dupliquée ni entrée perdue.
- La première page utilise désormais une sélection top-K avec le comparateur
  canonique au lieu de trier les 100 000 lignes complètes. Le nombre total et
  les curseurs restent exacts ; les vues groupées conservent l'évaluation
  exhaustive nécessaire à leurs comptes.

### Corrections issues des parcours réels

- Les commandes de création, duplication, ordre, suppression, renommage et
  présentation d'une vue sont verrouillées pendant leur sauvegarde. Deux clics
  rapides ne partent plus de la même ancienne révision de définition.
- Une propriété date absente démarre avec une valeur vide et non un tableau ;
  une entrée peut donc réellement rester non planifiée puis être programmée.
- L'accusé d'une création remplace ses révisions locales dans les mutations
  dépendantes avant leur envoi, et le lot causal s'arrête avant une dépendance
  locale. Une édition immédiate après création ne produit plus de faux conflit.
- Le rejeu d'une édition locale déjà appliquée retrouve l'outbox avant de
  revalider sa base devenue obsolète, et restitue les mêmes révisions sans
  réécriture.

## Checkpoint transversal — cycle de vie et confidentialité

**Date**: 2026-08-20
**Résultat**: réussi sur les preuves ciblées ; matrice complète à rejouer au gate

### Cycle de vie

- L'aperçu de mise à la corbeille compte les appartenances actives, y compris
  une entrée déplacée hors de la branche hiérarchique de sa base.
- La confirmation révise et met à la corbeille l'hôte, sa branche et toutes ses
  entrées actives dans une transaction. Une faute injectée ne laisse aucun état
  partiel.
- Toutes les révisions portent la même identité de mutation, utilisée comme
  groupe de restauration ; hôte, entrées déplacées, définition, valeurs et
  relations retrouvent leurs identités d'origine.
- Un tombstone `purged` conserve l'identité de convergence mais retire les
  définitions, appartenances, valeurs et projections structurées orphelines du
  snapshot et du flux local.

Les 2 tests d'intégration PostgreSQL du cycle de vie, les 8 tests contrat API
de base et les 11 tests locaux de requête/mutation réussissent.

### Confidentialité

- Les définitions, valeurs, relations et révisions structurées sont écrites
  dans leurs enveloppes applicatives ; les tables structurelles 009 ne portent
  que des identités et versions.
- La définition, les valeurs, les payloads d'outbox et les trois versions d'un
  conflit sont scellés dans IndexedDB. La passe de mise à niveau reseale aussi
  les anciennes files et conflits en clair, de manière idempotente.
- L'éviction ouvre les files protégées avant de décider : une page avec travail
  pending ou conflict reste irrécupérable et ne peut pas être déchargée.
- Un export prêt n'est plus conservé comme manifeste JSON en clair dans la
  table `exports`; il attend son téléchargement autorisé sous l'entité protégée
  `export.manifest`. La sauvegarde reste chiffrée avant le transfert.
- Les sentinelles structurées restent absentes des nouvelles surfaces
  PostgreSQL, d'IndexedDB, des URLs, journaux, diagnostics, erreurs et octets de
  sauvegarde externes, tout en étant présentes dans l'export propriétaire.

Les 3 tests API de sentinelles, les 25 tests locaux chiffrement/reseal/budget,
les 17 tests existants de contenu protégé et le parcours Chromium de sécurité
réussissent. Le typecheck complet réussit. Le test d'impact déclare les trois
nouveaux parcours 009 et ses 31 assertions réussissent.

## Checkpoint de convergence — quickstart, langue et fixture de référence

**Date**: 2026-08-20
**Résultat**: réussi avant le gate exact du commit final

Les sections 1 à 12 et 14 du quickstart ont été rejouées. La section 13 reste
le gate exact `checks:local`, suivi séparément par T111 afin qu'aucune
modification documentaire postérieure ne puisse invalider sa preuve.

### Langue active sans donnée dépendante des copies

- Les libellés, erreurs, annonces, noms de contrôles et noms par défaut de la
  009 sont centralisés dans le catalogue anglais de la feature. Les appels
  propres aux bases depuis la hiérarchie utilisent la même frontière.
- Les dates affichées suivent la locale active. Les calculs de dates civiles et
  d'instants gardent leur représentation canonique indépendante du texte.
- La création peut transmettre le nom localisé de la propriété titre. Son UUID
  et son type canonique `title` restent inchangés ; un client antérieur qui
  omet ce champ conserve le défaut compatible `Title`.
- Le test domaine prouve qu'une copie « Titre » produit toujours la même
  propriété typée et identifiée. Les 8 tests du contrat API prouvent le passage
  du nom sans l'utiliser pour l'identité ou la requête.
- La matrice structurée complète conserve exactement les textes anglais actifs
  et réussit sur Chromium desktop/mobile, WebKit desktop/mobile et Firefox
  desktop : 5 projets, 8 parcours par projet, soit 40 exécutions en 97 s.

### Fixture et budgets de référence

La fixture contient effectivement 40 propriétés, 20 vues et 100 000 relations,
une par entrée. La suite de performance complète compte 5 fichiers et 14 tests
réussis. Mesures de cette exécution :

- reconstruction simultanée de deux projections : 381,4 ms, avec un pic de
  heap échantillonné à 194,0 Mio ;
- p95 première page 100/100 000 : table 166,5 ms, liste 162,8 ms, Kanban
  161,8 ms, galerie 162,5 ms et calendrier 162,2 ms ;
- p95 de propagation vers une seconde projection : 526,5 ms ;
- p95 de commit local pendant 10 100 opérations mixtes : 17,7 ms, sans perte
  ni duplication.

Tous les budgets restent sous leurs seuils de 1 000 ms, 2 000 ms et 300 ms.

### Inventaire complet avant gate exact

| Contrôle | Résultat |
| --- | --- |
| Format | 616 fichiers, aucune différence |
| Lint | 617 fichiers, zéro erreur ; 3 avertissements CSS connus |
| TypeScript | 8 projets et configuration racine réussis |
| Unitaires | 102 fichiers, 1 284 tests réussis après ajout de la preuve de locale |
| Propriétés | 25 fichiers, 324 tests réussis |
| Intégration PostgreSQL | 31 fichiers, 311 tests réussis |
| Migrations | 1 fichier, 8 tests réussis |
| Contrats | 76 fichiers, 1 038 tests réussis |
| Sécurité | 14 fichiers, 267 tests réussis |
| Performance | 5 fichiers, 14 tests réussis |
| Playwright 009 | 5 profils, 40 exécutions de parcours réussies |

Les parcours réels ont aussi verrouillé quatre courses observables : un accusé
serveur ne remplace plus une saisie locale plus récente ; une réponse de requête
périmée ne réinitialise plus une vue nouvellement créée ; un refresh de
hiérarchie ancien ne démonte plus l'entrée sélectionnée ; et les objets JSONB
dont PostgreSQL réordonne les clés sont comparés canoniquement plutôt que pris
pour de faux conflits.

### Convergence Spec Kit

La passe finale a contrôlé 50 exigences fonctionnelles, 30 scénarios
d'acceptation, 11 critères mesurables, 12 cas limites, 7 décisions structurantes
du plan et les 8 principes de la constitution. Elle ne trouve aucun élément
`missing`, `partial`, `contradicts` ou `unrequested` et n'ajoute donc aucune
tâche de convergence supplémentaire.
