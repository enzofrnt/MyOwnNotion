# Implementation Plan: URLs canoniques de l’application

**Branch**: `codex/app-url-routing` | **Date**: 2026-08-30 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/020-app-url-routing/spec.md`

## Summary

Introduire un routeur navigateur standard afin que l’installation, la connexion, le workspace, chaque page/dossier/entrée et chaque section de réglages possèdent une destination canonique. La route devient l’unique source de vérité de la page affichée. Le workspace reste monté mais masqué pendant les réglages pour préserver les brouillons, le focus et l’ancre de lecture ; sa sélection devient contrôlée par `/notes/:itemId`. Les paramètres de vue de base restent dans la requête, les ouvertures d’entrées deviennent de vraies navigations, les liens directs protégés reprennent une destination interne validée après authentification, et le shell précaché répond aussi aux routes hors ligne.

## Technical Context

**Language/Version**: TypeScript strict, React 19.2.4, Bun 1.4.0 exactement

**Primary Dependencies**: React Router DOM 7.18.2 en mode déclaratif ; React/React DOM existants ; Dexie et client-core existants ; Workbox 7.4.1 pour le shell hors ligne

**Storage**: Aucun nouveau stockage canonique. Dexie reste l’autorité locale du contenu et des préférences de navigation ; `history.state` et `sessionStorage` ne conservent que du contexte transitoire propre à l’onglet.

**Testing**: Vitest/jsdom et tests de composants, tests contractuels du build/service worker/nginx, Playwright sur les cinq profils maintenus et viewports desktop/étroit

**Target Platform**: SPA Web responsive servie par Vite en développement et nginx dans l’image Compose, largeur minimale 320 px, deux dernières versions majeures de Chrome/Edge/Firefox/Safari selon la matrice existante

**Project Type**: Monorepo Web + API ; changement limité au client Web, à ses contrats de distribution et à leurs tests

**Performance Goals**: Navigation locale sans attente réseau ; aucune remonte de l’éditeur lors d’un changement de paramètres de vue ; résolution d’une route parmi 100 000 métadonnées sans introduire de parcours supplémentaire par rapport à la projection locale existante

**Constraints**: Local-first, session hors ligne existante conservée, URL sans contenu privé ni titre, identités UUID stables, aucune migration de données, historique arrière/avant natif, `/__ui-lab` isolé, API et application sur la même origine

**Scale/Scope**: 12 formes de destinations utilisateur, toutes les entrées de navigation du workspace, 6 sections de réglages, pages/dossiers/bases/entrées adressés à l’échelle V1 de 100 000 pages

## Constitution Check

*GATE initial puis post-design : PASS.*

- **I. User Ownership and Local Resilience — PASS** : une route locale n’attend pas le réseau ; le service worker sert le shell et Dexie résout les contenus présents. Une note absente reste explicitement indisponible sans perte ni remplacement.
- **II. One Spec, Any Agent — PASS** : tous les artefacts vivent uniquement dans `specs/020-app-url-routing/` et référencent les sections produit 2.13, 6.1, 7, 10–12, 18, 39, 42, 43 et 47.
- **III. Incremental, Verifiable Delivery — PASS** : tests de reconnaissance pure, composants, distribution et journeys Playwright précèdent les changements correspondants ; les tâches restent organisées par parcours indépendant.
- **IV. Privacy and Security by Default — PASS** : les URLs ne contiennent que des identifiants canoniques non secrets ; les retours d’authentification sont limités aux routes internes reconnues ; aucun contenu, session ou clé n’entre dans l’URL ou les journaux.
- **V. Simple, Modular Architecture — PASS** : un routeur client mature remplace plusieurs états et écritures History API concurrents, sans service ni abstraction serveur supplémentaires.
- **VI. Practical and Predictable Experience — PASS** : précédent/suivant, rechargement, liens, focus et scroll deviennent prévisibles ; les liens et destinations conservent des libellés explicites et le clavier existant.
- **VII. Reproducible Toolchains and Enforced Quality — PASS** : dépendances exactes installées par Bun 1.4.0, `bun.lock` mis à jour, contrôles locaux complets et matrice Playwright obligatoires.
- **VIII. Canonical Product Direction — PASS** : le plan renforce la frontière connaissance/réglages et l’identité stable après renommage, déplacement ou conversion.

### Post-design re-check

PASS sans exception. Le design n’ajoute ni stockage canonique, ni permission, ni service, ni migration. Les seuls nouveaux états sont des destinations de navigation et un contexte d’onglet transitoire.

## Project Structure

### Documentation (this feature)

```text
specs/020-app-url-routing/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── routing.md
├── checklists/
│   └── requirements.md
└── tasks.md
```

### Source Code (repository root)

```text
apps/web/
├── package.json
├── src/
│   ├── main.tsx
│   ├── app.tsx
│   ├── service-worker.ts
│   ├── routing/
│   │   ├── app-router.tsx
│   │   ├── paths.ts
│   │   └── return-destination.ts
│   └── features/
│       ├── routing/
│       │   └── not-found-page.tsx
│       ├── hierarchy/hierarchy-explorer.tsx
│       ├── settings/settings-shell.tsx
│       └── databases/use-database-view.ts
└── tests/
    ├── app-routing.spec.tsx
    ├── route-paths.spec.ts
    ├── hierarchy-explorer.spec.tsx
    ├── workspace-content-boundary.spec.tsx
    └── database-views.spec.tsx

tests/
├── contract/
│   ├── compose.spec.ts
│   └── web-offline-shell.spec.ts
└── e2e/
    ├── routing.spec.ts
    ├── helpers.ts
    └── workspace-settings-boundary.spec.ts

docker/
└── web-nginx.conf

bun.lock
ci/test-impact.json
```

**Structure Decision**: Conserver le découpage fonctionnel existant et ajouter une petite frontière `apps/web/src/routing/` pour les chemins, le fournisseur navigateur et le retour d’authentification. `App` conserve seulement le gate installation/session et compose les pages. `HierarchyExplorer` reste propriétaire de ses états d’interface et de données, mais reçoit l’identité sélectionnée depuis la route. Les composants métier reçoivent des callbacks ou hooks de navigation et ne construisent plus d’URL.

## Design

### 1. Routeur et topologie

`main.tsx` conserve le court-circuit exact de `/__ui-lab`. Le chemin normal charge `AppRouter`, qui installe `BrowserRouter` autour de `App`. `App` déclare les routes publiques et protégées avec `Routes`, `Route`, `Navigate`, des segments dynamiques et une mise en page protégée persistante.

Le layout protégé monte une seule instance du workspace. Il la rend visible pour `/notes` et `/notes/:itemId`, la masque pour les réglages, puis rend la page de réglages par `Outlet`. Ce choix préserve les brouillons, connexions temps réel, ancrages, focus et files locales pendant une visite opérationnelle.

Les helpers purs de `paths.ts` sont l’unique endroit qui :

- construit les chemins canoniques ;
- reconnaît et valide les UUID ;
- mappe `storage-sync` vers la section interne `local-data` ;
- distingue une route inconnue d’une route valide dont la donnée manque ;
- conserve uniquement les paramètres de requête explicitement autorisés.

### 2. Gate installation/session

La reconnaissance du chemin précède la protection, mais aucune page privée n’est rendue avant résolution du gate. En l’absence de propriétaire, une route protégée est remplacée par `/setup?returnTo=…`. Après refus explicite de session, elle est remplacée par `/login?returnTo=…`. Le paramètre n’est accepté que si son décodage produit une destination interne protégée reconnue ; schéma, origine, double slash, route publique, encodage invalide ou chemin inconnu sont rejetés.

Une erreur `service_unavailable` conserve la règle actuelle : le propriétaire peut atteindre le workspace et les contenus locaux. Une authentification réussie remplace la page de connexion par le retour validé ou `/notes`, afin que précédent ne ramène pas au formulaire déjà satisfait.

### 3. Sélection de contenu contrôlée par la route

`HierarchyExplorer` reçoit `selectedItemId` et `onOpenItem`. Son ancien `selectedId` local disparaît. Un ref synchronisé conserve seulement la protection contre les lectures structurées asynchrones obsolètes ; il ne choisit jamais une destination différente.

Toutes les entrées — arbre, clavier, favoris, récents, recherche, fil d’Ariane, création, `/page`, liens internes et bases — utilisent `onOpenItem`, qui pousse `/notes/:itemId`. Pendant l’hydratation, l’identité demandée reste intacte. Le dernier item visité ne sert que lors de l’entrée non ciblée `/notes`; il peut alors canonicaliser par remplacement vers `/notes/:lastVisitedItemId` si l’item est encore actif.

Après hydratation :

- UUID actif : contenu normal ;
- UUID dans la corbeille : état « non actif » ;
- UUID absent en ligne : introuvable ;
- UUID absent hors ligne : indisponible localement ;
- UUID mal formé : la page de route introuvable est rendue avant le workspace.

### 4. Réglages et retour au workspace

La section active vient de la route. Les boutons de `SettingsShell` naviguent vers les chemins canoniques ; `/settings` remplace vers la sécurité. Les détails utilisent `/settings/page/:itemId`, ce qui permet leur chargement direct sans dépendre d’`activeItem` en mémoire.

Lorsqu’une navigation vers les réglages part du workspace, l’entrée d’historique porte un contexte transitoire sûr : chemin de retour, élément qui avait le focus et ancre de lecture déjà persistée. Le bouton de retour choisit ce chemin si celui-ci est reconnu, sinon `/notes`. Le précédent/suivant natif reste l’autorité historique.

### 5. Bases et requêtes

`useDatabaseView` utilise les primitives du routeur pour lire/écrire `?view=` par remplacement sans construire manuellement l’URL. L’ouverture d’une entrée mémorise le contexte de vue puis pousse `/notes/:entryId`. La fermeture explicite ou le précédent retrouve `/notes/:databaseId?view=:viewId` et restaure le scroll/focus depuis `sessionStorage`/`history.state`. Le paramètre historique `entry` est retiré.

### 6. Chargement direct et hors ligne

Le fallback nginx existant est conservé et verrouillé par contrat pour `/notes/...` et `/settings/...`. Le service worker enregistre une route de navigation liée à l’`index.html` précaché, limitée aux requêtes document same-origin et excluant `/v1/`, `/health`, `/assets/`, le service worker et les ressources statiques. Les réponses API ne sont jamais mises en cache.

### 7. Échecs et observabilité

Une page `NotFoundPage` réutilise les primitives UI et propose un retour vers les notes. Les refus History API ne doivent pas provoquer de sélection locale concurrente : la navigation est considérée réussie seulement lorsque le routeur publie la nouvelle location ; les tests simulent les erreurs et vérifient que le contenu monté reste intact.

### 8. Validation et surveillance

Les tests sont ajoutés avant les changements correspondants. Les commandes ciblées donnent un retour rapide, puis `bun run checks:local` reste le gate pré-push. Les phases longues de tests et de CI sont confiées à des sous-agents `gpt-5.6-luna` à faible effort pour lancer ou surveiller une commande bornée et restituer code de sortie, suites en échec et chemins d’artefacts. Le processus réel et ses codes de sortie restent l’autorité ; aucun résumé d’agent ne transforme un échec en succès.

## Complexity Tracking

Aucune violation constitutionnelle ni complexité exceptionnelle à justifier.
