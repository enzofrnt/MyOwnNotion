# Plan pour Opus 5.5 — des témoins corrélés au lieu de signaux d'amorçage

Lire d'abord `RAPPORT.md` (diagnostic) et `INVENTAIRE.md` (56 sites, identifiants `W-xx`). Ce plan
donne l'ordre d'implémentation, les contrats à construire et les critères d'acceptation. **Rien n'a
été implémenté** : l'audit était en lecture seule.

Arbre de référence : `5f71be02` (fusion `0679cdeb` de `main`). Une seule branche depuis `main`
courant — le dépôt interdit les PR empilées.

---

## 0. Les cinq invariants que chaque changement doit respecter

1. **Observer la fin de l'opération, pas son début.** Un témoin doit être produit par le code qui
   termine l'opération (commit de transaction, acquittement, révision appliquée), pas par l'état React
   qui affiche l'intention.
2. **Corréler par identité.** Un témoin doit être lié à l'entité, la révision, l'identifiant de
   mutation ou le type de commande dont dépend l'étape suivante. « La file est vide » n'est valide
   qu'*après* avoir observé que cette opération existe dans la file (ou dans la même transaction
   IndexedDB).
3. **Aucune attente minimale, aucune tolérance ajoutée.** Garder `retries: 0`, `maxFailures: 10`,
   `actionTimeout` 15 s, `navigationTimeout` 30 s, `expect` 10 s. Un délai plus long n'est autorisé que
   si le *moteur* est réellement lent (le chien de garde WebKit existant,
   `playwright.config.ts:92-96`) — jamais pour masquer une course.
4. **Une attente doit pouvoir échouer.** Chaque témoin doit être exercé par la matrice d'injection du
   §6 : retarder ou annuler l'opération doit rendre le test rouge. Un témoin incapable d'échouer est
   pire qu'aucun témoin, parce qu'il certifie.
5. **Les courses volontaires restent, de façon déterministe.** Les parcours qui doivent exercer une
   fermeture brutale, une coupure réseau ou une écriture concurrente continuent de le faire, mais avec
   une barrière contrôlée par le test, pas avec la chance sur quelques millisecondes.

---

## 0bis. La doctrine est normative, la carte dit où l'appliquer

Deux documents encadrent tout le reste, et prévalent sur toute habitude locale :

- [`DOCTRINE.md`](DOCTRINE.md) — l'exigence transversale, valable pour **tous** les tests (E2E,
  unitaires, intégration, contrat, performance) : preuve = état réel corrélé à l'opération exacte,
  jamais un délai, une visibilité, une réponse réseau reçue ou un état `idle`. Il contient le
  catalogue `S1`…`S20` (séquence → précondition → signal → producteur → moment exact) et la règle
  d'écriture des nouveaux tests (six questions d'en-tête, forme des helpers, politique d'horloge).
- [`COUVERTURE.md`](COUVERTURE.md) — la carte du dépôt : 520 fichiers de test classés (déjà conformes,
  à migrer, temps comme sujet, bornes de sécurité autorisées), chacun rattaché à un lot.

Ce plan ne traite donc pas « les 56 constats » seulement : il installe la règle, ses helpers, ses
contrôles, et migre les fichiers que la carte désigne. Un fichier de la carte sans lot est un défaut
de ce plan, pas un oubli acceptable.

---

## 1. Lot L0 — instrumentation et preuves (à faire d'abord, c'est un prérequis)

Sans ces signaux, les lots L1 à L5 ne sont pas validables et le prochain incident sera aussi aveugle
que celui-ci.

### L0.1 `LocalContentService.readPresentationState()` — relecture du document validé

Producteur : `apps/web/src/services/local-content.ts`, classe `LocalContentService`, à placer à côté
de `getSnapshot` (ligne 496).

```ts
/** Le document de navigation local validé, relu depuis IndexedDB. */
async readPresentationState(): Promise<WorkspacePresentationState> {
  return await readWorkspacePresentationState(this.db);
}
```

`readWorkspacePresentationState` existe déjà
(`packages/client-core/src/navigation/presentation-state.ts:180`). Exposer la méthode sur le type du
point d'accroche E2E (`tests/e2e/helpers.ts`, `E2ELocalContentService`, vers la ligne 300) la rend
utilisable immédiatement dans n'importe quelle spec. C'est une *lecture* d'un enregistrement existant,
pas un drapeau de test : elle ne peut pas être périmée, elle ne peut pas être manquée, et c'est
exactement la précondition dont W-01 a besoin.

### L0.2 Compteur monotone d'acquittement pour l'enregistrement automatique des entrées

Producteur : `apps/web/src/features/databases/use-entry-autosave.ts:153` (`setState("saved")`), rendu
par `entry-panel.tsx:196`.

Ajouter une ref `savedCount` incrémentée exactement là où l'enregistrement est acquitté, et la rendre
en `data-save-sequence={autosave.savedCount}` à côté du `data-save-state` existant. Pourquoi un
compteur et pas l'état seul : `waitForEntryAutosave` accepte aujourd'hui n'importe quel `"saved"`, y
compris celui laissé par un enregistrement *précédent*, et `"idle"` signifie « aucune écriture n'a
jamais été émise » — c'est précisément ce que le run CI 43524911626 a révélé. Le test capture alors le
compteur avant le geste et exige qu'il augmente.

### L0.3 Compteur monotone d'acquittement pour les définitions de base

Producteur : `apps/web/src/features/databases/database-page.tsx:1112`
(`data-definition-state={pendingDefinitionMutations > 0 ? "saving" : "idle"}`). Ajouter
`data-definition-sequence` incrémenté à l'acquittement d'une mutation de définition, et
`data-definition-error` en cas de refus.

### L0.4 Facultatif, seulement si L0.1 s'avère peu pratique à un endroit : `data-navigation-persisted-item`

Producteur : le même effet que `hierarchy-explorer.tsx:879-895`, posé **après** la résolution de
`await updateWorkspacePresentationState(...)`, avec la valeur retournée par la transaction. C'est un
attribut d'observabilité de l'enregistrement que l'application vient de valider, pas un commutateur
E2E ; il doit être dérivé de `next.lastVisitedItemId`, jamais de `selectedId`.

Préférer L0.1 : une relecture ne peut être ni manquée ni périmée.

### L0.5 Conservation des preuves par tentative (CI)

`.github/workflows/ci.yml` :

- les noms d'artefacts doivent porter la tentative :
  `blob-report-${{ matrix.laneId }}-${{ github.run_attempt }}`,
  `test-results-${{ matrix.laneId }}-${{ github.run_attempt }}`,
  `test-impact-plan-${{ github.run_attempt }}`. Preuve que c'est nécessaire : le run `43709453347` n'a
  conservé que les blobs de la tentative 2 (15 artefacts, tous créés entre 11:52 et 12:14 UTC) ; le run
  de contrôle `43613845751` (même réexécution complète, `upload-artifact` v7.0.1) montre la même perte,
  alors que la réexécution des seuls jobs en échec `43524911626` a conservé les deux tentatives.
- `Browser gate report` doit imprimer, dans son résumé, le `github.run_attempt` de chaque blob fusionné,
  pour qu'un rapport fusionné ne puisse jamais mélanger deux tentatives en silence.
- Documenter dans `docs/development.md` : préférer « re-run failed jobs » à « re-run all jobs » quand la
  tentative rouge est la preuve.

### L0.6 Journal de diagnostic du document d'ergonomie (derrière le drapeau E2E existant)

Dans l'écrivain de présentation, quand `__MYOWNNOTION_E2E__`, `console.debug("nav-persist", {...})` au
démarrage et à la fin. Playwright conserve la console dans la trace en cas d'échec ; c'est ce qui a
rendu la reproduction locale lisible et ce qui manquait au run CI. Aucun changement de comportement,
aucun drapeau DOM.

**Acceptation L0 :** test unitaire de `readPresentationState` (retourne la valeur validée et reflète
une écriture ultérieure) ; test-sonde qui retarde `meta.put("navigation-state")` de 1500 ms via
`addInitScript` et vérifie que `readPresentationState` renvoie encore l'ancienne valeur jusqu'à la
résolution différée (preuve que la relecture n'est pas un écho de l'interface) ; noms d'artefacts
portant la tentative sur une réexécution.

---

## 2. Lot L1 — module partagé de témoins (`tests/e2e/waits/`)

Un module par famille de flux, importé par les specs ; aucune logique dupliquée dans les specs. Les
helpers existants de `tests/e2e/helpers.ts` restent (c'est l'API stable) et délèguent.

### L1.1 `tests/e2e/waits/presentation.ts`

```ts
import { expect, type Page } from "@playwright/test";

export interface PersistedPresentation {
  readonly lastVisitedItemId: string | null;
  readonly openTabIds: readonly string[];
  readonly expandedItemIds: readonly string[];
}

export async function readPersistedPresentation(page: Page): Promise<PersistedPresentation | null> {
  return await page.evaluate(async () => {
    const service = window.__MYOWNNOTION_E2E_LOCAL_CONTENT__?.();
    if (service === undefined) return null;
    const record = await service.readPresentationState();
    return {
      lastVisitedItemId: record.lastVisitedItemId,
      openTabIds: [...record.openTabIds],
      expandedItemIds: [...record.expandedItemIds],
    };
  });
}

/** Échoue si l'élément visité n'a pas atteint le document d'ergonomie de l'appareil. */
export async function expectPersistedNavigation(page: Page, itemId: string): Promise<void> {
  await expect
    .poll(async () => (await readPersistedPresentation(page))?.lastVisitedItemId ?? null, {
      timeout: 15_000,
      message: "l'élément sélectionné n'a jamais été validé dans le document de navigation",
    })
    .toBe(itemId);
}

/** Échoue si l'onglet donné ne fait pas partie de la bande d'onglets validée. */
export async function expectPersistedTab(page: Page, itemId: string): Promise<void> {
  /* même forme, sur openTabIds */
}
```

Pourquoi cela garantit la précondition : le seul écrivain de ce document est
`updateWorkspacePresentationState` (`presentation-state.ts:204-219`), une transaction Dexie `rw` sur
`db.meta` ; la promesse se résout après le commit, et l'enregistrement relu est celui validé. Rien
d'autre ne peut le rendre vrai, et une écriture perdue laisse l'ancienne valeur pour toujours.

### L1.2 `tests/e2e/waits/autosave.ts` et `definition.ts`

```ts
/** Attend qu'un *nouvel* enregistrement d'entrée soit acquitté après la séquence donnée. */
export async function expectEntrySavedSince(page: Page, sequence: number): Promise<void> {
  const status = page.locator(".entry-panel .entry-properties__status");
  await expect
    .poll(async () => Number((await status.getAttribute("data-save-sequence")) ?? "-1"), {
      timeout: 15_000,
      message: "aucune valeur d'entrée n'a été acquittée après ce geste",
    })
    .toBeGreaterThan(sequence);
  await expect(status).toHaveAttribute("data-save-state", "saved");
}

export async function readEntrySaveSequence(page: Page): Promise<number> {
  const value = await page.locator(".entry-panel .entry-properties__status")
    .getAttribute("data-save-sequence");
  const sequence = Number(value);
  return Number.isSafeInteger(sequence) ? sequence : -1;
}
```

Même forme pour `data-definition-sequence` sur `.database-page`. `waitForEntryAutosave` garde sa
signature pour les appelants qui n'ont besoin que de « saved », et gagne la variante par séquence pour
tous les tests qui éditent puis rechargent/ferment/changent d'appareil (W-10, W-11, W-12, W-21).

### L1.3 `tests/e2e/waits/revisions.ts`

```ts
/** Attend que cet appareil détienne le texte écrit par l'autre appareil. */
export async function expectAppliedOn(page: Page, itemId: string, text: string): Promise<void> {
  await expect
    .poll(
      async () =>
        await page.evaluate(
          async ({ itemId, text }) => {
            const service = window.__MYOWNNOTION_E2E_LOCAL_CONTENT__?.();
            const item = await service?.getItem(itemId);
            return item?.pageDocument ? JSON.stringify(item.pageDocument).includes(text) : false;
          },
          { itemId, text },
        ),
      { timeout: 30_000, message: "l'autre appareil n'a jamais appliqué cette modification" },
    )
    .toBe(true);
}
```

Le point d'accroche expose déjà `getItem`, `outbox.all()`, `pageOperationLog.getState` et
`db.revisionHeaders.get` : assez pour W-02, W-14, W-16, W-17, W-19 sans nouveau producteur.

### L1.4 `tests/e2e/waits/menus.ts` — disponibilité et identité, jamais de boucle de reclique

```ts
/** Ouvre un déclencheur une seule fois et rend le menu, en vérifiant qu'il est actionnable. */
export async function openMenu(trigger: Locator, menuName: string | RegExp): Promise<Locator> {
  await expect(trigger).toBeEnabled();
  if ((await trigger.getAttribute("aria-expanded")) !== "true") await trigger.click();
  const menu = trigger.page().getByRole("menu", { name: menuName });
  await expect(menu).toBeVisible();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  return menu;
}

/** Attend l'*effet* du choix ; ne reclique jamais pour le provoquer. */
export async function pickMenuItem(
  menu: Locator,
  name: string,
  effect: () => Promise<void>,
): Promise<void> {
  await menu.getByRole("menuitem", { name }).click();
  await effect();
}
```

Règle pour toute la suite : après un clic sur un item de menu, le test attend l'effet propre de
l'opération (nouvelle ligne, écriture de définition acquittée, valeur persistée). **Aucune boucle ne
doit refaire l'action** — c'est le défaut de W-07, et c'est pourquoi une régression « le panneau se
referme intempestivement » est restée verte sur trois échecs CI consécutifs.

### L1.5 `tests/e2e/waits/transitions.ts`

`expectClosed(locator)` fondé sur `data-closing` de l'application ou sur la disparition de l'élément,
jamais sur `waitForTimeout`. Pour les captures : barrière de repaint
(`await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))`)
plus `toHaveScreenshot()` avec `animations: "disabled"` explicite.

### L1.6 `tests/e2e/waits/rename.ts` — acquittement d'un renommage (S4)

Aujourd'hui `commitTreeRename` (`hierarchy-explorer.tsx:1532-1545`) affiche le nouveau nom puis lance
l'écriture et retourne `Promise.resolve(true)` : aucun appelant ne peut attendre. Exposer, sur la
ligne de l'arbre, l'état d'acquittement (`data-name-state="saving|saved|refused"` posé par le
`.then`/`.catch` existant) et un helper :

```ts
export async function expectTreeNamePersisted(page: Page, itemId: string, name: string) {
  const row = page.getByTestId(`tree-item-${name}`);
  await expect(row).toHaveAttribute("data-name-state", "saved");
  await expectPollPersistedName(page, itemId, name); // relecture de l'élément
}
```

### L1.7 `tests/e2e/waits/acknowledgement.ts` — acquittement par identité (S8)

Le snapshot ne dit que « la file est vide ». Pour « cette mutation a été acquittée », exposer dans
`LocalContentSnapshot` (`apps/web/src/services/local-content.ts:157-170`) un compteur monotone
`acknowledgedCount` et le dernier `mutationId` acquitté (rempli là où la file retire la ligne après
succès). Helper : `expectMutationAcknowledged(page, { since: number })` → poll sur
`acknowledgedCount > since`. À défaut d'identifiant exposable, le compteur suffit si l'on a capturé sa
valeur avant le geste : c'est une preuve de « une mutation de plus a été acquittée », corrélée à
l'ordre, et suffisante pour refuser un `synced` périmé.

### L1.8 `tests/e2e/waits/files.ts` — téléversement et pièce jointe (S12)

`getSnapshot().filePendingCount` existe. Helper `expectFileDurable(page, fileId)` qui attend
`filePendingCount === 0` **et** relit l'attachement du côté de l'élément (`getItem`) : un compteur
seul ne dit pas *quel* fichier.

### L1.9 `tests/e2e/waits/clock.ts` — le temps comme sujet (S13, S17, S18)

- `withPageClock(page, work)` : `page.clock.install()` puis `fastForward` explicite, avec repli
  documenté si l'horloge factice casse le service worker ou la boucle de synchronisation (alors :
  horloge injectée côté application, jamais un sommeil).
- `expectBackupAge(page, …)` : lecture API de la sauvegarde + `page.clock` pour le seuil de 26 h,
  au lieu du `Date.now() - 27 h` en fixture de `backup.spec.ts`.

### L1.10 `tests/e2e/waits/identity.ts` — identité des cibles et des fixtures (S20)

`uniqueName` (`helpers.ts:385`) reste pour l'unicité, mais l'**ordre** ne doit jamais dépendre de
l'horloge réelle (cf. `sidebar.spec.ts:59`). Fournir `orderedIds(n)` fondé sur une horloge injectée et
`itemIdOf(page, name)` (lecture de `data-item-id`) pour que les attentes visent une identité, pas un
libellé ni un index de liste.

**Acceptation L1 :** le module est utilisé par au moins une spec par famille ; `bun run format:check`,
`bun run lint:ci`, `bun run typecheck` et les suites unitaires touchées passent ; aucun nouveau
`waitForTimeout` ; chaque helper exporté cite dans son commentaire l'id `S…` de la doctrine qu'il
incarne.

---

## 3. Lot L2 — les sept sites P1 (chacun avec son test d'acceptation)

| id | Changement | Acceptation (doit pouvoir échouer) |
|---|---|---|
| W-01 | `page-multi-device-convergence.spec.ts:385-390` : remplacer l'assertion de titre par `await expectPersistedNavigation(second.page, landingId)` avant `page.close()`. L'identifiant vient de l'attribut `data-item-id` de la ligne, pas du nom. | Avec D1 (put `navigation-state` retardé de 1500 ms) le parcours doit **échouer** ; avec le comportement actuel, `--repeat-each=20` vert. |
| W-02 | `conflict-resolution.spec.ts:96` : `expectAppliedOn(second.page, itemId, texteAttendu)` puis l'absence de notice de conflit. | Avec D5 (`/v1/changes` interrompu 5 s) le parcours doit échouer ; vert sinon. |
| W-03 | `offline-availability.spec.ts:135` : (a) relire le document durable au lieu de croire l'éditeur ; (b) **décision produit requise** : `runEviction` (`budget.ts:151`) n'a aucun appelant de production, donc le contrôle de limite ne peut rien évincer. Soit brancher `runEviction` sur le chemin de la limite (`storage-panel.tsx:44-52`, après `writeLimit`), soit renommer le parcours sur ce qu'il vérifie réellement et couvrir la garantie par un test unitaire de `runEviction`. Ne pas laisser un test vert qui certifie une propriété de non-perte que personne n'implémente. | `runEviction` branché : forcer la limite à 1 Go avec 2 Go de contenu *non envoyé* doit conserver les lignes non envoyées et ne libérer que ce qui est libérable ; le test E2E doit échouer si `runEviction` est remplacé par une version qui libère tout. |
| W-04 | `file-preview.spec.ts:196-204` : le SVG hostile émet `{probe:"started"}` sans condition au chargement ; vérifier ce marqueur (témoin positif), puis l'absence de vol via `expect.poll`, puis l'événement de chargement du cadre. Supprimer le sommeil de 1000 ms. | Si le marqueur est retiré de la fixture, le test doit échouer (prouve que le témoin est vivant). |
| W-05 | `hierarchy.spec.ts:602-606` : après `Escape`, `await expect(menu).toHaveCount(0)` ; puis le chemin clavier. | Réintroduire un menu insensible à `Escape` doit faire échouer le test. |
| W-06 | `synchronize-serialization.spec.ts:249,273` : remplacer le sommeil de 50 ms par une barrière différée que le test libère ; vérifier `peakConcurrency === 1` *avant* de libérer, puis libérer et attendre. | Retirer la sérialisation doit faire échouer le test (ce n'est pas vrai dans tous les entrelacements aujourd'hui). |
| W-07 | `database-page-interaction.spec.tsx:355-368` : ouvrir le panneau une fois, vérifier `aria-expanded`, `await vi.waitFor(() => expect(option).not.toBeNull())`, cliquer une fois, vérifier `replace` appelé une fois. | Faire refermer le panneau sur un basculement parasite doit faire échouer le test immédiatement (aujourd'hui il réessaie 15 s et peut encore passer). |

---

## 4. Lot L3 — sites P2 côté E2E (`W-08` … `W-24`)

Regrouper par témoin, pas par fichier, pour que chaque changement soit relu une seule fois :

1. **Écritures de présentation** (`W-08`, plus la même forme trouvée dans `workspace-shell.spec.ts` et
   `routing.spec.ts`) : `expectPersistedTab` avant tout rechargement/fermeture.
2. **Écritures d'entrée et de propriétés** (`W-10`, `W-12`, `W-21`) : capturer la séquence avant le
   geste, `expectEntrySavedSince`/`expectDefinitionSavedSince` après ; jamais un
   `waitForDatabaseDefinitionIdle` nu.
3. **Écritures d'éditeur** (`W-09`, `W-13`) : `waitForEditorSettled({ afterApplyCount })` capturé
   avant le geste, puis relecture du document persisté.
4. **Preuves sur second appareil** (`W-14`, `W-16`, `W-19`, `W-24`) : `expectAppliedOn` /
   `pendingCommand` par type de commande *puis* vidage, jamais un vidage global d'abord.
5. **Assertions négatives** (`W-18`, `W-20`) : une négation doit être encadrée par deux preuves
   positives (avant et après la fenêtre), ou remplacée par une assertion positive sur le magasin
   durable.
6. **Jamais de délai** (`W-22`, `W-23`) : capture sans barrière de repaint ; annonce de région vive
   tierce comme témoin d'un glisser. Remplacer par l'ordre/la révision persistés.

**Acceptation L3 :** chaque parcours modifié vert en `--repeat-each=10` sur `chromium-desktop` et
`webkit-mobile` en local, et l'injection correspondante (§6) rouge.

---

## 5. Lots L4 et L5 — unitaire, intégration, puis le garde-fou

### L4 (`W-25` … `W-37`)
- Remplacer les sommeils réels par faux minuteurs + `advanceTimersByTimeAsync` pour les debounces et
  backoffs (`W-25`, `W-26`, `W-27`) ; le contre-exemple à copier est
  `packages/client-core/tests/page-editing-session.spec.ts:58`.
- Remplacer les barrières « une microtâche / deux microtâches » (`W-30`, `W-33`, `W-49`) par une
  promesse différée que le test résout.
- Remplacer les preuves d'ordre par durée écoulée (`W-28`, `W-31`) par l'ordre d'appel enregistré.
- Réparer les assertions infalsifiables (`W-32` : `?? Number.POSITIVE_INFINITY`), l'horloge de fixture
  (`W-36`), et supprimer le contournement `vi.waitFor` à 10 s (`W-37`) une fois l'événement manqué
  identifié.
- Migrer les douze fichiers qui utilisent un `pause()`/`setTimeout(0…100)` comme flush après un clic
  ou un montage (tableau 3 de `COUVERTURE.md`) : `board-card-editor`, `database-board-interaction`,
  `database-card-inline`, `database-view-loading` (`advance()`), `emoji-picker`, `group-editor`,
  `map-view-states` (`render()`), `navigation-item-menu`, `page-attachment-panel`,
  `recovery-replacement`, `editor-input`, `sidebar`. Remplacer le flush par une attente sur l'état
  attendu (`vi.waitFor`) ou par une promesse exposée par le faux service.
- Ajouter un test d'intégration qui reproduit le côté produit de W-01 au niveau unitaire : l'écrivain
  de présentation doit être attendu par un appelant observable (voir §7, décision D-A).

### L4bis — horloge contrôlée pour les tests dont le temps est le sujet

Fichiers concernés (tableau 4 de `COUVERTURE.md`) : `apps/web/tests/mcp-access-panel.spec.tsx`,
`packages/domain/tests/rotation-policy.clock.spec.ts` (à confirmer),
`tests/e2e/backup.spec.ts` (seuil 26 h), `tests/e2e/security-rotation.spec.ts` (échéances),
plus les budgets de latence à annoter (`realtime-page-sync`, `editor-performance`,
`progressive-startup`, `databases-schema`, `knowledge-graph`, `linked-databases`,
`databases-offline-sync`).

Règles :

- horloge **injectée** côté domaine (`now()`), **`vi.useFakeTimers` + `advanceTimersByTimeAsync`**
  côté web, **`page.clock`** côté E2E — jamais un sommeil réel ;
- les modèles à copier sont `session-policy.clock.spec.ts` et `lifecycle.spec.ts`, déjà corrects ;
- un budget de latence est autorisé **si** la latence est l'exigence produit : borne annoncée dans le
  nom ou le commentaire avec la mention `budget produit`, et l'assertion ne doit jamais servir à
  attendre (le témoin d'achèvement reste distinct) ;
- le délai volontaire de `progressive-startup.spec.ts:156` (réponse serveur retenue) est une variable
  indépendante du test : il est conservé et documenté comme tel.

**Acceptation L4bis :** aucun `Date.now()` dans une assertion de type « attendre que » ; chaque test
temporel avance une horloge qu'il possède ; l'annotation `budget produit` est présente sur chaque
`toBeLessThan` temporel (le contrat du L5 la vérifie).

### L5 (`W-38` … `W-56`) et le frein de régression
- Les assertions négatives gagnent un ancrage positif ; les choix de menu slash vérifient le bloc
  inséré.
- Nouveau test de contrat `tests/contract/test-witness-contract.spec.ts` :
  - interdit `waitForTimeout(` partout sous `tests/e2e/` ;
  - interdit `setTimeout(` utilisé comme sommeil dans `*.spec.ts(x)` sauf si le fichier appelle
    `vi.useFakeTimers()` ;
  - exige que chaque `page.reload()`, `page.close()`, `context.newPage()`, `setOffline(` et appel de
    révocation d'appareil sous `tests/e2e/**` soit précédé, dans le même test, d'un appel à l'un des
    témoins approuvés (`saveDocument`, `waitForEditorSettled`, `waitForSynchronized` après un
    changement de projection observé, `expectPersistedNavigation`, `expectPersistedTab`,
    `expectEntrySavedSince`, `expectDefinitionSavedSince`, `expectAppliedOn`,
    `waitForEntryAutosave`), sauf si le test est listé dans un fichier d'exceptions explicite
    `tests/e2e/deliberate-races.ts` avec une justification d'une ligne.
  - Ces exceptions sont la clé de l'invariant 5 : les parcours de fermeture/coupure/concurrence
    volontaires y figurent visiblement, au lieu d'être indiscernables d'un oubli.
- Contrôles de revue et de documentation, dans le même lot :
  - `docs/development.md` : nouvelle entrée dans l'inventaire des portes, pointant vers un nouveau
    `docs/testing/wait-contracts.md` (résumé d'une page + lien vers `DOCTRINE.md` du dossier d'audit,
    qui devient la référence normative du dépôt) ;
  - `AGENTS.md`, section « Working conventions » : une ligne rendant l'audit d'attente obligatoire
    avant de déclarer un test terminé, avec pointeur vers ce document ;
  - modèle de revue : le dépôt n'a pas de `.github/PULL_REQUEST_TEMPLATE` — en créer un (ou ajouter la
    section au corps de PR documenté) avec la case non négociable « chaque nouvelle attente cite le
    signal corrélé et le code qui le produit ; aucun délai, aucune visibilité seule, aucun `idle` » ;
  - politique de migration : une PR qui touche un fichier de catégorie B de `COUVERTURE.md` migre ce
    fichier dans la même PR, ou justifie explicitement pourquoi non.
- Être honnête dans l'en-tête du contrat : c'est un frein syntaxique, pas une preuve. Sa valeur est
  d'empêcher la suite de régresser pendant que le travail sémantique est relu.

---

## 6. Protocole de validation (avant/après, injections, charge, cinq navigateurs, runs répétés)

### 6.1 Matrice d'injection — la seule façon de montrer qu'un témoin peut échouer

Chaque injection est appliquée **depuis le test** (`page.addInitScript`, `page.route`), jamais par un
drapeau applicatif :

| # | Injection | Mécanisme | Doit devenir rouge | Doit rester vert (témoin positif) |
|---|---|---|---|---|
| D1 | retarder de 1500 ms le `put` `meta` de `navigation-state` | `addInitScript` enveloppant `IDBObjectStore.prototype.put` pour cette clé | W-01 | W-01 avec 60 ms de retard |
| D2 | retenir `/v1/mutations/batch` 2000 ms puis réussir | `page.route` | tout test qui prend le clic pour un acquittement (aucun après L2) | tous les tests de L2 |
| D3 | refuser une fois le batch (`503`) | `page.route` | le chemin de refus de `save-state.spec.ts` | son jumeau positif |
| D4 | supprimer les écritures d'onglets/visité | `addInitScript` rejetant la promesse pour cette clé | W-08 | les parcours qui ne rechargent pas |
| D5 | interrompre `/v1/changes` pendant 5 s | `page.route` | W-02, W-16 | leurs assertions en régime établi |
| D6 | retirer le `postMessage` du témoin positif de la prévisualisation | modification de la fixture | W-04 | — |
| D7 | retarder de 2 s l'acquittement de l'enregistrement automatique | `addInitScript` sur le `put` des items | W-10, W-20 | les mêmes avec 0 ms |

Conserver les injections dans un module réutilisable `tests/e2e/injections.ts` et un tableau dans
`docs/development.md`, parce que c'est la réponse durable à « cette attente masque-t-elle un défaut ? ».

### 6.2 Parcours de course volontaire (à préserver, ne pas adoucir)

Ces parcours existent pour exercer une interruption brutale et doivent garder un comportement
exigeant : `page-multi-device-convergence.spec.ts` (page fermée), `page-multi-tab-convergence.spec.ts`,
`interrupted-mutations.spec.ts`, `conflict-resolution.spec.ts`, `page-ambiguity.spec.ts`,
`offline-availability.spec.ts` (branches sans réseau), `realtime-sync-security-and-restore.spec.ts`
(révocation), `databases-offline-sync.spec.ts`.

Deux d'entre eux ont besoin d'une course **déterministe** plutôt que chanceuse :

- *fermer juste après avoir sélectionné une page* : au lieu de fermer à un instant aléatoire, utiliser
  D1 avec un retard connu, fermer, et vérifier le comportement documenté. **Cela exige la décision
  D-A (§7).**
- *couper le réseau au milieu d'une écriture* : bloquer la requête batch via `page.route`, couper,
  libérer, puis vérifier que la commande en attente est bien présente par type et que le document
  local est intact (le motif existe déjà à `databases-offline-sync.spec.ts:315`).

### 6.3 Calibration et sensibilité des témoins (preuve que l'attente attend le bon état)

Une attente correcte doit être **sensible** : elle ne se résout qu'après l'opération, et elle échoue
si l'opération n'a pas lieu. Pour chaque témoin migré, produire trois mesures et les consigner :

1. **Ordre** — horodater deux événements dans le test (par exemple `page.evaluate` enregistrant
   l'instant du commit de l'écriture, et l'instant où le helper se résout) et vérifier que le témoin
   se résout **après** le commit, jamais avant. C'est l'instrumentation de L0.6 qui le permet.
2. **Sensibilité** — injection correspondante de la matrice (D1-D7) : le test doit échouer, et le
   message d'échec doit nommer la précondition manquante (pas un simple timeout muet).
3. **Non-régression de la vérification** — le diff ne modifie pas l'assertion finale. Fournir dans la
   PR le `git diff` filtré sur les lignes `expect(` pour le prouver.

Un témoin qui ne satisfait pas les trois n'est pas livré.

### 6.4 Matrice locale et répétition

1. `bun run checks:local` (format, lint, typecheck, unitaire, contrat) — vert avant toute exécution.
2. `bun run test:e2e:local -- --project=<p> -g "<parcours>" --repeat-each=20` pour chaque parcours
   touché, sur les cinq projets : `chromium-desktop`, `firefox-desktop`, `webkit-desktop`,
   `chromium-mobile`, `webkit-mobile` (Firefox et WebKit via
   `scripts/test-e2e-firefox-container.sh`, image épinglée
   `mcr.microsoft.com/playwright:v1.64.1-noble`).
3. Charge variable : répéter les parcours touchés avec deux projets en parallèle
   (`MYOWNNOTION_E2E_JOBS=2`) et, une fois, sous contention CPU (charge de type `stress-ng` dans le
   conteneur) pour élargir la distribution temporelle. Consigner le taux de réussite observé dans la
   description de la PR.
4. Preuves en ligne de commande, pas d'affirmations : coller la sortie exacte du `--repeat-each` et le
   résultat des injections.

### 6.5 CI

1. Deux runs `CI` complets, verts à la première tentative, sur le commit final (la porte 058 exige
   déjà l'échec rapide ; ne pas relancer les jobs rouges pour obtenir du vert).
2. Un troisième run avec le **job d'injection** activé par une entrée dédiée du `workflow_dispatch`,
   pour re-prouver les témoins sur l'infrastructure réelle et pas seulement en local.
3. Vérifier que les compteurs du rapport de porte sont inchangés (347 parcours par projet au moment de
   l'audit) et qu'aucun parcours n'a été ignoré ni réessayé.
4. Lire le tableau de synthèse comme une mesure de stabilité, pas comme une garantie — le dire dans le
   corps de la PR.

---

## 7. Décisions qu'Opus doit prendre explicitement (ne pas trancher en silence)

**D-A. « La dernière page visitée survit à une fermeture immédiate » est-elle une promesse produit ?**
`hierarchy-explorer.tsx:868-895` dit que l'écriture se fait au changement *parce qu'une fermeture
brutale n'atteint jamais un gestionnaire de déchargement* : l'intention est la durabilité, et la
course signifie que l'intention n'est pas tenue. Options : (a) garder l'intention, resserrer la
fenêtre et faire asserter la récupération au parcours de course volontaire (par exemple retomber sur
l'enregistrement des onglets ouverts quand `lastVisitedItemId` est absent ou périmé) ; (b) accepter la
fenêtre, la documenter dans la spec, et faire vérifier au parcours le comportement *documenté* au lieu
de restaurer la page précédente en silence. Dans les deux cas, le changement de W-01 (attendre le
commit avant de fermer) reste requis : il supprime le succès accidentel.

**D-B. `runEviction` doit-il exister en production ?** (W-03.) Le test E2E certifie une propriété
qu'aucun code de production n'implémente. Soit le brancher sur le chemin de la limite de stockage avec
sa couverture unitaire, soit retirer la revendication du nom et des commentaires du parcours.

**D-C. L'état `"idle"` de l'enregistrement automatique après un geste est-il un défaut produit ?**
Dans le run 43524911626 le panneau est resté `idle` 15 s après un geste qui aurait dû produire une
écriture. C'était un clic perdu (produit). Si un futur `idle` peut suivre un geste valide pour une
autre raison, le helper strict en fera un rouge — correct, mais la cause doit être comprise, pas
attendue.

**D-D. Budget de délais.** Aucun nouveau délai ne peut dépasser l'attente existante sauf si le
*moteur* est en cause, et toute augmentation doit être justifiée dans la PR par une mesure (comme le
fait déjà le chien de garde WebKit, `playwright.config.ts:92-96`).

---

## 8. Fichiers que ce plan touchera (liste attendue)

Producteurs (L0) : `apps/web/src/services/local-content.ts`,
`apps/web/src/features/databases/use-entry-autosave.ts`,
`apps/web/src/features/databases/entry-panel.tsx`,
`apps/web/src/features/databases/database-page.tsx`,
`apps/web/src/features/hierarchy/hierarchy-explorer.tsx` (seulement si L0.4 est retenu),
`.github/workflows/ci.yml`, `docs/development.md`.

Helpers (L1) : nouveaux `tests/e2e/waits/{presentation,autosave,definition,revisions,menus,transitions}.ts` ;
`tests/e2e/helpers.ts` (délégation + type du point d'accroche).

Specs (L2/L3) : `page-multi-device-convergence`, `conflict-resolution`, `offline-availability`,
`file-preview`, `hierarchy`, `workspace-tabs-folder`, `editor-offline-media`,
`database-entry-properties`, `database-multi-select-board`, `database-form-lifecycle`, `block-editor`,
`page-ambiguity`, `databases-offline-sync`, `revision-restore`, `save-state`,
`legacy-sync-self-healing`, `page-autosave-recovery`, `database-relations-rollups`,
`page-scroll-restoration`, `page-links`, `page-protocol-migration`, `files`, `keyboard-navigation`,
`rich-page`, `editor-suggestion-menu`, plus `tests/e2e/injections.ts` et
`tests/e2e/deliberate-races.ts` (nouveaux).

Unitaire (L4) : `apps/web/tests/{synchronize-serialization,database-page-interaction,entry-property-interaction,table-scroll-observer,projection-refresh,operational-page-opening,board-card-editor,sidebar,relation-value-menu,local-content-realtime-sync,database-view-loading,emoji-picker,group-editor,map-view-states,app-routing}.spec.ts(x)`,
`packages/client-core/tests/legacy-page-editing-session.spec.ts`,
`packages/database/tests/{page-operations,client-lifecycle}.integration.spec.ts`,
`packages/domain/tests/search-index.spec.ts`,
`tests/performance/realtime-page-sync.performance.spec.ts`.

Contrat et documentation (L5) : nouveau `tests/contract/test-witness-contract.spec.ts` ;
nouveau `docs/testing/wait-contracts.md` (résumé normatif + lien vers ce dossier) ; entrée de porte
dans `docs/development.md` ; ligne de convention dans `AGENTS.md` ; modèle de revue de PR.

Migration unitaire complémentaire (L4) : les douze fichiers listés au §5 (flush déguisé) et les sept
fichiers du §7 de `COUVERTURE.md` (horloge à confirmer).

---

## 9. Fin de mission

1. Les 7 sites P1 et les 30 sites P2 sont clos ou explicitement reclassés avec une raison dans
   `INVENTAIRE.md` (mettre à jour le fichier ; c'est l'inventaire vivant).
2. Plus aucun `waitForTimeout`, aucune boucle de reclique, aucun sommeil-témoin dans `tests/e2e/`, et
   le nouveau test de contrat le garantit.
3. Matrice d'injection D1 à D7 consignée dans la PR : chaque ligne « rouge comme attendu » avec le run
   ou la commande.
4. Matrice locale sur cinq navigateurs verte et répétée ; deux runs CI complets verts à la première
   tentative sur le commit final ; un troisième run avec injections vert sur les seuls cas injectés.
5. `docs/development.md` liste le catalogue des témoins et la matrice d'injection, pour que l'agent
   suivant n'ait pas à les redécouvrir.
6. `DOCTRINE.md` et `COUVERTURE.md` sont repris dans `docs/testing/wait-contracts.md` (référence
   durable du dépôt) et référencés depuis `docs/development.md` et `AGENTS.md` ; le contrat
   `tests/contract/test-witness-contract.spec.ts` est actif dans la CI et échoue sur une régression de
   forme.
7. Aucun fichier de `COUVERTURE.md` n'est resté sans lot : chaque ligne est migrée, ou explicitement
   reclassée (conforme / temps comme sujet / borne de sécurité) avec sa justification.
8. Le corps de la PR dit ce qui est prouvé, ce qui n'est que statique, et ce qui reste non vérifiable
   (les éléments moteur et tiers : annonces `@dnd-kit`, variance du moteur WebKit).
