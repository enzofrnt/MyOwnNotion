# Plan d'implémentation — parité des types de propriété

**Feature**: 055-property-type-parity | **Date**: 2026-11-06 | **Spec**: `spec.md`

## Résumé

Étendre le modèle de propriété par un `config` discriminé par type, exposer un
panneau de configuration latéral dans le menu de colonne, puis implémenter les
rendus/éditeurs/calculs par type. Commencer par la fondation et Nombre, puis
Dates, État, Identifiant, Agrégation, Fichiers, Formule, Lieu.

## Contexte technique

- Bun + TypeScript, React 19, Vite, PostgreSQL/Drizzle, Ariakit, Vitest, Playwright.
- `packages/domain` : `DatabaseProperty`, schéma, commandes, valeurs, requêtes.
- `apps/api` : persistance et endpoints des bases.
- `apps/web` : `database.css`, `table-view.tsx`, `property-configuration.tsx`,
  éditeurs de cellules, panneaux de vue.
- Fichiers : stockage protégé existant (`apps/api/src/files`, blobs).
- Google : Places API (recherche/adresse) + Maps JavaScript (vue Carte).
  Variables : `MYOWNNOTION_GOOGLE_MAPS_API_KEY` (serveur, Places) et
  `MYOWNNOTION_GOOGLE_MAPS_BROWSER_KEY` (navigateur, Maps JS restreinte).
  Sans clé : recherche indisponible avec un message explicite.
- Formule : évaluateur typé côté web/domaine, sans IA ; interface éditeur.

## Contrôles constitution

- Single-user : aucune identité supplémentaire.
- Confidentialité : clés non journalisées ; lieux et fichiers restent locaux.
- Résilience locale : valeurs stockées localement ; Google est un enrichissement,
  pas le seul chemin de lecture ; la carte se dégrade proprement.
- Toolchain Bun ; tests/format/types bloquants.
- UI quality + notion-parity : captures, états, clair/sombre, clavier.

## Architecture

1. **Domaine** : configs typées (`NumberConfig`, `DateConfig`, `StatusConfig`,
   `UniqueIdConfig`, `RollupConfig`, `PlaceConfig`), validation de schéma,
   valeurs par défaut pour les propriétés existantes, helpers de lecture.
2. **API** : sérialisation des configs, validation, migration des données
   existantes, endpoints Google Places (proxy serveur) et upload fichiers.
3. **Web** : panneau `Modifier la propriété` (popover latéral) + formulaires
   par type ; formatage des cellules ; éditeurs (date, état, lieu, formule) ;
   vue Carte ; limites fichiers.
4. **Google** : proxy Places côté API (secret serveur) ; carte côté web avec clé
   navigateur restreinte ; pins et popup ; chargement paresseux.
5. **Formule** : éditeur type Notion (propriétés, fonctions/docs, aperçu,
   débogage, type), évaluateur typé sans IA ; palier 1 = opérateurs + propriétés
   + fonctions de base, palier 2 = couverture complète.
6. **Tests** : domaine (config, validation, calculs), web (rendu/édition),
   intégration API, Playwright pour les surfaces et Google si clé.

## Phases

- P0 Fondation : config panel + menu + captures ; aucun changement de données.
- P1 Nombre + Dates.
- P2 État + Identifiant.
- P3 Agrégation.
- P4 Fichiers.
- P5 Formule.
- P6 Lieu + Carte (clé Google).
- P7 Tests/validation/preuves, convergence.

## Risques

- Volume de la formule (langage complet) : phaser, interface d'abord.
- Google Maps : clé/quotas/coût ; consentement et restriction de clé.
- Limites fichiers : notre app n'a pas de notion de plan ; appliquer les limites
  Notion documentées (5 Mo gratuit ; PDF 20 Mo et images 5 Mo payant) via une
  configuration de déploiement, par défaut les limites payantes documentées.
- Migration des propriétés existantes : ajouter des défauts sans réécrire les
  valeurs ; tester les bases existantes.

## Preuves attendues

Captures Notion/candidat dans `.notion-lab/parity/`, `evidence/`, tests,
`validation.md` ; comparaison structure/styles/états.
