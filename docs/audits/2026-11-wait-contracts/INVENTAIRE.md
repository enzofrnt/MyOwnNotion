# Inventaire des défauts de témoin dans la suite de tests (arbre `5f71be02`)

Chaque ligne est un endroit où un test avance sur autre chose que la preuve que l'opération dont il
dépend est terminée. Les lignes viennent de trois balayages indépendants de l'arbre audité
(`evidence/scan-sync-devices.md`, `evidence/scan-ui-menus.md`, `evidence/scan-unit.md`), qui ont
chacun vérifié le mécanisme dans le code avant de juger un site ; l'analyse complète des 8 champs de
chaque constat se trouve dans le fichier indiqué par `src`. Les lignes marquées `vérifié` ont été
relues par l'auditeur.

Le catalogue des signaux (`S1`…`S20`) et la règle normative sont dans [`DOCTRINE.md`](DOCTRINE.md) ;
la carte fichier par fichier (conforme / à migrer / temps comme sujet / borne de sécurité) est dans
[`COUVERTURE.md`](COUVERTURE.md). Les colonnes « Témoin requis » de cet inventaire renvoient aux
identifiants `S…` de ce catalogue.

Légende

- **Forme** — A : l'interface affiche une écriture avant qu'elle soit écrite (appel sans attente).
  B : le témoin est global et non corrélé à l'opération. C : l'assertion prouve autre chose.
  D : le test ne peut pas échouer pour la raison qu'il annonce (aucun témoin).
- **Grav.** — P1 peut masquer une perte de données ou laisser passer un résultat faux ; P2 peut
  produire un faux rouge sans distinguer une vraie régression ; P3 lisibilité/maintenance.
- **Conf.** — `prouvé` (cause démontrée, trace CI ou reproduction), `ci` (un échec CI est
  attribuable au *comportement* de ce site ; la numérotation du journal peut différer), `statique`.

## Gravité P1 — un vert ici ne veut pas dire ce qu'annonce le nom

| id | Site | Test | Forme | Opération en vol | Témoin actuel | Témoin requis | Conf. | src |
|---|---|---|---|---|---|---|---|---|
| W-01 | `tests/e2e/page-multi-device-convergence.spec.ts:385-390` | a restarted device drains a closed page… | A/B | commit de `navigation-state.lastVisitedItemId` (Dexie `meta`) | valeur de `active-item-title`, puis `page.close()` | **S1** élément visité persisté | **prouvé** (reproduction locale, run 43722479700) | sync:73 |
| W-02 | `tests/e2e/conflict-resolution.spec.ts:96` | produces no conflict when it catches up | B | rattrapage du second appareil après rechargement | `sync-status[data-state] != "conflict"` juste après `selectItem` | **S7** revision appliquée sur le second appareil, ou file vidée *après* l'acquittement de l'écriture du premier | statique | sync:120 |
| W-03 | `tests/e2e/offline-availability.spec.ts:135-165` | an unsent change is still there after the limit is lowered | D | rien : `runEviction` n'a aucun appelant de production (`budget.ts:151`) ; `setLimit` écrit et re-mesure | le texte est encore dans l'éditeur (projection mémoire) | **S3/S12** relecture du document durable ; et rendre la garantie réelle via `runEviction` (décision D-B du plan) | vérifié | sync:156 |
| W-04 | `tests/e2e/file-preview.spec.ts:196-204` | script inside a previewed file cannot read the page around it | C | exécution du script hostile dans la cadre isolé, et son refus | `waitForTimeout(1000)` puis `stolen == []` | **S11** témoin positif : le cadre émet `{probe:"started"}` avant la lecture same-origin ; vérifier ce marqueur, puis l'absence de vol | vérifié | ui:103 |
| W-05 | `tests/e2e/hierarchy.spec.ts:602-606` | opens the same item actions from right click and the keyboard | D | fermeture du menu du clic droit | `rename-<item>` visible après `Shift+F10`, sans avoir attendu la fermeture du menu pointeur | **S9** vérifier que le menu pointeur a disparu avant le chemin clavier | vérifié | ui:133 |
| W-06 | `apps/web/tests/synchronize-serialization.spec.ts:249` (et `:273`) | runs one pass when several callers arrive at once | B | une `synchronize()` concurrente qui ne doit pas entrer dans le transport | `setTimeout(50)` puis `peakConcurrency == 1` | barrière différée dans le faux transport (promesse résolue par le test), assert avant de libérer | statique | unit:21 |
| W-07 | `apps/web/tests/database-page-interaction.spec.tsx:355-368` | sets a property icon from the schema panel… | C/D | le panneau reste ouvert, puis l'option est choisie | boucle de 15 s qui **reclique** le déclencheur quand le panneau s'est refermé (4 échecs CI : runs 43421853764, 43455992441, 43510287732, 43521962935) | ouvrir une fois, vérifier `aria-expanded`, `vi.waitFor` sur l'option, cliquer — une fermeture intempestive échoue alors | vérifié | unit:51 |

## Gravité P2 — faux rouges, ou régression réelle non attribuable

| id | Site | Test | Forme | Témoin requis | Conf. | src |
|---|---|---|---|---|---|---|
| W-08 | `tests/e2e/workspace-tabs-folder.spec.ts:92` | keeps tabs, a deep path and folder ordering… | A | **S2** onglet persisté | statique | ui:157 |
| W-09 | `tests/e2e/editor-offline-media.spec.ts:76` | a file dropped offline becomes a durable reference | A | **S5** puis **S12** | statique | ui:182 |
| W-10 | `tests/e2e/database-entry-properties.spec.ts:153-165` | configures entry properties directly… | A | **S4** (`waitForDatabaseDefinitionSaved`) | statique | ui:207 |
| W-11 | `tests/e2e/database-multi-select-board.spec.ts:184` | multi-select Kanban preserves memberships… | A | **S4** | statique | ui:233 |
| W-12 | `tests/e2e/database-form-lifecycle.spec.ts:69-70` | converts a card without editorial history… | A | `aria-pressed` → **S6 après changement de projection observé** | statique | ui:253 |
| W-13 | `tests/e2e/block-editor.spec.ts:453` | is shown as unrenderable and kept unchanged… | A | **S5** (compteur d'application / nombre de blocs) | statique | ui:275 |
| W-14 | `tests/e2e/page-ambiguity.spec.ts:125` | delete/edit ambiguity survives restart | B | **S7** (tête serveur), pas `data-sync != "offline"` | statique | sync:195 |
| W-15 | `tests/e2e/offline-availability.spec.ts:89` | a marked branch opens with no network | B | **S8** commande en attente de ce type | statique | sync:302 |
| W-16 | `tests/e2e/databases-offline-sync.spec.ts:347` (et `:390`) | survives restart, merges compatible fields… | B | **S8** par `commandType`, pas un vidage global | statique | sync:268 |
| W-17 | `tests/e2e/revision-restore.spec.ts:30-41` | restores retained content as a new descendant | B | `db.revisionHeaders.canonicalRevisionId` en relecture | statique | sync:229 |
| W-18 | `tests/e2e/save-state.spec.ts:142` | the last completed edit is there when the application reopens | B/C | `waitForTimeout(400)` → **relecture du document durable**, puis rechargement immédiat | statique | sync:335 |
| W-19 | `tests/e2e/legacy-sync-self-healing.spec.ts:52` | five retained page conflicts self-heal… | B | **S7** par page, ou lecture API par identifiant | statique | sync:367 |
| W-20 | `tests/e2e/page-autosave-recovery.spec.ts:74` | edits from a closed tab reappear… | B | `if (await status.count())` rend la garde optionnelle → **S3/S5** sans condition | statique | sync:428 |
| W-21 | `tests/e2e/database-form-lifecycle.spec.ts:143` | cancels a pressed property action… | A | **S4** | ci | (lecture propre du run 43587332746) |
| W-22 | `tests/e2e/database-relations-rollups.spec.ts:509` | a two-way relation shows on both sides | C | barrière de repaint (`requestAnimationFrame` deux fois) ou assertion d'état | statique | ui:361 |
| W-23 | `tests/e2e/workspace-tabs-folder.spec.ts:260` | keeps tabs… (annonce de glisser) | C | **S13** : vérifier l'ordre persisté ; l'annonce seulement après | ci | (lecture propre du run 43706222653) |
| W-24 | `tests/e2e/page-protocol-migration.spec.ts:219` | acknowledges a pending v2 replacement… | B | vérifier le chemin hors-ligne géré (**S8**) au lieu de « aucune erreur de page » | ci | (lecture propre du run 43519009785) |
| W-25 | `apps/web/tests/entry-property-interaction.spec.tsx:15,152` | entry property configuration menus | B | `vi.waitFor` / faux minuteurs (le fichier le fait déjà en `:104`) — runs 43225166453, 43376534470 | ci | unit:111 |
| W-26 | `packages/client-core/tests/legacy-page-editing-session.spec.ts:408` | stops retrying after an orphaned branch… | B | faux minuteurs + `advanceTimersByTimeAsync` | statique | unit:170 |
| W-27 | `packages/client-core/tests/legacy-page-editing-session.spec.ts:329` | does not convert a page that was only looked at | B | vider la file explicitement | statique | unit:196 |
| W-28 | `packages/database/tests/page-operations.integration.spec.ts:352` | holds a row lock until the first transaction commits | B | barrière sur la première requête du second client | statique | unit:221 |
| W-29 | `apps/web/tests/table-scroll-observer.spec.ts:49` | preserves the new bottom when iOS flushes… | B | vidage explicite entre `touchend` et `resizeItem` (runs 43392306416, 43470717395, 43587630795) | ci | unit:241 |
| W-30 | `apps/web/tests/projection-refresh.spec.ts:14` | projection refresh drain | B | lecture différée résolue par le test, pas « deux microtâches » | statique | unit:272 |
| W-31 | `packages/database/tests/client-lifecycle.integration.spec.ts:58` | waits for a socket already removed… | B | ordre d'appel enregistré, pas une durée écoulée | statique | unit:298 |
| W-32 | `apps/web/tests/operational-page-opening.spec.ts:877` | drains a pending %s before checking the head | D | `?? Number.POSITIVE_INFINITY` rend l'assertion infalsifiable → vérifier que `checkpoint` a été appelé d'abord | statique | unit:319 |
| W-33 | `apps/web/tests/operational-page-opening.spec.ts:491` | settles an in-flight activation… | B | activation différée possédée par le test | statique | unit:342 |
| W-34 | `apps/web/tests/database-page-interaction.spec.tsx:210,234,242` | shows the source title inside an integrated database | B | équivalent de **S4** en unitaire | statique | unit:367 |
| W-35 | `apps/web/tests/board-card-editor.spec.tsx:17` | creates atomically from the editable title… | B | assertion sur le magasin, pas sur la valeur du champ | statique | unit:389 |
| W-36 | `apps/web/tests/sidebar.spec.ts:59` | puts the most recently changed item first | B | horloge fixe / `now()` injecté ; les `setTimeout(2)` rendent la *fixture* instable | statique | unit:413 |
| W-37 | `apps/web/tests/relation-value-menu.spec.tsx:126` | adds to the selection… | B | un `vi.waitFor` relevé à 10 s en contournement (runs 43243026089, 43317240835, 43374207601) — trouver l'événement manqué | ci | unit:434 |

## Gravité P3 — maintenance, ou assertion négative non discriminante

| id | Site | Forme | Note | src |
|---|---|---|---|---|
| W-38 | `tests/e2e/block-editor.spec.ts:204` (+ `rich-page.spec.ts:74,92`, `editor-suggestion-menu.spec.ts:78`) | C | choix du menu slash confirmé seulement par la fermeture du menu | ui:297 |
| W-39 | `tests/e2e/files.spec.ts:216` | C | rechargement suivi d'une seule assertion négative ; ajouter un ancrage positif | ui:323 |
| W-40 | `tests/e2e/keyboard-navigation.spec.ts:456` | C | `Escape` puis action de menu sans attente de fermeture | ui:343 |
| W-41 | `tests/e2e/page-scroll-restoration.spec.ts:36` | B | `data-sync` global là où `waitForEditorSettled` est le témoin spécifique | ui:381 |
| W-42 | `tests/e2e/page-links.spec.ts:493` | B | écriture du document attendue via la file globale | ui:400 |
| W-43 | `tests/e2e/offline-reconciliation.spec.ts:68` | B | `pending-mutations` visible mais non corrélé au type de commande | sync:397 |
| W-44 | `tests/e2e/save-state.spec.ts:75` | C | 2 s de sommeil comme fenêtre d'une assertion négative | sync:460 |
| W-45 | `tests/e2e/save-state.spec.ts:219` | C | négation « pas synchronisé » avant que le refus soit tenté | sync:486 |
| W-46 | `tests/e2e/interrupted-mutations.spec.ts:86` | B | `waitForSynchronized` final sans étape dépendante | sync:516 |
| W-47 | `tests/e2e/live-sync.spec.ts:54` | B | attente globale avant une assertion de 15 s qui fait le vrai travail | sync:543 |
| W-48 | `apps/web/tests/local-content-realtime-sync.spec.ts:211` | B | coalescence prouvée par un comportement temporel | unit:458 |
| W-49 | `apps/web/tests/database-view-loading.spec.tsx:34` | B | utilitaire `advance()` à profondeur de microtâches fixe | unit:476 |
| W-50 | `apps/web/tests/emoji-picker.spec.tsx:175` (+ 2 voisins) | B | état de réouverture asserté avant l'acquittement de la première ouverture | unit:499 |
| W-51 | `apps/web/tests/group-editor.spec.tsx:93` (+ `database-board-interaction.spec.tsx:95`) | B | choix refusé retenu, prouvé par l'ordre de rendu | unit:523 |
| W-52 | `packages/domain/tests/search-index.spec.ts:69` | B | cohérence au-delà du seuil de vacuum prouvée par une durée | unit:540 |
| W-53 | `apps/web/tests/map-view-states.spec.tsx:85` | B | utilitaire `render()` et ses hypothèses de microtâches | unit:561 |
| W-54 | `apps/web/tests/app-routing.spec.tsx:199` | B | `renderAt()` et ses jumeaux en ligne | unit:580 |
| W-55 | `apps/web/tests/database-page-interaction.spec.tsx:909` | B | retrait optimiste de ligne sur refus | unit:600 |
| W-56 | `tests/performance/realtime-page-sync.performance.spec.ts:135` | B | coalescence de 10 000 annonces prouvée par un budget de temps seul | unit:620 |

Identifiants `W-01`…`W-56`. Totaux : **7 P1, 30 P2, 19 P3**.

## Témoins vérifiés sains — ne pas « corriger »

55 attentes ont été lues et sont de vraies preuves (21 + 15 + 19 dans les fichiers de balayage). Les
familles importantes :

- **Les écritures `service.mutate` sont atomiques avec leur ligne de file**
  (`packages/client-core/src/outbox/apply-local-mutation.ts:114-163`) : observer le changement de DOM
  dérivé de la projection, puis attendre que la file se vide *est* corrélé. C'est pourquoi les
  dizaines de sites `waitForSynchronized` → `reload` de la suite sont légitimes (par exemple
  `hierarchy.spec.ts:359`, `workspace-shell.spec.ts:332`, `routing.spec.ts:135`, `files.spec.ts:366`,
  `item-conversion.spec.ts:372`, `database-multi-select-board.spec.ts:220`).
- **Les gestes d'éditeur ont un témoin synchrone** : `page-editor.tsx:304-311` écrit
  `data-editor-settled="false"` dans la même tâche que l'événement d'entrée ; `waitForEditorSettled`
  et `saveDocument` ne peuvent donc pas être trompés par un geste pas encore observé.
- `helpers.ts:saveDocument` (chemin opérationnel et chemin hérité),
  `waitForEditorSettled` avec `afterApplyCount`/`afterSequence`,
  `page-multi-device-convergence.spec.ts:225-239` (durabilité prouvée avant la fermeture),
  `page-multi-tab-convergence.spec.ts:226,234` (comptage IDB brut `sending` + commit intercepté),
  `databases-offline-sync.spec.ts:315,326,381` (`pendingCommand` par type de commande) et sa lecture
  API du parent de fusion en `:431-448`,
  `interrupted-mutations.spec.ts:38-51`, `page-protocol-migration.spec.ts:81-90,122-134`,
  `progressive-startup.spec.ts` (`pendingWorkspaceWrites` + marqueurs),
  `page-ambiguity.spec.ts:136-144` (la notice est rendue depuis une lecture du magasin durable),
  `protocol-compatibility.spec.ts:98` et `realtime-sync-security-and-restore.spec.ts:105` (attentes de
  révocation sur un état dérivé du serveur),
  et côté unitaire `packages/client-core/tests/page-editing-session.spec.ts:58`,
  `outbox-resume-safety.spec.ts:144`, `progressive-startup.spec.ts:234-242` — le motif de référence :
  le magasin durable est verrouillé et c'est le test qui libère.

## Comportements revendiqués par la suite sans aucun témoin

Au-delà de W-03/W-05/W-07 (P1), deux comportements ne sont vérifiés nulle part :

1. **Les écritures d'ergonomie de l'appareil ne sont jamais relues.** Aucun test ne lit
   `navigation-state`/`openTabIds` depuis IndexedDB : toute assertion est un rendu. L'incident prouvé
   en est la conséquence directe.
2. **L'acquittement d'une opération n'est jamais corrélé par identité** (identifiant de mutation ou de
   révision) dans la couche E2E, seulement par type de commande (`pendingCommand`) ou en agrégé
   (`syncState`). Un test qui a besoin de « cette modification précise a été acquittée » n'a
   aujourd'hui aucun outil.
