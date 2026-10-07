# Validation — démarrage progressif

## Périmètre et sélection des contrôles

La frontière de démarrage/synchronisation et le stockage local changent : le
gate complet `bun run checks:local` est requis par `docs/development.md`, après
les contrôles ciblés. Les modifications déjà présentes des features 038/039
sont conservées ; le gate porte sur le candidat exécutable partagé.

Les tests de données ne suffisent pas pour attester la fluidité : le parcours
E2E retient volontairement un lot pendant au moins cinq secondes, puis vérifie
la disponibilité, les états incomplets et la convergence. Les captures réelles
et la revue suivent ui-quality, son journal et le guide UI.

**État historique avant la demande de publication du 7 octobre 2026** : à la
demande explicite du propriétaire, les E2E
restants et la reprise du gate complet sont reportés. La priorité passe au
système de couleurs, fondé sur des mesures réelles de Notion. Les contrôles déjà
engagés ont été terminés et leurs résultats sont conservés ci-dessous ; aucun
nouveau E2E ni gate complet n'est lancé pour cette mise à jour documentaire.
La feature 040 n'est pas déclarée convergée : T008/T010/T013/T014/T015/T016/T017
et la validation globale de T018 restent ouvertes.

## Contrôles ciblés

- Client-core : 23 tests de reconciliation/database passent.
- Services Web : 63 tests de démarrage, activation éditoriale, temps réel,
  transferts, notifications et sérialisation passent.
- Revue finale du service : 10 tests de démarrage passent, dont un callback
  du dernier lot tenu en attente. La notification finale et la résolution
  du drain attendent cette publication.
- Navigation : tests des routes partielles, restauration et nombres d'enfants
  inconnus ; première exécution groupée 51 tests avec recherche/fusion.
- Recherche, worker, dialogue, fusion par lots : 46 tests passent, dont cent
  notifications inutilisées sans lecture et première recherche pendant des
  notifications continues.
- Bases : 34 tests passent, dont cinq cas de couverture progressive, vide
  véritable seulement après completion, indisponibilité/erreur et reprise.
- Revue T017 finale : 59 tests helper/surface/wrapper passent, dont refus d'une
  modification de structure avant lecture d'impact, fallback normalisé en
  couverture partielle et renommage de source autorisé pendant cette découverte.
- Types Web et client-core, Biome sur les fichiers modifiés par ce chantier :
  passent dans les exécutions ciblées.

Logs privés : `work/notion-api/040-*` et sorties ciblées des agents. Ces familles
se recoupent ; les nombres ne représentent pas une somme de tests distincts.

## Mesure bornée du travail dérivé

Pour un lot synthétique de 200 renommages, trois chauffes et dix mesures
intercalées : médiane de fusion à 1 097 éléments, 1,43 → 0,156 ms ; à 10 000
éléments, 10,54 → 0,438 ms. Résultat final byte-identique, références des éléments
inchangés conservées. Cette mesure exclut IndexedDB, déchiffrement, réseau et
rendu : elle atteste seulement la suppression des scans répétés du catalogue.

## Revues et décisions de sûreté

- Le préchargement racine ne modifie jamais le curseur du journal ; avant et
  après le réseau, une garde sous verrou laisse gagner tout travail local.
- Un marqueur absent signifie couverture inconnue, même avec un ancien curseur.
  Seul le dernier lot durable ou le snapshot complet établit la completion.
- La couverture utilisée pour élaguer branches/onglets est liée au catalogue
  effectivement lu/accepté. Le callback de projection attend sa publication.
- Les bases intégrées/natives sans entrée connue attendent les memberships
  avant d'affirmer une base vide. Les données déjà présentes restent lisibles
  pendant une découverte partielle/hors ligne, sans faux total ni agrégat.
- Une première recherche observe une coupure finie des mises à jour, sans
  attendre une période de calme pendant un téléchargement continu.

## Vérification réelle et gate complet

La première exécution desktop a échoué dans l'intercepteur de test
(`Route is already handled`) : elle n'atteste pas le parcours entier. Après
correction du cleanup idempotent attendant les handlers, le parcours enrichi
avec une base intégrée aux entrées tardives passe : **2/2 tests Chromium desktop,
26,5 s**. Les PNG et mesures sont ensuite persistés explicitement pour la matrice
complète ; le reporter local `list` ne conserve pas les pièces jointes en mémoire
des tests réussis.

Le 409 `page-operations.not-active` observé sur la racine v2 est suivi du GET
item puis d'une activation 200 sans ambiguïté, avec vrai contenu affiché. Il
appartient au handover éditorial existant ; aucun contournement de ses barrières.

PostgreSQL de validation isolé : projet Compose `myownnotion-040-gate`, port
55434 ; aucune migration/remise à zéro de la base propriétaire 8080/8082.
Déploiement Web 8082 et revue manuelle restent à effectuer après validation.

Premier arrêt du gate : shfmt système 3.14.1 différent de la version 3.12.0
épinglée. Le binaire officiel 3.12.0 Darwin ARM64 est téléchargé dans le dossier
privé `work/notion-api/040-tools`, ajouté au PATH seulement pour le gate. Aucun
changement global de toolchain ni contrôle ignoré. Le gate complet reprend avec
Bun 1.4.2 et cette version épinglée.

Deuxième arrêt : outils PostgreSQL 18 absents du PATH du shell, déclenchant les
refus de sauvegarde et leur cleanup. Le chemin installé
`/opt/homebrew/opt/libpq/bin` fournit pg_dump/pg_restore 18.6 et sera ajouté au
PATH selon `docs/development.md:331`. Aucun changement du serveur propriétaire.
Cette exécution a passé 5 196 tests mais n'est pas une validation du gate.

Le contrat d'inventaire a aussi trouvé quatre parcours E2E non enregistrés,
dont le nouveau démarrage progressif et trois parcours déjà suivis par Git.
`ci/test-impact.json` enregistre leurs propriétaires ; le contrat ciblé passe.

La revue de migration a révélé un écart de lecture sur cache historique hors
ligne : masquer toutes les bases tant que le marqueur manque empêchait de lire
leurs entrées pourtant présentes. T017 distingue ces données connues d'une base
sans entrée connue, normalise résultats/fallback en couverture partielle et
annonce un total inconnu. La migration conservatrice du marqueur reste intacte.

Troisième exécution : **506 fichiers et 5 263 tests passent**, deux tests sont
ignorés par leurs conditions de plateforme existantes. Le gate de couverture
refuse 2 265 statements non couverts (plafond 2 216) et 2 760 branches (plafond
2 470). Les quatre fichiers client-core modifiés n'en représentent que 41 :
la dette visible concerne aussi les frontières de reprise existantes. T018
complète des tests de comportements liés à FR005, sans abaisser les seuils
ni exclure de code. Cette exécution reste un gate interrompu, pas une réussite.

## Dernier ciblé réel T017 : périmètre atteint et échec du test

Le dernier ciblé isolé Chromium desktop termine avec **1 test réussi et
1 test échoué, 34,1 s** (`work/notion-api/040-e2e-t017-isolated.log`). Le parcours
chaud passe entièrement : contenu local disponible avant le réseau, création
locale en attente, édition hors ligne, redémarrage, puis reprise HTTP avec
queue vide et contenu canonique convergent.

Le parcours froid passe jusqu'à la lecture native du cache historique :
racines actuelles, descendants partiels et message de chargement, racine v2
ouvrable, source intégrée déjà connue avec entrées tardives, découverte finale,
300 enfants ordonnés, première recherche, puis cache sans marqueur hors ligne.
La base intégrée conserve son entrée locale avec total inconnu et notice
honnête ; les assertions et captures à 320 px passent dans les deux thèmes.
La base native affiche aussi l'entrée locale, sa grille a déjà satisfait
`aria-rowcount="-1"`, et le snapshot ainsi que la capture montrent la notice
« Données locales disponibles. Reconnectez-vous pour charger les autres
entrées. ».

L'arrêt intervient à `tests/e2e/progressive-startup.spec.ts:452` : le sélecteur
`getByRole('main').locator('.database-container-page').getByTestId('database-discovery-state')`
renvoie deux nœuds DOM, la notice native active et celle de l'éditeur intégré
conservé dans une session `hidden`/`inert`. `getByTestId` ne filtre pas les nœuds
cachés ; les vérifications de grille par rôle, elles, ciblaient déjà la surface
visible. Il s'agit d'une ambiguïté du sélecteur de test, pas d'une absence de
données ou de notice produit. Le test devra cibler la surface native active
lors de la reprise autorisée. Aucun correctif E2E n'est appliqué à ce stade ;
les captures natives à 320 px et la matrice complète restent non attestées.

Mesures de ce ciblé : **413 ms** pour les racines et **304 ms** pour le cache
chaud ; lots retenus **5 002 ms / 5 000 ms**. Ce sont des mesures bornées sur
fixture locale, pas un benchmark du HAR ni du transfert complet.

Les logs, `error-context.md`, `trace.zip`, 19 captures originales (plus leurs
copies attachées) et les deux mesures JSON sont copiés dans le dossier privé
`work/notion-api/040-e2e-t017-evidence/`, afin qu'une future exécution Playwright
ne les remplace pas. La capture `test-failed-1.png` a été revue : la base native
et son entrée locale sont visibles, avec la notice hors ligne. Aucun accès ni
mutation des données de l'instance propriétaire n'a été nécessaire.

## Compléments de sûreté T018 après le gate interrompu

- Client, marqueur et publications : **95 tests ciblés passent**, dont les
  10 cas de callbacks de démarrage. Reconciliation par lots, migration du
  marqueur, reçus/frontières opérationnels et effets des rejets restent
  durables avant publication. Gain contre le dernier gate : **67 branches et
  47 statements** ; rapports dans
  `work/notion-api/040-coverage-client/after/`.
- Récupération des conflits historiques : **22 nouveaux tests passent** dans
  `packages/client-core/tests/legacy-conflict-recovery.spec.ts`. Ils renforcent
  les preuves d'ancêtres/drafts, la reprise des branches scellées et les refus
  conservant la source lorsqu'une conversion ne peut pas être prouvée. Gain
  mesuré : **32 branches et 33 statements** ; rapport dans
  `work/notion-api/040-coverage-recovery/lcov.info`. Types et Biome ciblé passent
  pour ces deux groupes.
- Serveur : **56 tests passent**, 29 gardes des bases de données et 27 gardes
  des opérations de pages. Ils couvrent notamment les métadonnées retenues
  indisponibles, présentations périmées, liens existants vers une source
  corbeillée, révocation, frontière locale non soumise, reçus dupliqués,
  checkpoint/journal endommagé, budget de téléchargement reprenable et détails
  protégés d'une vraie ambiguïté suppression/édition. Les refus conservent les
  sources, entrées, intentions et frontières durables. Biome et types
  API/database passent. Union avec le LCOV du dernier gate : **46 branches et
  41 lignes auparavant non couvertes**. Rapports privés :
  `work/notion-api/040-coverage-server/ambiguities/lcov.info` (API final) et
  `work/notion-api/040-coverage-server/combined/lcov.info` (bases).
- Intégrité éditoriale et contrats : **77 tests passent** dans cinq fichiers
  domain/page-state/contracts, portant sur les documents v2/v3, les blocs
  opaques, les arbres, les valeurs structurées et la frontière de transport.
  Résultat dans `work/notion-api/040-integrity-coverage-final.log`, rapport dans
  `work/notion-api/040-coverage-integrity/lcov.info`. L'invocation ciblée couvre
  peu de fichiers mais garde les seuils absolus de tout le dépôt : son code de
  sortie non nul au calcul global ne transforme pas les 77 tests réussis en
  réussite du gate de couverture.
- Intentions locales/outbox : **196 tests passent**, dont 39 nouveaux dans
  `packages/client-core/tests/outbox-resume-safety.spec.ts`. Ils couvrent l'ordre
  et le chiffrement après redémarrage, memberships non encore reçues, gardes
  de cardinalité/structure, relations, anciennes métadonnées de projection et
  rollback après préparation asynchrone. Le ciblé garde les plafonds existants
  et mesure **55 branches, 28 statements et 24 lignes** supplémentaires contre
  le dernier gate ; rapports privés
  `work/notion-api/040-coverage-outbox/lcov.info` et `gains.json`.
- Journal éditorial local : **102 tests passent**, dont 29 nouveaux dans
  `packages/client-core/tests/page-log-resume-safety.spec.ts`, sur durabilité des
  updates/frontières, relecture chiffrée et refus de pertes de données pendant
  la reprise. Gain mesuré : **32 branches, 26 statements et 24 lignes** ;
  rapports `work/notion-api/040-coverage-editorial/lcov.info` et `gains.json`.
  Types client-core et Biome ciblé passent pour ces deux groupes, qui ajoutent
  au total 68 nouveaux tests sans modifier la production.

Ces rapports s'ajoutent au LCOV global pour évaluer les gains ; ils ne
remplacent pas une nouvelle mesure complète. Les seuils existants restent
inchangés et aucune source n'est exclue. La reprise du gate complet, la matrice
E2E, le déploiement Web 8082 et la convergence attendent la suite demandée par
le propriétaire.

Cette mise à jour de preuves a seulement exécuté les contrôles documentaires :
`git diff --check`, résolution Spec Kit `--paths-only` sans changement du
pointeur de feature, présence de spec/plan/tasks, revue des références de
fichiers/preuves et cohérence des tâches de validation encore ouvertes.

## Limites

Le transfert total conserve le journal existant ; ce chantier accélère la
première disponibilité et supprime du travail dérivé, sans promettre un gain
de durée totale ni un plafond pour le corps d'une page racine très volumineuse.
Le HAR ne contient pas de métriques de premier rendu et reste hors du dépôt.
La fixture E2E utilise 300 enfants au même niveau et de petits corps. Le temps
de disponibilité inclut le boot et la navigation ; la durée du lot retenu
inclut les interactions/captures et ne mesure pas le débit total. Le cache legacy
est simulé par l'absence du marqueur dans le schéma actuel, pas par la migration
d'un ancien IndexedDB. HTTP et socket sont bloqués pour simuler le réseau
indisponible tout en gardant le shell accessible ; la reprise chaude est
démontrée par HTTP, sans prétendre mesurer la reconnexion socket.


## Reprise des parcours historiques de publication

La navigation rend maintenant les racines avant la fin du feed : le parcours
de pagination de 1 001 entrées attend explicitement cette fin avant de parcourir
les curseurs d'une source stable. Les assertions de pages de 100, absence de
doublon et dernière entrée virtualisée restent intactes. La première recherche
reste paresseuse ; le parcours hors ligne du bundle contrôlé sans service worker
ouvre ce module en ligne puis libère un contenu déjà indexé. Il vérifie ainsi
la revalidation de disponibilité, l'édition locale et la déduplication. Le
build de production précache les assets de workers. Les deux parcours passent
sans retry sur Chromium desktop et Firefox Linux épinglé ; le gate complet
et les parcours propres à 040 restent à terminer.
