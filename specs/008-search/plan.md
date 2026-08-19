# Implementation Plan: Recherche initiale du workspace

**Branch**: codex/008-search | **Date**: 2026-08-19 | **Spec**:
[spec.md](spec.md)

**Input**: Feature specification from /specs/008-search/spec.md

## Summary

Ajouter une recherche V1 partagée entre serveur et client local, couvrant les
titres, noms de fichiers et textes visibles des pages. Le moteur retenu est
MiniSearch 7.2.0, encapsulé derrière un contrat de domaine commun et conservé
uniquement en mémoire. Le serveur reconstruit son index depuis les contenus
canoniques ouverts par la couche de protection ; le navigateur le reconstruit
depuis sa projection locale déjà chiffrée. Aucun lexème, titre, extrait ou
index sérialisé n'est persisté en clair.

Le client répond d'abord avec les résultats locaux, puis fusionne la réponse
complète du serveur par identité canonique. Une mutation locale en attente ou
un conflit garde la priorité sur une réponse distante plus ancienne. Les
reconstructions utilisent un nouvel index isolé et ne remplacent la génération
active qu'après validation complète ; un échec place la recherche en état
dégradé au lieu de publier un résultat partiel comme complet.

## Technical Context

**Language/Version**: TypeScript 5.9.3 ; Node.js 24 ; navigateurs V1 définis
par le canevas produit

**Primary Dependencies**: MiniSearch 7.2.0, Fastify 5, React 19, Dexie 4,
Intl.Segmenter, contrats TypeBox existants

**Storage**: PostgreSQL pour les données canoniques protégées ; IndexedDB/Dexie
pour la projection locale protégée ; aucun index de recherche persistant

**Testing**: Vitest pour domaine, client, intégration, contrats et performance ;
Playwright pour les parcours responsive, clavier, offline et multi-navigateurs

**Target Platform**: serveur Linux auto-hébergé et client Web responsive,
Chrome/Edge/Firefox/Safari sur les deux dernières versions majeures

**Project Type**: application Web local-first avec API auto-hébergée

**Performance Goals**: 20 premiers résultats serveur en moins de 1 seconde au
p95 sur 100 000 pages et 1 000 000 de blocs ; résultats locaux en moins de
300 ms au p95 sur 10 000 items ; mise à jour locale sous 1 seconde

**Constraints**: mono-utilisateur ; pas de contenu ou requête dans les URLs et
journaux ; aucun index sensible persistant ; résultat local disponible hors
ligne ; reconstruction fail-closed ; clavier, lecteur d'écran, largeur 320 px

**Scale/Scope**: 100 000 pages, 1 000 000 de blocs, 50 000 fichiers, 10
appareils ; titres, noms de fichiers et texte visible des blocs pris en charge

## Constitution Check

*GATE: Passed before research and re-checked after Phase 1 design.*

| Principe | Décision | Gate |
| --- | --- | --- |
| I. User Ownership and Local Resilience | La recherche locale est reconstruite depuis la projection chiffrée et reste utilisable sans réseau ; le serveur n'est jamais la seule voie vers le contenu déjà local | PASS |
| II. One Spec, Any Agent | La spec, le plan, la recherche, le modèle, les contrats et les tâches restent sous specs/008-search | PASS |
| III. Incremental, Verifiable Delivery | Les tranches domaine, serveur, local, interface et reprise possèdent chacune leurs tests et critères indépendants | PASS |
| IV. Privacy and Security by Default | L'index est transitoire, les sources au repos restent chiffrées, la requête voyage dans un corps authentifié et aucun extrait n'entre dans les logs | PASS |
| V. Simple, Modular Architecture | Un petit moteur embarqué commun remplace un service de recherche, une base ou un modèle canonique supplémentaire | PASS |
| VI. Accessible and Predictable Experience | États de couverture explicites, navigation clavier, focus, annonces et comportement 320 px sont contractuels | PASS |
| VII. Reproducible Toolchains | MiniSearch est ajouté par pnpm, verrouillé dans pnpm-lock.yaml et soumis aux gates de dépendances, licences, builds et tests | PASS |
| VIII. Canonical Product Direction | Le plan concrétise les sections 6.1, 12, 17 à 21, 28, 29, 33 et 42 à 43 sans absorber les features 009 à 013 | PASS |

## Project Structure

### Documentation (this feature)

~~~text
specs/008-search/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── search-api.openapi.yaml
│   └── search-ui.md
└── tasks.md
~~~

### Source Code (repository root)

~~~text
packages/domain/src/search/
├── document-text.ts
├── normalise.ts
├── search-index.ts
└── types.ts

packages/database/src/repositories/
└── search-source-repository.ts

packages/client-core/src/search/
├── local-search-source.ts
└── merge-search-results.ts

packages/contracts/src/
└── content-api.ts

apps/api/src/search/
├── search-service.ts
└── search-state.ts

apps/api/src/routes/
└── search.ts

apps/web/src/features/search/
├── search-dialog.tsx
├── search-filters.tsx
├── search-results.tsx
└── search.worker.ts

apps/web/src/services/
└── search.ts

packages/domain/tests/
├── search-document-text.spec.ts
├── search-index.spec.ts
├── search-normalise.spec.ts
└── search.property.spec.ts

packages/database/tests/
└── search-source.integration.spec.ts

packages/client-core/tests/
├── local-search-source.spec.ts
└── search-merge.spec.ts

apps/api/tests/
├── search-service.spec.ts
├── search-rebuild.spec.ts
├── search-security.spec.ts
└── search.contract.spec.ts

apps/web/tests/
├── search-dialog.spec.ts
└── search-worker.spec.ts

tests/e2e/
├── search.spec.ts
└── search-offline.spec.ts

tests/performance/
└── search.perf.spec.ts
~~~

**Structure Decision**: Les règles de normalisation, extraction, rang et
déduplication appartiennent au domaine commun. Les repositories ne font que
charger la source canonique et la hiérarchie courante. Le serveur et le worker
Web possèdent chacun une instance transitoire du même index. Aucun nouveau
workspace package, service Compose, stockage ou source de vérité n'est ajouté.

## Design

### Index transitoire et génération atomique

MiniSearch indexe en mémoire un SearchDocument par identité active. Une
reconstruction crée une instance séparée, ouvre chaque contenu par les codecs
existants, valide toutes les entrées, puis échange atomiquement l'instance et
incrémente sa génération. Tant que cette étape n'est pas terminée, l'ancienne
génération reste prête ou, s'il n'en existe aucune, la route indique
rebuilding. Une erreur d'ouverture ou d'intégrité place le composant en
degraded et interdit de présenter des résultats serveur complets.

Une écriture serveur met à jour l'index seulement après le commit canonique.
L'upsert porte l'identité et la révision courante ; une notification ancienne
ou rejouée ne peut donc pas remplacer une version plus récente. Un échec
d'upsert invalide la génération active et déclenche une reconstruction.

### Texte, normalisation et rang

Le domaine extrait uniquement le texte qu'un client compatible sait afficher :
texte inline, titres, listes, cases à cocher, citations, code et légendes de
fichiers. Les URLs de liens, identifiants, métadonnées et blocs inconnus ne sont
pas indexés. Les contenus legacy ou inconnus restent trouvables par titre
jusqu'à ce qu'un client compatible les transforme explicitement.

La segmentation utilise Intl.Segmenter avec granularité mot, puis une
normalisation Unicode NFKD, suppression des marques diacritiques et casse
française. La recherche fuzzy est désactivée pour la V1. Le titre exact, puis
le préfixe de titre, puis les termes du titre précèdent le nom de fichier et le
corps. Une clé stable fondée sur le rang, le titre normalisé et l'identité
départage les égalités.

### Portée et hydratation

L'index ne stocke ni chemin ni liste d'ancêtres. À chaque requête, le
repository calcule l'ensemble courant des descendants de la branche demandée
et hydrate le chemin des candidats retenus. Déplacer une branche ne requiert
donc pas de réindexer tous ses descendants et aucun ancien chemin ne peut
survivre dans l'index.

### Local-first et fusion

Après déverrouillage, le worker Web reçoit les items ouverts par le repository
local et construit son propre index. Toute mutation confirmée localement
provoque un upsert ou retrait avant que l'interface ne considère la recherche
à jour. Le worker ne persiste rien et est vidé lors du verrouillage, de la
déconnexion ou de la perte de clé.

Une recherche affiche immédiatement le local avec la couverture local-only,
puis demande le workspace au serveur si disponible. La fusion utilise
l'identité canonique ; une entrée locale en attente ou en conflit remplace la
présentation distante, tandis qu'une entrée locale reconnue comme synchronisée
peut être enrichie par le serveur. Une absence réseau ne supprime jamais les
résultats locaux.

### Contrat et confidentialité

La recherche serveur utilise POST /v1/search : la requête et les filtres ne
figurent ni dans une URL, ni dans l'historique, ni dans les logs d'accès. La
route exige le propriétaire authentifié et ne journalise que des métriques
agrégées sans texte. Les pages suivantes utilisent un curseur opaque lié à la
requête et à la génération ; un curseur d'une autre génération est refusé afin
d'éviter un mélange silencieux de classements.

Les extraits restent des chaînes de texte rendues comme texte, jamais comme
HTML. Les erreurs ne reprennent ni requête, ni titre, ni extrait.

## Phase 0 Output

[research.md](research.md) fixe le moteur, la frontière de chiffrement, la
normalisation, le cycle de vie, le contrat sans query-string et la fusion
local-first.

## Phase 1 Output

- [data-model.md](data-model.md) définit les entités transitoires et leurs
  états.
- [contracts/search-api.openapi.yaml](contracts/search-api.openapi.yaml)
  définit la frontière HTTP propriétaire.
- [contracts/search-ui.md](contracts/search-ui.md) fixe la couverture visible,
  le clavier et la fusion.
- [quickstart.md](quickstart.md) décrit les preuves end-to-end, sécurité,
  reprise et performance.

## Constitution Check — post-design

Le design ne crée aucun stockage sensible supplémentaire : les index vivent
uniquement dans la mémoire de processus et sont reconstruits depuis les sources
déjà protégées. Il conserve l'identité canonique, refuse les résultats partiels
présentés comme complets, réutilise la projection locale hors ligne, et garde
les contrats de recherche extensibles aux features 009 à 013 sans leur donner
accès aujourd'hui. Les huit gates constitutionnels restent PASS.

## Complexity Tracking

Aucune violation constitutionnelle ou exception de complexité n'est requise.
