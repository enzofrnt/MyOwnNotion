# Quickstart: valider la recherche initiale

Ce guide décrit les preuves attendues. Il ne remplace ni tasks.md, ni le gate
local complet.

## Prérequis

1. Les features 001 à 007 sont présentes, avec la 007 fusionnée avant
   l'intégration finale.
2. PostgreSQL de développement est prêt et les migrations existantes passent.
3. L'installation possède un propriétaire et une clé de déploiement valides.
4. Les dépendances sont installées avec pnpm 10.33.3.

## 1. Recherche complète

Préparer :

- une page dont le titre contient « Architecture résiliente » ;
- une autre page dont seul le corps contient « reprise atomique » ;
- un dossier et un fichier homonymes dans deux branches.

Vérifier :

1. Le titre exact précède la correspondance de corps.
2. « resiliente » trouve « résiliente ».
3. Le nom de fichier indique le type file.
4. Le filtre de type et le filtre de branche retirent les homonymes hors portée.
5. Ouvrir un résultat conserve son itemId et navigue vers son chemin courant.

Commande ciblée attendue :

~~~bash
pnpm test:contract -- search
pnpm test:e2e -- --grep "workspace search"
~~~

## 2. Recherche locale et changements en attente

1. Charger deux pages et décharger le corps de l'une.
2. Couper le réseau.
3. Modifier le titre et le corps de la page locale.
4. Rechercher immédiatement les nouvelles valeurs.
5. Rechercher une expression présente uniquement dans le corps déchargé.

Résultat attendu :

- la modification locale est trouvée ;
- la page déchargée est trouvée par titre mais pas par son corps absent ;
- l'interface annonce local-only ;
- aucun résultat n'est présenté comme complet.

Puis reconnecter et vérifier qu'une même identité n'apparaît qu'une fois et que
la version locale en attente n'est pas remplacée par une ancienne réponse.

## 3. Cycle de vie

Pour un même item, exécuter renommage, déplacement, conversion, corbeille,
restauration et suppression définitive.

Après chaque étape :

- même itemId après renommage, déplacement et conversion ;
- chemin courant hydraté, jamais l'ancien ;
- corps retiré après page vers dossier ;
- aucun résultat actif dans la corbeille ;
- résultat de nouveau présent après restauration ;
- aucun titre ou extrait après purge.

## 4. Reconstruction et intégrité

1. Démarrer sans génération d'index.
2. Observer building sans réponse serveur partielle.
3. Interrompre une reconstruction puis redémarrer.
4. Vérifier l'échange atomique vers ready.
5. Injecter une enveloppe impossible à ouvrir.

Résultat attendu :

- le reste de l'application reste utilisable ;
- la recherche complète reste rebuilding ou degraded ;
- aucune entrée partielle n'est annoncée comme complete ;
- la réparation reconstruit exactement les identités canoniques.

## 5. Confidentialité

Utiliser une requête, un titre et un extrait sentinelles distinctifs.

Inspecter :

- URL et historique navigateur ;
- logs API et Compose ;
- diagnostics et erreurs ;
- base PostgreSQL ;
- IndexedDB après fermeture et redémarrage.

Aucune sentinelle ne doit apparaître dans une URL, un journal ou un index
persisté en clair. Les contenus canoniques et locaux restent des enveloppes
protégées.

## 6. Accessibilité et responsive

Dans chaque projet Playwright :

1. Ouvrir au clavier.
2. Saisir, filtrer, parcourir, ouvrir puis fermer.
3. Vérifier le retour de focus.
4. Répéter à 320 px et 200 % de zoom.
5. Vérifier les annonces local-only, loading, complete, no-results et error.

## 7. Performance de référence

Générer 100 000 pages, 1 000 000 de blocs et 50 000 noms de fichiers sans
contenu réel sensible.

Mesurer :

~~~bash
pnpm test:performance -- search
~~~

Le rapport doit enregistrer :

- p50/p95 des 20 premiers résultats serveur ;
- p50/p95 sur 10 000 items locaux ;
- durée et mémoire d'une reconstruction ;
- délai d'un upsert local et serveur ;
- zéro doublon sur 10 000 mutations/replays.

## 8. Gate avant push

Cette feature modifie code, dépendances et contrats exécutables. Le gate final
est donc :

~~~bash
pnpm checks:local
~~~

Un échec, une interruption ou un contrôle indisponible bloque le push.
