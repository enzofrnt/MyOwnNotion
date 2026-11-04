# Architecture

Les décisions transversales validées seront consignées ici sous forme de documents courts, reliés depuis le `plan.md` de la fonctionnalité qui les introduit.

## Documents

- [`write-guarantees.md`](write-guarantees.md) : les deux garanties que porte
  toute écriture acceptée — blocage de rotation respecté, contenu protégé scellé
  — et pourquoi elles vivent en un seul endroit.
- [`document-model.md`](document-model.md) : le format de document par blocs.
- [`file-handling.md`](file-handling.md) : pourquoi les prévisualisations sont
  en bac à sable, pourquoi aucun service de diagrammes ne fait partie de la
  stack, et ce qui admet un contenu à l'éviction.
- [`synchronization.md`](synchronization.md) : pourquoi l'événement de
  synchronisation transporte une position et non un contenu, pourquoi la
  détection de conflit n'a pas été reconstruite, et les deux cas que la fusion
  refuse de trancher.
- [`backup.md`](backup.md) : archive canonique scellée, répétition de
  restauration et garde de mise à jour.
- [`search.md`](search.md) : index transitoires, générations atomiques,
  reconstruction, diagnostics, confidentialité et volume de référence.
- [`feature 019 plan`](../../specs/019-bun-toolchain/plan.md) : chaîne Bun
  unique, artefacts Web/API, module WebSocket intégré, CI et images de
  production sans runtime Node.js de secours.
- [`feature 010 plan`](../../specs/010-knowledge-graph/plan.md) : projection
  locale reconstruisible, backlinks, périmètres et rendu borné sans nouvelle
  source de vérité.

## Frontières actuelles

- `apps/web` : expérience utilisateur web et orchestration côté client.
- `apps/api` : API HTTP, authentification, synchronisation distante et surface MCP sous Bun.
- `apps/desktop` : hôte Electron (fenêtre, IPC, mises à jour, politiques de navigation).
- `packages/contracts` : schémas et DTO partagés entre l'API, le client et les tests de contrat.
- `packages/domain` : modèle canonique, règles métier et crypto ; **aucune dépendance workspace**.
- `packages/database` : schémas Drizzle, migrations et repositories PostgreSQL.
- `packages/page-state` : état de page convergent (Loro, blocs, projections).
- `packages/client-core` : outbox, stockage local, réconciliation et orchestration hors ligne.
- `packages/blob-store` : stockage adressé par contenu, chiffrement des blocs et uploads partiels.
- `packages/graph` : projection pure et déterministe des liens, backlinks, périmètres et dispositions.
- `packages/test-utils` : fixtures PostgreSQL et générateurs de propriétés.

Règles de dépendance vérifiées au HEAD : `domain` ne dépend d'aucun package du
dépôt ; `contracts`, `graph`, `page-state`, `blob-store` et `database` dépendent
de `domain` ; `client-core` dépend de `contracts`, `domain`, `graph` et
`page-state` ; `api` dépend de `blob-store`, `contracts`, `database`, `domain` et
`page-state` ; `web` dépend de `client-core`, `contracts`, `domain`, `graph` et
`page-state`. Aucun cycle de production n'est admis. `apps/desktop` importe
aujourd'hui le numéro de protocole de `packages/domain` par chemin relatif sans
déclarer la dépendance workspace : toute nouvelle frontière desktop doit passer
par `@myownnotion/domain` dans `apps/desktop/package.json`.

