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

- URL : `https://localhost:8443`
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
3. Ouvrir les outils de développement sur `https://localhost:8443`.
4. Dans **Application > Service Workers**, désinscrire le service worker.
5. Dans **Application > Storage**, choisir **Clear site data** en incluant
   cookies, Local Storage, Session Storage, IndexedDB et Cache Storage.
6. Supprimer aussi les données du site `http://localhost:8080` dans les
   paramètres de confidentialité du navigateur si cette URL a déjà été
   ouverte. Elle redirige vers HTTPS, mais peut conserver son propre état.
7. Fermer l'onglet, rouvrir `https://localhost:8443`, puis se connecter avec le
   mot de passe factice.

Dans Firefox ou Safari, utiliser l'équivalent **Données de sites / Gérer les
données**, supprimer toutes les entrées `localhost`, puis fermer et rouvrir le
navigateur. La preuve recherchée est la même : aucune base IndexedDB, aucun
cookie, cache, service worker ou PWA de l'ancien déploiement ne subsiste.

## 3. Ce que le jeu de données garantit

Le seed ne signale « ready » qu'après avoir vérifié :

- 240 éléments uniques : 8 dossiers, 190 pages, 1 base structurée, 40 tâches
  et 1 vrai fichier Markdown attaché ;
- 480 occurrences de relations actives : 120 liens issus de documents et 360
  relations explicites ;
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

1. Ouvrir le graphe global et comparer les compteurs avec les valeurs ci-dessus.
2. Tester la carte et la liste, puis les filtres de statut, échéance et priorité.
3. Afficher les isolés, les doublons, les relations réciproques et le type
   `future:semantic`.
4. Ouvrir un graphe local à profondeur 1 puis 2 et revenir au global.
5. Vérifier le cas de la cible à la corbeille avec et sans contenu masqué.
6. Réduire la fenêtre à 320 px et confirmer que la liste reste exploitable.
7. Attendre une synchronisation complète, couper le réseau et vérifier la
   dernière vue sûre, puis reconnecter.

Pour recommencer depuis zéro, répéter d'abord `bun run dev:stack:demo`, puis la
réinitialisation navigateur. Les deux moitiés sont nécessaires.
