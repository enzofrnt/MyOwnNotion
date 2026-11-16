# Doctrine des témoins — exigence transversale pour tous les tests

Document **normatif**. Il ne décrit pas l'état du dépôt (voir `INVENTAIRE.md` et `COUVERTURE.md`) :
il décrit la règle que tout test existant doit satisfaire après migration et que tout test futur doit
satisfaire dès l'écriture. Il s'applique aux tests E2E (91 specs, cinq projets navigateurs), aux
tests unitaires et d'intégration (`apps/web/tests`, `packages/*/tests`), aux tests de contrat et de
performance.

## 1. La règle

Une étape de test ne peut commencer que sur la preuve, **produite par le code qui achève
l'opération**, que la précondition dont elle dépend est vraie. Six clauses :

1. **La preuve est un état réel du système**, pas une conséquence observée de cet état. Un élément
   visible, un texte affiché, un `aria-pressed`, une capture d'écran, un toast ou une entrée de menu
   sont des *conséquences*.
2. **La preuve est corrélée à l'opération exacte** : même entité (identifiant), même révision, même
   identifiant de mutation, même type de commande, même appareil. « La file est vide » n'est une
   preuve que si l'on a d'abord observé que *cette* opération y est entrée, ou qu'elle a été validée
   dans la même transaction IndexedDB.
3. **La preuve ne peut pas être manquée ni périmée.** On interroge un état persistant (relecture
   IndexedDB, réponse API d'état, attribut dérivé de l'état validé) ou un compteur monotone capturé
   avant le geste. On n'attend jamais un événement transitoire, et on n'accepte jamais un état déjà
   vrai avant l'action comme s'il était la preuve de l'action.
4. **Le temps n'est pas une preuve.** Aucun délai, si court soit-il, ne peut servir d'autorisation à
   continuer. Les délais ne subsistent que sous la forme prévue en clause 5, ou lorsque **le temps est
   le sujet du test** (clause 6).
5. **Les timeouts sont des bornes maximales de sécurité, avec diagnostic explicite.** Une attente est
   un `expect.poll`/`vi.waitFor` sur un signal réel, borné par un timeout dont l'échec **nomme** ce
   qui manquait (« la valeur d'entrée n'a jamais été acquittée après ce geste »). Un timeout n'est
   jamais une durée à laisser passer pour espérer que ça marche, et son expiration est un échec, pas
   une transition.
6. **Quand le temps est le sujet, l'horloge est contrôlée.** Pour un debounce, une expiration, un
   backoff, une fenêtre de rétention ou un budget de latence produit, le test avance une horloge
   qu'il possède (faux minuteurs Vitest, `page.clock` de Playwright, ou `now()` injecté côté domaine)
   et n'attend pas la vraie horloge.

Aucune de ces clauses n'autorise à affaiblir une assertion : la migration remplace le *témoin*, jamais
la *vérification*. Un scénario qui exerce une fermeture immédiate, une coupure réseau ou une
concurrence reste couvert, et devient plus déterministe (clause 6 appliquée aux courses :
l'interruption est déclenchée par une barrière que le test contrôle).

## 2. Liste noire — ce qui n'est jamais une preuve

| Jamais | Pourquoi | Cas réel |
|---|---|---|
| `waitForTimeout` / sommeil | ne prouve rien sur l'opération, seulement que du temps est passé | `file-preview.spec.ts:203`, `save-state.spec.ts:75,142`, `offline-availability.spec.ts:158` |
| Un élément « simplement visible » | rendu React ≠ durabilité ; peut précéder l'écriture | `page-multi-device-convergence.spec.ts:390` (incident prouvé) |
| Un texte optimiste affiché | l'interface montre l'écriture avant qu'elle soit écrite (`void rename…`, `void edit…`) | `hierarchy-explorer.tsx:1532-1545`, `entry-property-list.tsx:485` |
| Une réponse réseau reçue | le serveur a répondu ≠ l'application a appliqué, et ≠ l'appareil a persisté | `page-protocol-migration.spec.ts:219` |
| Un état `idle` / `0` / « rien en attente » | peut être vrai *avant* l'action, faute d'enfilement observé | `waitForEntryAutosave` voyant `idle` 15 s (run 43524911626) |
| Une capture d'écran | fige un rendu, y compris au milieu d'une animation, et un diff ne prouve pas l'écriture | `v1-surface-visuals`, `workspace-shell-visual` |
| Une annonce de région vive tierce | émise par une bibliothèque, pas par l'opération ; peut ne jamais venir | `@dnd-kit` `DndLiveRegion` (run 43706222653) |
| « Aucune erreur » / « pas de conflit » | absence, non corrélée, souvent assertée avant que l'opération soit tentée | `conflict-resolution.spec.ts:96`, `save-state.spec.ts:219` |
| `aria-pressed`, focus, menu refermé | état d'intention, pas d'achèvement | `database-form-lifecycle.spec.ts:69` |
| Une boucle qui refait l'action jusqu'à ce que l'assertion passe | masque la régression par construction | `database-page-interaction.spec.tsx:355-368` |

## 3. Liste blanche — les formes autorisées

| Forme | Quand | Exemple de référence dans le dépôt |
|---|---|---|
| Relecture d'un état persistant (IndexedDB, API d'état) corrélée par identifiant | toute écriture locale durable | `page-multi-tab-convergence.spec.ts:226,234` (comptage IDB brut `sending`), `databases-offline-sync.spec.ts:431-448` (lecture API du parent de fusion) |
| `expect.poll` sur un attribut produit par le code qui achève l'opération, capturé avant le geste | écritures d'éditeur, d'entrée, de définition | `waitForEditorSettled({ afterApplyCount })`, `page-editing-session.spec.ts:58` (magasin durable verrouillé, libéré par le test) |
| File vidée **après** preuve d'enfilement | écritures passant par `service.mutate` (atomiques, `apply-local-mutation.ts:114-163`) | `hierarchy.spec.ts:359`, `routing.spec.ts:135` |
| Commande en attente **par type** | preuve qu'une mutation a été enfilée avant de vider | `databases-offline-sync.spec.ts:315,326,381` |
| État dérivé du serveur | révocation, sauvegarde vérifiée, session | `protocol-compatibility.spec.ts:98`, `realtime-sync-security-and-restore.spec.ts:105` |
| Témoin positif d'exécution | assertions négatives (rien ne fuit, rien ne casse) | à construire pour W-04 |
| Borne maximale avec échec explicite | tout ce qui précède : les timeouts | `bounds` de `bounded-database.ts`, `reset-installation.ts:117-121` |
| Horloge contrôlée | debounce, expiration, backoff, rétention | `session-policy.clock.spec.ts`, `lifecycle.spec.ts` (`now()` injecté) |
| Budget de latence produit | quand la latence **est** l'exigence, bornée et documentée | `realtime-page-sync.spec.ts:78` (2 s annoncés), `databases-schema.spec.ts:103` |

## 4. Catalogue des séquences asynchrones : précondition et signal

Chaque séquence du produit nomme la précondition que l'étape suivante exige et le signal qui la
prouve. Les identifiants `S1`…`S20` sont ceux utilisés dans `INVENTAIRE.md` et `PLAN-OPUS.md`.

| id | Séquence | Précondition avant l'étape suivante | Signal fiable | Producteur, moment exact où il devient vrai | Jamais utilisé à la place |
|---|---|---|---|---|---|
| S1 | Sélection d'un élément, persistée comme « dernière page visitée » | l'enregistrement `navigation-state.lastVisitedItemId` est **validé** pour cet élément | relecture du document (`readPresentationState()`, à exposer) ou attribut dérivé de la valeur retournée par la transaction | `hierarchy-explorer.tsx:879-895`, après résolution de `updateWorkspacePresentationState` | ligne `aria-selected`, titre affiché, `waitForSynchronized` |
| S2 | Bande d'onglets, branches dépliées, largeur du panneau, ancres de défilement | le même document contient la valeur voulue | relecture du champ concerné du document | même effet / `onCaptureScrollAnchor` (`:488-498`) | `aria-current`, ordre du DOM |
| S3 | Création, déplacement, conversion, corbeille, renommage via `service.mutate` | projection **et** ligne de file validées ensemble | changement de projection observé, puis file vidée (`syncState`) ; ou relecture de l'élément | `apply-local-mutation.ts:114-163` (transaction unique) | clic, toast, `idle` |
| S4 | Renommage en ligne dans l'arbre | l'écriture du nom est acquittée (pas seulement affichée) | acquittement dédié sur la ligne (à exposer : même compteur que S9/S10) | `commitTreeRename` (`hierarchy-explorer.tsx:1532-1545`) | nouveau nom affiché |
| S5 | Geste d'éditeur (frappe, collage, IME, glisser de bloc) | dernier lot canonique remis au moteur, transactions locales durables, zéro échec d'application | `data-editor-change-sequence` et `data-editor-apply-count` capturés avant, `data-editor-settled="true"`, `data-editor-apply-failures="0"` | `page-editor.tsx:304-311` (écrit dès le geste), `data-editor-settled` après drainage | contenu du `ProseMirror`, `data-durable` seul |
| S6 | Enregistrement automatique des propriétés d'entrée | l'enregistrement de *ce* geste est acquitté | `data-save-sequence` (à exposer) capturé avant et strictement supérieur après, plus `data-save-state="saved"` | `use-entry-autosave.ts:153`, `entry-panel.tsx:196` | `"saved"` déjà présent, `"idle"`, valeur du champ |
| S7 | Ordre des propriétés d'entrée, propriétés de base, vues (filtres, tris, groupes, colonnes) | la mutation de définition est acquittée | `data-definition-sequence` (à exposer) capturé avant, plus `data-definition-state="idle"` en fin de séquence | `database-page.tsx:1112`, `database-container-page.tsx:438,909` | `data-definition-state="idle"` seul, nouvel ordre affiché |
| S8 | Vidage de la file vers le serveur | *cette* mutation a été acquittée par le serveur (ou refusée, explicitement) | `syncState="synced"` **après** S3/S7, ou identifiant de mutation acquitté (à exposer : `lastAcknowledgedMutationId`) | `local-content.ts` `#notify` (ligne 578-616) | `synced` lu avant enfilement, `pendingCount: 0` |
| S9 | Application sur un autre appareil | la révision attendue est **appliquée sur cet appareil** | relecture `getItem(itemId)` (texte/révision) ou `revisionHeaders.get(revisionId)`, comparée à ce que l'autre appareil a écrit | projection distante appliquée (`client-core` réconciliation) | `data-sync` global, horodatage, simple absence de conflit |
| S10 | Reconnexion / reprise après coupure | commandes en attente identifiées par type, puis traitées | `pendingCommand(page, commandType)` puis file vidée | `databases-offline-sync.spec.ts:315` (motif existant) | `navigator.onLine`, `data-sync` |
| S11 | Révocation d'appareil ou de session | l'état serveur a changé et cet appareil l'a lu | `live-connection-state[data-state]`, `session-list`, `sync-status[data-state]` dérivés du serveur | `connection-state.tsx:49`, endpoints de révocation | fermeture de socket observée seule, délai de 5 s supposé |
| S12 | Téléversement / pièce jointe | le fichier est durable et l'attachement enregistré | `getSnapshot().filePendingCount` revenu à zéro **et** relecture de l'attachement dans l'élément | `local-content.ts` (file de transfert) | état visuel de la progression, nom de fichier affiché |
| S13 | Sauvegarde, vérification, rétention | l'état est celui du serveur pour un instant donné | lecture API de la sauvegarde/du statut, avec horloge contrôlée pour les seuils (26 h) | `backup.spec.ts`, API de sauvegarde | texte de bandeau, `Date.now()` du test |
| S14 | Ouverture de menu, sous-menu, sélecteur | le menu est **actionnable** et la cible est **la bonne** | `aria-expanded="true"`, cible `aria-disabled="false"`, identité stable (`data-item-id`) et effet propre de l'opération après le clic | composants `ui-menu`, `property-settings`, `entry-choice-picker` | menu visible, texte de l'item, boucle de reclique |
| S15 | Fermeture d'un volet, panneau, tiroir, aperçu | l'élément a effectivement disparu ou n'intercepte plus le pointeur | disparition (`toHaveCount(0)`) ou attribut `data-closing`/`data-open` posé par l'application | `database-entry-peek`, `workspace-navigation-drawer` | durée d'animation (260 ms), `waitForTimeout` |
| S16 | Transition, animation, repaint | la transition est terminée pour l'élément concerné | `transitionend`/`animationend` porté par l'élément, ou attribut d'état de l'application ; pour une capture, deux `requestAnimationFrame` **plus** `animations: "disabled"` | composants CSS concernés | diff de capture sans barrière |
| S17 | Hydratation initiale (shell, arbre, projection) | le shell est prêt et la projection complète pour ce que l'on va lire | `workspace-shell` visible + `[role="tree"]` attaché + `getSnapshot().projectionComplete` (et `loadState="ready"`) | `hierarchy-explorer` (`setLoadState`), `local-content.ts` | premier pixel, `domcontentloaded`, délai |
| S18 | Recherche avec requête débouncée | la requête *voulue* a été exécutée et ses résultats rendus depuis l'index durable | horloge contrôlée pour le debounce, puis `expect.poll` sur les résultats attendus | composant de recherche, index de recherche | `waitForTimeout` après la frappe, résultats partiels |
| S19 | Calcul de cumul, de formule, d'agrégat | les sources dont dépend le calcul sont durables, puis la valeur affichée est cohérente | S6/S7 pour les sources, puis assertion de la valeur (état produit) | `rollup`, `formula` (évaluateur) | valeur affichée alors que la source est en vol |
| S20 | Identité des cibles et des fixtures | la cible désignée est bien celle que l'on croit, indépendamment des remontages et du temps | identifiants explicites (`data-item-id`, `generateUuidV7()` d'une horloge injectée) pour localiser et nommer | générateurs d'identifiants, attributs d'identité | nom généré avec l'horloge réelle pour ordonner des fixtures, index de liste |

Le rapport d'audit conserve une seconde lecture de ce catalogue : pour chaque ligne, les sites du
dépôt qui s'y conforment déjà et ceux qui doivent migrer, dans `COUVERTURE.md`.

## 5. Règle d'écriture pour tout nouveau test

Un nouveau test (ou un test migré) doit répondre à six questions dans un commentaire d'en-tête, au
même endroit que les commentaires de comportement existants :

1. Quelle opération asynchrone cette étape déclenche-t-elle, et qui la termine ?
2. Quelle est la précondition de l'étape suivante, en une phrase ?
3. Quel signal **corrélé** prouve cette précondition, et par quel code est-il produit ?
4. Pourquoi ce signal ne peut-il pas être déjà vrai avant l'action (pas d'événement manqué) ni
   rester vrai après une écriture perdue (pas d'état périmé) ?
5. Si le test doit exercer une interruption (fermeture, coupure, concurrence), quelle barrière la
   déclenche de façon déterministe ?
6. Quelle injection (matrice D1-D7 du plan) prouve que ce témoin peut échouer ?

Règles de forme associées :

- **Aucun** `waitForTimeout`, aucun `setTimeout` comme synchronisation, aucune boucle de reclique
  dans `tests/e2e/`. Aucun sommeil réel dans un fichier `*.spec.ts(x)` sans `vi.useFakeTimers()`.
- Les attentes vivent dans les helpers partagés (`tests/e2e/waits/`, `tests/e2e/helpers.ts`), jamais
  recopiées dans une spec : un témoin dupliqué diverge et n'est plus revu.
- Un helper de témoin prend l'entité en argument (identifiant) et, quand l'opération est un geste,
  la valeur capturée avant le geste (numéro de séquence, compteur). Un helper sans argument
  d'identité est un signal global : il doit être justifié en commentaire.
- Les timeouts de témoins sont les bornes existantes (15 s action, 20-30 s synchronisation, 10 s
  `expect`) et chaque message d'échec nomme la précondition manquante.
- Un test dont **le sujet est le temps** déclare son horloge contrôlée dès l'en-tête et n'utilise
  aucun sommeil réel.
- Une assertion négative est encadrée par deux preuves positives (avant et après la fenêtre) ou
  remplacée par une assertion positive sur l'état durable.

## 6. Contrôles

### 6.1 Contrôle automatisé (nouveau test de contrat)

`tests/contract/test-witness-contract.spec.ts`, écrit dans le style de
`tests/contract/e2e-gate-coverage.spec.ts` (même famille, même ton : il lit les sources et refuse les
formes interdites). Contenu minimal :

1. `waitForTimeout(` interdit sous `tests/e2e/`.
2. `new Promise(... setTimeout/` et `setTimeout(` utilisés comme synchronisation interdits dans les
   fichiers `*.spec.ts(x)` de tout le dépôt, sauf si le fichier appelle `vi.useFakeTimers()`.
3. `page.reload()`, `page.close()`, `context.newPage()`, `setOffline(`, et les appels de révocation
   sous `tests/e2e/**` doivent être précédés, dans le même test, d'un témoin approuvé (liste
   blanche du §3) — ou le test figure dans `tests/e2e/deliberate-races.ts` avec une justification
   d'une ligne.
4. `expect(...).toBeLessThan`/`toBeGreaterThan` sur une durée mesurée (`Date.now()`/`performance.now()`)
   doit être accompagné d'un commentaire contenant `budget produit` (temps comme sujet, §1 clause 6).
5. Interdiction d'un `aria-pressed`/`toBeVisible` immédiatement suivi d'un `reload()`/`close()`
   lorsque le fichier est en catégorie B de `COUVERTURE.md` (liste explicite tant que la migration
   n'est pas finie, puis règle générale).

Le contrat est un **frein syntaxique**, pas une preuve : il empêche le retour des formes interdites,
il ne démontre pas qu'un témoin est corrélé. Sa relecture humaine reste obligatoire, et l'en-tête du
fichier doit le dire.

### 6.2 Contrôle de revue

- Ajouter au modèle de revue (le dépôt n'a pas de `PULL_REQUEST_TEMPLATE` : en créer un, ou ajouter la
  section au corps de PR documenté dans `docs/development.md`) une case non négociable :
  *« chaque nouvelle attente cite le signal corrélé et le code qui le produit ; aucun délai, aucune
  visibilité seule, aucun `idle` »*.
- `docs/development.md` référence ce document depuis l'inventaire des portes.
- `AGENTS.md` ajoute une ligne dans les conventions de travail : l'audit d'attente est obligatoire
  avant de déclarer un test terminé, avec pointeur vers ce fichier.
- Politique de migration : une PR qui touche un fichier de la catégorie B de `COUVERTURE.md` doit
  migrer ce fichier dans la même PR ou justifier pourquoi non.

### 6.3 Définition du temps autorisé

| Situation | Outil | Contrainte |
|---|---|---|
| Debounce, expiration, rétention, backoff (unitaire) | `vi.useFakeTimers()` + `advanceTimersByTimeAsync` | `useRealTimers()` en `afterEach` ; jamais `advanceTimersByTime` seul quand des promesses sont en jeu |
| Même chose (E2E) | `page.clock` (disponible dans la version épinglée 1.64.1 : `install`, `fastForward`, `pauseAt`, `resume`, `runFor`, `setFixedTime`) | à valider spec par spec : l'horloge factice peut perturber le service worker et la boucle de synchro ; si elle est incompatible, revenir à une horloge injectée côté application déjà existante |
| Politique datée (sessions, rotation, purge) | `now()` injecté (motif `session-policy.clock.spec.ts`) | le code de production doit accepter l'horloge ; aucune dépendance à `Date.now()` dans une assertion |
| Latence produit | mesure + `toBeLessThan` avec commentaire `budget produit` | borne annoncée dans le nom du test ou le commentaire, jamais utilisée pour *attendre* |
| Attente d'une opération | `expect.poll`/`vi.waitFor` sur signal corrélé | timeout = borne de sécurité avec message nommant la précondition |

## 7. Comment on démontre qu'une attente n'a pas masqué un bug

Trois garanties cumulatives, exigées pour chaque témoin migré :

1. **Injection** : retarder ou annuler l'opération (matrice D1-D7) rend le test rouge. Le témoin
   observe donc vraiment l'opération.
2. **Assertion intacte** : la vérification finale est identique avant et après migration (même valeur,
   même tolérance, même portée). Un diff qui change une assertion en plus du témoin est un
   affaiblissement et doit être justifié séparément.
3. **Course volontaire** : pour chaque scénario d'interruption, un test déclenche l'interruption via
   une barrière déterministe et vérifie le comportement applicatif attendu — il ne dépend plus d'une
   fenêtre de quelques millisecondes.

Un témoin qui ne peut pas échouer (W-03, W-05, W-07 de l'inventaire) est traité comme un défaut de
même gravité qu'une assertion manquante.
