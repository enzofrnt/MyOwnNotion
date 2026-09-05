# Implementation Plan: Applications Desktop Electron Windows, macOS et Linux

Native CI convergence (2026-09-05): Windows packages now build and launch, but
their temporary API fixture must validate its deployment key using Windows ACLs,
not synthetic POSIX mode bits. The loader retains owner-only enforcement: require
the current account as owner, protected inheritance and no allowed principal
besides that account. The fixture sets that ACL explicitly. Linux/macOS retain
0600/0400 validation. This adapts the native test host without changing the Linux
server deployment target or bypassing the guarded migration.

**Branch**: `014-desktop-clients` | **Date**: 2026-08-16 | **Spec**: [spec.md](spec.md)

## Summary

**Prochain travail d'implémentation**, avant la clôture V1. La chaîne Bun 1.4.0
est déjà exclusive (feature 019) ; ce plan n'introduit ni pnpm ni Node.js
first-party.

Créer un hôte desktop Electron pour le client Web existant, distribué pour
cinq cibles : Windows 10/11 x64, Windows 10/11 ARM64, macOS 13+ Apple Silicon,
Linux glibc x64 et Linux glibc ARM64. Windows et macOS : un installateur
chacun. Linux : AppImage, deb et rpm par architecture. Téléchargement GitHub,
aucun store. Le rendu réutilise
`apps/web` et `packages/client-core`; la couche native se limite à la fenêtre,
la protection de clé, les capacités système contrôlées, les diagnostics et le
cycle de release. Le serveur, les contrats métier, le modèle canonique et la
synchronisation restent ceux des features précédentes.

Le choix retenu est Electron Forge comme orchestrateur de packaging/makers et
de publication, avec une build Bun dédiée pour le processus principal et le
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
  base canonique, iOS/Android, macOS Intel, stores, paquets universels ou
  multi-OS, plugins arbitraires, télémétrie non
  consentie et stockage non chiffré.

## Technical Context

**Language/Version**: TypeScript strict; Bun `1.4.0` exactement pour les dépendances workspace, les scripts et l'outillage first-party. Electron (version épinglée) est le runtime hôte de l'application packagée, pas un second gestionnaire de paquets.

**Primary Dependencies**: Electron version épinglée; Electron Forge et makers
Windows, macOS et Linux épinglés; Bun.build; React; `@myownnotion/client-core`, `contracts`,
`domain`; Vitest; Playwright; tests Electron ciblés pour IPC, permissions,
protocole, single-instance et mises à jour

**Storage**: Projection Dexie/IndexedDB et outbox du client-core dans le profil
persistant de l’application; clé locale protégée par le mécanisme sécurisé de
l’OS via le processus principal; aucun contenu canonique dans le processus
principal

**Testing**: Vitest pour les politiques et contrats; Playwright pour le rendu
et les parcours; smoke tests installés sur Windows, macOS et Linux; inspection
de signature ou équivalent de confiance, empreinte, provenance, absence de
secrets et absence de runtime étranger à la cible

**Target Platform**: Windows 10/11 x64 et ARM64 ; macOS 13+ ARM64 uniquement ;
Linux glibc x64 et ARM64 (classe Ubuntu LTS). Un installateur par cible.
Jamais de binaire universel, jamais de store.

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
cinq cibles (Windows x64, Windows ARM64, macOS ARM64, Linux x64, Linux ARM64)
avec AppImage, deb et rpm pour chaque Linux

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
    ├── build.ts
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
.github/workflows/desktop-ci.yml
.github/workflows/desktop-release.yml
bunfig.toml
```

**Structure Decision**: Ajouter un seul package `apps/desktop`. Le rendu n’est
pas copié: la build desktop consomme les assets produits par `apps/web`. Le
processus principal n’importe que des contrats natifs et l’adaptateur de clé;
il n’importe ni domaine, ni repository, ni DB.

La matrice GitHub Actions de release est native et n’alimente aucun store :

| Runner | `platform` | `arch` | Fichiers publiés |
| --- | --- | --- | --- |
| `windows-latest` | `win32` | `x64` | Squirrel `.exe` |
| `windows-11-arm` | `win32` | `arm64` | installateur Windows ARM `.exe` |
| `macos-14` | `darwin` | `arm64` | DMG |
| `ubuntu-24.04` | `linux` | `x64` | AppImage, `.deb`, `.rpm` |
| `ubuntu-24.04-arm` | `linux` | `arm64` | AppImage, `.deb`, `.rpm` |

Chaque job n’installe et n’empaquette que sa cible. Un job Linux lance les
trois makers sur le même runtime packagé. Un job `publish` télécharge tous les
fichiers, refuse tout runtime étranger et tout fichier hors matrice, puis les
attache à la GitHub Release du tag.

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

- Electron Forge est utilisé pour package/make. Les makers publiés sont :
  Squirrel (ou équivalent WiX si Squirrel ne produit pas l’ARM64) sur
  Windows ; DMG sur macOS ARM ; AppImage, deb et rpm sur Linux. Pas de ZIP
  macOS Intel, pas de `osxUniversal`. `prune: true`. La signature Authenticode
  et la notarisation Apple restent des prérequis Windows/macOS ; Linux publie
  SHA-512. Aucun secret dans le dépôt. Aucune publication store ni dépôt
  apt/rpm.
- Le maker DMG local étend `@electron-forge/maker-base` et invoque les outils
  macOS `ditto`/`hdiutil` depuis Bun. Il préserve l'application signée/notarisée,
  ajoute le raccourci Applications, vérifie l'image et publie le fichier par
  renommage. Il remplace la chaîne historique appdmg/macos-alias dont les
  addons V8/NAN ne fonctionnent pas sous Bun.
- Les artefacts portent version, plateforme, architecture, empreinte,
  provenance et métadonnées de mise à jour. Un manifeste invalide, une
  signature ou empreinte absente, une incompatibilité de protocole, ou un
  artefact dont la plateforme/architecture n’est pas celle de l’installation
  bloque l’installation.
- La mise à jour est déclenchée dans le processus principal pour le même OS
  et la même architecture, depuis la GitHub Release. Elle est proposée ou
  reportée dans le rendu et ne démarre pas une migration destructive tant que
  le coffre local ou l’outbox n’est pas dans un état explicite. Sur Linux, le
  manifeste in-app pointe vers l’AppImage de cette architecture ; deb et rpm
  restent des installateurs de premier téléchargement.
- Chaque migration de coffre est versionnée, atomique par étape, reprenable et
  testée avec interruption simulée. Le chemin de retour conserve le coffre et
  les mutations non synchronisées.
- Le workflow de release exécute la matrice native ci-dessus, vérifie qu’aucun
  artefact n’embarque un runtime étranger, puis attache les fichiers de la
  matrice à la GitHub Release.

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
| Adaptateur de clé natif | Le Web ne peut pas fournir la même protection OS que Windows, macOS ou Linux | Considérer IndexedDB comme coffre de plateforme exagérerait sa garantie et contredirait la section 17.3 |
| Builds par OS et architecture | FR-014 et FR-016 exigent un installateur natif et léger | Un fat Windows+macOS+Linux, un macOS Intel, un macOS universel ou un store ajouteraient des runtimes ou des canaux hors matrice |

## Convergence decisions — 2026-09-05

The imported implementation had no executable update transport. The host now
owns a bounded GitHub Release download and validates a detached Ed25519 signature
with a public key embedded at build time, followed by SHA-512 and target/protocol
checks. Release signing material is configured outside the repository. An
unconfigured development build reports updates unavailable; it must never trust
a public key supplied by the feed. Protocol bounds use the integer sync protocol.
The verified installer is handed to the OS at the owner's request, with explicit
instructions to finish installation and restart; opening an installer must not
be reported as a completed upgrade. Pending local writes block this handoff.
The installer does not delete or replace the user data directory. Linux system
packages remain a manual installation path. Native signature/notarization and
manifest signing are release gates, independent from unsigned CI smoke tests.

The revocation journey exposed a missing shared HTTP authorization gate: resolving
a session into request context did not protect ordinary content handlers. Add a
fail-closed pre-handler for private routes, reusing the existing owner/CSRF gate;
keep bootstrap/login/status as an explicit public route allowlist. Session
resolution also rejects a revoked device. Test anonymous, revoked, and authenticated
requests against ordinary content routes; preserve already stored local ciphertext.

The native vault format is now persisted atomically and checked before access.
Unknown or corrupt formats refuse access without resetting files. There is no
second migration engine for IndexedDB: client-core owns its transactional Dexie
migrations. The initial native format requires no content rewrite. Legacy host
key adoption copies and rewraps the exact envelope already referenced by the
profile, leaves the original intact, and can resume after interruption. Removed
the disconnected pretend migration-state machine from the imported scaffold.

A cold offline launch restores local content without a CSRF token. On connectivity
recovery, revalidate the session and wake workspace/page drains only after the
server returns a valid in-memory token. A bounded retry while that token is
missing also handles server recovery without an operating-system online event.

Both tag workflow callers must allow the permissions declared by reusable CI
(SARIF upload and the main-only publisher). GitHub cannot elevate a caller's
permissions inside a callee. The image publisher remains gated to a main push.

All resumable upload writes use the current memory-only CSRF token, including
zero-byte finalization and resumed chunks. A server-provided upload destination
must remain on the current origin, and redirects are refused before sending
private file bytes. Standalone Playwright API setup authenticates its own cookie
jar rather than assuming it shares the browser session.

A verified live session belonging to a revoked device gets the existing safe
`device_revoked` refusal, without obtaining an owner principal. This preserves
the change-stream UI's revocation diagnosis while ordinary content access stays
denied. Unknown, expired and revoked session secrets remain indistinguishable.
The connection form uses the active `global.css` surface and recovers from IPC
rejection without discarding input. A verified Linux AppImage becomes executable
by its owner immediately before revealing its folder; this is still a manual
handoff, not proof that an upgrade completed.

Deferred authentication for Bun's WebSocket upgrade is restricted to GET on the
registered `/v1/page-sync/socket` route. An Upgrade header on any other route
must retain ordinary owner and CSRF enforcement. Contracts reproduce anonymous
HTTP reads and authenticated writes with forged Upgrade headers; native
onboarding and cold offline restart verify the real socket still works.
