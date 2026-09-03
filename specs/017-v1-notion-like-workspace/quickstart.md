# Quickstart: Implémenter et vérifier la feature 017


> **Chaîne actuelle (feature 019, livrée)** : Bun 1.4.0 exclusivement. Installer
> avec `bun ci` et orchestrer avec `bun run`. Les mentions de pnpm ou Node.js
> plus bas décrivent l'époque de construction de cette feature ; elles ne sont
> plus la procédure à exécuter. Guide vivant :
> [`docs/development.md`](../../docs/development.md).

Ce guide décrit l'ordre sûr de construction. Il ne remplace ni `tasks.md`, ni
l'inventaire des gates dans `docs/development.md`.

## 1. Préparer l'environnement

Depuis la racine du dépôt, utiliser Bun 1.4.0, verrouillé par le dépôt :

~~~bash
bun install --frozen-lockfile
docker compose up -d --wait postgres
bun run db:migrate
~~~

Avant une tranche, lire dans cet ordre : constitution, canevas produit, spec,
plan, data model et le contrat directement concerné. Ne pas commencer par
modifier l'éditeur : le modèle opérationnel et sa projection sont la première
preuve requise.

## 2. Construire par tranches verticales

### Tranche A — Modèle opérationnel pur

Créer `packages/page-state` sans dépendance React, BlockNote, Dexie, Fastify ou
Drizzle. Implémenter :

1. arbre de blocs stable et texte riche ;
2. commandes minimales ;
3. export/import d'updates et checkpoints ;
4. projection canonique v3 ;
5. détection d'intentions incompatibles ;
6. migration v2 pure et branche legacy sémantique.

La tranche est terminée seulement si les propriétés suivantes passent avec des
ordres d'import aléatoires : même paragraphe, même position, marques, blocs
distincts, arbres imbriqués, moves concurrents, move+edit, delete+edit et
tables/cellules.

~~~bash
pnpm exec vitest run --project page-state
pnpm exec vitest run --project page-state --grep "conver"
~~~

Les noms de projet/test peuvent être ajustés au branchement Vitest final ; les
tests doivent rester exécutables isolément et depuis les gates globales.

### Tranche B — Durabilité locale

Ajouter la version Dexie suivante sans modifier les versions historiques.
Tester chaque point de crash : avant chiffrement, après chiffrement, après row
update, avant frontier et après commit. À chaque reprise, l'état doit être soit
avant, soit après la transaction, jamais partiel.

Vérifier aussi quota, rotation de clé, deux onglets, fermeture/rechargement et
une branche v2 créée entièrement hors ligne.

~~~bash
pnpm exec vitest run --project client-core page-operation
pnpm exec vitest run --project web editor-sync
~~~

### Tranche C — Serveur et protocole

Ajouter la migration SQL et le repository avant d'exposer les routes. Sous
verrou de page, prouver l'atomicité de : update, checkpoint, projection, liens,
fichiers, révision et change feed.

Le serveur annonce le protocole 3 avec les en-têtes existants. La compatibilité
globale peut encore autoriser les commandes v2 inchangées ; les routes
opérationnelles exigent v3 et `page.document.replace` refuse une page active.

~~~bash
pnpm test:migration
pnpm exec vitest run --project database-integration page-operation
pnpm exec vitest run --project api-contract page-operation
~~~

### Tranche D — Sauvegarde, restauration et rétention

Étendre le manifeste avant d'autoriser la compaction. Restaurer dans une base
jetable, reproduire la projection/digest, puis importer une update plus récente
provenant d'un appareil resté hors ligne.

La compaction doit refuser si un appareil autorisé n'a pas dominé la frontier,
si une ambiguïté dépend de l'update ou si la sauvegarde vérifiée manque.

~~~bash
pnpm test:reference-backups
pnpm exec vitest run --project database-integration --grep "checkpoint|frontier|restore"
~~~

### Tranche E — Adaptateur et autosauvegarde

Installer toutes les dépendances BlockNote Community à la même version exacte
et Loro à une version exacte. Vérifier les licences ; ne jamais installer
`@blocknote/xl-*`.

Brancher d'abord paragraphes et titres, puis listes/checkbox/code/quote,
ensuite table, toggle, callout, image, fichier et embed. Chaque ajout exige son
round-trip canonique et son scénario offline avant le suivant.

Le bouton de sauvegarde disparaît seulement lorsque le commit local chiffré,
la reprise et les états d'erreur sont prouvés.

### Tranche F — Système visuel et parcours complets

Ajouter tokens et primitives, puis migrer shell, navigation, éditeur et les
autres surfaces V1. Ne pas maintenir deux composants généraux équivalents après
la migration d'une surface.

Capturer clair/sombre, desktop/mobile et tester zoom 200 %, focus, reduced
motion et clavier avant de supprimer les styles historiques.

Pour la convergence d'interface courante, vérifier dans cet ordre :

1. les préférences locales et indépendantes de `Favoris`/`Récents`, leurs
   interrupteurs et chevrons placés avant les libellés, puis le libellé
   `Notes` ;
2. les trois zones avant/dans/après sur plusieurs niveaux de l'arbre, avec
   indicateur avant la mutation ; déplacer le dernier enfant d'une page doit
   aussi rendre cette page à son état de feuille sans message vide ;
3. un titre vidé pendant plus de deux secondes qui reste vide jusqu'à la
   sortie du champ ;
4. le témoin de synchronisation épinglé en bas qui ne change jamais la position
   du titre ou du premier bloc ;
5. un emoji facultatif ajouté à une page et à un dossier, puis changé et
   retiré hors ligne ; l'arbre, l'en-tête, la recherche et chaque référence
   interne doivent toujours résoudre la même identité, tandis que le chevron
   d'une branche remplace l'icône dans la même boîte sans déplacer le texte ;
6. un lien de page créé par son action dédiée au clavier, retargeté et retiré :
   son libellé doit suivre le titre courant de la cible, son icône doit suivre
   l'emoji courant et seule une référence hors de la filiation directe porte
   le badge de lien ;
7. un bookmark Web créé par son action dédiée avec une URL valide, refusé avec
   une URL invalide, puis modifié et retiré ; il doit occuper une ligne entière,
   rester lisible hors ligne et ne jamais devenir un embed interactif implicite ;
8. une ligne vide et une saisie suivant la suppression complète d'un lien sur
   Chromium, Firefox et WebKit : le caret doit rester visible et le nouveau
   texte ne doit porter aucune ancienne relation.
9. un document et une arborescence plus hauts que le viewport : faire défiler
   le contenu puis l'arbre et vérifier que le document racine, le chrome, la
   barre latérale et son pied ne changent pas de position ;
10. masquer la barre latérale : sa commande de réouverture doit rester dans la
    ligne supérieure, sans recouvrir le titre, puis rendre le focus à la
    commande de fermeture après réouverture ;
11. créer une page et un dossier depuis le `+` du titre Notes, depuis le `+` d'une ligne,
    puis une sous-page avec `/page` : aucun champ de nom préalable, chaque
    nouvel item s'ouvre avec un titre vide ciblé et devient `Sans titre`
    uniquement après sortie sans saisie ;
12. prolonger artificiellement l'ouverture d'une page : le titre reste présent,
    seul un squelette éditorial neutre apparaît et aucun grand statut orange ne
    prend la place du document ;
13. créer une référence de page, supprimer au clavier toute sa ligne, saisir du
    texte normal, attendre le drainage et une adoption distante : la référence
    ne doit jamais réapparaître à la suite du texte.

Ces parcours visent l'ergonomie personnelle de base : clavier, focus visible,
pointeur et toucher. Ils n'ouvrent pas de campagne VoiceOver ou de conformité
formelle.

## 3. Scénario manuel multi-appareils minimal

Utiliser deux profils navigateur isolés A et B, pas deux onglets du même profil :

1. connecter A et B, ouvrir la même page et attendre `Synchronisé` ;
2. passer les deux contextes hors ligne ;
3. dans A, déplacer un bloc et modifier son début ;
4. dans B, modifier la fin du même bloc et ajouter un bloc voisin ;
5. fermer brutalement A ;
6. reconnecter B, attendre la confirmation serveur ;
7. rouvrir A hors ligne et vérifier que son travail est présent localement ;
8. reconnecter A ;
9. vérifier même texte, IDs et ordre dans les deux profils ;
10. recharger les deux profils et répéter avec delete+edit ;
11. vérifier que delete+edit crée une décision récupérable, pas une perte ;
12. ajouter une image hors ligne et vérifier séparément contenu puis octets.

Le statut `Synchronisé` est valide uniquement si la frontier serveur domine
l'état local persistant et si les fichiers référencés sont présents.

## 4. Matrice automatisée

Les suites ciblées doivent couvrir au moins :

| Couche | Preuve |
| --- | --- |
| modèle | convergence indépendante de l'ordre, IDs, texte/marks, tree, tombstones |
| projection | v2→v3, unknown, fileEmbed, JSON/digest déterministes |
| local | chiffrement, commit atomique, quota, crash, onglets |
| API | idempotence, dépendances, révocation, activation, branche legacy |
| base | contraintes, verrou, rollback, checkpoints, frontiers |
| backup | archive/restauration + appareil hors ligne plus récent |
| éditeur | origine distante sans écho, sélection, IME, move+edit |
| E2E | deux profils offline, reconnect, fichiers, ambiguïtés |
| visuel/a11y | 5 projets navigateur, thèmes, 320 px, zoom 200 % |
| performance | 500 blocs, 10 000 updates, batch réseau, mémoire |

Pour un retour rapide, lancer les fichiers Vitest ciblés et un petit nombre de
journeys Playwright. La matrice navigateur ciblée peut utiliser cinq profils en
parallèle ; le corpus Playwright complet reste à deux stacks en parallèle,
limite mesurée et documentée dans `docs/development.md`.

~~~bash
MYOWNNOTION_E2E_JOBS=5 bun run test:e2e:local -- --grep "offline page convergence"
bun run test:e2e:gate
~~~

## 5. Gate avant push

Une modification uniquement documentaire exécute les checks documentaires
définis dans `docs/development.md`. Dès qu'une dépendance, migration, source,
configuration, fixture ou référence visuelle change, la modification est mixte
et exige le gate complet :

~~~bash
bun run checks:local
~~~

Ne jamais déclarer une tranche terminée parce que le CRDT converge seul : la
durabilité chiffrée, la projection, les fichiers, les sauvegardes et le rendu
éditeur font partie de la même promesse utilisateur.

## 6. Activation et retour arrière

- Une lecture ne migre aucune page.
- La première écriture v3 active une page atomiquement.
- Une page active garde une projection lisible par l'ancien serveur/client,
  mais devient read-only pour leurs écritures de corps.
- Un déploiement ne retire pas le chemin legacy tant que migration, restauration
  et branches hors ligne ne passent pas toute la matrice.
- Revenir au binaire v2 autorise la lecture ; reprendre des écritures v2 après
  activation exige une restauration explicite de la sauvegarde pré-migration.
