# Implementation Plan: Applications Desktop Electron Windows et macOS

**Branch**: `014-desktop-clients` | **Date**: 2026-08-16 | **Spec**: [spec.md](spec.md)

## Summary

**Prochain travail d'implémentation**, avant la clôture V1. La chaîne Bun 1.4.0
est déjà exclusive (feature 019) ; ce plan n'introduit ni pnpm ni Node.js
first-party.

Créer un hôte desktop Electron pour le client Web existant, distribué sur
Windows 10/11 x64 et macOS 12+ Intel/Apple Silicon. Le rendu réutilise
`apps/web` et `packages/client-core`; la couche native se limite à la fenêtre,
la protection de clé, les capacités système contrôlées, les diagnostics et le
cycle de release. Le serveur, les contrats métier, le modèle canonique et la
synchronisation restent ceux des features précédentes.

Le choix retenu est Electron Forge comme orchestrateur de packaging/makers et
de publication, avec une build Vite dédiée pour le processus principal et le
preload. Le rendu Web est construit une seule fois puis servi comme contenu
local de l’application via un protocole applicatif. Les appels API ciblent
l’URL du serveur configurée par le propriétaire; le desktop ne devient pas un
proxy métier ni un serveur local.

## Product-canvas traceability, dependencies, and exclusions

- **Canevas**: sections 6.1, 7 et 47, avec les invariants des sections 5, 9, 17
  à 20, 28 à 30 et 36 à 45.
- **Dépendances**: fondations V1 du client Web (001 à 010, 016 à 020, 022) et
  chaîne Bun 019. Les fonctionnalités métier restent testées et possédées par
  leurs features ; 014 ajoute leur hôte. 011 à 013 ne sont pas des prérequis.
- **Exclusions**: nouvelles fonctionnalités métier, serveur embarqué, seconde
  base canonique, iOS/Android/Linux, Mac App Store, plugins arbitraires,
  télémétrie non consentie et stockage non chiffré.

## Technical Context

**Language/Version**: TypeScript strict; Bun `1.4.0` exactement pour les dépendances workspace, les scripts et l'outillage first-party. Electron (version épinglée) est le runtime hôte de l'application packagée, pas un second gestionnaire de paquets.

**Primary Dependencies**: Electron version épinglée; Electron Forge et makers
Windows/macOS épinglés; Vite; React; `@myownnotion/client-core`, `contracts`,
`domain`; Vitest; Playwright; tests Electron ciblés pour IPC, permissions,
protocole, single-instance et mises à jour

**Storage**: Projection Dexie/IndexedDB et outbox du client-core dans le profil
persistant de l’application; clé locale protégée par le mécanisme sécurisé de
l’OS via le processus principal; aucun contenu canonique dans le processus
principal

**Testing**: Vitest pour les politiques et contrats; Playwright pour le rendu
et les parcours; smoke tests installés sur Windows/macOS; inspection de
signature, empreinte, provenance et absence de secrets

**Target Platform**: Windows 10/11 x64; macOS 12+ x64 et arm64. Builds macOS
séparés par architecture au premier release; Windows ARM64 est différé.

**Project Type**: Desktop application + shared web client + release pipeline

**Performance Goals**: premier affichage du shell local sous 2 secondes après
lancement sur une machine de référence; aucune opération IPC courante ne bloque
le rendu; reprise de la fenêtre et du profil sous 1 seconde hors réseau

**Constraints**: offline-first; données protégées avant écriture durable; aucun
Node.js dans le rendu; isolation de contexte et sandbox; navigation et IPC
allowlistés; URL HTTP non locale signalée; pas de secret dans le dépôt, les
artefacts, les logs ou les crash reports; distribution signée et traçable

**Scale/Scope**: une installation desktop par appareil, plusieurs profils de
serveur possibles mais un seul profil actif à la fois; un workspace canonique;
trois familles d’artefacts de release initiales (Windows x64, macOS x64,
macOS arm64)

## Constitution Check — pre-design

| Principe | Décision de conception | Gate |
| --- | --- | --- |
| I. Propriété et résilience locale | Le rendu réutilise la projection/outbox existante; le serveur n’est pas requis pour lire ou reprendre les changements déjà présents | PASS |
| II/VIII. Spec et direction produit | La feature cite le canevas V1, la roadmap et les dépendances Web 001–010/016–022; elle ne redéfinit aucune identité canonique | PASS |
| III. Livraison vérifiable | Chaque parcours desktop possède un test indépendant, un smoke test installé et une validation de release; les contrôles suivent local → PR → release | PASS |
| IV. Confidentialité et sécurité | Rendu isolé, IPC minimal, clé protégée par l’OS, contenu local chiffré, logs expurgés, signatures et refus fail-closed | PASS |
| V. Architecture simple | Une couche desktop mince au-dessus du client Web; pas de serveur, DB ou domaine parallèle | PASS |
| VI. Expérience prévisible | Clavier, focus, états hors ligne, erreurs et mises à jour explicités; les comportements métier restent ceux du Web | PASS |
| VII. Toolchain reproductible | Bun 1.4.0 reste exclusif pour paquets et scripts; versions Electron/Forge sont lockées; CI utilise des runners natifs et publie seulement après gate complet | PASS |

No design violation or unresolved clarification remains. The remaining risks
are implementation and release-environment risks, covered by tasks and the
quickstart evidence table.

## Architecture and data ownership

### Boundaries

- `apps/web` owns the renderer UI, HTTP client, local projection, outbox,
  encryption policy and feature journeys. It receives a typed runtime profile
  instead of assuming same-origin forever.
- `apps/desktop` owns the Electron main process, BrowserWindow lifecycle,
  custom local protocol, OS key wrapping, native dialogs, external-link policy,
  single-instance coordination, update orchestration and redacted diagnostics.
- `packages/client-core` remains the owner of local identities, encrypted
  records, outbox/reconciliation and device trust. Its `SecureKeyStorage`
  boundary gains a desktop adapter; it does not gain Electron imports.
- `packages/contracts` owns only shared wire/runtime DTOs. The desktop IPC
  contract is a separate local contract and never becomes a server API.
- `.github/workflows/desktop-release.yml` owns packaging, signing metadata,
  artifact verification and publication. It cannot publish from an unverified
  or unsigned job.

### Repository structure

```text
apps/
├── web/
│   └── src/
│       ├── runtime/client-runtime.ts
│       └── services/{content-api,security-api,local-key-storage}.ts
└── desktop/
    ├── package.json
    ├── forge.config.ts
    ├── vite.main.config.ts
    ├── vite.preload.config.ts
    ├── src/
    │   ├── main.ts
    │   ├── preload.ts
    │   ├── ipc.ts
    │   ├── protocol.ts
    │   ├── server-profiles.ts
    │   ├── native-key-storage.ts
    │   ├── window-state.ts
    │   ├── external-links.ts
    │   ├── diagnostics.ts
    │   └── updates.ts
    └── tests/
        ├── ipc.contract.spec.ts
        ├── security-boundary.spec.ts
        ├── window-lifecycle.spec.ts
        └── update-state.spec.ts
packages/client-core/
└── src/security/secure-key-storage.ts
.github/workflows/desktop-release.yml
.npmrc
```

**Structure Decision**: Ajouter un seul package `apps/desktop`. Le rendu n’est
pas copié: la build desktop consomme les assets produits par `apps/web`. Le
processus principal n’importe que des contrats natifs et l’adaptateur de clé;
il n’importe ni domaine, ni repository, ni DB.

## Security design

1. Le shell applicatif est local et est servi via un protocole applicatif
   contrôlé; aucun serveur distant ne fournit du JavaScript exécutable.
2. `BrowserWindow` utilise `nodeIntegration: false`, `contextIsolation: true`,
   `sandbox: true`, CSP stricte et une allowlist de navigation/origines.
3. `preload` expose des fonctions métier natives explicites, jamais `ipcRenderer`
   brut. Chaque message vérifie le sender, la forme des arguments et le profil
   actif avant d’atteindre le processus principal.
4. Le client-core chiffre les enregistrements avant écriture. L’adaptateur
   desktop conserve seulement une enveloppe de clé protégée par le mécanisme
   OS; la clé en clair n’est jamais persistée, journalisée ou exportée.
5. Les liens externes passent par une politique explicite et l’ouverture
   système. Les URLs de serveur suivent la règle du canevas pour HTTP local ou
   explicitement sûr; HTTPS est requis pour les origines distantes.

## Update and release design

- Electron Forge est utilisé pour package/make/publish, avec `Squirrel.Windows`
  pour Windows et `DMG`/`ZIP` pour macOS. La signature et la notarisation sont
  des prérequis de publication; les secrets viennent uniquement des secrets du
  runner.
- Les artefacts portent version, plateforme, architecture, empreinte,
  provenance et métadonnées de mise à jour. Un manifeste invalide, une
  signature absente ou une incompatibilité de protocole bloque l’installation.
- La mise à jour est déclenchée dans le processus principal. Elle est
  proposée/reportée dans le rendu et ne démarre pas une migration destructive
  tant que le coffre local ou l’outbox n’est pas dans un état explicite.
- Chaque migration de coffre est versionnée, atomique par étape, reprenable et
  testée avec interruption simulée. Le chemin de retour conserve le coffre et
  les mutations non synchronisées.
- Le workflow de release exécute une matrice native Windows/macOS, vérifie les
  artefacts avant publication et publie uniquement après les contrôles
  d’intégrité, sécurité, signature et smoke test prévus.

## Constitution Check — post-design

| Principe | Preuve du design | Gate |
| --- | --- | --- |
| I | La projection chiffrée, l’outbox, la reprise et l’export restent dans le client-core | PASS |
| II/VIII | Les responsabilités sont liées aux sections 6.1, 7 et 47 et aux fondations V1 du client Web sans duplication | PASS |
| III | Les tâches sont ordonnées par fondation → onboarding/offline → natif → update → release, chacune avec critères vérifiables | PASS |
| IV | Les secrets et clés sont confinés, les origines sont contrôlées, les erreurs sont expurgées et les artefacts signés | PASS |
| V | Aucun service ou modèle canonique parallèle n’est introduit | PASS |
| VI | Les parcours existants sont rejoués dans le desktop et les capacités natives conservent clavier/focus | PASS |
| VII | `bun.lock`, Bun 1.4.0, les versions Electron/Forge épinglées, les runners natifs et les gates de release sont documentés | PASS |

## Complexity Tracking

| Addition | Pourquoi nécessaire | Alternative rejetée |
| --- | --- | --- |
| `apps/desktop` séparé | Séparer le privilège Electron du rendu et du métier | Ajouter Electron dans `apps/web` exposerait les APIs natives au package Web et compliquerait les tests navigateur |
| Profil serveur desktop | Le rendu desktop n’est plus toujours same-origin | Déduire l’URL depuis la fenêtre ou l’environnement ne permettrait pas plusieurs installations ni un onboarding fiable |
| Adaptateur de clé natif | Le Web ne peut pas fournir la même protection OS que Windows/macOS | Considérer IndexedDB comme coffre de plateforme exagérerait sa garantie et contredirait la section 17.3 |
