# Validation: Recherche initiale du workspace

Ce document accumule les preuves par checkpoint. Toutes les tâches et le gate
local final sont validés.

## Checkpoint US1 — recherche complète en ligne

Statut : **validé sur Chromium desktop**. Le gate complet multi-navigateurs est
réservé à T068 et T069.

### Comportements prouvés

- construction isolée et échange atomique de génération ;
- refus explicite pendant le premier build et après une erreur d'intégrité ;
- mise à jour après commit pour les mutations simples, lots et imports de
  fichiers, y compris pendant une reconstruction concurrente ;
- rang titre avant corps, normalisation casse/accents, extrait textuel sûr,
  chemin courant et identité canonique ;
- requête privée dans le corps d'un POST propriétaire, jamais dans l'URL ;
- surface Web avec saisie vide, chargement, résultats, aucun résultat et erreur
  récupérable ;
- ouverture globale par `Ctrl/⌘ K`, navigation vers le résultat et conservation
  de la requête sans résultat.

### Résultats ciblés

| Preuve | Résultat |
| --- | --- |
| `apps/api/tests/search-service.spec.ts` + `search.contract.spec.ts` | 12/12 |
| `apps/web/tests/search-dialog.spec.ts` + `sidebar.spec.ts` | 9/9 |
| tests de rang domaine et service après correction du cas titre partiel/corps complet | 14/14 |
| repository de sources PostgreSQL | 5/5 |
| atomicité des mutations PostgreSQL | 10/10 |
| contrats OpenAPI et cartographie d'impact | 49/49 |
| `tests/e2e/search.spec.ts`, projet `chromium-desktop` | 1/1, 1,3 s |
| typecheck domain, database, API et Web | PASS |

### Défaut découvert par le parcours

Lorsqu'un seul terme de la requête apparaissait dans le titre et que tous les
termes apparaissaient dans le corps, MiniSearch signalait les deux champs. Le
titre devenait à tort la raison principale, masquant l'extrait de corps. Le
classement et le champ principal vérifient maintenant que le titre satisfait
tous les termes avant de le privilégier ; un test domaine protège ce cas.

## Checkpoint US2 — recherche locale et hors ligne

Statut : **validé sur Chromium desktop**. La matrice multi-navigateurs reste
réservée à T068 et T069.

### Comportements prouvés

- reconstruction du worker depuis la projection locale ouverte, sans index
  persistant ni lecture d'un corps `offloaded` ou `never-fetched` ;
- publication d'un upsert seulement après le commit local durable et retrait
  immédiat d'un item supprimé de la projection active ;
- résultat local visible pendant l'appel serveur, puis fusion par `itemId` sans
  doublon et avec priorité aux versions `pending` ou `conflict` ;
- couverture `local-only`, `offline`, `rebuilding`, `degraded` ou `complete`
  annoncée sans effacer les résultats fiables ;
- disponibilité locale hydratée jusque sur une correspondance trouvée seulement
  par le serveur ;
- titre d'une page déchargée toujours trouvable hors ligne, corps déchargé jamais
  inventé comme correspondance, et ouverture expliquant qu'une reconnexion est
  nécessaire ;
- vidage et terminaison du worker lors d'un verrouillage, d'une perte de clé ou
  du démontage de la session propriétaire.

### Résultats ciblés

| Preuve | Résultat |
| --- | --- |
| source locale et fusion client-core | 6/6 |
| worker, coordinateur local-first et rendu Web | 10/10 |
| récupération d'un index serveur dégradé après commit | 8/8 |
| `tests/e2e/search-offline.spec.ts`, projet `chromium-desktop` | 1/1, 1,5 s |
| typecheck client-core et Web | PASS |

### Défauts découverts par le parcours

- En mode développement strict, React simulait un démontage puis réutilisait le
  même service déjà fermé. Le service de recherche est maintenant créé dans
  l'effet qui en possède le cycle de vie, ce qui recrée correctement le worker.
- Une reconstruction serveur échouée au démarrage restait définitivement
  `degraded`. Un commit canonique ultérieur relance maintenant une reconstruction
  atomique, tout en conservant le refus fail-closed tant qu'elle échoue.
- Une page déchargée sans corps était ouverte comme un document vide. L'éditeur
  distingue maintenant explicitement `offloaded` et `never-fetched`.

## Checkpoint US3 — filtres, pagination et clavier

Statut : **validé sur les cinq variantes navigateur** (Chromium, Firefox et
WebKit, desktop et mobile).

### Comportements prouvés

- filtres combinables pages/dossiers/fichiers, portée à la racine et aux
  descendants actifs d'une branche, avec réinitialisation visible ;
- même portée appliquée à l'index complet et au worker local transitoire ;
- pagination par curseur opaque signé, lié à la requête normalisée, aux filtres,
  à la limite et à la génération, sans texte privé dans le curseur ;
- refus sûr d'un curseur mal formé et reprise automatique depuis la première
  page lorsque la génération a changé ;
- chargement progressif sans doublon et sans déplacer la sélection existante ;
- focus initial, flèches haut/bas, Entrée, Échap et retour au déclencheur ;
- annonces dédiées du nombre, de la couverture, de la sélection et d'un
  rafraîchissement après curseur périmé ;
- interface utilisable sans défilement horizontal à 320 pixels et à 200 % de
  zoom, avec préférence reduced-motion respectée ;
- absence de violation axe-core critique ou sérieuse sur la surface ouverte.

### Résultats ciblés

| Preuve | Résultat |
| --- | --- |
| contrats et service API, filtres/branche/curseur inclus | 26/26 |
| source locale, worker, fusion, coordinateur et rendu Web | 24/24 |
| typecheck domain, client-core, API et Web | PASS |
| parcours filtres/clavier/320 px/zoom, cinq projets Playwright | 5/5 |
| audit axe-core de la recherche, cinq projets Playwright | 5/5 |

### Défauts découverts par le parcours

- Une assertion cherchait le nom de la branche dans toute la ligne et confondait
  le chemin d'une page descendante avec le titre du dossier filtré. Le scénario
  vérifie désormais le titre canonique du résultat.
- Le scénario attendait un retour vers le bouton latéral après une ouverture au
  raccourci depuis le corps de page. Il fixe maintenant explicitement le
  déclencheur avant l'ouverture et prouve le retour de focus prévu.

## Checkpoint US4 — fraîcheur, reprise, sécurité et volume

Statut : **validé dans la frontière de responsabilité de la recherche**.
L'état canonique `purged` et son retrait de la recherche sont prouvés en
intégration. La feature 001 produit l'éligibilité de cycle de vie ; une future
feature dédiée orchestrera confirmation, références affectées, synchronisation
et sauvegardes. La 008 ne duplique pas cette décision transverse par une route
de purge incomplète.

### Comportements prouvés

- 10 000 opérations aléatoires couvrent rejeu idempotent, révision ancienne,
  retrait, restauration et ordre répété sans doublon ni résurrection obsolète ;
- le rang est départagé par rang explicite, titre normalisé et identité, sans
  dépendre du score de corpus que le nettoyage interne de MiniSearch peut faire
  varier ;
- une écriture met à jour l'index après son commit observable et un rejeu déjà
  accepté ne le met pas à jour une seconde fois ;
- renommage, déplacement, conversion page vers dossier, corbeille et
  restauration remplacent les valeurs dérivées sans ancienne entrée ;
- un tombstone canonique `purged` retire titre, corps et résultat même si les
  révisions diagnostiques restent présentes ;
- reconstruction interrompue, source protégée illisible et échec d'upsert
  restent fail-closed ; une source réparée reconstruit une génération propre ;
- une sauvegarde de référence 007 restaurée refuse la recherche pendant le
  build puis retrouve exactement chaque page, dossier et fichier ;
- URL, journaux, erreurs, diagnostics, schéma PostgreSQL et stores IndexedDB ne
  conservent ni requête, ni titre, ni extrait, ni index de recherche ;
- `/health` expose seulement état, génération, progression et code stable ;
- les résultats locaux fiables restent visibles lorsque l'index complet est
  annoncé en reconstruction.

### Résultats ciblés et complets

| Preuve | Résultat |
| --- | --- |
| propriétés domaine search | 17/17, dont 10 000 opérations aléatoires |
| sources PostgreSQL et restauration de référence 007 | 7/7 |
| contrats/service/reprise/sécurité/logging API ciblés | 49/49 |
| client-core et worker/interface Web ciblés | 19/19 |
| OpenAPI et cartographie d'impact | 50/50 |
| format, lint et typecheck racine | PASS ; 2 avertissements CSS préexistants |
| suite unitaire complète | 1 144/1 144 |
| suite d'intégration complète | 298/298 |
| suite de contrat complète | 999/999 |
| suite de performance complète | 10/10 |
| recherche, offline et audit axe ciblés, cinq projets Playwright | 110/110, 5/5 projets, 77 s |
| gate local final exact | PASS sur `3980e7d5` |

### Performance de référence

Le jeu contient 100 000 pages, dix segments de blocs visibles par page, soit un
million de blocs, plus 50 000 noms de fichiers. La génération serveur prend
2 551,2 ms et environ 323,5 MiB de heap sur l'environnement de développement.

| Mesure | p50 | p95 | Objectif |
| --- | ---: | ---: | ---: |
| 20 résultats serveur | 1,9 ms | 4,3 ms | < 1 000 ms |
| 20 résultats locaux sur 10 000 items | 0,2 ms | 0,3 ms | < 300 ms |
| upsert local | 0,0 ms | 0,1 ms | < 1 000 ms |
| propagation vers un second index | 0,0 ms | 0,2 ms | < 2 000 ms |

Les 10 000 rejeux idempotents prennent 41,4 ms et produisent zéro doublon.

### Convergence finale T071 à T080

- les symboles visibles isolés sont des termes indexables et un emoji seul est
  retrouvé sur serveur et appareil ;
- l'interface compte les points de code Unicode, accepte 512 caractères et
  explique le refus du 513e sans tronquer la requête ;
- une correspondance présente seulement dans la version serveur concurrente
  reste visible avec son marqueur de conflit ;
- le filtre local parcourt tous les placements `hierarchy`, y compris les
  placements multiples, et exclut les simples références `attachment` ;
- la reconstruction serveur rend la main tous les 256 documents et une
  callback sans rapport observe encore l'état `building` avant publication ;
- l'état redacted `search` de `/health` est documenté dans l'OpenAPI canonique
  et aligné avec le schéma runtime ;
- la restauration de référence compare exactement itemId, revisionId, type,
  titre, chemin, champ correspondant, extrait et conflit ;
- un parcours à deux appareils prouve qu'une identité acceptée apparaît sans
  rechargement, est trouvée une seule fois puis ouvre le même item sur le second ;
- la sélection CI relie explicitement chaque source majeure de recherche au
  benchmark de référence ;
- la responsabilité de purge est alignée : retrait du tombstone ici,
  orchestration complète dans une feature de cycle de vie dédiée.

### Défauts découverts par les gates

- MiniSearch peut déclencher un nettoyage paresseux entre deux requêtes
  identiques. Utiliser son score implicite pour départager les égalités rendait
  donc l'ordre dépendant de l'état interne ; la clé stable documentée décide
  désormais seule après les rangs produit.
- Le typecheck du package Web incluait les bibliothèques WebWorker, mais le
  typecheck racine qui importe le worker depuis les benchmarks ne les incluait
  pas. La détection du contexte worker utilise maintenant une frontière
  structurelle explicite, compatible avec les deux configurations.

## Gate local final exact

Le 20 août 2026, `pnpm checks:local` a terminé avec succès sur le commit
`3980e7d5` (`feat(search): close freshness and convergence gaps`). Le binaire
`shfmt` 3.12.0 demandé par le dépôt a été placé en tête du `PATH`, sans modifier
le code ni la configuration du projet.

- politique de toolchain, shell, format, lint et typecheck : PASS ;
- couverture : 180 fichiers et 2 252 tests, seuils globaux respectés ;
- intégration : 298/298 ; migrations : 6/6 ; contrats : 999/999 ;
- E2E : 5/5 projets en 944 s — Chromium, Firefox et WebKit desktop, Chromium et
  WebKit mobile ;
- build applicatif et images API/Web `linux/amd64` + `linux/arm64` : PASS ;
- audit de dépendances : aucune vulnérabilité haute ou critique, une modérée ;
- secrets : 735 fichiers, 0 résultat ; analyse statique : 518 fichiers,
  0 résultat ; licences : 298 packages de production, 0 violation ;
- contrat Compose : PASS.

## Clôture

Le dernier passage de `speckit-converge` ne trouve plus aucun écart ni tâche à
ajouter. Toutes les tâches T001 à T080 sont réalisées et la feature est prête à
être publiée.
