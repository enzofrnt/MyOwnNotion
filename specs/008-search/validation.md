# Validation: Recherche initiale du workspace

Ce document accumule les preuves par checkpoint. La matrice navigateur complète,
le local-first, les filtres, la reprise et les volumes restent ouverts tant que
leurs tâches ne sont pas cochées.

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

## Encore ouvert

- US4 : cycle de vie exhaustif, restauration, sécurité et benchmarks ;
- matrice Playwright complète et `pnpm checks:local` sur le commit final exact.
