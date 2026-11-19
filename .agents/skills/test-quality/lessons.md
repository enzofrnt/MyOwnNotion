# Leçons — robustesse des tests

Journal **append-only** des échecs qui nous ont appris quelque chose sur la
façon d'écrire un test. Il se lit avec [SKILL.md](SKILL.md) avant d'écrire ou de
modifier un test, et la norme reste
[`docs/testing/wait-contracts.md`](../../../docs/testing/wait-contracts.md).

Il vit ici, dans un skill maintenu du dossier `.agents/skills/`, parce que c'est
l'endroit que les agents consultent réellement (catalogue de skills et
`AGENTS.md`) — et non dans un dossier de documentation que personne n'ouvre. Le
principe non négociable correspondant est inscrit dans
[`.specify/memory/constitution.md`](../../../.specify/memory/constitution.md),
article III.

L'équivalent existe pour l'interface : `.agents/skills/ui-quality/lessons.md`.
Même esprit, même format, même exigence : une leçon naît d'un échec réel observé,
jamais d'une intuition.

## Comment capitaliser

1. Constater l'échec sur une exécution réelle (CI, local, sonde) et rassembler la
   preuve : run, job, ligne, trace, capture.
2. Corriger la cause — dans le produit si le défaut est applicatif.
3. Extraire une règle réutilisable, pas un cas isolé.
4. Ajouter une entrée `L-NNN` ici, avec le statut `validée` si une correction et
   un test l'accompagnent, `candidate` si la règle reste à éprouver.
5. Si la règle devient générale, la remonter dans
   [`docs/testing/wait-contracts.md`](../../../docs/testing/wait-contracts.md)
   (la norme) plutôt que de la laisser dans ce journal ; si elle vaut pour toute
   livraison, l'inscrire dans la constitution.

## Format

```markdown
### L-NNN — titre court
- Statut : validée | candidate
- Surface : chemin ou parcours
- Symptôme : ce que la CI ou la sonde a montré
- Anti-pattern : ce que l'agent avait fait / ferait
- Règle : ce qu'il doit faire à la place
- Preuve : run, fichier, test de non-régression
```

## Entrées

### L-001 — Un menu portail n'est pas une cible de geste stable
- Statut : validée
- Surface : `tests/e2e/databases-tasks.spec.ts:35`,
  `tests/e2e/database-form-lifecycle.spec.ts:143`, menu de types du composeur
  de propriété (`table-view.tsx`, rendu par `createPortal`).
- Symptôme : deux échecs intermittents sous WebKit desktop, à deux jours
  d'intervalle (runs `43587332746` et `43856315749`), sur des assertions
  différentes (`toHaveValue` de la saisie) mais le même geste : appuyer sur un
  bouton du menu, emmener le pointeur ailleurs, relâcher.
- Anti-pattern : écrire un geste dont le **sens dépend de l'endroit où l'appui
  tombe** par rapport à un élément rendu dans un portail et repositionné par
  mesure (`newColumnMenuPos`). Si le menu bouge entre la mesure du rectangle et
  l'appui, le geste ne fait plus ce que le test croit.
- Règle : un geste de test ne s'appuie que sur une cible dont la position est
  garantie par le produit au moment de l'appui, ou sur une cible non portailée
  qui lui appartient. Quand un geste peut légitimement fermer l'interface, le
  test rétablit la **précondition** (rouvrir) puis vérifie la garantie ; il ne
  suppose jamais que l'interface est restée ouverte.
- Preuve : `ensureNewPropertyComposer` dans `tests/e2e/helpers.ts`, utilisé par
  les deux parcours ; le parcours reste rouge si le brouillon est perdu.

### L-002 — Une saisie ne se détruit pas sur une fermeture implicite
- Statut : validée
- Surface : `apps/web/src/features/databases/table-view.tsx`, composeur de
  nouvelle propriété.
- Symptôme : saisir un nom, appuyer ailleurs → le composeur se ferme et le nom
  est perdu ; le rouvrir propose un champ vide. Prouvé par sonde : `"Notes"`
  après saisie, composeur fermé après appui extérieur, `""` à la réouverture.
- Anti-pattern : traiter « fermer » et « jeter » comme le même geste. Le bouton
  d'ouverture remettait la saisie à vide (`setNewColumnName("")`), et la
  fermeture sur appui extérieur ne conservait rien.
- Règle : une fermeture **implicite** (appui ailleurs, re-rendu, défilement)
  conserve la saisie ; seuls une action explicite (Échap) ou un usage réussi
  (propriété créée) la jettent. Un composant qui détient du texte tapé n'a pas le
  droit de le perdre sans décision de l'utilisateur.
- Preuve : `apps/web/tests/database-new-property-draft.spec.tsx` (échoue sans le
  correctif : « reopening resumes the draft: expected '' to be 'Notes' »).

### L-003 — Protéger une garantie une fois, pas deux
- Statut : validée
- Surface : `databases-tasks.spec.ts` et `database-form-lifecycle.spec.ts`
  protégeaient la même garantie avec deux gestes presque identiques.
- Symptôme : la même perte de brouillon a fait échouer les deux parcours, à
  deux jours d'intervalle ; chaque copie avait sa propre fragilité.
- Anti-pattern : dupliquer un contrôle délicat dans plusieurs parcours « pour
  être sûr », avec des variantes de geste qui ne sont pas équivalentes.
- Règle : la **sémantique** d'une garantie se prouve une fois, au niveau le plus
  bas qui l'exprime (test unitaire de composant ou d'état). Les parcours E2E
  couvrent l'enchaînement réel et une seule variante du geste ; ils renvoient à
  la garantie au lieu de la réimplémenter.
- Preuve : garantie dans `database-new-property-draft.spec.tsx` (trois cas :
  appui extérieur, création, Échap) ; les deux parcours gardent l'assertion mais
  la rendent déterministe.

### L-004 — Vert local répété ne veut pas dire test fragile
- Statut : validée
- Surface : incident du 16 novembre, `webkit-desktop 2/3`.
- Symptôme : 16 répétitions vertes en local, dans la même image WebKit Linux,
  puis deux échecs en CI. La tentation est de conclure « test instable ».
- Anti-pattern : relancer, ajouter un délai, ou déclarer le parcours instable
  sans nommer l'état qui a changé.
- Règle : un échec qu'on ne reproduit pas n'est pas un bruit, c'est une **fenêtre
  non prouvée**. On cherche l'état modifié (`toHaveValue` vide, classe `--adding`
  encore présente dans le DOM), on instrumente, on compare avec l'historique. Une
  réexécution verte n'est jamais une preuve.
- Preuve : trace `43856315749` (DOM : composeur ouvert, `value: ""`), sonde
  temporaire, puis test unitaire déterministe.

### L-005 — Attribuer un échec demande l'historique, pas l'intuition
- Statut : validée
- Surface : même incident, après la fusion de la PR #203.
- Symptôme : l'échec est apparu sur `main` après une fusion ; le réflexe est de
  blâmer la dernière PR.
- Anti-pattern : chercher la cause dans le dernier diff avant d'avoir vérifié que
  la même signature n'existait pas déjà.
- Règle : avant d'attribuer, chercher la **même signature** dans les preuves
  conservées (runs, jobs, erreurs). Ici, l'assertion, la valeur vide et le geste
  identiques existaient le 14 novembre, avant la PR.
- Preuve : `docs/audits/2026-11-wait-contracts/evidence/errors/43587332746-1-132424695799.txt`,
  cité dans `specs/061-test-evidence-and-draft-preservation/validation.md`.

### L-006 — Un témoin d'achèvement se lit dans l'état validé
- Statut : validée
- Surface : ensemble de la suite (feature 060).
- Symptôme : une page restaurée sur la mauvaise entrée après une fermeture ; un
  cumul à 0 au lieu de 17 ; un conflit de révision après une modification de
  schéma.
- Anti-pattern : avancer sur un élément visible, un titre affiché, une réponse
  réseau reçue ou un état `idle`.
- Règle : voir [`docs/testing/wait-contracts.md`](../../../docs/testing/wait-contracts.md)
  — la preuve est produite par le code qui achève l'opération, corrélée à
  l'entité, et ne peut être ni manquée ni périmée.
- Preuve : `tests/e2e/wait-witnesses.spec.ts` (les témoins échouent quand
  l'opération n'a pas lieu), `specs/060-wait-contracts/validation.md`.

### L-007 — Une négation sans ancre positive ne mesure rien
- Statut : candidate
- Surface : `apps/api/tests/realtime-page-sync.contract.spec.ts` (fenêtre de
  20 ms), `offline-availability.spec.ts` (garantie d'éviction, `runEviction` sans
  appelant de production).
- Symptôme : des tests verts qui certifient une absence sans avoir prouvé que le
  moment risqué a été observé, et un test qui certifie une propriété que le
  produit n'implémente pas.
- Anti-pattern : « rien ne s'est produit pendant un délai » et « l'écran affiche
  encore le texte ».
- Règle : encadrer la négation par deux preuves positives (avant et après la
  fenêtre), ou enregistrer toutes les valeurs de la fenêtre ; et vérifier que la
  garantie existe dans le code de production avant de la certifier.
- Preuve : `recordAttribute` dans `tests/e2e/waits/observation.ts` ; lectures
  d'état validé pour les cas migrés. Les deux cas cités restent des limites
  déclarées, pas des garanties.

### L-008 — Un état transitoire s'enregistre avant, il ne se prélève pas après
- Statut : validée
- Surface : `tests/e2e/helpers.ts` (`sampleCssTransition`), appelé par
  `files.spec.ts:26` et sept autres parcours.
- Symptôme : deux échecs sous WebKit desktop, à messages identiques —
  « No active grid-template-rows transition was found » — aux runs
  `43803790517` et `43919332602`, sur un parcours que les diffs concernés ne
  touchaient pas.
- Anti-pattern : cliquer, puis **prélever** après coup une transition CSS qui a
  peut-être déjà démarré et fini (le helper attend 12 images, soit ~200 ms pour
  une transition de 210 ms ; un runner chargé dépasse cette fenêtre et la
  transition n'existe plus au moment du prélèvement).
- Règle : un état transitoire s'**enregistre** avant l'action qui le produit
  (observateur d'animations, `getAnimations()` capturé dès l'apparition), puis
  s'analyse après. On ne prélève jamais un état dont la durée de vie est plus
  courte que le trajet de l'action.
- Preuve : `recordAttribute` fait déjà cela pour les attributs
  (`tests/e2e/waits/observation.ts`) ; la correction de
  `sampleCssTransition` est proposée en suivi, hors du périmètre de la feature
  061, avec ses huit sites d'appel à revalider.

### L-009 — Une dépendance qui écoute en différé perd la première entrée
- Statut : validée (feature 067)
- Surface : `@dnd-kit/core` 6.3.1, `KeyboardSensor` ; parcours
  `workspace-tabs-folder.spec.ts` ; correctif local
  `apps/web/src/features/workspace/ready-keyboard-sensor.ts`.
- Symptôme : après avoir soulevé un élément au clavier, la première flèche est
  perdue ; l'écran annonce pourtant déjà un survol. Échec reproduit sur `main`
  vierge, donc pas une régression de la branche.
- Anti-pattern : conclure « droppables non mesurés » (ou attendre un délai) sur
  la foi d'un attribut comme `data-dragging`, qui ne dit que « cet identifiant est
  actif », jamais « le capteur écoute ».
- Règle : vérifier *qui* enregistre l'écouteur et *quand*. `attach()` appelle
  `handleStart()` puis enregistre le keydown dans un `setTimeout` non suivi : la
  touche suivante peut tomber dans ce trou, même avec une géométrie complète.
  Enregistrer l'écouteur de façon synchrone et ignorer l'événement d'activation
  par identité (sinon l'Espace de levée dépose aussitôt), en dédupliquant les
  événements parce que l'enregistrement différé de la bibliothèque ajoute le même
  gestionnaire ensuite. Un patch de dépendance n'est pas une option : le contrat
  d'outillage refuse `patchedDependencies` dans le lockfile.
- Preuve : `apps/web/tests/keyboard-sensor-readiness.spec.ts` échoue sans le
  correctif (« must accept the first direction after lift », 0 appel) et passe
  avec ; il prouve aussi le dépôt unique, l'annulation et l'absence d'action
  après la fin.

### L-010 — Un clic d'éditeur n'est pas une sélection avant que l'éditeur ne l'adopte
- Statut : validée (feature 067)
- Surface : éditeur BlockNote/ProseMirror ; parcours
  `editor-math-contents.spec.ts`.
- Symptôme : cliquer un paragraphe vide puis taper immédiatement perd la frappe ;
  le texte atterrit dans le paragraphe précédent.
- Anti-pattern : constater le curseur DOM dans le bon bloc et en conclure que la
  frappe y ira ; ou attendre un délai « le temps que ça se stabilise ».
- Règle : attendre le marqueur que l'éditeur écrit lui-même quand il adopte la
  sélection (`data-is-empty-and-focused="true"` sur le bloc), puis taper. Un
  filet de réparation différé dans le composant ne doit pas déplacer un curseur
  vivant : il a volé un curseur légitime pendant la transition clic → sélection.
- Preuve : sonde instrumentée (curseur par bloc à chaque étape), mesure du
  marqueur image par image (deux images), puis parcours vert sur les cinq moteurs.

### L-011 — Lancer une suite projet par projet fabrique des stacks orphelines
- Statut : validée (session 2026-11-18, PR #213) ; norme promue dans la
  constitution, article IX, et `docs/testing/parallel-stacks.md`.
- Surface : exécution locale des parcours (`run-local-matrix.ts`,
  `test-e2e-local.sh`), Compose, PostgreSQL.
- Symptôme : une seule session de travail a laissé quatre projets Compose
  (`myownnotion`, `myownnotion-dev`, `mn059-investigation`, `myownnotion-057-e2e`),
  quatre serveurs PostgreSQL, vingt volumes, quatre réseaux, un conteneur
  `oven/bun` sans projet et deux bases abandonnées
  (`myownnotion_e2e_lane_repro`, `mon_e2e_chromium_desktop_e06251`).
- Anti-pattern : lancer `--project chromium-desktop` fichier par fichier « pour
  aller plus vite », ou `MYOWNNOTION_E2E_JOBS=1` pour valider un correctif. Chaque
  lancement recrée une stack, mais rien ne la nomme, ne la date ni ne la ferme ;
  le nettoyage en `finally` ne survit pas à un `SIGKILL`.
- Règle : une suite multi-projets se lance par `bun run test:e2e:gate`
  (parallèle, `MYOWNNOTION_E2E_JOBS` ≥ 2) ; `=1` est réservé à la reproduction
  d'un échec nommé, consignée dans `validation.md`. Toute stack porte
  `com.myownnotion.stack` et `com.myownnotion.ephemeral=true`, avec un nom de
  projet Compose explicite. Une session se termine par `bun run stacks:audit`,
  qui échoue tant qu'une stack éphémère existe.
- Preuve : l'audit, exécuté sur la machine, nomme les trois stacks éphémères et
  sort en code 1 ; ses contrats (`tests/contract/stack-audit.spec.ts`) pilotent un
  `docker` contrôlé et vérifient l'échec, les commandes de récupération exactes et
  l'impossibilité d'un audit muet.
