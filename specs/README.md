# Feature specifications

Ce dossier est l’unique source de vérité pour les fonctionnalités du produit.

La direction transversale du produit est définie dans
[`docs/product/product-canvas.md`](../docs/product/product-canvas.md). Chaque
feature doit citer les sections du canevas qu’elle concrétise, préciser ses
dépendances et son hors-périmètre, puis transformer cette direction en critères
d’acceptation testables. Une feature ne doit jamais contredire silencieusement
le canevas.

Chaque cycle Spec Kit crée un seul sous-dossier numéroté, par exemple :

```text
specs/001-core-workspace/
  spec.md
  plan.md
  tasks.md
  checklists/
  contracts/
  research.md
  data-model.md
  quickstart.md
```

Seuls les fichiers utiles à la fonctionnalité sont créés. Ne pas dupliquer ces artefacts dans `.agents/`, `.cursor/`, `docs/` ou un autre dossier.
