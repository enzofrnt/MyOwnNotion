# Quickstart: Implémenter et vérifier la feature 017

Ce guide décrit l'ordre sûr de construction. Il ne remplace ni `tasks.md`, ni
l'inventaire des gates dans `docs/development.md`.

## 1. Préparer l'environnement

Depuis la racine du dépôt, utiliser Node 24 et la version pnpm verrouillée :

~~~bash
corepack enable
pnpm install --frozen-lockfile
docker compose up -d --wait postgres
pnpm db:migrate
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
MYOWNNOTION_E2E_JOBS=5 pnpm test:e2e:local -- --grep "offline page convergence"
pnpm test:e2e:gate
~~~

## 5. Gate avant push

Une modification uniquement documentaire exécute les checks documentaires
définis dans `docs/development.md`. Dès qu'une dépendance, migration, source,
configuration, fixture ou référence visuelle change, la modification est mixte
et exige le gate complet :

~~~bash
pnpm checks:local
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
