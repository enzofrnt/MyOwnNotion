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

## Frontières envisagées

- `apps/web` : expérience utilisateur web et orchestration côté client.
- `apps/api` : API, authentification, partage et synchronisation distante éventuelle.
- `packages/editor` : modèle et interface d’édition par blocs, avec Tiptap comme candidat initial.
- `packages/graph` : liens, backlinks, index et projections du graphe.
- `packages/database` : schémas, migrations et accès à la persistance.
- `packages/mcp` : surface MCP séparée du cœur métier.

Ces frontières sont provisoires. Le premier `plan.md` concerné doit les confirmer, les modifier ou les supprimer selon les besoins de la spec. Une technologie n’est considérée comme choisie que lorsqu’un plan approuvé la documente.
