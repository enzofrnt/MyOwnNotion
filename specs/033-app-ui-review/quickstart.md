# Observer la passe

Instance conservée : http://localhost:8080/notes ; laboratoire :
http://localhost:8080/__ui-lab. Connexion « Utiliser le mot de passe »,
`knowledge-graph-demo` (fixture locale). Sources HMR du checkout courant.
Ne pas réinitialiser ni reseeder les données ajoutées par le propriétaire.

Pour redémarrer : commande et override CA de [032](../032-ui-uniformity/quickstart.md).
Ne pas utiliser `bun run dev:stack` qui cible l’ancienne stack.

Parcours isolés : `/__ui-lab?review=conflicts`, `files`, `history`, `database`,
`properties`, `editor`, `recovery`, `desktop`, `backup`, `states`. Pour les bases,
ajouter `&format=table|board|gallery|list|calendar`. Actions et données en mémoire ;
aucune rotation, restauration ou suppression des données de l’espace. Les
transferts de fichiers de l’éditeur sont désactivés dans ce laboratoire.

Contrôles : `bun run --filter @myownnotion/web typecheck`,
`bun run --bun vitest run --project web <suites pertinentes>`,
`bun run --filter @myownnotion/web build`, Biome ciblé et `git diff --check`.
La revue visuelle initiale différérait les E2E à la demande du propriétaire.
Depuis sa demande du 3 octobre 2026, lancer toutes les suites et la matrice de
`bun run checks:local` avant chaque push, puis vérifier la CI du dernier commit
sur la PR. Les bases, fichiers et clés des tests restent jetables et distincts
à chaque projet de navigateur. Pour cette machine, PostgreSQL de tests écoute
sur 55432 ; l'instance du propriétaire sur 5432 reste intacte. Voir la procédure
et les outils requis dans [development.md](../../docs/development.md).
