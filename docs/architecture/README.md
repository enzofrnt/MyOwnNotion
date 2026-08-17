# Architecture

Les décisions transversales validées seront consignées ici sous forme de documents courts, reliés depuis le `plan.md` de la fonctionnalité qui les introduit.

## Documents

- [`write-guarantees.md`](write-guarantees.md) : les deux garanties que porte
  toute écriture acceptée — blocage de rotation respecté, contenu protégé scellé
  — et pourquoi elles vivent en un seul endroit.
- [`document-model.md`](document-model.md) : le format de document par blocs.
- [`file-handling.md`](file-handling.md) : pourquoi les prévisualisations sont
  en bac à sable, pourquoi l'éditeur de diagrammes est auto-hébergé, et ce qui
  admet un contenu à l'éviction.

## Frontières envisagées

- `apps/web` : expérience utilisateur web et orchestration côté client.
- `apps/api` : API, authentification, partage et synchronisation distante éventuelle.
- `packages/editor` : modèle et interface d’édition par blocs, avec Tiptap comme candidat initial.
- `packages/graph` : liens, backlinks, index et projections du graphe.
- `packages/database` : schémas, migrations et accès à la persistance.
- `packages/mcp` : surface MCP séparée du cœur métier.

Ces frontières sont provisoires. Le premier `plan.md` concerné doit les confirmer, les modifier ou les supprimer selon les besoins de la spec. Une technologie n’est considérée comme choisie que lorsqu’un plan approuvé la documente.
