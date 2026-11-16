# Audit — échecs CI dus à des témoins d'amorçage (suite de la feature 059)

Date de l'audit : 15 novembre 2026. Audit en **lecture seule** : aucun fichier de `apps/`,
`packages/`, `tests/` ou `.github/` n'a été modifié, rien n'a été poussé. La mise en œuvre est
transmise à Opus 5.5 (voir `TRANSMISSION.md` et `PLAN-OPUS.md`).

Ce dossier est neuf et non suivi par Git. Aucune conclusion ici ne remplace une correction.

## 1. Périmètre et références auditées

| Élément | Valeur |
|---|---|
| Arbre audité | `main`, commit de fusion **`0679cdeb1ba43d4e0d0658c228e7b35067b4c215`** (PR #202, fusionnée le 2026-11-15 à 14:05:56 UTC) |
| Objet Git `tree` | `5f71be02c458813be70f8abee7e5daddd813c8bf` |
| Tête de la PR | `f73b449c70f8b055be9b1363ab2986c1d58f2192` — worktree `/Users/enzofournet/Git/MyOwnNotion-059`, **même objet `tree`** |
| Run de référence vert deux fois | [43709453347](https://github.com/enzofrnt/MyOwnNotion/actions/runs/43709453347), tentatives 1 et 2 |
| Run rouge puis vert sans changement | [43722479700](https://github.com/enzofrnt/MyOwnNotion/actions/runs/43722479700), tentative 1 rouge, tentative 2 verte |
| Suite couverte | 91 specs E2E, 107 fichiers sous `tests/e2e/` (helpers et fixtures compris), 182 fichiers sous `apps/web/tests/`, 214 sous `packages/*/tests/`, 26 de contrat, 10 de performance |

Toutes les références `fichier:ligne` de cet audit sont relatives à l'arbre `5f71be02`. Les journaux
de CI d'arbres antérieurs sont cités avec leur identifiant de run : leurs numéros de ligne bougent et
ne sont jamais transposés silencieusement.

## 2. Ce qui a été examiné — et ce qui manque

### 2.1 Runs de CI

- **100 derniers runs du workflow `CI`** récupérés : `evidence/ci-runs.json` (charge utile complète
  conservée hors dépôt). Fenêtre du 2026-11-12 à 11:35:31 UTC au 2026-11-15 à 14:05:59 UTC,
  **111 tentatives** (10 runs ont plusieurs tentatives, maximum 3).
- Événements : 93 `pull_request`, 5 `push` (dont les deux runs post-fusion de #200 et #202), 1
  `schedule` (nocturne), 1 `workflow_dispatch`. Conclusions : 19 succès, 49 échecs, **32 annulations**
  (rafales de pushes des 12 et 13 novembre pendant la feature relations/bases inline).
- Tous les jobs en échec de **toutes les tentatives** énumérés : `evidence/failures.tsv` — **403
  instances de job en échec** sur 86 runs, dont 105 `Playwright journeys` sur 40 voies/tentatives.
- Journal de chaque job en échec du périmètre téléchargé et analysé : `evidence/logs/` (signatures) et
  `evidence/errors/` (sections de rapport d'erreur).
- Rapports **blob** par voie des deux runs de référence et du run `43524911626` (tentatives 1 et 2
  présentes côte à côte), plus la **trace** de l'incident post-fusion, dépouillés
  (`onTestEnd`, `onStepBegin`/`onStepEnd`).
- Reproduction locale de l'incident de référence (§4.4).

### 2.2 Artefacts absents ou non fiables

1. **Aucun rapport blob avant la feature 058.** Les runs antérieurs à `e35dd268` (2026-11-14)
   publient `playwright-report-<projet>` : un rapport HTML par projet pour le projet entier, sans
   identité de voie ni de tentative, écrasé par toute réexécution. L'attribution par test des 78 runs
   antérieurs vient donc des journaux et de `failures.tsv`, pas de rapports structurés.
2. **Une réexécution complète détruit les preuves de la tentative précédente.** Mesuré sur
   `43709453347` (2026-11-15) : après la réexécution complète il reste exactement 15 artefacts
   `blob-report-*`, tous créés entre 11:52 et 12:14 UTC, c'est-à-dire pendant la tentative 2 ; rien de
   la tentative 1 (11:32-11:51) n'est récupérable. Contre-expérience qui écarte l'hypothèse de la
   montée de version : le run `43613845751` (2026-11-14, `actions/upload-artifact` v7.0.1,
   réexécution complète de 44 jobs) se termine lui aussi avec 15 blobs et aucun doublon. À l'inverse,
   une **réexécution des seuls jobs en échec conserve les deux tentatives** : `43524911626` garde
   `blob-report-webkit-desktop-3-3` deux fois (tentative 1 `14084834246` à 23:25, tentative 2
   `14087345418` à 23:47). Le facteur est le mode de réexécution, pas le passage de
   `upload-artifact` de v7.0.1 à v7.0.2 que la PR #202 a intégré.
3. **Les journaux ne sont pas toujours conservés.** Les 138 jobs en échec du périmètre ont répondu.
   Les anciens échecs `Frozen install & toolchain policy` du 2026-11-12 (28) renvoient `BlobNotFound` :
   leur cause exacte n'est pas établissable, seule la cascade qu'ils ont produite est visible.
4. **L'application ne journalise pas les opérations concernées.** Ni `console`, ni attribut, ni point
   d'accroche de test n'enregistre le commit du document d'ergonomie locale (`navigation-state`) ni
   l'acquittement de l'enregistrement automatique des propriétés d'entrée. En CI, une écriture perdue
   est donc indiscernable d'une écriture lente ; le diagnostic ci-dessous la restitue par une sonde
   injectée dans la page (`IDBObjectStore.prototype.put` instrumenté), impossible après coup.
5. **Traces et captures conservées uniquement en cas d'échec** (`trace: "retain-on-failure"`,
   `screenshot: "only-on-failure"`). Pour un job rouge la trace existe ; pour la réexécution verte
   rien n'est conservé, donc l'alternative « lent mais correct » n'est jamais exclue du côté vert.

## 3. Découpage temporel utilisé

| Époque | Runs | Enjeu |
|---|---|---|
| A — avant la feature 058 (`< e35dd268`) | 78 runs, 2026-11-12 11:35 → 2026-11-13 22:02 | Porte différente : retries présents, pas de voies, pas de rapports blob. Les échecs sont surtout des défauts produit de la feature en cours. |
| B — depuis 058 / fusion #200 | 23 runs, 2026-11-13 22:03 → 2026-11-15 14:05 | Porte actuelle : `retries: 0`, échec rapide (`actionTimeout` 15 s, `navigationTimeout` 30 s, `maxFailures` 10), voies auto-dimensionnées, garde de couverture. C'est l'époque de l'incident de référence. |

## 4. L'incident de référence (post-fusion, rouge puis vert sans aucun changement)

### 4.1 Faits

- Fusion `0679cdeb` → run [43722479700](https://github.com/enzofrnt/MyOwnNotion/actions/runs/43722479700) (`push`).
- Tentative 1 : un seul job en échec, [Playwright journeys (webkit-mobile 1/3) — job
  132837341439](https://github.com/enzofrnt/MyOwnNotion/actions/runs/43722479700/job/132837341439).
  `Browser gate report` (job 132842415065) et `quality-gate` échouent en cascade —
  « webkit-mobile: 1 journey(s) failed ».
- Test fautif : `tests/e2e/page-multi-device-convergence.spec.ts:390`, *a restarted device drains a
  closed page without reopening it*, exécuté en 79e position sur 120 dans la voie `webkit-mobile-1-3`
  (`workers: 1`).
  ```
  expect(getByTestId('active-item-title')).toHaveValue
  Expected: "DifferentLandingPage-mwhx8aoz-2aahb"
  Received: "ClosedPageQueue-mwhx8aoz-2ewxj"      (23 scrutations sur 10 s)
  ```
- Tentative 2 (réexécution des seuls jobs en échec) : même job, [job
  132847103202](https://github.com/enzofrnt/MyOwnNotion/actions/runs/43722479700/job/132847103202),
  vert ; run entier vert.

### 4.2 Chronologie extraite de la trace conservée (tentative 1, UTC)

| Heure | Événement |
|---|---|
| 14:19:52,4 | fin du clic sur la ligne `DifferentLandingPage` |
| +33 ms | la ligne affiche `aria-selected="true"` |
| +42 ms | `active-item-title` affiche la page d'atterrissage |
| +51 ms | `page.close()` |
| +~60 ms | nouvelle page, `goto /notes` |
| 14:19:59 → 14:20:06 | `active-item-title` reste `ClosedPageQueue` pendant 10 s, puis échec |

L'application persiste l'élément actif dans le document local de l'appareil
`navigation-state.lastVisitedItemId` (`packages/client-core/src/navigation/presentation-state.ts:12`,
écrivain `apps/web/src/features/hierarchy/hierarchy-explorer.tsx:879-895`) : une transaction Dexie
lancée par un `useEffect` dont **aucun test ne peut observer la promesse**. Fenêtres clic→fermeture
mesurées dans la même voie : 81 ms (PR, vert), 65 ms (réexécution, vert), **18 ms (post-fusion,
rouge)**. L'écriture aboutit ou n'aboutit pas dans cette fenêtre.

### 4.3 Pourquoi la PR, la fusion et la réexécution se contredisent

Le code est identique : `ffe3b734` (référence de fusion de la PR), `f73b449c` (tête de PR) et
`0679cdeb` (fusion) donnent tous l'objet `tree` `5f71be02`. Le plan de voies est identique octet pour
octet (`test-impact.json` de #202 et de main : 15 voies, `webkit-mobile-1-3` = 26 fichiers dont
`page-multi-device-convergence.spec.ts`). Le cache de durées n'existait pas encore (`Cache not found
for input keys: e2e-timings-restore-only, e2e-timings-`), donc l'auto-dimensionnement et
l'équilibrage n'ont joué aucun rôle. Image de runner identique (`ubuntu24/20261111.370`). Une seule
différence : WebKit venait du cache navigateurs sur la PR et sur la réexécution, et a été téléchargé
sur le run rouge — différence de démarrage du moteur, pas de sémantique, et la version est la même
(`webkit v2370`). La seule variable qui compte est le nombre de millisecondes entre une écriture
IndexedDB et la destruction du processus.

C'est la définition d'un témoin qui observe le début d'une opération (la ligne qui bascule, parce que
l'état React a changé) au lieu de sa fin (l'enregistrement validé).

### 4.4 Reproduction locale (`/Users/enzofournet/Git/MyOwnNotion-059`, arbre `5f71be02`)

Méthode : copie non suivie du parcours, avec une sonde injectée enregistrant chaque `put` sur
`meta`/`navigation-state`, l'événement `complete` ou `abort` de sa transaction, et la lecture au
démarrage. Sonde supprimée ensuite ; les deux worktrees vérifiés propres.

| Variante | Exécutions | Résultat |
|---|---|---|
| Parcours inchangé | 20 | 20 succès ; le commit arrive 0 à 50 ms avant la demande de fermeture, parfois après |
| Même parcours sans l'assertion de titre intermédiaire (fenêtre plus serrée) | 20 | **1 échec, identique à la CI** |

Itération fautive (ms depuis le début du test) : `5255 NAVPUT <page d'atterrissage>` émis à l'instant
du `close()` ; aucun `NAVCOMMIT` ; `5257 closed` ; `5812 NAVREAD <page précédente>` ; le démarrage
restaure `ClosedPageQueue` et l'assertion échoue exactement comme en CI.

La chaîne causale est établie : la restauration au démarrage lit un enregistrement que le processus
fermé n'a jamais validé, et le seul témoin du test était un rendu en mémoire.

## 5. Incidents observés relevant de la classe (époque B), dédoublonnés

Vocabulaire de confiance : **prouvé** = cause démontrée (trace/journal + lecture du code, ou
reproduction) ; **probable** = mécanisme identifié mais non observé directement ; **statique** =
lecture de code seule, sans événement CI.

| # | Test (ligne actuelle) | Voies | Run / job | Erreur | Classe | Confiance |
|---|---|---|---|---|---|---|
| I-1 | `page-multi-device-convergence.spec.ts:390` *a restarted device drains a closed page…* | webkit-mobile | [43722479700 t1 / 132837341439](https://github.com/enzofrnt/MyOwnNotion/actions/runs/43722479700/job/132837341439) → t2 vert | titre restauré sur la page précédente | Témoin = début de l'écriture d'ergonomie (§4) | **prouvé** |
| I-2 | `realtime-sync-security-and-restore.spec.ts:68` *revoking a device closes all of its live page sockets immediately* | chromium-desktop | [43524911626 t1 / 132228285441](https://github.com/enzofrnt/MyOwnNotion/actions/runs/43524911626) → t2 vert | `active-item-title` n'apparaît jamais (page jamais créée) | Produit : clic de menu de création perdu pendant l'ouverture/remontage — le défaut corrigé par #200/#202. Le test avait raison d'échouer. | prouvé |
| I-3 | `database-relations-rollups.spec.ts:401` (alors `:372`) *relation and rollup isolate a second source…* | webkit-desktop | même run t1 / 132228285425 → t2 vert | `waitForEntryAutosave` : `data-save-state` reste `idle` 15 s | Produit : écriture jamais émise après un clic perdu. Le helper strict a correctement refusé « idle ». | prouvé |
| I-4 | `database-relations-rollups.spec.ts` cumul lu `17` / `0` | firefox-desktop, chromium-mobile | [43706222653](https://github.com/enzofrnt/MyOwnNotion/actions/runs/43706222653) (nocturne) jobs 132787817023 et 132787817140 ; [43706172859](https://github.com/enzofrnt/MyOwnNotion/actions/runs/43706172859) job 132788805324 | cumul à 0 au lieu de 17 | Produit (catalogue de relations reconstruit à chaque synchro, clic perdu) ; a aussi été révélé par le run nocturne. Corrigé en #202. | prouvé |
| I-5 | `page-protocol-migration.spec.ts:181` *acknowledges a pending v2 replacement…* | webkit-desktop, webkit-mobile | [43519009785](https://github.com/enzofrnt/MyOwnNotion/actions/runs/43519009785) | `pageErrors` = `… /v1/changes?after=0&limit=200 due to access control checks` | Timing : requête tentée dans la fenêtre hors ligne / accès à l'origine non contrôlé ; le test prend « aucune erreur de page » comme témoin. | probable |
| I-6 | `accessibility.spec.ts:412` *all five views pass axe…* | firefox-desktop (5 runs) | 43587630795, 43609826504, 43611677776, 43613845751, 43617700745 | plantage de page dans `analyze()` | Infrastructure : crash Firefox 159 de Playwright 1.65 sur `ariaLabelledByElements` après une requête de rôle (reproduction statique dans le dépôt). Corrigé par l'épinglage 1.64.1. | prouvé |
| I-7 | `rich-page.spec.ts:96` *composes advanced blocks…* | 5 voies | 43587630795 | bloc bascule absent | Produit : adaptation BlockNote 0.57 `renderFrame`. Corrigé. | prouvé |
| I-8 | `accessibility.spec.ts:324/346` *file surfaces* | 7 voies | 43587630795 | `label-content-name-mismatch` | Produit : régression d'appellation introduite en corrigeant l'appellation. Corrigée. | prouvé |
| I-9 | `database-entry-properties.spec.ts`, `databases-tasks.spec.ts:127`, `database-form-lifecycle.spec.ts:143` | plusieurs | 43609826504, 43613845751, 43587332746 | item de menu ou valeur de brouillon jamais affiché | Produit : clics perdus et brouillons effacés au remontage ; les attentes de menu se sont comportées correctement. | probable |
| I-10 | `workspace-tabs-folder.spec.ts:260` *keeps tabs, a deep path and folder ordering…* | chromium-mobile | 43706222653 job 132787817140 | annonce `DndLiveRegion` jamais émise | Annonce d'une bibliothèque tierce (`@dnd-kit`) prise comme témoin d'un glisser qui n'a pas commencé. Forme d'assertion à corriger, pas la durabilité produit. | probable |
| I-11 | `editor-math-contents.spec.ts:98/100`, `:18` | 5 voies | 43587630795, 43609826504, 43391791498 | liens de sommaire à 0, option de menu absente | Produit/adaptation (projection math) + menu non ouvert au moment de la recherche de l'option. | probable |

L'époque A (78 runs) est inventoriée dans `evidence/failures.tsv` et `evidence/errors/` : 152 couples
`(test, projet)` distincts. Causes dominantes, par ordre : la feature relations/bases inline en cours
(produit), les adaptations BlockNote 0.57 et axe, le crash du moteur Firefox, le contrat de versions
de l'outillage éditeur (6 échecs), et les rafales de pushes annulés. **Aucun n'est attribuable à un
contrat d'attente**, sinon par le même mécanisme que I-1 (les 4 `waitForTimeout`, §8).

## 6. Pourquoi la classe existe : trois formes dans l'arbre actuel

Normalisé depuis les trois rapports de balayage (`evidence/scan-*.md`, chacun en anglais — notes de
travail), qui ont tous vérifié le mécanisme dans le code avant de juger un site.

**Forme A — écriture affichée avant d'être écrite.** Le contrôle se met à jour depuis l'état React,
puis un appel lancé sans attente (`void …`) déclenche l'écriture. Le DOM ne prouve donc rien :

- renommage en ligne dans l'arbre : `pendingTreeNames` puis `void renameSelectedItem(...)`, et
  `commitTreeRename` retourne même `Promise.resolve(true)` (`hierarchy-explorer.tsx:1532-1545`) ;
- valeurs et ordre des propriétés d'entrée : `data-save-state` au-dessus d'un crochet
  d'enregistrement automatique, commit du glisser
  `void edit?.(...).catch(() => undefined)` (`entry-property-list.tsx:485`) ;
- éditions de vues et de présentation : `void save({...})` (`database-container-page.tsx:909` →
  `:438`) ;
- le document d'ergonomie de l'appareil (onglets ouverts, largeur, **dernière page visitée**) — le cas
  prouvé ;
- sélecteur de type de carte, vérifié par `aria-pressed`.

**Forme B — témoin global non corrélé à l'opération.** `waitForSynchronized` interroge la file
durable agrégée. Lancé juste après un clic, il peut lire `synced` à la fois parce que tout est
réellement acquitté *et* parce que l'écriture n'a pas encore été mise en file (le gestionnaire a déjà
rendu la main). Idem pour un `data-sync="synced"` global, ou un `data-durable="true"` déjà vrai avant
l'action (événement manqué, succès périmé).

**Forme C — preuve d'autre chose.** Assertion négative gardée par un délai (`waitForTimeout`), capture
d'écran prise au milieu d'une animation, annonce d'une région vive tierce, ou boucle qui reclique
l'action jusqu'à ce que l'assertion puisse passer.

Contrepoids, et raison pour laquelle la plupart des `waitForSynchronized` **ne sont pas** des
constats : `packages/client-core/src/outbox/apply-local-mutation.ts:114-163` valide la projection
optimiste **et** la ligne de file dans **une seule transaction IndexedDB**. Pour toute écriture
passant par `service.mutate`, la projection ne peut pas changer avant que la ligne existe ; observer
le changement de DOM qui en dérive puis attendre que la file se vide *est* donc un témoin corrélé. La
classe de défaut est exactement l'ensemble des écritures qui contournent cette propriété.

Rappel lié : les gestes d'éditeur ont un témoin synchrone (`page-editor.tsx:304-311` écrit
`data-editor-settled="false"` dans la même tâche que l'événement d'entrée), donc
`waitForEditorSettled` et `saveDocument` ne sont pas sensibles au décalage « geste pas encore
observé ».

## 7. Exigence transversale — la doctrine des témoins (normatif)

La robustesse de **tous** les tests, présents et futurs, doit reposer sur un état réel vérifiable qui
prouve que l'étape suivante peut commencer. Le temps écoulé, un élément simplement visible, une
réponse réseau reçue et un état « idle » ne sont jamais des preuves d'achèvement. Cette exigence est
écrite une fois, de façon normative, dans [`DOCTRINE.md`](DOCTRINE.md), et sa carte d'application
fichier par fichier dans [`COUVERTURE.md`](COUVERTURE.md). Elle se résume en six clauses :

1. La preuve est un **état réel du système**, pas une conséquence observée de cet état.
2. Elle est **corrélée à l'opération exacte** : même entité, même révision, même identifiant de
   mutation, même type de commande, même appareil.
3. Elle **ne peut être ni manquée ni périmée** : on relit un état persistant ou un compteur monotone
   capturé avant le geste ; on n'attend jamais un événement transitoire.
4. **Le temps n'est pas une preuve.** Aucun délai n'autorise à continuer.
5. Les timeouts sont **des bornes maximales de sécurité avec diagnostic explicite** : un échec nomme
   la précondition manquante ; un timeout n'est jamais une durée à laisser passer.
6. **Quand le temps est le sujet** (debounce, expiration, backoff, rétention, budget de latence
   produit), l'horloge est contrôlée : faux minuteurs Vitest, `page.clock` de Playwright, ou `now()`
   injecté côté domaine.

`DOCTRINE.md` contient le catalogue `S1`…`S20` : pour chaque séquence asynchrone du produit, la
précondition que l'étape suivante exige, le signal fiable qui la confirme, **le producteur et le
moment exact où ce signal devient vrai**, et ce qui ne doit jamais servir de preuve à sa place. Les
identifiants `S…` sont ceux repris dans `INVENTAIRE.md` et `PLAN-OPUS.md`.

Trois conséquences directes pour la suite :

- **Aucune assertion n'est affaiblie par la migration.** On remplace le témoin, jamais la
  vérification. Un diff qui modifie une assertion en plus du témoin est traité comme un
  affaiblissement à justifier séparément.
- **Les scénarios d'interruption restent couverts.** Fermeture immédiate, coupure réseau et
  concurrence continuent d'exister et deviennent *déterministes* : l'interruption est déclenchée par
  une barrière que le test contrôle (retard d'écriture, requête retenue, verrou différé), et le
  comportement applicatif attendu est vérifié explicitement.
- **La migration est ciblée et cartographiée.** `COUVERTURE.md` classe les 520 fichiers de test du
  dépôt : 4 specs E2E et 20 fichiers unitaires utilisent réellement un sommeil, 45 fichiers portent
  un constat d'inventaire (26 specs E2E + 19 fichiers unitaires), les autres sont déclarés conformes
  avec la réserve explicite que « conforme au motif » n'est pas « revu sémantiquement ». Chaque
  fichier listé porte un lot de migration (L2 à L5 du plan).

## 8. Synthèse de l'inventaire statique

`INVENTAIRE.md` liste 56 sites avec un identifiant stable (`W-01`…`W-56`), le témoin requis, la
gravité et la confiance. Totaux : **7 × P1, 30 × P2, 19 × P3**, plus **55 attentes vérifiées saines**
(21 + 15 + 19) que le plan interdit explicitement de « corriger », et 3 sites où le test ne peut pas
échouer pour la raison qu'il annonce.

Ces trois derniers méritent une mention à part, car des runs verts répétés n'y mesurent rien :

1. `tests/e2e/offline-availability.spec.ts:135` — *an unsent change is still there after the limit is
   lowered*. `runEviction` (`packages/client-core/src/local-store/budget.ts:151`) **n'a aucun appelant
   de production** (seulement `packages/client-core/tests/budget.spec.ts`). `StoragePanel.setLimit`
   écrit la limite et re-mesure (`storage-panel.tsx:44-52`). Abaisser la limite ne peut rien évincer,
   et l'assertion lit le contenu de l'éditeur, c'est-à-dire la projection en mémoire. La garantie de
   non-perte que ce parcours prétend défendre n'est pas testée.
2. `tests/e2e/hierarchy.spec.ts:602-606` — après un `Escape` non attendu, l'assertion du chemin
   clavier est satisfaite par le menu pointeur resté ouvert : la régression annoncée peut revenir au
   vert.
3. `apps/web/tests/database-page-interaction.spec.tsx:355-368` — une boucle de 15 s qui **reclique**
   le déclencheur quand le panneau s'est refermé. Elle réessaie l'action, donc la régression
   « le panneau se referme intempestivement » ne peut être observée qu'à épuisement ; elle a échoué
   4 fois en CI, ce qui prouve que la course est réelle et que les répétitions précédentes de la même
   défaillance ont été absorbées.

## 9. Ce qui a produit rouge puis vert sur le *même* code

Trois issues distinctes en époque B, toutes documentées :

| Run | Tentative 1 | Tentative 2 | Signification |
|---|---|---|---|
| 43722479700 | 1 voie rouge (I-1) | verte | course sur le témoin d'amorçage, §4 |
| 43524911626 | 2 voies rouges (I-2, I-3) | vertes | clic produit perdu ; l'échec était *juste*, la reprise fut chanceuse |
| 43709453347 | verte | verte (réexécution complète, même commit) | mesure de stabilité seulement ; les preuves de la tentative 1 ont été détruites par la réexécution (§2.2) |

Aucune des trois n'est expliquée par la consolidation des dépendances, le plan de voies, le cache de
durées ou l'image du runner. En époque B, la seule différence observable entre le run rouge et le run
vert du même arbre est la position du commit de l'opération par rapport à la frontière du processus.

## 10. Réponses aux questions posées par l'incident

- **La configuration de la PR a-t-elle pu le masquer ?** Non. Même arbre, même plan, même image,
  aucun cache de durées. La PR et la réexécution ont simplement accordé environ 65 à 80 ms à
  l'écriture ; le run post-fusion lui en a accordé 18.
- **La réexécution verte prouve-t-elle la santé ?** Non. C'est un tirage d'une course dont la branche
  perdante est rare (environ 1 sur 20 en local avec une fenêtre serrée, 1 sur 3 échantillons CI pour
  ce parcours).
- **Un `retries: 1` aurait-il aidé ?** Il l'aurait masqué, exactement comme le dit le commentaire du
  dépôt (`playwright.config.ts:49-56`).
- **Isoler l'audit par vue aurait-il aidé ?** Non pour cette classe : la défaillance n'est pas dans
  l'audit mais dans le témoin du parcours.
- **Autre chose de temporel en époque B ?** I-5, I-10 et les trois sites du §8. Le reste est du
  produit ou du moteur, depuis corrigé.

## 11. Limites de cet audit

1. L'attribution de cause pour I-1 est **prouvée en local**, pas observée en CI : l'application
   n'émet aucune preuve du commit perdu pendant un run. L'argument côté CI est la signature
   (restauration sur la page précédente, aucune autre explication dans la trace) plus la reproduction
   locale du même mécanisme.
2. Les 78 runs de l'époque A n'ont pas de rapports blob ; leur attribution vient des journaux, et les
   échecs `Frozen install` du 2026-11-12 n'ont aucun journal.
3. Les numéros de ligne dérivent d'un arbre à l'autre ; seul I-1 est cité à sa ligne actuelle avec un
   journal CI conforme. Chaque autre citation CI conserve la numérotation de son arbre.
4. Les rapports de balayage sont des analyses statiques de `5f71be02`. Un site jugé « témoin à
   corriger » n'est pas pour autant cassé en production : il peut être *incapable d'échouer*, ce qui
   est un défaut de force du test, pas un défaut produit. Les deux catégories sont séparées dans
   `INVENTAIRE.md`.
5. Impossible de décider si React 19.3 ou Dexie 4.4.7 ont resserré la marge autour de I-1 : aucun
   échec antérieur de ce parcours n'existe dans la fenêtre conservée.

## 12. Index des preuves

```
evidence/ci-runs.json          100 runs CI, huit champs chacun
evidence/failures.tsv          403 instances de job en échec, toutes tentatives, run/sha/date
evidence/logs/                 138 extractions de signatures d'échec depuis les journaux
evidence/errors/               138 sections de rapport d'erreur (titre, message, journal d'appel, source citée)
evidence/scan-sync-devices.md  20 specs synchro/persistance/hors-ligne, 15 constats   (anglais)
evidence/scan-ui-menus.md      48 specs UI/éditeur/bases/fichiers/sécurité, 14 constats + les 4 waitForTimeout (anglais)
evidence/scan-unit.md          suites unitaires/intégration, 26 constats + couverture      (anglais)
evidence/00-brief-scanners-EN.md  la classe de défaut et le format donnés aux balayeurs
DOCTRINE.md                    exigence transversale (normatif) : règles, catalogue S1-S20, contrôles
COUVERTURE.md                  carte du dépôt : fichiers conformes, à migrer, temps comme sujet
INVENTAIRE.md                  inventaire normalisé (W-xx) + témoins vérifiés sains
PLAN-OPUS.md                   plan de remédiation transmis à Opus 5.5
TRANSMISSION.md                message de transmission
```

Traces, rapports blob et journaux de la sonde locale sont hors dépôt :
`/private/tmp/claude-501/-Users-enzofournet-Git-MyOwnNotion/0af274a5-95a3-409f-ae5f-05280e3f7cce/scratchpad/postmerge`
(`art/`, `blobs/`, `trace/`, `probe1-full.log`, `probe2-full.log`, `ci-runs-raw.json`), parce que ce
sont des archives volumineuses et opaques.
