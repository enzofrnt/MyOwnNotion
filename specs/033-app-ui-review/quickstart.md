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
La passe complète demandée le 3 octobre 2026 est validée par le contrôle local
20 et la CI verte de `782f7618`. Selon la clarification du 4 octobre et la
Constitution 4.0.0, les publications suivantes choisissent leurs contrôles selon
l'impact : documents et cohérence pour la prose seule, tests pertinents pour une
correction délimitée, `bun run checks:local` pour un changement transversal ou
incertain. Un suivi documentaire réutilise les preuves du code inchangé ; il ne
relance pas les suites applicatives. La CI requise reste bloquante avant fusion.
Les bases, fichiers et clés des tests restent jetables et distincts
à chaque projet de navigateur. Pour cette machine, PostgreSQL de tests écoute
sur 55432 ; l'instance du propriétaire sur 5432 reste intacte. Voir la procédure
et les outils requis dans [development.md](../../docs/development.md).
