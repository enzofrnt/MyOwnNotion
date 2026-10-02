# Tâches — Réduction des duplications

## Phase 1 — Setup

- [x] T001 Figer le rapport initial dans work/slopo/baseline-reports.
- [x] T002 Lire constitution, canevas et skills ; enregistrer plan.md et research.md.

## Phase 2 — US1 qualification

Critère indépendant : chaque groupe initial a une décision et une justification.

- [x] T003 [US1] Qualifier les 173 groupes dans specs/030-source-duplication/audit.json et audit.md.

## Phase 3 — US2 extractions

Pour chaque tâche, vérifier les tests existants et compléter les cas manquants
avant extraction, puis lancer les tests ciblés. Les précautions détaillées sont
dans audit.json. Pour les familles UI, suivre ui-quality et lessons référencés
dans plan.md ; conserver DOM, classes, labels et interactions.

- [x] T004 [US2] Partager la famille 3 (groupes 3) dans `apps/api/src/page-state/legacy-branch-service.ts`; `packages/client-core/src/page-sync/legacy-conflict-recovery.ts`. Vérifier le contrat et ses tests ciblés.
- [x] T005 [US2] Partager la famille 4 (groupes 4, 7, 8, 9) dans `apps/api/src/databases/database-query-service.ts`; `packages/client-core/src/databases/local-database-query.ts`. Vérifier le contrat et ses tests ciblés.
- [x] T006 [US2] Partager la famille 6 (groupes 6) dans `apps/api/src/page-state/page-operation-crypto.ts`; `packages/client-core/src/page-sync/encrypted-update-log.ts`; `packages/page-state/src/document.ts`; `packages/page-state/src/update-envelope.ts`. Vérifier le contrat et ses tests ciblés.
- [x] T007 [US2] Partager la famille 10 (groupes 10) dans `packages/domain/src/export/canonical-export.ts`; `apps/api/src/backup/page-operation-archive.ts`. Vérifier le contrat et ses tests ciblés.
- [x] T008 [US2] Partager la famille 11 (groupes 11) dans `apps/api/src/page-state/semantic-detection.ts`; `packages/page-state/src/legacy-document-diff.ts`; `packages/page-state/src/undo-manager.ts`. Vérifier le contrat et ses tests ciblés.
- [x] T009 [US2] Partager la famille 12 (groupes 12, 32) dans `packages/domain/src/databases/schema.ts`; `apps/api/src/page-state/legacy-branch-service.ts`; `apps/api/src/backup/page-operation-archive.ts`. Vérifier le contrat et ses tests ciblés.
- [x] T010 [US2] Partager la famille 45 (groupes 15, 45) dans `apps/api/src/search/search-service.ts`; `apps/web/src/services/search.ts`. Vérifier le contrat et ses tests ciblés.
- [x] T011 [US2] Partager la famille 16 (groupes 16) dans `packages/domain/src/document/document.ts`; `apps/web/src/features/editor/editor-adapter.ts`. Vérifier le contrat et ses tests ciblés.
- [x] T012 [US2] Partager la famille 17 (groupes 17) dans `packages/domain/src/security/crypto.ts`; `apps/api/src/security/bootstrap-service.ts`; `apps/api/src/databases/database-query-service.ts`; `apps/api/src/search/search-service.ts`. Vérifier le contrat et ses tests ciblés.
- [x] T013 [US2] Partager la famille 18 (groupes 18) dans `packages/contracts/src/security-artifacts.ts`; `packages/domain/src/security/types.ts`. Vérifier le contrat et ses tests ciblés.
- [x] T014 [US2] Partager la famille 26 (groupes 26) dans `packages/domain/src/backup/archive-manifest.ts`; `packages/domain/src/export/canonical-export.ts`; `apps/api/src/backup/full/receipts.ts`; `apps/api/src/backup/full/activity.ts`. Vérifier le contrat et ses tests ciblés.
- [x] T015 [US2] Partager la famille 27 (groupes 27) dans `packages/client-core/src/page-sync/encrypted-update-log.ts`; `apps/web/src/features/auth/passkey-client.ts`. Vérifier le contrat et ses tests ciblés.
- [x] T016 [US2] Partager la famille 28 (groupes 28) dans `apps/api/src/backup/page-operation-archive.ts`; `apps/api/src/page-state/page-operation-service.ts`. Vérifier le contrat et ses tests ciblés.
- [x] T017 [US2] Partager la famille 33 (groupes 33) dans `apps/web/src/services/local-content.ts`. Vérifier le contrat et ses tests ciblés.
- [x] T018 [US2] Partager la famille 38 (groupes 38) dans `packages/client-core/src/files/pending-file-transfer-store.ts`; `packages/client-core/src/outbox/apply-local-mutation.ts`. Vérifier le contrat et ses tests ciblés.
- [x] T019 [US2] Partager la famille 39 (groupes 39) dans `apps/web/src/features/attachments/attachment-panel.tsx`; `apps/web/src/features/files/attachment-list.tsx`. Vérifier le contrat et ses tests ciblés.
- [x] T020 [US2] Partager la famille 40 (groupes 40) dans `packages/database/src/mutations/database-commands.ts`; `packages/client-core/src/outbox/apply-to-projection.ts`. Vérifier le contrat et ses tests ciblés.
- [x] T021 [US2] Partager la famille 41 (groupes 41) dans `packages/page-state/src/legacy-offline-branch.ts`; `apps/api/src/page-state/page-history-service.ts`; `packages/page-state/src/legacy-document-diff.ts`. Vérifier le contrat et ses tests ciblés.
- [x] T022 [US2] Partager la famille 48 (groupes 48) dans `apps/web/src/features/databases/page-databases.tsx`; `apps/web/src/features/editor/custom-blocks/database-view.tsx`. Vérifier le contrat et ses tests ciblés.
- [x] T023 [US2] Partager la famille 50 (groupes 50) dans `packages/page-state/src/block-tree.ts`. Vérifier le contrat et ses tests ciblés.
- [x] T024 [US2] Partager la famille 51 (groupes 51) dans `packages/client-core/src/outbox/outbox.ts`; `packages/client-core/src/page-sync/legacy-conflict-recovery.ts`. Vérifier le contrat et ses tests ciblés.
- [x] T025 [US2] Partager la famille 57 (groupes 57) dans `apps/api/src/files/protected-file-rotation.ts`; `apps/api/src/files/protected-file-service.ts`; `apps/api/src/files/protected-upload-service.ts`. Vérifier le contrat et ses tests ciblés.
- [x] T026 [US2] Partager la famille 62 (groupes 62) dans `apps/web/src/services/local-content.ts`. Vérifier le contrat et ses tests ciblés.
- [x] T027 [US2] Partager la famille 167 (groupes 63, 167) dans `packages/client-core/src/page-sync/migration.ts`. Vérifier le contrat et ses tests ciblés.
- [x] T028 [US2] Partager la famille 143 (groupes 65, 143) dans `packages/database/src/mutations/database-commands.ts`. Vérifier le contrat et ses tests ciblés.
- [x] T029 [US2] Partager la famille 69 (groupes 69) dans `packages/page-state/src/document.ts`. Vérifier le contrat et ses tests ciblés.
- [x] T030 [US2] Partager la famille 72 (groupes 72) dans `scripts/ci/check-toolchain.ts`; `scripts/ci/scan-secrets.ts`; `scripts/ci/static-security.ts`; `scripts/ci/check-shell.ts`. Vérifier le contrat et ses tests ciblés.
- [x] T031 [US2] Partager la famille 78 (groupes 78) dans `apps/api/src/files/protected-file-references.ts`; `apps/api/src/files/protected-file-rotation.ts`. Vérifier le contrat et ses tests ciblés.
- [x] T032 [US2] Partager la famille 79 (groupes 79) dans `apps/web/src/features/save-state/blocked-notice.tsx`; `apps/web/src/features/save-state/save-state-indicator.tsx`. Vérifier le contrat et ses tests ciblés.
- [x] T033 [US2] Partager la famille 80 (groupes 80) dans `packages/client-core/src/page-sync/legacy-page-editing-session.ts`; `packages/client-core/src/page-sync/page-editing-session.ts`. Vérifier le contrat et ses tests ciblés.
- [x] T034 [US2] Partager la famille 82 (groupes 82, 83) dans `packages/page-state/src/block-tree.ts`; `packages/page-state/src/document.ts`. Vérifier le contrat et ses tests ciblés.
- [x] T035 [US2] Partager la famille 90 (groupes 90) dans `apps/api/src/security/protected-content.ts`. Vérifier le contrat et ses tests ciblés.
- [x] T036 [US2] Partager la famille 94 (groupes 94) dans `apps/api/src/security/canonical-storage-migration.ts`. Vérifier le contrat et ses tests ciblés.
- [x] T037 [US2] Partager la famille 95 (groupes 95) dans `packages/client-core/src/outbox/apply-to-projection.ts`. Vérifier le contrat et ses tests ciblés.
- [x] T038 [US2] Partager la famille 96 (groupes 96) dans `packages/page-state/src/checkpoints.ts`. Vérifier le contrat et ses tests ciblés.
- [x] T039 [US2] Partager la famille 99 (groupes 99) dans `apps/web/src/services/security-api.ts`. Vérifier le contrat et ses tests ciblés.
- [x] T040 [US2] Partager la famille 100 (groupes 100) dans `apps/api/src/security/file-storage-migration.ts`. Vérifier le contrat et ses tests ciblés.
- [x] T041 [US2] Partager la famille 136 (groupes 103, 136, 157) dans `packages/domain/src/document/export-markdown.ts`. Vérifier le contrat et ses tests ciblés.
- [x] T042 [US2] Partager la famille 104 (groupes 104) dans `packages/client-core/src/outbox/apply-to-projection.ts`. Vérifier le contrat et ses tests ciblés.
- [x] T043 [US2] Partager la famille 105 (groupes 105) dans `apps/web/src/features/databases/table-view.tsx`; `apps/web/src/features/databases/database-page.tsx`; `apps/web/src/features/databases/view-settings-panel.tsx`. Vérifier le contrat et ses tests ciblés.
- [x] T044 [US2] Partager la famille 107 (groupes 107, 116) dans `packages/domain/src/document/document.ts`. Vérifier le contrat et ses tests ciblés.
- [x] T045 [US2] Partager la famille 111 (groupes 111) dans `apps/api/src/page-state/legacy-branch-service.ts`; `apps/api/src/page-state/page-operation-service.ts`. Vérifier le contrat et ses tests ciblés.
- [x] T046 [US2] Partager la famille 112 (groupes 112) dans `apps/api/src/backup/backup-service.ts`. Vérifier le contrat et ses tests ciblés.
- [x] T047 [US2] Partager la famille 115 (groupes 115) dans `apps/api/src/databases/database-query-service.ts`. Vérifier le contrat et ses tests ciblés.
- [x] T048 [US2] Partager la famille 117 (groupes 117) dans `apps/api/src/security/audit-service.ts`. Vérifier le contrat et ses tests ciblés.
- [x] T049 [US2] Partager la famille 120 (groupes 120) dans `packages/database/src/mutations/database-commands.ts`. Vérifier le contrat et ses tests ciblés.
- [x] T050 [US2] Partager la famille 124 (groupes 124) dans `apps/web/src/features/hierarchy/hierarchy-explorer.tsx`. Vérifier le contrat et ses tests ciblés.
- [x] T051 [US2] Partager la famille 126 (groupes 126) dans `packages/database/src/repositories/content/usage-repository.ts`. Vérifier le contrat et ses tests ciblés.
- [x] T052 [US2] Partager la famille 128 (groupes 128) dans `packages/page-state/src/undo-manager.ts`. Vérifier le contrat et ses tests ciblés.
- [x] T053 [US2] Partager la famille 129 (groupes 129) dans `packages/client-core/src/page-sync/page-reconciler.ts`. Vérifier le contrat et ses tests ciblés.
- [x] T054 [US2] Partager la famille 131 (groupes 131, 173) dans `apps/web/src/ui/primitives/drawer.tsx`; `apps/web/src/ui/primitives/dialog.tsx`. Vérifier le contrat et ses tests ciblés.
- [x] T055 [US2] Partager la famille 132 (groupes 132) dans `apps/api/src/security/security-config.ts`; `apps/api/src/security/cookie-policy.ts`. Vérifier le contrat et ses tests ciblés.
- [x] T056 [US2] Partager la famille 144 (groupes 144) dans `packages/client-core/src/reconciliation/resolve-conflict.ts`. Vérifier le contrat et ses tests ciblés.
- [x] T057 [US2] Partager la famille 150 (groupes 150) dans `packages/database/src/repositories/database-repository.ts`. Vérifier le contrat et ses tests ciblés.
- [x] T058 [US2] Partager la famille 155 (groupes 155) dans `apps/api/src/realtime/page-sync-session.ts`. Vérifier le contrat et ses tests ciblés.
- [x] T059 [US2] Partager la famille 156 (groupes 156) dans `packages/database/src/mutations/execute-command.ts`. Vérifier le contrat et ses tests ciblés.
- [x] T060 [US2] Partager la famille 160 (groupes 160) dans `packages/database/src/mutations/execute-command.ts`. Vérifier le contrat et ses tests ciblés.
- [x] T061 [US2] Partager la famille 162 (groupes 162) dans `packages/client-core/src/local-store/local-repository.ts`. Vérifier le contrat et ses tests ciblés.
- [x] T062 [US2] Partager la famille 170 (groupes 170) dans `packages/database/src/mutations/database-commands.ts`. Vérifier le contrat et ses tests ciblés.

## Phase 4 — US3 convergence

- [x] T063 [US3] Exécuter tests concernés, typage et format/lint ; consigner dans specs/030-source-duplication/verification.md.
- [x] T064 [US3] Relancer work/slopo/run.sh, qualifier les nouveaux groupes et relier les extractions à l’audit.
- [x] T065 [US3] Vérifier tous les critères de spec.md ; conserver les limites E2E et push dans verification.md.

- [x] T066 [US2] Appliquer ui-quality et documenter la revue visuelle des composants partagés : dialogues/panneaux, visibilité des propriétés et usages de fichiers ; clavier, 320 px, thèmes clair/sombre.
- [x] T067 [US2] Partager aussi la règle valeurs/relations de la cellule avec hierarchy-explorer (groupe nouveau/modifié confirmé dans follow-up-audit.json), en conservant retry, refresh et erreurs des appelants.
- [x] T068 [US2] Corriger le débordement des longs noms d’utilisation de fichier constaté à 320 px ; vérifier le rendu réel et conserver styles/labels des cas ordinaires.

## Dépendances et stratégie

T001–T003 bloquent les extractions. Les extractions pures précèdent leurs
consommateurs ; les tâches partageant un fichier sont séquentielles. Des contrôles
indépendants de lecture/format peuvent être lancés en parallèle ; aucun agent de
code supplémentaire n’est requis. Livraison incrémentale dans le checkout,
convergence complète requise avant déclaration de fin.

## Phase 5 — Écarts de vérification découverts

- [x] T069 [US3] Vérifier les scripts CI factorisés avec les outils épinglés ; ne pas lire comme texte le lien de répertoire .codex suivi par Git.
- [x] T070 [US3] Aligner les attentes unitaires anciennes sur les exigences actuelles : vues liées multiples (029 FR-006/FR-019), source locale dédiée (029 FR-009/FR-010), légende de titre sous le groupe de titre (022), commandes de liens par leur comportement (003 FR-027/FR-028). Conserver les évolutions existantes.
- [x] T071 [US3] Relancer avec PostgreSQL 18 les suites de sauvegarde/restauration concernées et isoler les tests de coloration et de longue absence ayant dépassé leur délai sous charge.

## Clôture d’implémentation

T001–T071 sont terminées. Voir [verification.md](verification.md) pour les
résultats effectifs, les écarts de première passe et leurs relances, le gate UI,
et les limites E2E/push. Les tâches décrivent les familles ; les références de
contrats et les tests correspondants sont dans [traceability.md](traceability.md).
