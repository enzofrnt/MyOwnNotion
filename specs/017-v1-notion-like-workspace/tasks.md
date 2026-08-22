---

description: "Tâches d'implémentation de l'expérience V1 Notion-like et de la synchronisation convergente"
---

# Tasks: Expérience V1 proche de Notion et convergence locale

**Input**: Design documents from `/specs/017-v1-notion-like-workspace/`

**Prerequisites**: `spec.md`, `plan.md`, `research.md`, `data-model.md`,
`contracts/`, `quickstart.md`

**Tests**: La spécification exige explicitement tests de propriétés,
intégration, contrats, fault injection, multi-contextes navigateur,
accessibilité, visuels, sécurité, migration, sauvegarde et performance. Les
tâches de test précèdent donc l'implémentation correspondante et doivent être
observées en échec pour la raison attendue avant la correction.

**Organization**: Les fondations rendent le modèle et les frontières sûrs ;
chaque phase suivante ferme une user story testable. Les stories P1 sont
ordonnées selon leurs dépendances réelles, puis la cohérence de toutes les
surfaces (US6, P2) termine l'expérience produit.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: tâche parallélisable dans des fichiers distincts, une fois ses
  prérequis de phase terminés
- **[Story]**: user story couverte par la tâche
- Toute tâche cite les fichiers qu'elle crée ou modifie

## Phase 1: Setup — dépendances et frontières du projet

**Purpose**: Préparer les packages, versions et points d'intégration sans
activer un nouveau chemin d'écriture.

- [X] T001 Créer le package pur `@myownnotion/page-state` dans `packages/page-state/package.json`, `packages/page-state/tsconfig.json` et `packages/page-state/src/index.ts`
- [X] T002 Ajouter Loro, BlockNote Community Ariakit, Tailwind Vite, Ariakit, dnd-kit et Lucide à versions exactes dans `packages/page-state/package.json`, `apps/web/package.json` et `pnpm-lock.yaml`, sans package `@blocknote/xl-*`
- [X] T003 Ajouter le projet Vitest `page-state`, sa couverture et ses commandes aux gates dans `vitest.workspace.ts`, `package.json` et `packages/page-state/package.json`
- [X] T004 Configurer Tailwind CSS via Vite et l'entrée CSS commune dans `apps/web/vite.config.ts`, `apps/web/src/styles.css` et `apps/web/package.json`
- [X] T005 [P] Créer les points d'entrée des modules de page locale dans `packages/client-core/src/page-sync/index.ts` et `packages/client-core/src/index.ts`
- [X] T006 [P] Créer les points d'entrée du système UI dans `apps/web/src/ui/index.ts`, `apps/web/src/ui/primitives/index.ts` et `apps/web/src/ui/icons.tsx`
- [X] T007 Étendre l'allowlist et les tests de licence aux licences MIT/MPL des dépendances retenues dans `scripts/ci/license-policy.ts` et `tests/contract/release-gates.spec.ts`
- [X] T008 Vérifier l'installation verrouillée, l'absence de XL et le graphe de dépendances avec des assertions dans `tests/contract/toolchain-editor-dependencies.spec.ts`

---

## Phase 2: Fondations — format, modèle opérationnel, stockage local et UI commune

**Purpose**: Construire les invariants partagés qui bloquent toutes les stories.

**⚠️ CRITICAL**: Aucun remplacement de l'éditeur ou activation serveur ne doit
commencer avant que projection, chiffrement local et migration soient prouvés.

### Format canonique v3

- [X] T009 [P] Écrire les tests du parser, de la normalisation et du digest v3 dans `packages/domain/tests/document-v3.spec.ts` et `packages/domain/tests/document-v3-normalise.property.spec.ts`
- [X] T010 [P] Écrire les tests de conservation des blocs, marques et propriétés inconnus dans `packages/domain/tests/document-v3-forward-compatibility.property.spec.ts`
- [X] T011 [P] Écrire les tests de migration v2→v3, dont `fileEmbed`, dans `packages/domain/tests/document-v3-migration.spec.ts`
- [X] T012 Étendre marques, couleurs et blocs canoniques v3 dans `packages/domain/src/document/block.ts` et les exports de `packages/domain/src/index.ts`
- [X] T013 Implémenter enveloppe, sérialisation canonique et digest v3 dans `packages/domain/src/document/document.ts` et `packages/domain/src/document/canonical-json.ts`
- [X] T014 Implémenter validation stricte et préservation opaque v3 dans `packages/domain/src/document/validate.ts`
- [X] T015 Implémenter la migration pure v2→v3 et la lecture versionnée dans `packages/domain/src/document/legacy.ts` et `packages/domain/src/document/migrate-v3.ts`
- [X] T016 Mettre à niveau extraction de texte, liens, usages de fichiers et export durable v3 dans `packages/domain/src/search/document-text.ts`, `packages/domain/src/document/export-markdown.ts` et `packages/domain/src/document/document.ts`

### Modèle opérationnel partagé

- [X] T017 [P] Écrire les tests de commandes atomiques et d'identité de blocs dans `packages/page-state/tests/document.spec.ts`
- [X] T018 [P] Écrire les propriétés de convergence du texte riche et des marques dans `packages/page-state/tests/rich-text.property.spec.ts`
- [X] T019 [P] Écrire les propriétés d'arbre, move concurrent, absence de cycle et identité stable dans `packages/page-state/tests/block-tree.property.spec.ts`
- [X] T020 [P] Écrire les tests de projection déterministe et de digest dans `packages/page-state/tests/canonical-projection.property.spec.ts`
- [X] T021 [P] Écrire les tests d'updates idempotentes, version vectors, checkpoints et Peer IDs de session dans `packages/page-state/tests/checkpoints.property.spec.ts`
- [X] T022 Définir types, commandes et résultats publics MyOwnNotion dans `packages/page-state/src/document.ts` et `packages/page-state/src/index.ts`
- [X] T023 Implémenter le texte Loro par bloc, marks et positions relatives dans `packages/page-state/src/rich-text.ts`
- [X] T024 Implémenter le `LoroTree`, les insertions, moves, suppressions et invariants UUID dans `packages/page-state/src/block-tree.ts`
- [X] T025 Implémenter les transactions de page et l'émission de changements sémantiques dans `packages/page-state/src/document.ts`
- [X] T026 Implémenter la projection v3, les liens/usages et les vérifications de digest dans `packages/page-state/src/canonical-projection.ts`
- [X] T027 Implémenter enveloppes, export/import incrémental, version vectors et checkpoints dans `packages/page-state/src/update-envelope.ts` et `packages/page-state/src/checkpoints.ts`
- [X] T028 [P] Écrire les tests des ambiguïtés delete/edit, delete/move, type, propriété et schéma dans `packages/page-state/tests/semantic-conflicts.property.spec.ts`
- [X] T029 Implémenter la détection et la résolution par nouvelles opérations dans `packages/page-state/src/semantic-conflicts.ts`
- [X] T030 [P] Écrire les tests de deux branches legacy hors ligne et de replay sémantique dans `packages/page-state/tests/legacy-offline-branch.property.spec.ts`
- [X] T031 Implémenter journal sémantique legacy, replay vérifié et diff `base/local/head` dans `packages/page-state/src/legacy-offline-branch.ts`

### Durabilité locale et protocoles partagés

- [X] T032 [P] Écrire les tests de migration Dexie v6→v7 et de conservation des versions historiques dans `packages/client-core/tests/page-operation-schema.spec.ts`
- [X] T033 Ajouter stores et types scellés `pageOperationStates`, `pageOperationUpdates`, `pageAmbiguities` et `legacyOfflineBranches` dans `packages/client-core/src/local-store/schema.ts`
- [X] T034 [P] Écrire les tests d'enveloppes chiffrées et d'absence de contenu clair dans `packages/client-core/tests/page-operation-encryption.spec.ts`
- [X] T035 Implémenter le repository chiffré et les AAD de page dans `packages/client-core/src/page-sync/encrypted-update-log.ts` et `packages/client-core/src/security/local-encryption.ts`
- [X] T036 [P] Écrire la fault matrix avant/pendant/après commit local dans `packages/client-core/tests/page-operation-atomicity.spec.ts`
- [X] T037 Implémenter la transaction locale update/frontier/checkpoint/projection dans `packages/client-core/src/page-sync/local-page-state.ts`
- [X] T038 [P] Écrire les tests multi-onglets, Peer IDs distincts et accusés durables dans `packages/client-core/tests/page-tab-channel.spec.ts`
- [X] T039 Implémenter le canal inter-onglets sans écho ni faux accusé dans `packages/client-core/src/page-sync/tab-channel.ts`
- [X] T040 [P] Écrire les tests de validation des requêtes/réponses du protocole v3 dans `packages/contracts/tests/page-operations.spec.ts`
- [X] T041 Implémenter les contrats TypeScript et parseurs bornés de page operations dans `packages/contracts/src/page-operations.ts` et `packages/contracts/src/index.ts`

### Système UI minimal partagé

- [X] T042 Définir tokens clair/sombre, couleurs de contenu, focus, espace, couches et mouvement dans `apps/web/src/ui/tokens.css` et `apps/web/src/styles.css`
- [X] T043 [P] Écrire les tests thème system/light/dark et persistance sans flash dans `apps/web/tests/theme-provider.spec.tsx`
- [X] T044 Implémenter le provider de thème et le bootstrap pré-rendu dans `apps/web/src/ui/theme-provider.tsx`, `apps/web/src/main.tsx` et `apps/web/index.html`
- [X] T045 [P] Écrire les contrats de rôle/focus/disabled/busy des primitives dans `apps/web/tests/ui-primitives.spec.tsx`
- [X] T046 Implémenter les primitives Ariakit dans `apps/web/src/ui/primitives/button.tsx`, `field.tsx`, `menu.tsx`, `popover.tsx`, `dialog.tsx`, `drawer.tsx`, `status.tsx`, `live-region.tsx` et `index.ts`
- [X] T047 [P] Centraliser la copie française, nombres, dates et raccourcis dans `apps/web/src/ui/copy/fr.ts` et `apps/web/src/ui/copy/index.ts`
- [X] T048 [P] Centraliser Lucide, tailles et noms accessibles dans `apps/web/src/ui/icons.tsx`
- [X] T049 Ajouter une page de test déterministe des primitives et tokens dans `apps/web/src/ui/ui-lab.tsx` et `apps/web/tests/ui-lab.spec.tsx`

**Checkpoint**: Le modèle opérationnel converge en mémoire, sa projection v3
est déterministe, son état se scelle atomiquement dans Dexie et le système UI
minimal est disponible. Aucun endpoint v3 ni nouvel éditeur n'est encore actif.

---

## Phase 3: User Story 1 — Entrer dans un espace de travail focalisé (Priority: P1)

**Goal**: Livrer shell, navigation desktop/mobile et contexte restauré avec une
hiérarchie visuelle propre.

**Independent Test**: Ouvrir un workspace peuplé, créer/renommer/déplacer une
page, restaurer sidebar/branches/page sur desktop puis 320 px sans ouvrir
l'éditeur riche.

### Tests for User Story 1

- [X] T050 [P] [US1] Écrire les tests du shell, header et états de chargement dans `apps/web/tests/workspace-shell.spec.tsx`
- [X] T051 [P] [US1] Étendre les tests de persistance sidebar/branches/dernier item dans `apps/web/tests/sidebar.spec.ts`
- [X] T052 [P] [US1] Écrire le journey desktop/mobile du shell et du focus drawer dans `tests/e2e/workspace-shell.spec.ts`
- [X] T053 [P] [US1] Écrire les références visuelles shell clair/sombre et assert le layout shift contextuel ≤ 1 px dans `tests/e2e/workspace-shell-visual.spec.ts`

### Implementation for User Story 1

- [X] T054 [US1] Construire le layout shell, les landmarks et la colonne de lecture dans `apps/web/src/features/workspace/workspace-shell.tsx` et `apps/web/src/app.tsx`
- [X] T055 [P] [US1] Construire header de page, fil d'Ariane et actions contextuelles dans `apps/web/src/features/workspace/page-header.tsx`
- [X] T056 [US1] Recomposer la sidebar avec sections recherche/favoris/récents/arbre/réglages dans `apps/web/src/features/navigation/sidebar.tsx`
- [X] T057 [US1] Remplacer les rangées de boutons par menus de ligne clavier/toucher dans `apps/web/src/features/navigation/navigation-item-menu.tsx` et `apps/web/src/features/hierarchy/hierarchy-explorer.tsx`
- [X] T058 [US1] Ajouter DnD dnd-kit, cible, autoscroll et capteur clavier sans cycle dans `apps/web/src/features/navigation/tree-drag-drop.tsx`
- [X] T059 [US1] Persister largeur, ouverture, branches et dernier item dans `packages/client-core/src/navigation/presentation-state.ts` et `apps/web/src/features/navigation/branch-state.tsx`
- [X] T060 [US1] Implémenter sidebar redimensionnable desktop et drawer mobile avec retour de focus dans `apps/web/src/features/navigation/responsive-sidebar.tsx`
- [X] T061 [US1] Maintenir titre, chemin, sélection et focus lors des mutations dans `apps/web/src/features/workspace/use-active-item.ts`
- [X] T062 [US1] Intégrer skeletons, états vides et diagnostics secondaires du shell dans `apps/web/src/features/workspace/workspace-state.tsx`
- [X] T063 [US1] Enregistrer les nouveaux journeys et leurs propriétaires dans `ci/test-impact.json`

**Checkpoint**: US1 fonctionne avec les données existantes et reste testable
sans dépendre des blocs riches.

---

## Phase 4: User Story 2 — Écrire et manipuler des blocs naturellement (Priority: P1)

**Goal**: Remplacer la surface Tiptap visible par BlockNote Community branché
sur les commandes MyOwnNotion, avec slash, poignée, toolbar, sélection et DnD.

**Independent Test**: Créer un document minimal, insérer/transformer cinq blocs
par plusieurs chemins, formater, déplacer un groupe, undo/redo et vérifier IDs
et projection après reload.

### Tests for User Story 2

- [x] T064 [P] [US2] Écrire les tests de correspondance canonique↔BlockNote et IDs dans `apps/web/tests/blocknote-round-trip.property.spec.ts`
- [x] T065 [P] [US2] Écrire les tests `getChanges()`→commandes minimales, dont move≠delete/insert, dans `apps/web/tests/editor-adapter.spec.ts`
- [x] T066 [P] [US2] Écrire les tests d'application distante sans écho et sélection stable dans `apps/web/tests/editor-remote-apply.spec.ts`
- [x] T067 [P] [US2] Écrire les tests IME, emoji, collage et offsets UTF-16 dans `apps/web/tests/editor-input.spec.ts`
- [x] T068 [P] [US2] Remplacer le journey éditeur minimal, y compris les maxima d'actions SC-012, dans `tests/e2e/block-editor.spec.ts`

### Implementation for User Story 2

- [x] T069 [US2] Définir le schéma BlockNote Community et les IDs canoniques dans `apps/web/src/features/editor/blocknote-schema.ts`
- [x] T070 [US2] Implémenter conversion initiale et diagnostic projection↔blocs visibles dans `apps/web/src/features/editor/blocknote-conversion.ts`
- [x] T071 [US2] Implémenter traduction ciblée des événements locaux vers `PageCommand` dans `apps/web/src/features/editor/editor-adapter.ts`
- [x] T072 [US2] Implémenter application des changements distants, suspension d'origine et restauration de sélection dans `apps/web/src/features/editor/editor-remote-apply.ts`
- [x] T073 [US2] Construire la session et surface BlockNote sans provider Yjs dans `apps/web/src/features/editor/page-editor.tsx` et `apps/web/src/features/editor/editor-view.tsx`
- [x] T074 [P] [US2] Construire slash menu français filtrable dans `apps/web/src/features/editor/editor-menus/slash-menu.tsx`
- [x] T075 [P] [US2] Construire poignée, ajout adjacent et menu de bloc dans `apps/web/src/features/editor/editor-menus/block-side-menu.tsx`
- [x] T076 [P] [US2] Construire toolbar flottante texte/liens/couleurs dans `apps/web/src/features/editor/editor-menus/formatting-toolbar.tsx`
- [x] T077 [US2] Implémenter sélection contiguë multi-blocs et actions atomiques dans `apps/web/src/features/editor/block-selection.ts`
- [x] T078 [US2] Traduire le DnD BlockNote en moves stables et afficher les refus dans `apps/web/src/features/editor/block-drag-drop.ts`
- [x] T079 [US2] Implémenter undo/redo local par opérations inverses sans cibler les updates distantes dans `packages/page-state/src/undo-manager.ts`
- [x] T080 [P] [US2] Porter le sélecteur de page-link vers la toolbar commune dans `apps/web/src/features/editor/editor-menus/page-link-picker.tsx`
- [x] T081 [P] [US2] Porter le placeholder non destructif des blocs inconnus dans `apps/web/src/features/editor/custom-blocks/unknown-block.tsx`
- [x] T082 [US2] Brancher le nouvel éditeur dans le shell avec fallback legacy lecture seule dans `apps/web/src/app.tsx` et `apps/web/src/features/editor/editor-surface.tsx`
- [x] T083 [US2] Ajouter commandes Markdown, clic droit et alternative clavier aux insertions dans `apps/web/src/features/editor/editor-shortcuts.ts`
- [x] T084 [US2] Valider le journey éditeur sur les cinq profils et enregistrer ses propriétaires dans `ci/test-impact.json`

**Checkpoint**: US2 manipule les blocs v2 connus via l'état opérationnel local,
sans dépendance commerciale et sans remplacement complet à chaque geste.

---

## Phase 5: User Story 3 — Composer une page riche sans quitter l'éditeur (Priority: P1)

**Goal**: Couvrir tous les blocs et marques V1, fichiers, liens et embeds avec
round-trip, offline et export durables.

**Independent Test**: Construire une page contenant chaque type/mark, la
rouvrir hors ligne, l'exporter et vérifier références, sécurité et inconnus.

### Tests for User Story 3

- [x] T085 [P] [US3] Étendre les propriétés de round-trip à tous les blocs v3 dans `apps/web/tests/blocknote-v3-round-trip.property.spec.ts`
- [x] T086 [P] [US3] Écrire les tests domain d'export et extraction v3 dans `packages/domain/tests/document-v3-export.property.spec.ts`
- [x] T087 [P] [US3] Écrire les tests de sécurité URL/embed/paste dans `apps/web/tests/editor-content-security.spec.ts`
- [x] T088 [P] [US3] Écrire le journey de page riche et export dans `tests/e2e/rich-page.spec.ts`
- [x] T089 [P] [US3] Écrire le journey fichiers/images hors ligne avec toutes les communications tierces bloquées dans `tests/e2e/editor-offline-media.spec.ts`

### Implementation for User Story 3

- [ ] T090 [P] [US3] Implémenter toggle et callout accessibles dans `apps/web/src/features/editor/custom-blocks/toggle.tsx` et `apps/web/src/features/editor/custom-blocks/callout.tsx`
- [ ] T091 [US3] Implémenter table simple avec IDs ligne/cellule, clavier et overflow mobile dans `apps/web/src/features/editor/custom-blocks/table.tsx`
- [ ] T092 [P] [US3] Implémenter code, langue et copie sûre dans `apps/web/src/features/editor/custom-blocks/code-block.tsx`
- [ ] T093 [P] [US3] Implémenter image et fileEmbed liés aux items 005 dans `apps/web/src/features/editor/custom-blocks/image.tsx` et `apps/web/src/features/editor/custom-blocks/file-embed.tsx`
- [ ] T094 [P] [US3] Implémenter embed allowlist, consentement et sandbox dans `apps/web/src/features/editor/custom-blocks/embed.tsx`
- [x] T095 [US3] Brancher dépôt/collage de fichiers sur la file durable existante dans `apps/web/src/features/editor/editor-files.ts` et `apps/web/src/features/files/upload.ts`
- [x] T096 [US3] Implémenter souligné, couleurs et surlignage selon tokens dans `apps/web/src/features/editor/blocknote-schema.ts` et `apps/web/src/features/editor/editor-menus/formatting-toolbar.tsx`
- [x] T097 [US3] Assainir collage riche avec fallback texte sans réduction silencieuse dans `apps/web/src/features/editor/paste-sanitizer.ts`
- [x] T098 [US3] Afficher états actif/supprimé/indisponible/inconnu des page-links dans `apps/web/src/features/editor/page-link.ts` et `apps/web/src/features/editor/editor-menus/page-link-picker.tsx`
- [x] T099 [US3] Étendre Markdown, export canonique, recherche et usages de fichiers aux types v3 dans `packages/domain/src/document/export-markdown.ts`, `packages/domain/src/export/canonical-export.ts` et `packages/domain/src/search/document-text.ts`
- [x] T100 [US3] Ajouter validation et projection des tables/médias/embeds au modèle opérationnel dans `packages/page-state/src/canonical-projection.ts`
- [x] T101 [US3] Garantir transformations de type sans perte, avec confirmation si nécessaire, dans `packages/page-state/src/document.ts` et `apps/web/src/features/editor/editor-menus/block-side-menu.tsx`
- [x] T102 [US3] Relier disponibilité locale et transfert séparé des octets au statut des blocs dans `apps/web/src/features/editor/editor-file-state.tsx`
- [x] T103 [US3] Ajouter copie française des blocs, erreurs et exports dans `apps/web/src/ui/copy/fr.ts`
- [x] T104 [US3] Enregistrer les journeys riche/média dans `ci/test-impact.json`

**Checkpoint**: US3 couvre la page riche V1, mais le chemin réseau v3 complet
reste à fermer dans US5.

---

## Phase 6: User Story 4 — Reprendre exactement où le travail s'est arrêté (Priority: P1)

**Goal**: Autosauvegarde locale permanente, reprise après crash, statuts honnêtes
et restauration de position.

**Independent Test**: Interrompre édition, navigation, stockage et réseau à
chaque frontière puis retrouver transaction, curseur, scroll et statut exacts.

### Tests for User Story 4

- [x] T105 [P] [US4] Écrire les tests de session editor→commit local→statut dans `packages/client-core/tests/page-editing-session.spec.ts`
- [x] T106 [P] [US4] Étendre la fault injection de reprise à toutes les frontières dans `packages/client-core/tests/page-operation-atomicity.spec.ts`
- [x] T107 [P] [US4] Écrire les tests de scroll par ancre et fallback dans `apps/web/tests/page-scroll-restoration.spec.tsx`
- [x] T108 [P] [US4] Écrire les tests quota/clé/protocole et buffer récupérable dans `apps/web/tests/editor-local-failure.spec.tsx`
- [x] T109 [P] [US4] Écrire les journeys crash/reload, offline et scroll dans `tests/e2e/page-autosave-recovery.spec.ts` et `tests/e2e/page-scroll-restoration.spec.ts`

### Implementation for User Story 4

- [x] T110 [US4] Implémenter `PageEditingSession` et le commit local avant acquittement UI dans `packages/client-core/src/page-sync/page-editing-session.ts`
- [x] T111 [US4] Dériver `local-saving/local-saved/pending/syncing/synced/offline/blocked/attention` dans `packages/client-core/src/page-sync/page-sync-state.ts`
- [x] T112 [US4] Remplacer le bouton save par autosauvegarde et statut commun dans `apps/web/src/features/editor/editor-sync-status.tsx` et `apps/web/src/features/save-state/save-state-indicator.tsx`
- [x] T113 [US4] Implémenter buffer de secours, copie et blocage des gestes destructifs après échec local dans `apps/web/src/features/editor/local-commit-recovery.tsx`
- [x] T114 [US4] Reprendre updates `sending`, branches legacy et uploads au boot/online dans `packages/client-core/src/page-sync/page-reconciler.ts` et `apps/web/src/features/sync/use-page-reconciler.ts`
- [x] T115 [US4] Persister ancre de bloc, offset et fallback pixel dans `packages/client-core/src/navigation/presentation-state.ts`
- [x] T116 [US4] Capturer/restaurer sélection et scroll sans saut tardif dans `apps/web/src/features/editor/editor-view-state.ts`
- [x] T117 [US4] Intégrer états offline, clés, quota et ambiguïtés à la copie utilisateur dans `apps/web/src/features/save-state/blocked-notice.tsx` et `apps/web/src/ui/copy/fr.ts`
- [x] T118 [US4] Supprimer le bouton de sauvegarde du parcours normal seulement après activation de la session dans `apps/web/src/features/editor/editor-surface.tsx`
- [x] T119 [US4] Enregistrer les journeys autosave/scroll dans `ci/test-impact.json`

**Checkpoint**: Toute frappe confirmée est durable localement et la position de
travail survit aux interruptions, même avant synchronisation serveur.

---

## Phase 7: User Story 5 — Travailler hors ligne sur plusieurs appareils puis converger (Priority: P1)

**Goal**: Activer le protocole v3, la convergence serveur, les frontiers, la
migration legacy, les ambiguïtés et la restauration multi-appareils.

**Independent Test**: Deux profils/appareils isolés modifient texte, marques,
arbre et fichiers hors ligne, ferment/reviennent dans les deux ordres et
obtiennent projection/historique identiques ; delete/edit reste récupérable.

### Tests for User Story 5

- [x] T120 [P] [US5] Écrire les tests SQL de contraintes, verrou, idempotence et rollback dans `packages/database/tests/page-operations.integration.spec.ts`
- [x] T121 [P] [US5] Étendre les tests de migration vide et fixture forward à `0008_page_operations.sql` dans `packages/database/tests/migrations.integration.spec.ts`
- [x] T122 [P] [US5] Écrire les tests API sync/checkpoint/activate/ambiguity/protocol dans `apps/api/tests/page-operations.contract.spec.ts`
- [x] T123 [P] [US5] Écrire les tests serveur de projection, liens, fichiers et transaction atomique dans `apps/api/tests/page-operation-service.integration.spec.ts`
- [x] T124 [P] [US5] Écrire les tests de deux branches legacy v2 concurrentes dans `apps/api/tests/page-operation-migration.integration.spec.ts`
- [ ] T125 [P] [US5] Écrire les tests de frontier, révocation et compaction dans `apps/api/tests/page-operation-compaction.integration.spec.ts`
- [ ] T126 [P] [US5] Écrire les tests backup/restore/appareil absent et consolidation 30 s/5 min/bornes dans `apps/api/tests/page-operation-backup.integration.spec.ts` et `apps/api/tests/page-history-consolidation.integration.spec.ts`
- [x] T127 [P] [US5] Écrire les tests client de batching, retries, catch-up et fichiers pending dans `packages/client-core/tests/page-reconciler.property.spec.ts`
- [ ] T128 [P] [US5] Écrire le journey à deux appareils réellement offline dans `tests/e2e/page-multi-device-convergence.spec.ts`
- [ ] T129 [P] [US5] Écrire le journey ambiguïté delete/edit, restart et résolution dans `tests/e2e/page-ambiguity.spec.ts`
- [ ] T130 [P] [US5] Écrire le journey migration d'une mutation v2 en attente dans `tests/e2e/page-protocol-migration.spec.ts`

### Storage and protocol implementation

- [x] T131 [US5] Créer tables, contraintes, triggers et index dans `packages/database/migrations/0008_page_operations.sql`
- [x] T132 [US5] Déclarer schéma Drizzle page states/updates/checkpoints/frontiers/ambiguities dans `packages/database/src/schema/page-operations.ts` et `packages/database/src/schema/index.ts`
- [x] T133 [US5] Implémenter repository verrouillé et transactions idempotentes dans `packages/database/src/repositories/page-operation-repository.ts` et `packages/database/src/index.ts`
- [x] T134 [US5] Passer le protocole annoncé à 3 avec fenêtre générale compatible et gate éditorial v3 dans `packages/domain/src/sync/protocol-version.ts` et `apps/api/src/plugins/protocol.ts`
- [x] T135 [US5] Ajouter les endpoints v3 et problèmes au contrat OpenAPI maintenu dans `specs/001-content-foundations/contracts/content-api.openapi.yaml`
- [x] T136 [US5] Brancher parseurs de contrats et limites d'octets dans `packages/contracts/src/page-operations.ts`

### Server implementation

- [x] T137 [US5] Implémenter ouverture/scellement des updates, vectors, checkpoints et ambiguïtés dans `apps/api/src/page-state/page-operation-crypto.ts`
- [x] T138 [US5] Implémenter matérialisation, validation, digests, liens, usages et recherche dans `apps/api/src/page-state/canonical-materializer.ts`
- [x] T139 [US5] Implémenter service transactionnel import→ambiguïtés→projection→révision→change feed dans `apps/api/src/page-state/page-operation-service.ts`
- [x] T140 [US5] Implémenter activation lazy atomique et protection de `page.document.replace` dans `apps/api/src/page-state/page-activation-service.ts` et `apps/api/src/routes/page-documents.ts`
- [x] T141 [US5] Implémenter conversion idempotente `LegacyOfflineBranch` dans `apps/api/src/page-state/legacy-branch-service.ts`
- [ ] T142 [US5] Implémenter checkpoint candidat/vérifié, frontier et compaction bornée par appareils dans `apps/api/src/page-state/checkpoint-service.ts`
- [ ] T143 [US5] Implémenter création/détail/résolution des ambiguïtés sans altérer les sources dans `apps/api/src/page-state/page-ambiguity-service.ts`
- [x] T144 [US5] Exposer sync, activate et ambiguity routes avec guards existants dans `apps/api/src/routes/page-operations.ts` et `apps/api/src/app.ts`
- [x] T145 [US5] Ajouter `page-operations.updated` au change feed et au signal SSE dans `packages/domain/src/sync/change-nature.ts`, `apps/api/src/routes/changes.ts` et `apps/api/src/routes/change-stream.ts`
- [ ] T146 [US5] Consolider après 30 s idle, 5 min max et bornes, exposer le retard de projection et restaurer par opérations dans `apps/api/src/page-state/page-history-service.ts` et `apps/api/src/routes/revisions.ts`
- [ ] T147 [US5] Étendre archives, verify et restore aux états opérationnels dans `apps/api/src/backup/archive-format.ts`, `apps/api/src/backup/backup-service.ts` et `apps/api/src/backup/restore-service.ts`

### Client and product integration

- [ ] T148 [US5] Implémenter échanges de vectors, batching et réponses idempotentes dans `apps/web/src/services/page-operations-api.ts` et `packages/client-core/src/page-sync/page-reconciler.ts`
- [ ] T149 [US5] Brancher catch-up sur change feed/SSE et reconnexion dans `apps/web/src/features/sync/use-change-stream.ts` et `apps/web/src/features/sync/use-page-reconciler.ts`
- [ ] T150 [US5] Convertir les mutations v2 locales en branche sémantique et persister le checkpoint actif atomiquement dans `packages/client-core/src/page-sync/migration.ts`
- [ ] T151 [US5] Intégrer statut documentaire+octets de fichiers sans doublon dans `packages/client-core/src/page-sync/page-sync-state.ts` et `apps/web/src/features/editor/editor-file-state.tsx`
- [ ] T152 [US5] Construire badge, liste et détail d'ambiguïté récupérable dans `apps/web/src/features/sync/page-ambiguity-notice.tsx` et `apps/web/src/features/sync/page-ambiguity-resolution.tsx`
- [ ] T153 [US5] Mettre à jour l'éditeur ouvert par deltas distants et préserver focus/scroll dans `apps/web/src/features/editor/editor-remote-apply.ts`
- [ ] T154 [US5] Vérifier deux onglets et deux appareils via le même chemin de durabilité dans `packages/client-core/src/page-sync/tab-channel.ts` et `apps/web/src/features/sync/use-page-reconciler.ts`
- [ ] T155 [US5] Enregistrer les trois nouveaux journeys et propriétaires page-state dans `ci/test-impact.json`
- [ ] T156 [US5] Valider les scénarios de `quickstart.md` et consigner les résultats de la story dans `specs/017-v1-notion-like-workspace/validation.md`

**Checkpoint**: US5 converge automatiquement après longue déconnexion, ne
remplace plus la page entière et conserve toute intention réellement ambiguë.

---

## Phase 8: User Story 7 — Clavier, toucher et navigateurs pris en charge (Priority: P1)

**Goal**: Fermer WebKit, focus, clavier, toucher, zoom, responsive et WCAG sur
les parcours essentiels.

**Independent Test**: Parcours création/navigation/édition/move/recherche/
ambiguïté sur cinq profils, clavier seul puis viewport/touch, sans violation
sérieuse axe.

### Tests for User Story 7

- [ ] T157 [P] [US7] Ajouter le cas flèche gauche parent WebKit aux tests unitaires dans `apps/web/tests/tree-keyboard.spec.ts`
- [ ] T158 [P] [US7] Étendre le journey clavier aux menus, DnD et WebKit dans `tests/e2e/keyboard-navigation.spec.ts`
- [ ] T159 [P] [US7] Étendre les audits axe aux nouveaux shell/éditeur/ambiguïtés dans `tests/e2e/accessibility.spec.ts`
- [ ] T160 [P] [US7] Étendre le journey 320 px, 200 % et tables/médias dans `tests/e2e/narrow-viewport.spec.ts`
- [ ] T161 [P] [US7] Écrire le journey toucher, clic contextuel alternatif et reduced-motion dans `tests/e2e/touch-and-motion.spec.ts`

### Implementation for User Story 7

- [ ] T162 [US7] Corriger le déplacement au parent d'une branche fermée sur WebKit dans `apps/web/src/features/navigation/use-tree-keyboard.ts`
- [ ] T163 [US7] Unifier ouverture/fermeture et retour de focus dans `apps/web/src/ui/primitives/menu.tsx`, `dialog.tsx`, `drawer.tsx` et `popover.tsx`
- [ ] T164 [US7] Ajouter capteur clavier et annonces live aux DnD navigation/éditeur dans `apps/web/src/features/navigation/tree-drag-drop.tsx` et `apps/web/src/features/editor/block-drag-drop.ts`
- [ ] T165 [US7] Garantir cibles tactiles et alternatives au hover/clic droit dans `apps/web/src/ui/tokens.css` et `apps/web/src/styles.css`
- [ ] T166 [US7] Corriger overflow 320 px/200 %, viewport clavier virtuel et popovers aux bords dans `apps/web/src/styles.css` et `apps/web/src/ui/primitives/popover.tsx`
- [ ] T167 [US7] Implémenter reduced-motion et annonces polies save/sync/remote delete dans `apps/web/src/ui/tokens.css` et `apps/web/src/ui/primitives/live-region.tsx`
- [ ] T168 [US7] Ajouter noms, descriptions, états et erreurs reliées dans `apps/web/src/features/navigation/sidebar.tsx`, `apps/web/src/features/editor/page-editor.tsx` et `apps/web/src/features/sync/page-ambiguity-resolution.tsx`
- [ ] T169 [US7] Tester les parcours avec VoiceOver et consigner résultats/corrections dans `specs/017-v1-notion-like-workspace/accessibility-validation.md`
- [ ] T170 [US7] Enregistrer le journey touch/motion et ses propriétaires dans `ci/test-impact.json`
- [ ] T171 [US7] Valider les cinq profils navigateur sans skip fonctionnel propre à WebKit dans `specs/017-v1-notion-like-workspace/validation.md`

**Checkpoint**: US7 ferme les écarts clavier/touch/browser et WCAG des parcours
essentiels.

---

## Phase 9: User Story 6 — Retrouver une application cohérente partout (Priority: P2)

**Goal**: Migrer toutes les surfaces livrées vers les tokens, primitives, copie
française et états communs.

**Independent Test**: Parcourir installation, login, recherche, fichiers,
bases, historique, sauvegarde et sécurité en ready/empty/loading/error dans les
deux thèmes et deux largeurs.

### Tests for User Story 6

- [ ] T172 [P] [US6] Écrire la matrice de rendu des surfaces et états communs dans `apps/web/tests/v1-surface-consistency.spec.tsx`
- [ ] T173 [P] [US6] Écrire l'audit de copie française et absence de diagnostics bruts dans `apps/web/tests/french-copy.spec.ts`
- [ ] T174 [P] [US6] Écrire les références visuelles multi-surfaces clair/sombre/mobile dans `tests/e2e/v1-surface-visuals.spec.ts`

### Implementation for User Story 6

- [ ] T175 [P] [US6] Migrer installation et connexion vers primitives/copie communes dans `apps/web/src/features/auth/bootstrap-page.tsx` et `apps/web/src/features/auth/login-page.tsx`
- [ ] T176 [P] [US6] Migrer recherche vers primitives/copie communes dans `apps/web/src/features/search/search-dialog.tsx`, `search-results.tsx` et `search-filters.tsx`
- [ ] T177 [P] [US6] Migrer fichiers vers primitives/copie communes dans `apps/web/src/features/files/file-preview.tsx`, `storage-panel.tsx`, `transfer-state.tsx` et `apps/web/src/features/attachments/attachment-panel.tsx`
- [ ] T178 [P] [US6] Migrer les vues de bases sans ajouter de capacité dans `apps/web/src/features/databases/database-page.tsx`, `database-toolbar.tsx`, `table-view.tsx`, `board-view.tsx`, `calendar-view.tsx`, `gallery-view.tsx` et `list-view.tsx`
- [ ] T179 [P] [US6] Migrer sauvegarde et historique dans `apps/web/src/features/backup/backup-panel.tsx`, `restore-rehearsal.tsx` et `apps/web/src/features/history/revision-restore.tsx`
- [ ] T180 [P] [US6] Migrer sécurité dans `apps/web/src/features/security/security-settings.tsx`, `device-panel.tsx`, `session-panel.tsx`, `key-rotation-panel.tsx` et `recovery-kit-panel.tsx`
- [ ] T181 [US6] Unifier états loading/empty/offline/error/success/conflict dans `apps/web/src/ui/primitives/async-state.tsx` et toutes les surfaces migrées
- [ ] T182 [US6] Déplacer IDs, révisions, outbox et détails techniques dans un panneau diagnostic secondaire dans `apps/web/src/features/diagnostics/diagnostics-panel.tsx`
- [ ] T183 [US6] Remplacer les confirmations natives par `ConfirmDialog` dans `apps/web/src/ui/primitives/confirm-dialog.tsx`, `apps/web/src/features/navigation/navigation-item-menu.tsx`, `apps/web/src/features/files/delete-file.tsx` et `apps/web/src/features/security/device-panel.tsx`
- [ ] T184 [US6] Appliquer thème et catalogue français aux composants BlockNote/Ariakit dans `apps/web/src/features/editor/page-editor.tsx` et `apps/web/src/ui/copy/fr.ts`
- [ ] T185 [US6] Supprimer variantes CSS et ancien composant sync sans consommateur dans `apps/web/src/styles.css` et `apps/web/src/components/sync-status.tsx`
- [ ] T186 [US6] Approuver les références visuelles contrôlées dans `tests/e2e/v1-surface-visuals.spec.ts-snapshots/`
- [ ] T187 [US6] Enregistrer le journey visuel multi-surfaces dans `ci/test-impact.json`
- [ ] T188 [US6] Consigner la matrice finale des surfaces et états dans `specs/017-v1-notion-like-workspace/validation.md`

**Checkpoint**: Toutes les surfaces V1 utilisent le même système visuel et la
même langue ; la feature est fonctionnellement complète.

---

## Phase 10: Polish et garanties transverses

**Purpose**: Prouver objectifs quantitatifs, sécurité, migration complète et
retirer les chemins temporaires.

- [ ] T189 [P] Ajouter benchmark 500 blocs, frappe, snapshot et update incrémentale dans `tests/performance/page-editor.perf.spec.ts`
- [ ] T190 [P] Ajouter benchmark 10 000 updates, catch-up, compaction et mémoire dans `tests/performance/page-operations.perf.spec.ts`
- [ ] T191 [P] Exécuter 1 000 suites de convergence générées et stabiliser seeds/régressions dans `packages/page-state/tests/multi-device-convergence.property.spec.ts`
- [ ] T192 [P] Simuler 90 jours/10 000 changements et un appareil autorisé absent dans `apps/api/tests/page-operation-long-absence.integration.spec.ts`
- [ ] T193 [P] Ajouter les tests inconnus+fichiers à travers export/backup/restore dans `apps/api/tests/page-operation-forward-compatibility.integration.spec.ts`
- [ ] T194 [P] Ajouter fuzz/limites d'updates, URL, profondeur et JSON dans `packages/contracts/tests/page-operations-fuzz.property.spec.ts` et `packages/page-state/tests/input-limits.property.spec.ts`
- [ ] T195 Auditer chiffrement, AAD, redaction, révocation et absence de contenu dans logs dans `apps/api/tests/page-operation-security.spec.ts` et `packages/client-core/tests/page-operation-encryption.spec.ts`
- [ ] T196 Vérifier backup pré-migration, compatibilité read-only et procédure de rollback dans `apps/api/tests/page-operation-migration.integration.spec.ts` et `docs/development.md`
- [ ] T197 Supprimer le chemin Tiptap et `page.document.replace` actif après preuve de migration dans `apps/web/src/features/editor/tiptap-schema.ts`, `to-tiptap.ts`, `from-tiptap.ts`, `block-controls.tsx`, `apps/web/package.json` et `apps/api/src/routes/page-documents.ts`
- [ ] T198 Supprimer dépendances Tiptap devenues inutilisées et mettre à jour le lockfile dans `apps/web/package.json` et `pnpm-lock.yaml`
- [ ] T199 Mettre à jour architecture sync, format v3, éditeur et dépannage dans `docs/architecture/synchronization.md`, `docs/architecture/document-format.md` et `docs/development.md`
- [ ] T200 Mettre à jour état de développement/RAF et statut 017 dans `README.md`, `docs/product/roadmap.md` et `specs/017-v1-notion-like-workspace/tasks.md`
- [ ] T201 Vérifier liens, terminologie, références FR/SC et cohérence finale dans `specs/017-v1-notion-like-workspace/validation.md`
- [ ] T202 Exécuter tous les scénarios manuels de `specs/017-v1-notion-like-workspace/quickstart.md` et enregistrer leurs résultats dans `specs/017-v1-notion-like-workspace/validation.md`
- [ ] T203 Exécuter les tests ciblés par couche en parallèle selon `docs/development.md` et consigner commandes/résultats dans `specs/017-v1-notion-like-workspace/validation.md`
- [ ] T204 Ajouter benchmark/journey d'une hiérarchie de plusieurs milliers d'items dans `tests/performance/navigation.perf.spec.ts`, `tests/e2e/hierarchy-large.spec.ts` et `ci/test-impact.json`
- [ ] T205 Préparer puis exécuter l'essai SC-001/SC-002 avec dix participants et consigner temps, succès et compréhension de la sauvegarde dans `specs/017-v1-notion-like-workspace/usability-validation.md`
- [ ] T206 Exécuter `pnpm checks:local` sur le commit final et consigner le gate exact dans `specs/017-v1-notion-like-workspace/validation.md`
- [ ] T207 Converger spec, plan, tasks, code et preuves puis marquer uniquement les exigences réellement satisfaites dans `specs/017-v1-notion-like-workspace/tasks.md` et `specs/017-v1-notion-like-workspace/validation.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: aucune dépendance.
- **Phase 2 (Fondations)**: dépend de Phase 1 et bloque toutes les stories.
- **US1**: dépend des tokens/primitives de Phase 2, mais pas du nouvel éditeur.
- **US2**: dépend du modèle opérationnel, du stockage local et des primitives.
- **US3**: dépend de US2 et étend son schéma/adaptateur.
- **US4**: dépend de US2 pour rendre l'autosauvegarde visible ; son repository
  local existe depuis Phase 2.
- **US5**: dépend du modèle Phase 2, de l'éditeur US2/US3 et de l'autosauvegarde
  US4 pour fermer le parcours multi-appareils complet.
- **US7**: dépend des interactions finales US1–US5 afin de tester les vrais
  composants plutôt que des placeholders.
- **US6**: dépend des primitives et suit US7 pour appliquer les motifs validés à
  toutes les surfaces.
- **Polish**: dépend de toutes les stories.

### User Story Dependency Graph

~~~text
Setup → Fondations ─┬→ US1 shell ───────────────┐
                   └→ US2 éditeur → US3 riche ─┼→ US7 accès → US6 cohérence
                                  └→ US4 local ─┴→ US5 convergence ────────┘
                                                        │
                                                        ▼
                                                      Polish
~~~

### Within Each Story

1. Écrire et observer les tests échouer pour la raison attendue.
2. Implémenter modèle/stockage avant service, service avant UI.
3. Vérifier ciblé après chaque groupe logique.
4. Exécuter l'independent test de la story avant son checkpoint.
5. Garder `tasks.md` à jour ; ne cocher qu'après preuve.

## Parallel Opportunities

- Phase 1 : T005 et T006 ; le changement de dépendances T002 reste sérialisé.
- Phase 2 : tests domain T009–T011, tests page-state T017–T021, puis tests
  local/contrats/UI portant des fichiers distincts.
- US1 : T050–T053 en parallèle, puis page header T055 pendant le shell T054.
- US2 : T064–T068 en parallèle ; menus T074–T076 et blocs inconnus/page-link
  T080–T081 après le schéma.
- US3 : tests T085–T089 et blocs T090/T092/T093/T094 en parallèle.
- US4 : tests T105–T109 en parallèle avant l'orchestration.
- US5 : tests T120–T130 en parallèle ; services serveur distincts après
  repository et contrats ; journeys après intégration.
- US7 : tests navigateurs T157–T161 en parallèle ; corrections par surface.
- US6 : migrations de surfaces T175–T180 en parallèle après primitives.
- Polish : benchmarks, fuzz, longue absence et forward compatibility peuvent
  s'exécuter sur des environnements isolés en parallèle ; le gate final reste
  l'inventaire ordonné de `docs/development.md`.

## Parallel Examples

### US2 — Adaptateur éditeur

~~~text
T064 round-trip canonique/BlockNote
T065 mapping getChanges/commandes
T066 application distante
T067 IME/Unicode
T068 journey interactions
~~~

Après le schéma T069, les menus T074–T076 peuvent être construits ensemble,
puis T071/T072 les relient à la session.

### US5 — Synchronisation

~~~text
Groupe DB       : T120, T121
Groupe contrats : T122, T127
Groupe serveur  : T123, T124, T125, T126
Groupe navigateur : T128, T129, T130
~~~

L'implémentation se rejoint à T139 : aucune route ne s'active avant migration,
repository, chiffrement et matérialisation.

### US6 — Surfaces

Les tâches T175–T180 portent des dossiers disjoints et peuvent avancer en
parallèle. T181–T185 harmonisent ensuite les écarts observés, avant
l'approbation visuelle T186.

## Implementation Strategy

### Première tranche démontrable

1. Phase 1 : dépendances et frontières.
2. Phase 2 : modèle convergent, projection et durabilité locale.
3. US1 : shell focalisé.
4. US2 : éditeur Notion-like sur le modèle local.
5. US4 : autosauvegarde/reprise locale.

Cette tranche démontre l'expérience et la sûreté locale, mais **ne constitue
pas la V1 annoncée** : US3, US5, US7 et US6 restent obligatoires.

### Livraison incrémentale sûre

1. Garder lecture/projection v2 et écriture legacy derrière leur frontière.
2. Prouver le modèle et Dexie avant tout remplacement visible.
3. Brancher BlockNote sur les commandes, jamais sur le stockage direct.
4. Activer routes v3 et migration lazy seulement après backup/restore tests.
5. Autoriser la suppression de Tiptap/replace uniquement après matrice
   multi-appareils et compatibilité.
6. Migrer les autres surfaces puis exécuter le gate complet sur le commit exact.

### Règles de progression

- Chaque commit reste petit, réversible et cohérent avec `tasks.md`.
- Un échec de projection, chiffrement ou stockage bloque l'état synchronisé.
- Aucun test n'utilise un timeout comme substitut à une frontière contrôlée.
- Les tests ciblés peuvent être lancés en parallèle ; les suites partageant une
  base ou la matrice Playwright complète respectent les limites documentées.
- Aucune fonctionnalité XL, présence multi-utilisateur, IA ou service hébergé
  ne peut entrer par opportunisme dans cette feature.
