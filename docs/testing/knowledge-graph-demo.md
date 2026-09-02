# Tester le Knowledge Graph après un redéploiement

Ce parcours recrée un environnement **strictement local et jetable**, charge un
workspace conséquent, puis vérifie ses invariants avant d'annoncer qu'il est
prêt. Il sert à distinguer un défaut du nouveau serveur d'un ancien état encore
présent dans le navigateur.

## 1. Réinitialiser le serveur et charger la démonstration

Depuis la racine du dépôt :

```bash
bun run dev:stack:demo
```

Si la stack publiée du même checkout tourne déjà sur le port PostgreSQL 5432,
l'arrêter d'abord avec `docker compose stop postgres`. Cette action conserve
son volume et évite que les deux stacks locales réclament le même port.

Cette commande est destructive uniquement pour le projet Compose
`myownnotion-dev`. Elle arrête la stack, supprime ses volumes PostgreSQL,
fichiers et sauvegardes, les recrée, démarre la stack, puis injecte les données
par les mutations normales de l'API. L'autorité de certification locale de
Caddy est conservée.

La commande refuse de continuer si l'une de ces conditions manque :

- `NODE_ENV` vaut exactement `development` ;
- l'origine publique vaut exactement `https://localhost:8443` ;
- PostgreSQL est le service local attendu et la base s'appelle `myownnotion` ;
- il existe exactement une installation, encore vide, sans owner ni contenu ;
- la confirmation destructive interne est exacte.

Il n'existe aucun démarrage automatique de ce jeu de données et aucun
paramètre permettant de l'activer en production. Si le chargement est
interrompu, ne tentez pas de le reprendre au milieu : relancez la commande
complète, qui repart de volumes vides.

Connexion locale :

- URL : `http://localhost:8080` (Cursor) ou `https://localhost:8443` (Safari/Chrome)
- owner : unique, aucun identifiant à saisir
- mot de passe factice : `knowledge-graph-demo`

Ce mot de passe est volontairement public et ne doit jamais être réutilisé sur
une installation réelle.

## 2. Effacer réellement l'ancien état du navigateur

Un rechargement normal, même forcé, ne supprime pas IndexedDB, les cookies, le
service worker ni ses caches. Après chaque redéploiement testé :

1. Fermer les autres onglets ouverts sur `localhost` et quitter l'éventuelle
   application MyOwnNotion installée.
2. Désinstaller cette application PWA si elle a été installée depuis le
   navigateur.
3. Ouvrir les outils de développement sur l’origine utilisée
   (`http://localhost:8080` ou `https://localhost:8443`).
4. Dans **Application > Service Workers**, désinscrire le service worker.
5. Dans **Application > Storage**, choisir **Clear site data** en incluant
   cookies, Local Storage, Session Storage, IndexedDB et Cache Storage.
6. Supprimer aussi les données de l’autre origine (`http://localhost:8080` ou
   `https://localhost:8443`) dans les paramètres de confidentialité du
   navigateur si cette URL a déjà été ouverte. Les deux origines sont servies
   par Caddy et peuvent conserver un état distinct.
7. Fermer l’onglet, rouvrir la même origine, puis se connecter avec le
   mot de passe factice.

Dans Firefox ou Safari, utiliser l'équivalent **Données de sites / Gérer les
données**, supprimer toutes les entrées `localhost`, puis fermer et rouvrir le
navigateur. La preuve recherchée est la même : aucune base IndexedDB, aucun
cookie, cache, service worker ou PWA de l'ancien déploiement ne subsiste.

## 3. Ce que le jeu de données garantit

Le seed ne signale « ready » qu'après avoir vérifié :

- 240 éléments uniques : 8 dossiers, 190 pages, 1 base structurée, 40 tâches
  et 1 vrai fichier Markdown attaché ;
- 243 occurrences de relations actives : 201 liens issus des documents et 42
  relations métier explicites ;
- 190 documents lisibles rangés en arbre dans 8 dossiers (vue d'ensemble,
  sections, notes filles) ; 163 pages portent un lien interne, 19 en portent
  deux, et 8 pages isolées n'en portent aucun ;
- une correspondance exacte, vérifiée après écriture, entre chaque cible
  déclarée dans un document et chaque relation canonique `page:link` ;
- cinq composantes de connaissance : huit arbres de branche reliés par trois
  passerelles entre vues d'ensemble ;
- 8 pages racines réellement isolées ;
- des doublons intentionnels, relations réciproques, cycles, liens entre
  branches et un type futur inconnu `future:semantic` ;
- une base de tâches avec statuts, échéances et priorités ;
- un élément connecté placé à la corbeille ;
- aucune relation orpheline.

Les identités changent à chaque recréation, mais les comptes et les invariants
restent identiques. C'est ce qui permet de rejouer le protocole sans dépendre
d'une ancienne sauvegarde.

Avant une release, la preuve destructive complète des dix générations peut être
rejouée avec `bun run dev:stack:demo:verify`. Elle effectue dix fois le reset,
le seed et tous ses contrôles, puis conserve le dixième workspace prêt à être
inspecté. Cette commande prend plusieurs minutes et reste soumise aux mêmes
garde-fous locaux.

## 4. Contrôle manuel conseillé

1. Ouvrir le graphe global : seule la couche « Connaissances » doit être active.
   Le réseau doit ressembler à plusieurs arbres (notes filles → sections → vue
   d'ensemble), pas à une pelote unique. Les arêtes de dossiers n'apparaissent
   que si la couche « Hiérarchie » est activée.
2. Sélectionner une passerelle entre deux vues d'ensemble, ouvrir la page
   source et retrouver le lien interne portant exactement le nom de la cible.
3. Faire glisser le fond de la carte, zoomer à la molette autour du pointeur,
   survoler un nœud pour atténuer le reste, cliquer pour l'inspecter puis
   double-cliquer pour ouvrir sa page.
4. Déplacer une page vers un autre dossier : le réseau « Connaissances » doit
   rester identique. Activer « Hiérarchie » pour voir uniquement cette couche
   structurelle refléter le déplacement.
5. Tester la carte, puis les filtres de statut, échéance et priorité.
6. Afficher les isolés, les doublons, les relations réciproques et le type
   `future:semantic`.
7. Ouvrir un graphe local à profondeur 1 puis 2 et revenir au global.
8. Vérifier le cas de la cible à la corbeille avec et sans contenu masqué.
9. Réduire la fenêtre à 320 px et confirmer que la carte reste exploitable.
10. Attendre une synchronisation complète, couper le réseau et vérifier la
   dernière vue sûre, puis reconnecter.

Pour recommencer depuis zéro, répéter d'abord `bun run dev:stack:demo`, puis la
réinitialisation navigateur. Les deux moitiés sont nécessaires.
