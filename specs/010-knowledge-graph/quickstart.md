# Quickstart: Graphe de connaissances privé

## Prérequis

Depuis la racine du dépôt, utiliser la version de Bun épinglée et installer les
dépendances verrouillées.

## Workspace de démonstration reproductible

1. Exécuter `bun run dev:stack:demo`. Cette action efface uniquement les
   volumes locaux `myownnotion-dev`, puis recrée et vérifie 240 éléments et 480
   relations cohérentes.
2. Suivre intégralement
   `docs/testing/knowledge-graph-demo.md` pour désinscrire le service worker,
   effacer cookies, caches, stockages locaux et IndexedDB, et retirer la PWA si
   elle était installée. Un rechargement forcé ne suffit pas.
3. Ouvrir `https://localhost:8443` et utiliser le mot de passe factice public
   `knowledge-graph-demo` pour l'unique owner local.
4. Ne jamais lancer le seed isolément. En cas d'interruption ou pour rejouer le
   test, relancer la commande complète afin de repartir d'une base, de fichiers
   et de sauvegardes vides.

La commande refuse une origine distante, une base inattendue, un environnement
autre que `development`, une installation ambiguë ou déjà remplie. Le corpus
inclut 8 branches, 40 tâches structurées, un fichier attaché, 8 isolés, des
cycles, doublons, réciproques, liens inter-branches, un type futur et un élément
à la corbeille.

## Preuves ciblées

1. Lancer les tests du package graphe : agrégation, backlinks, cycles,
   permutations, périmètres, filtres et limites.
2. Lancer les tests client : lecture Dexie, ouverture différée des titres,
   complétude et reconstruction après snapshot.
3. Lancer les tests Web : routes, contrôles, liste/carte et dernière vue sûre.
4. Lancer le parcours Playwright `knowledge-graph.spec.ts` aux largeurs desktop
   et 320 px.
5. Lancer la fixture de performance 100 000 éléments / 100 000 relations et
   vérifier les budgets documentés.

## Parcours manuel principal

1. Créer trois pages A, B et C ; ajouter deux liens de A vers B et un lien de C
   vers B.
2. Ouvrir B puis « Voir les relations ».
3. Vérifier « Référencé par » : A avec multiplicité 2, puis C avec multiplicité
   1 ; vérifier que les relations sortantes sont séparées.
4. Ouvrir le voisinage à profondeur 2, sélectionner A, recentrer et ouvrir A.
5. Ouvrir le graphe global depuis la barre latérale, filtrer les pages, masquer
   un type de relation, révéler les isolés puis réinitialiser en une action.
6. Basculer en liste et retrouver exactement les mêmes nœuds et relations.

## Offline et reprise

1. Attendre une synchronisation complète puis couper le réseau.
2. Ajouter un lien interne et vérifier l'apparition immédiate de la relation et
   du backlink.
3. Recharger brutalement : la relation apparaît une seule fois.
4. Reconnecter, synchroniser sur un second navigateur et comparer directions,
   types et multiplicités.

## Corbeille et restauration

1. Mettre une cible à la corbeille : elle disparaît par défaut et l'inspecteur
   indique la cible indisponible lorsque le lifecycle est inclus.
2. Restaurer la cible : même identité et même relation réapparaissent.
3. Purger dans une fixture dédiée : l'arête est retirée sans corrompre les
   autres composantes.

## Gate avant push

Relire `docs/development.md`, puis exécuter le gate local complet indiqué pour
une modification de code. Aucun push ne part si une étape requise est absente
ou en échec.
