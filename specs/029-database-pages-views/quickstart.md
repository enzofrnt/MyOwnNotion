# Validation rapide — 029

## Préparer

1. Utiliser une installation de test ou une base PostgreSQL jetable. `bun run dev:stack:reset` efface toutes les données Postgres, fichiers et sauvegardes du profil local ciblé ; ne le lancer que sur une installation de développement isolée dont l'inventaire et la perte ont été acceptés. Une migration ordinaire n'exécute jamais cette commande.
2. Installer avec le Bun épinglé (`bun install --frozen-lockfile`), puis lancer les migrations selon `docs/development.md`. Si une ancienne source est détectée, la migration refuse de continuer. Sur une installation jetable seulement, inventorier données/fichiers/sauvegardes, exporter ce qui doit l'être et choisir explicitement le reset complet du profil local avant de relancer. Sur une installation à conserver, attendre une migration dédiée.
3. Démarrer la stack locale avec `bun run dev:stack`. Ouvrir l'interface en thème clair et sombre.

## Parcours de validation

1. Dans une page contenant deux paragraphes, insérer `/base de données - intégrée` entre eux. Vérifier une seule vue Table centrée dans la colonne de lecture, un enfant `database` dans l'arbre et aucun lien ajouté au texte. Vérifier que le titre de la source est visible au-dessus des vues. Avec deux sources disponibles, passer d'un onglet à l'autre et vérifier que le titre suit la source active ; le titre d'une source liée reste en lecture seule. Recharger, passer en Kanban, revenir à Table ; une seule vue reste affichée dans le bloc.
2. Dans la même page, insérer `/base de données - pleine page`. Vérifier le lien au curseur avec icône de base sans flèche, l'ouverture immédiate du conteneur, sa source propre et sa vue Table. Vérifier les `+` Notes, page et dossier avec trois choix ; vérifier l'absence du bouton permanent « Ajouter une base ».
3. Créer page et dossier entrées depuis une vue, y ajouter des propriétés et vérifier leur placement direct sous la base. Créer une base sous la page entrée, puis tenter de créer/déplacer une base directement sous la base propriétaire : refus sans objet partiel. Déplacer l'entrée dehors puis dedans : mêmes valeurs retrouvées.
4. Ajouter Kanban/Galerie/Liste/Calendrier ; régler filtres, tris et groupes indépendamment. Avec une seule vue, vérifier le choix de source verrouillé ; avec deux, relier un onglet à une seconde base. Réorienter tous les onglets : la source possédée et ses entrées restent accessibles dans l'arbre et le sélecteur.
5. Dans une page, insérer `/vue liée de base de données`, choisir une source existante et vérifier bloc unique + enfant `database_view` fléché. Créer une entrée depuis cette vue : elle apparaît sous le propriétaire de la source. Mettre le propriétaire à la corbeille : avertissement et lecture seule ; restaurer : vue réutilisable. Supprimer la vue liée : source intacte.
6. Répéter les parcours UI à 320 px, au clavier, en clair/sombre et hors ligne. Le tableau intégré défile en interne sans élargir la page. Noter les preuves réelles dans `validation.md` conformément à `ui-quality`.
7. Exporter, restaurer sur une installation de test et vérifier identités, placements, valeurs dormantes et liens de vues. Importer un export Notion avec deux sources et vues liées ; aperçu et résultat doivent annoncer les mêmes propriétaires et entrées directes. Interrompre/reprendre l'import sans doublon.

## Checks

Lancer les tests ciblés au fil de l'implémentation : `bun run test:unit`, `bun run test:integration`, `bun run test:contract`, `bun run db:test-migrations`, `bun run test:e2e:local`. Avant tout push de code, lire l'inventaire de `docs/development.md` puis exécuter `bun run checks:local` avec le chemin conteneur documenté si l'hôte ne peut pas faire tourner Firefox.
