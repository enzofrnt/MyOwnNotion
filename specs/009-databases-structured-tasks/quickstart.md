# Quickstart: valider les bases de données et tâches structurées

Ce guide décrit les preuves attendues. Il ne remplace ni `tasks.md`, ni le
gate local complet.

## Prérequis

1. Les features 001 à 008 sont présentes.
2. PostgreSQL de développement est prêt et les migrations existantes passent.
3. L'installation possède un propriétaire, un appareil autorisé et les clés de
   déploiement/locales utilisables.
4. Les dépendances sont installées avec pnpm 10.33.3 et Node.js 24.

## 1. Base, schéma et entrées-pages

Créer « Projets » dans un dossier, puis :

1. vérifier la propriété titre et la première vue table ;
2. ajouter texte, nombre, date civile, instant, statut, sélection,
   multi-sélection, checkbox et relation ;
3. créer trois entrées avec un document éditorial et des valeurs différentes ;
4. ouvrir une entrée, modifier ses blocs puis revenir à la même cellule ;
5. renommer et déplacer la base puis une entrée.

Résultat attendu :

- `databaseId === itemId` pour la page hôte ;
- `entryId === itemId` pour chaque page d'entrée ;
- appartenance, placement et relation sont trois liens distincts ;
- les valeurs sont identiques dans toutes les vues ;
- aucun renommage ou déplacement ne change une identité.

Tests ciblés attendus :

~~~bash
pnpm test:unit -- databases
pnpm test:integration -- database
pnpm test:contract -- database
pnpm test:e2e -- --grep "database schema and entries"
~~~

## 2. Valeurs, conversion et impact

Pour chaque type :

1. accepter une valeur valide ;
2. soumettre une valeur invalide et vérifier que la saisie reste présente ;
3. vérifier valeur absente, zéro, faux et chaîne vide ;
4. renommer/réordonner options et propriétés ;
5. demander conversion ou retrait alors que des valeurs existent.

Résultat attendu :

- décimaux identiques entre interface française, stockage et filtre ;
- date civile inchangée après changement de fuseau ;
- instant affiché selon le fuseau mais comparé en UTC ;
- options référencées par UUID ;
- aperçu d'impact exact avant confirmation ;
- changement concurrent entre aperçu et commit refusé ;
- valeur incompatible préservée ou supprimée uniquement selon la décision.

## 3. Vues et déterminisme

Créer une vue table, liste, Kanban, galerie et calendrier sur les mêmes entrées.
Configurer :

- une combinaison ALL puis ANY ;
- des opérateurs de chaque famille ;
- trois tris avec valeurs égales et absentes ;
- un groupe statut, sélection puis checkbox ;
- des propriétés visibles et ordres différents par vue.

Comparer le résultat du serveur, de deux navigateurs et de la projection locale.

Résultat attendu :

- ensemble d'`entryId`, groupes et ordre identiques à état canonique identique ;
- aucune entrée dupliquée entre pages ;
- départage final stable par titre canonique puis UUID ;
- propriété masquée toujours conservée ;
- curseur ancien refusé après modification de vue au lieu de produire un
  mélange.

## 4. Tâches structurées

Créer « Tâches » avec statut, échéance, priorité et relation projet. Mapper les
trois rôles puis :

1. créer une tâche et écrire des notes dans sa page ;
2. changer son statut dans le panneau ;
3. la déplacer au clavier puis au pointeur dans le Kanban ;
4. déplacer son échéance au clavier puis au pointeur dans le calendrier ;
5. modifier sa priorité depuis la table ;
6. cocher une case dans son document.

Résultat attendu :

- une seule page et une seule identité ;
- toutes les vues et la recherche reflètent les mêmes propriétés ;
- les notes et pièces jointes restent ordinaires ;
- la checkbox éditoriale ne crée, ne modifie ni ne supprime aucune tâche.

## 5. Offline, reprise et couverture partielle

1. Charger complètement une base et l'épingler hors ligne.
2. Couper le réseau, modifier définition, vue et valeurs, puis tuer/recharger le
   navigateur.
3. Vérifier les modifications avant reconnexion et le rejeu idempotent.
4. Répéter avec une base non épinglée dont certaines valeurs sont déchargées.

Résultat attendu :

- chaque confirmation locale survit au redémarrage ;
- aucune mutation rejouée ne duplique entrée, option, vue ou relation ;
- la base épinglée est complète ;
- la base partielle affiche X/Y et ne présente pas groupes/totaux comme
  exhaustifs ;
- la réponse distante ne remplace pas une version locale pending/conflict.

## 6. Synchronisation et conflits

Sur deux appareils issus du même état :

1. modifier deux propriétés distinctes d'une entrée ;
2. modifier deux vues distinctes ;
3. modifier différemment la même valeur ;
4. supprimer une propriété d'un côté et l'éditer de l'autre ;
5. changer le type d'une propriété pendant qu'une valeur de l'ancien type est
   écrite.

Résultat attendu :

- cas 1 et 2 fusionnés automatiquement ;
- cas 3 à 5 en conflit explicite ;
- ancêtre, local et distant consultables ;
- résolution sous une nouvelle révision à deux parents ;
- aucune version source altérée ou supprimée.

## 7. Corbeille et restauration

1. Mettre une entrée à la corbeille puis la restaurer.
2. Demander la mise à la corbeille d'une base de plusieurs entrées.
3. Vérifier le nombre annoncé puis confirmer.
4. Interrompre artificiellement la transaction avant commit.
5. Réessayer, puis restaurer la base.

Résultat attendu :

- une entrée trashed disparaît de toutes les vues mais garde son appartenance ;
- aucune base partiellement mise à la corbeille n'est observable ;
- hôte et entrées retrouvent les mêmes identités, définition, valeurs,
  relations et historique ;
- une purge canonique simulée retire les projections dérivées sans ajouter de
  bouton ou worker de purge à 009.

## 8. Recherche, export, sauvegarde et restauration

Utiliser des sentinelles distinctes dans :

- propriété texte ;
- option de statut ;
- option de priorité ;
- échéance ;
- relation.

Vérifier :

1. recherche par propriété avec `entryId` et `propertyId` ;
2. une entrée unique même si cinq vues la montrent ;
3. exclusion après corbeille et retour après restauration ;
4. export versionné puis import compatible ;
5. sauvegarde de référence, validation, restauration vide et reconstruction de
   la projection.

Le digest restauré doit retrouver exactement identités, propriétés, options,
vues, rôles, valeurs et relations avant l'état sain.

## 9. Confidentialité

Utiliser des noms, filtres et valeurs sentinelles. Inspecter :

- URLs et historique navigateur ;
- logs API, Compose, diagnostics et erreurs ;
- colonnes PostgreSQL et index ;
- IndexedDB après fermeture ;
- export et sauvegarde avant ouverture autorisée.

Résultat attendu :

- aucune sentinelle privée dans URL ou journal ;
- seulement IDs/types/métadonnées structurelles lisibles au repos ;
- définitions et valeurs sous enveloppes applicatives ;
- aucune projection structurée ou clé de tri sérialisée ;
- une enveloppe corrompue provoque un refus/degraded, jamais un fallback en
  clair ni une vue prétendument complète.

## 10. Accessibilité et responsive

Dans chaque projet Playwright :

1. créer une entrée, éditer une cellule et changer de vue sans pointeur ;
2. appliquer filtre, tri et groupe ;
3. déplacer une carte Kanban et une date par leurs actions clavier ;
4. ouvrir/fermer le panneau et vérifier le retour de focus ;
5. répéter à 320 px et 200 % ;
6. contrôler noms, rôles, états et annonces ;
7. exécuter axe sur chaque parcours essentiel.

La table doit respecter le mode navigation/édition du contrat UI ; aucune vue ne
doit dépendre uniquement de la couleur, de la position ou du drag-and-drop.

## 11. Performance de référence

Générer 100 000 entrées, 40 propriétés variées, 20 vues et 100 000 relations,
sans contenu réel sensible. Mesurer :

~~~bash
pnpm test:performance -- databases
~~~

Le rapport enregistre :

- reconstruction serveur et locale, mémoire maximale et refus atomique ;
- p50/p95 de la première page de 100 lignes pour chaque vue ;
- p50/p95 filtres, tris et groupes sélectifs/non sélectifs ;
- p50/p95 d'une mise à jour locale et d'un upsert serveur ;
- stabilité des curseurs sous 10 000 mutations ;
- zéro duplication et zéro divergence serveur/local.

La première page doit être utilisable en moins d'une seconde au p95 et la
modification locale visible en moins de 300 ms au p95 sur l'environnement de
référence documenté par le test.

## 12. Migration et compatibilité

1. Migrer une base 008 avec items, révisions, relations, sauvegardes et outbox
   non vide.
2. Interrompre/reprendre la migration.
3. Vérifier qu'aucune page existante n'acquiert une capacité base.
4. Tester client courant, client stable précédent en lecture sûre et écriture
   structurée incompatible.
5. Restaurer une sauvegarde pré-009 puis une sauvegarde 009.

Un client incompatible reste en lecture explicitement limitée et ses écritures
structurées sont refusées sans toucher son outbox.

## 13. Gate avant push

Cette feature modifie code, dépendances, migrations, contrats et builds. Le gate
final est :

~~~bash
pnpm checks:local
~~~

Un échec, une interruption ou un contrôle requis indisponible bloque le push.
