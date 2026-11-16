# Couverture du dépôt — fichiers déjà conformes, fichiers à migrer, temps comme sujet

Réponse à une question simple : **la règle de `DOCTRINE.md` couvre-t-elle tout, et où doit-elle être
appliquée concrètement ?** Ce document classe les 520 fichiers de test du dépôt (arbre `5f71be02`) et
donne à chacun son lot de migration.

## 1. Méthode et honnêteté de la mesure

- Périmètre compté : `tests/e2e/*.ts` = **91 fichiers** (77 specs, 14 helpers/fixtures) ;
  `apps/web/tests/**/*.spec.*` = **179** ; `packages/*/tests/**/*.ts` = **214** ;
  `tests/contract/*.ts` + `tests/performance/*.ts` = **36**. Total **520**.
- Premier filtre, mécanique : recherche de `waitForTimeout`, `new Promise(… setTimeout …)`,
  `setTimeout(`, `Date.now()` en arithmétique, `deadline`, `vi.useFakeTimers`, `toHaveScreenshot`.
  Ce filtre dit où le temps apparaît **littéralement**.
- Second filtre, humain : lecture des lignes signalées, puis des tests jugés propres par le motif mais
  défaillants par le raisonnement (c'est la moitié des constats). Résultat : **les attentes déguisées
  par un sommeil sont peu nombreuses ; les défauts sémantiques, eux, sont dispersés**.
- Troisième filtre : les trois balayages (`evidence/scan-*.md`) et l'inventaire `W-01`…`W-56`.

Conséquence à assumer : « propre au motif » ne veut pas dire « correct sémantiquement ». Les 56
constats de l'inventaire se répartissent sur **45 fichiers de test** — **26 specs E2E** et **19
fichiers unitaires/intégration/performance** — dont **41 sont propres au motif** (22 specs E2E et les
19 unitaires). La carte ci-dessous donne donc deux informations distinctes : où le temps est utilisé
comme synchronisation (tableaux 1 et 3), et où le témoin est mauvais sans qu'aucun sommeil
n'apparaisse (tableau 2).

## 2. Tableau 1 — E2E : sommeils réels (à migrer)

Sur 35 occurrences de `setTimeout(` dans les specs E2E, **32 sont des `test.setTimeout(...)`** (budgets
de parcours, déjà contrôlés par `tests/contract/e2e-gate-coverage.spec.ts:39`) et 3 sont de vraies
utilisations de minuteur. Les attentes déguisées en E2E sont donc concentrées :

| Fichier | Ligne | Forme actuelle | Précondition réelle | Migration (témoin) | id | Lot |
|---|---|---|---|---|---|---|
| `tests/e2e/file-preview.spec.ts` | 203 | `waitForTimeout(1000)` puis `expect(stolen).toEqual([])` | le script hostile du cadre isolé s'est exécuté, et sa lecture a échoué | témoin positif `{probe:"started"}` émis par le cadre avant la lecture, puis `expect.poll` sur l'absence de vol ; chargement du cadre attendu par événement | W-04 (S11) | L2 |
| `tests/e2e/offline-availability.spec.ts` | 158 | `waitForTimeout(500)` après le choix de limite | la limite est écrite et la mesure rafraîchie **et** une passe d'éviction a eu lieu (aujourd'hui elle n'existe pas en production) | attribut d'état du panneau + relecture du document durable ; décision produit D-B pour l'éviction | W-03 (S13) | L2 |
| `tests/e2e/save-state.spec.ts` | 142 | `waitForTimeout(400)` avant `page.reload()` | la transaction Dexie est validée et le document durable contient le texte | relecture du document via `readPresentationState`/`getItem` avant le rechargement | W-18 (S5/S12) | L3 |
| `tests/e2e/save-state.spec.ts` | 75 | `waitForTimeout(2_000)` comme fenêtre d'une négation | l'écriture a été tentée et refusée (ou reste en file) | `getSnapshot().syncState !== "synced"` + `pendingCount > 0` + `data-durable="true"`, après un `requestfailed` observé | W-44 (S8) | L3 |
| `tests/e2e/database-entry-properties.spec.ts` | 123 | `page.evaluate(() => new Promise(r => setTimeout(r, 0)))` | la poignée d'édition de propriété a fini son cycle après le geste | attribut de séquence de définition (S7) ou disparition du formulaire | (nouveau, à rattacher à S7) | L3 |

## 3. Tableau 2 — E2E : témoins mauvais sans aucun sommeil (le gros du travail)

Ces fichiers sont « propres » au motif mais portent un constat de l'inventaire. C'est ici que se
trouve le risque réel, et la raison pour laquelle un simple garde-fou syntaxique ne suffira pas.

| Fichier(s) | Constats | Nature du défaut | Lot |
|---|---|---|---|
| `page-multi-device-convergence.spec.ts` | W-01 | écriture d'ergonomie non validée avant `close()` (incident prouvé) | L2 |
| `page-multi-tab-convergence.spec.ts` | — | conforme (comptage IDB brut), sert de modèle | — |
| `conflict-resolution.spec.ts` | W-02 | négation globale non corrélée | L2 |
| `hierarchy.spec.ts` | W-05 | menu non refermé, assertion du chemin clavier triviale | L2 |
| `workspace-tabs-folder.spec.ts` | W-08, W-23 | onglet non persisté avant rechargement ; annonce tierce comme témoin | L3 |
| `editor-offline-media.spec.ts` | W-09 | `close()` après DOM optimiste | L3 |
| `database-entry-properties.spec.ts` | W-10 | ordre de propriétés non acquitté avant rechargement | L3 |
| `database-multi-select-board.spec.ts` | W-11 | écriture de vue non acquittée | L3 |
| `database-form-lifecycle.spec.ts` | W-12, W-21 | conversion prouvée par `aria-pressed` ; brouillon non acquitté | L3 |
| `block-editor.spec.ts` | W-13, W-38 | insertion contextuelle non prouvée ; menu slash refermé | L3 / L5 |
| `page-ambiguity.spec.ts` | W-14 | acceptation serveur remplacée par `data-sync != offline` | L3 |
| `offline-availability.spec.ts` | W-03, W-15 | cf. tableau 1 + marquage non corrélé | L2 / L3 |
| `databases-offline-sync.spec.ts` | W-16 | vidage global avant relecture de l'autre appareil | L3 |
| `revision-restore.spec.ts` | W-17 | identité de révision déduite, non relue | L3 |
| `legacy-sync-self-healing.spec.ts` | W-19 | file globale par page | L3 |
| `page-autosave-recovery.spec.ts` | W-20 | garde durable optionnelle avant `close()` | L3 |
| `database-relations-rollups.spec.ts` | W-22 | capture d'écran sans barrière de repaint | L5 |
| `page-protocol-migration.spec.ts` | W-24 | « aucune erreur de page » comme preuve | L3 |
| `files.spec.ts`, `keyboard-navigation.spec.ts`, `page-scroll-restoration.spec.ts`, `page-links.spec.ts`, `offline-reconciliation.spec.ts`, `interrupted-mutations.spec.ts`, `live-sync.spec.ts`, `rich-page.spec.ts`, `editor-suggestion-menu.spec.ts` | W-39…W-47, W-38 | assertions négatives sans ancrage, témoins globaux, choix de menu prouvés par fermeture | L5 |
| `v1-surface-visuals.spec.ts`, `workspace-shell-visual.spec.ts` | — | captures d'écran : ajouter `animations: "disabled"` + barrière de repaint (aucun constat d'inventaire, durcissement) | L5 |
| 51 autres specs | — | aucune trace de témoin mauvais après lecture, ni sommeil : **conformes** | — |

## 4. Tableau 3 — unitaire, intégration, contrat : sommeils réels (20 fichiers à migrer)

| Fichier | Occurrences | Forme | Précondition réelle | Migration | Lot |
|---|---|---|---|---|---|
| `apps/web/tests/app-routing.spec.tsx` | 12 | `await new Promise(r => setTimeout(r, 0))` | la route cible est rendue et ses effets exécutés | `vi.waitFor` sur le rendu attendu, ou `act` autour de la promesse de navigation | L4 |
| `apps/web/tests/database-page-interaction.spec.tsx` | 8 + 2 dates | sommeils + boucle de reclique de 15 s | le panneau reste ouvert, l'option est choisie une fois | ouvrir une fois, `vi.waitFor` sur l'option, clic unique | L2 (W-07) |
| `apps/web/tests/synchronize-serialization.spec.ts` | 3 | `setTimeout(50)` | la passe concurrente n'entre pas dans le transport | barrière différée libérée par le test | L2 (W-06) |
| `apps/web/tests/entry-property-interaction.spec.tsx` | 1 (`delay()` = 24 usages) | sommeil réel pour un debounce de 350 ms | le debounce a expiré pour **ce** geste | `vi.useFakeTimers` + `advanceTimersByTimeAsync` | L4 (W-25) |
| `packages/client-core/tests/legacy-page-editing-session.spec.ts` | 2 | `setTimeout(300)`, `setTimeout(0)` | le backoff a épuisé son cycle / la file de drain est vide | faux minuteurs + `advanceTimersByTimeAsync` | L4 (W-26, W-27) |
| `packages/database/tests/page-operations.integration.spec.ts` | 1 | `setTimeout(50)` | la seconde transaction est en attente du verrou | barrière sur la première requête du second client | L4 (W-28) |
| `packages/domain/tests/search-index.spec.ts` | 1 | sommeil | l'index a fini de journaliser | `vi.waitFor` sur l'état de l'index | L4 (W-52) |
| `tests/contract/export.spec.ts` | 1 | sommeil | l'export a fini d'écrire | attendre la fin de l'écriture (promesse ou `vi.waitFor` sur le fichier) | L5 |
| `apps/web/tests/board-card-editor.spec.tsx`, `database-board-interaction.spec.tsx`, `database-card-inline.spec.tsx` (`pause()`), `database-view-loading.spec.tsx` (`advance()`), `emoji-picker.spec.tsx`, `group-editor.spec.tsx`, `map-view-states.spec.tsx` (`render()`), `navigation-item-menu.spec.tsx`, `page-attachment-panel.spec.tsx`, `recovery-replacement.spec.tsx`, `editor-input.spec.ts`, `sidebar.spec.ts` | 1-2 chacun | `pause()`/`setTimeout(15…100)` après un clic ou un montage | l'effet asynchrone du composant a eu lieu | remplacer le flush par une attente sur l'état attendu (`vi.waitFor`), ou par une promesse que le faux service expose ; pour `sidebar.spec.ts:59` (identifiants ordonnés par le temps), horloge injectée | L4 (W-35, W-36, W-49, W-50, W-51, W-53, W-55) |

## 5. Tableau 4 — le temps comme sujet : horloge contrôlée, pas d'attente

Ces fichiers testent un comportement temporel **par nature**. Ils ne doivent pas attendre la vraie
horloge : ils doivent la posséder.

| Fichier | Sujet temporel | Outil |
|---|---|---|
| `packages/domain/tests/session-policy.clock.spec.ts` | expiration de session à la milliseconde | **déjà exemplaire** : horloge injectée, à citer comme modèle |
| `packages/domain/tests/lifecycle.spec.ts` | purge après rétention de 30 jours | `now()` injecté (`isPurgeEligible(item, () => new Date(…))`) — **déjà correct** |
| `packages/domain/tests/rotation-policy.clock.spec.ts` | politique de rotation | horloge injectée — à confirmer, même famille |
| `apps/web/tests/mcp-access-panel.spec.tsx` | expiration d'un jeton d'accès | `vi.useFakeTimers` présent : vérifier que tous les seuils l'utilisent |
| `tests/e2e/backup.spec.ts` | sauvegarde vérifiée « il y a 26/27 h » | horloge contrôlée (`page.clock`) ou `now()` injecté côté API ; aujourd'hui `Date.now() - 27 h` en fixture |
| `tests/e2e/security-rotation.spec.ts` | échéances de rotation (due/block) | fixtures datées par `Date.now()` : acceptable, mais préférer une horloge injectée pour les seuils limites (§S18) |
| `tests/e2e/realtime-page-sync.spec.ts` | budget de propagation 2 s (exigence produit) | mesure + `toBeLessThan` **avec** commentaire `budget produit`, jamais comme attente — **déjà correct** |
| `tests/e2e/editor-performance.spec.ts` | latence de frappe, cadence de mesure | mesure + `requestAnimationFrame` (barrière correcte) ; le `settleMs` entre frappes est de la cadence de mesure, à documenter comme telle |
| `tests/e2e/progressive-startup.spec.ts` | démarrage progressif : le serveur est **retenu volontairement** | le délai est la variable indépendante du test — **correct**, à documenter |
| `tests/e2e/databases-schema.spec.ts`, `knowledge-graph.spec.ts`, `linked-databases.spec.ts`, `databases-offline-sync.spec.ts` | budgets/ mesures de parcours | mesure + assertion de budget avec commentaire `budget produit` (à ajouter), jamais comme attente |

## 6. Tableau 5 — bornes de sécurité déjà correctes (forme autorisée, à documenter)

| Fichier | Rôle | Verdict |
|---|---|---|
| `tests/e2e/bounded-database.ts` | `deadline` qui force la fermeture du client et échoue explicitement | **forme canonique** de la clause 5, à citer en exemple |
| `tests/e2e/reset-installation.ts`, `reset-content.ts` | bornes de préparation/réinitialisation | conforme |
| `tests/e2e/desktop-process.ts` | attente de disponibilité du processus hôte | conforme (borne + échec) |
| `tests/contract/compose-dev.spec.ts`, `tests/contract/export.spec.ts` | bornes d'attente de service | conforme, hors le sommeil signalé au tableau 3 |
| `packages/domain/tests/bootstrap-state.property.spec.ts`, `canonical-export.spec.ts`, `security-owner-device.property.spec.ts`, `packages/client-core/tests/reconciliation.spec.ts` | occurrences de `deadline` = **données de rétention**, pas des attentes | aucun changement |

## 7. Ce qui reste à confirmer par lecture (honnêteté de la couverture)

Sept fichiers unitaires n'utilisent l'horloge que par `Date.now()` sans sommeil. Ils sont
probablement des fixtures ou des mesures, mais n'ont pas été lus ligne à ligne :
`packages/database/tests/{relation-source-mutation,repository-failures,restore,search-source,uploads}.integration.spec.ts`,
`apps/web/tests/mcp-access-panel.spec.tsx`, `packages/domain/tests/lifecycle.spec.ts`.
La migration doit commencer par les lire et les classer (fixture → horloge injectée ; attente →
témoin réel ; mesure → commentaire `budget produit`).

## 8. Ce que « couvrir tout le dépôt » veut dire ici

1. **La règle s'applique à 100 % des 520 fichiers** : elle n'est pas limitée aux E2E. Le contrat
   automatique (§6.1 de `DOCTRINE.md`) inspecte tout le dépôt, et le second filtre humain de revue
   couvre ce qu'un motif ne peut pas voir.
2. **La migration est ciblée, pas massive** : 4 specs E2E avec sommeil, 20 fichiers unitaires avec
   sommeil, 45 fichiers portant un constat d'inventaire (26 specs E2E + 19 fichiers unitaires). Les
   51 autres specs E2E et 390 autres fichiers unitaires sont déclarés conformes, avec la réserve
   explicite que « conforme au motif » n'est pas « revu sémantiquement ».
3. **Les 55 attentes vérifiées saines sont protégées** : `DOCTRINE.md` §3 en fait les formes de
   référence, et `PLAN-OPUS.md` §2 interdit de les « corriger ».
4. **Chaque fichier listé ci-dessus porte un lot** (L2 à L5), donc une place dans le plan. Aucun
   fichier n'est laissé « à traiter plus tard » sans identifiant.
5. **Le temps comme sujet n'est pas interdit** : il est outillé (horloge contrôlée, `page.clock`,
   `now()` injecté) et déclaré dans l'en-tête du test, ce qui le rend vérifiable en revue.
