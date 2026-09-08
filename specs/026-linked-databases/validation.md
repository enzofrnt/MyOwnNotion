# Validation 026

Branche locale `codex/026-linked-databases`, worktree isolé `mon-linked-db`. Aucune écriture dans le checkout utilisateur ; aucun push ni PR depuis cette branche. La migration réservée est 0016.

## Preuves exécutées

- Fondations source/emplacements : 30 fichiers, 208 tests ciblés réussis (`/tmp/mon-linked-db-validation.log`). Identités, source après purge des hôtes, migration avec appareils déjà synchronisés, chiffrement local/API, conflits et export/restauration.
- Après chargements groupés : 14 fichiers, 101 tests réussis (`/tmp/mon-linked-db-final-focused.log`). Cela inclut les refus d'enveloppes absentes/corrompues, les valeurs versionnées, les tombstones neutres, la migration et l'export.
- Lecture PostgreSQL chiffrée réelle de 1 001 entrées : reconstruction froide en 59,6 ms, état `ready`, `indexedCount=expectedCount=1001` (`/tmp/mon-linked-db-sql-1001.log`). Mesure effectuée sur le corpus créé par le parcours API protégé, avec un nouveau service de requête.
- Contrat de chargement : 24 entrées reconstruites en 16–24 ms ; actualisation d'une seule entrée en 3–4 ms. Le test vérifie que seules ses valeurs/noms sont relus, qu'aucun corps de page n'est ouvert par la projection, que l'ordre d'insertion des versions n'influence pas la version courante et qu'une version obligatoire absente ou un nom corrompu empêche de publier une projection complète.
- Convergence des entrées sans placement : 4 fichiers, 44 tests réussis (`/tmp/mon-linked-db-unplaced-tests.log`) : contrat optionnel, maintien du placement explicite, outbox chiffrée après redémarrage, recherche de la page canonique, export/restauration sans placement et intégration PostgreSQL.
- Derniers contrôles de chargement et d'interface : 5 fichiers, 24 tests réussis (`/tmp/mon-linked-db-last-focused.log`), avec actualisation d'une entrée supprimée sans réouvrir les noms inchangés. Les suites pagination/vues/accessibilité comptent également 4 fichiers, 17 tests réussis.
- Contrat de sélection CI : 35 tests réussis ; le nouveau parcours est déclaré dans `ci/test-impact.json`.
- Typecheck du monorepo et build Web de production réussis. Biome et `git diff --check` vérifiés sur les fichiers modifiés.

## Parcours et revue visuelle

Le parcours Chromium de réutilisation passe : texte éditorial sur la page hôte, insertion de la même source dans deux pages, cinq vues, vues indépendantes, contenu et identité de l'entrée communs, retour à la vue d'origine, retrait puis réinsertion après rechargement avec API/health inaccessibles, reprise et thème sombre. Les captures `linked-source-light.png`, `linked-source-dark.png`, `linked-source-narrow.png` et `linked-source-narrow-entries.png` sont conservées sous `test-results/linked-databases-embeds-*/`.

Inspection à l'échelle réelle : surfaces et boutons alignés, contours et espacements imbriqués, commandes lisibles en clair/sombre, largeur 320 px sans débordement global ; la table conserve son propre défilement. Les actions emploient les boutons sémantiques existants. Les identifiants de formulaires et le retour au déclencheur sont propres à chaque emplacement.

## Convergence des grandes bases

Le scénario réel crée 1 001 entrées par l'API canonique protégée puis parcourt les pages de 100 autorisées par le contrat. Il vérifie le compte chargé, l'accès à la dernière entrée et son retour avec focus. Les délais UI restent bornés à 15/30 secondes ; le délai global inclut la préparation du corpus. Résultat final Chromium : **2 parcours réussis en 58,2 s**, dont la réutilisation en 13,7 s et le corpus de 1 001 entrées en 42,1 s, préparation API comprise (`/tmp/mon-linked-db-e2e.log`). Le corpus omet le placement comme l'UI réelle et vérifie une seule racine de navigation. Les 11 pages de résultats sont accessibles ; l'ouverture de la dernière entrée puis le retour restaurent son déclencheur.

Les premiers essais ont découvert puis fait corriger : chargement SQL séquentiel de toute la source à chaque entrée, lecture séquentielle des enveloppes au rattrapage, transactions IndexedDB par entrée affichée, limite API100 ignorée par le wrapperUI1000 et invalidation de curseur par notifications d'autres pages. Une préparation API comparable est passée de 126 à 22 secondes ; les réponses de rattrapage200 sont passées de 1–2,8 secondes à environ 0,3 seconde. Les mesures varient sous charge des autres gates et ne remplacent pas un budget contractuel.

Le profil CPU effectué sur l'ancien corpus de 1 001 racines a identifié 12,8 s dans la résolution globale des noms accessibles par Playwright, contre 15 ms de déchiffrement local. Les locators de fermeture sont maintenant limités au panneau. La clarification produit T013 supprime aussi le placement racine automatique des nouvelles entrées de vues ; elle ne cache aucune page ayant un placement explicite. L'instrumentation temporaire est retirée. Journaux de diagnostic : `/tmp/mon-linked-db-profile.log`, `/tmp/mon-linked-db-profile-cpu.log`, `/tmp/mon-linked-return.cpuprofile`.

## Limites et gate de livraison

La purge planifiée complète reste hors 026 : les tests appliquent l'état canonique purgé et retirent les enveloppes éditoriales de l'ancien hôte pour vérifier l'indépendance réelle. La reprise hors ligne testée garde disponible le shell statique ; elle n'atteste pas un premier démarrage sans réseau avec service worker non préparé.

Le parent doit intégrer les corrections 025 postérieures à `e38ccd3b`, conserver sa normalisation d'index dans `indexedCriterion`, puis exécuter `bun run checks:local` et la matrice documentée avant push. Les checks ciblés de cette branche ne sont pas présentés comme un gate complet.

## Intégration sur l'audit courant

Les commits 026 et 027 ont ensuite été repris sur `1104822c` dans une nouvelle
branche isolée. Les vérifications communes, la préservation des corrections
de l'audit et les étapes encore attendues sont consignées dans
[integration-validation.md](integration-validation.md).


## T015 — External command validation (2026-09-08, focused evidence)

The integrated run on e8d40c1f passes all 430 suites / 4 085 tests, but fails
the unchanged uncovered-branch budget at 2 559 / 2 465
(`/tmp/mon-pre-v1-coverage-history-integrated.log`). This is not a passing gate.

Review reproduced three unsupported types accepted through the public mutation
parser: source property, source view and embedded view. The new regression suite
initially reports 3 failures / 70 passes (`/tmp/mon-db-boundaries-red.log`). The
shared definition validator now checks the existing canonical type vocabularies
for properties and all views. Unknown types are refused rather than persisted.

Public command tests also exercise required identities, explicit placements,
malformed typed values and relation sets, invalid page documents, conflict
parents and destructive-change confirmations. Definition tests cover invalid
labels, IDs, option metadata, widths, task roles and embeddings. Positive cases
prove normalization, stable identities, deterministic replay and unchanged input.
All nine database domain suites pass (187 tests), with domain types and Biome
passing (`/tmp/mon-db-definition-boundaries.log`). Full integrated coverage and
delivery remain required; neither thresholds nor exclusions were changed.


The follow-up integrated run passes 432 suites / 4 197 tests but still exceeds
the same uncovered-branch budget: 2 488 / 2 465
(`/tmp/mon-pre-v1-coverage-database-boundaries.log`). Additional domain tests
exercise missing/disabled/invalid task fields, typed alternative representations,
retired option impact counts, removed properties and foreign definition refusal.
The complete database domain set now passes 195 tests with strict types
(`/tmp/mon-db-task-boundaries.log`). These tests protect recovery decisions and
canonical task value interpretation; they do not change runtime behavior.
The renewed combined coverage is still required.


The integrated run on d1f2911d passes all 432 suites / 4 209 tests and the
unchanged coverage gate: 2 465 uncovered branches (maximum 2 465), exit 0
(`/tmp/mon-pre-v1-coverage-import-membership.log`). This combines historical
backup keys, native CSV scope correction, shared definition rejection and task
recovery tests with 026/027/013/028. It is aggregate coverage evidence, not the
complete `checks:local` delivery gate.

The local relationship fixture additionally verifies the bulk reader against
the individual reader for duplicate targets, foreign database metadata, invalid
property metadata, unrelated relation kinds, unrequested entries and empty
batches. All six tests in that suite pass with client-core types and Biome
(`/tmp/mon-db-bulk-relation-boundary.log`). No runtime code changed in this
additional boundary verification.


## Integrated packaging and security (833cd23c, 2026-09-08)

- `bun run images:build` passes both API/web images for linux/amd64 and
  linux/arm64. The native compiled API smoke and full SQL/blob backup/restore,
  committed upload prefix, rehearsal and activation pass
  (`/tmp/mon-pre-v1-images-integrated.log`). No image was published.
- Production dependency audit has no high/critical finding; four findings are
  below that threshold. License policy passes 431 production packages with
  zero violations (`/tmp/mon-pre-v1-dependency-audit.log`,
  `/tmp/mon-pre-v1-licenses.log`).
- The equivalent pinned Trivy scan of a freshly built linux/amd64 API image
  passes the same HIGH/CRITICAL-with-fix gate. Full SARIF remains at
  `/tmp/mon-pre-v1-container-scan.sarif`, log `/tmp/mon-pre-v1-trivy.log`.
  Manifest/lock/Docker inputs are those of 833cd23c.

These focused integrated gates complement aggregate coverage; they do not
replace the full exact-commit pre-push gate or PR/main verification.
