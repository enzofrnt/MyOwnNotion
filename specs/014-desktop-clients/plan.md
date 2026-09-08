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

Windows fixture requests currently revalidate the mounted deployment-key ACL by
starting PowerShell for each key lookup. Native logs show roughly 0.7 s per
inspection and multi-second ordinary requests; replaying several offline writes
misses the unchanged synchronization deadline. Keep permission enforcement and
on-demand key-file reads. A bounded positive ACL cache may reuse only the
permission verdict for an unchanged exact file identity and metadata change
stamp, after verifying Bun's Windows stat mapping to NTFS ChangeTime. Validate
identity before and after inspection; invalidate on replacement, content or ACL
change, missing/unavailable metadata and inspection failure. Never retain key
bytes in this cache. Native tests must warm the cache, grant another SID access
and require immediate refusal, then verify repair and file replacement.

### Windows cold offline restart investigation (T096)

CI 33993754133 passes all five browser profiles and native macOS/Linux targets,
but both Windows targets stall at cold offline workspace readiness. The prior
ACL latency fix is verified by native permission tests and ordinary request
latency; it does not prove cold restart is repaired. Ten unchanged macOS restart
repetitions pass. Capture the manually launched Electron context explicitly:
the default Playwright fixture trace contains test actions but omits that native
context's DOM/network details. Keep the trace only on failure in this generated
fixture; attach loading phase, browser connectivity, Web Lock inventory and
error class names without reading private application records or native keys.
No readiness timeout or replay assertion may be weakened. The cause and renewed
Windows result remain required before closing T096 or delivering desktop.

The first explicit trace localizes both Windows failures to native key unwrap,
with no pending or held Web Locks. Before choosing a repair, capture whether the
generated fixture's Chromium `Local State` contains its protected Windows key
before process death and whether that same persisted key survives relaunch.
Compare fingerprints only inside the test process; attach presence/equality
booleans, never the protected key, fingerprint, path or application records.
T097 addresses the separately demonstrated unhandled initialization refusal:
the shell must show the existing safe WorkspaceState error with a reload retry,
not native error text or an endless skeleton. Hide the tree and page surfaces
until initialization succeeds, preserve IndexedDB and native envelopes, and
verify a temporary storage refusal followed by recovery of the same page.
This does not fix or disguise the underlying Windows decryption failure.

Retain an already-ready shell when the route callback changes. Resetting it to
loading on every effect invocation briefly removes focused tree rows during
navigation and breaks ArrowDown/ArrowUp. Initial state already supplies the
first-boot skeleton; error retry reloads the application without deleting data.

The suspected delayed preferences commit remains a hypothesis until this native
evidence confirms it. Do not add a pre-crash sleep or flush to the test.

### T096 — Windows key commitment repair

CI 34203443742 on e02693c6 confirms the missing dependency on Windows x64:
both attempts have no Local State/protected key before process death, then a
new protected key after restart. Native unwrap consequently fails. The exact
Electron 44.1.1 source waits for bootstrap code (`JoinAppCode`) before Windows
`OSCrypt::Init`; a graceful main-loop exit commits Local State. Its
`RequestSingleInstanceLock` explicitly succeeds when already held.

Before importing the regular Windows main entrypoint, acquire the existing
single-instance lock and run the same installed executable in a narrowly scoped
internal initialization mode. That child creates no window or application
service: after Electron readiness it verifies OS encryption availability, then
quits normally so Chromium commits its own key/preferences. The parent waits
for successful exit, validates the bounded committed Local State and fsyncs
that file before its own Chromium crypto initialization. Always prime, including
existing profiles, so a replaced or repaired OS key cannot be confused with old
on-disk metadata. Preserve the original master key when valid, all envelopes,
cookies, application records and profile partitions. Use a bounded child timeout
and fail closed with a safe native message. The helper never calls the
single-instance lock, so it cannot displace its parent. No arbitrary sleep,
pre-crash test flush, plaintext fallback, custom cryptography or new dependency.

This lifecycle choice relies on the exact pinned Electron initialization order;
recheck that order on runtime upgrades. Native Windows cold restart is the
required end-to-end proof; mocked process tests alone cannot close T096.

The pinned Chromium 152.0.7977.65 `JsonPrefStore` default file task runner uses
`BLOCK_SHUTDOWN`, so a normal child exit waits for queued preference writes;
see [constructor defaults](https://github.com/chromium/chromium/blob/152.0.7977.65/components/prefs/json_pref_store.h).
The parent additionally fsyncs the committed metadata and never treats a killed
or timed-out child as success.

### T096 — Native child launch boundary follow-up

CI 34212459656 on 9e9dcdc6 passes macOS and both Linux native targets, but Windows
fails packaged launch before the crash journey. The child launch boundary needs
native coverage: injected runner tests did not exercise its environment or entry.
Electron 44.1.1's Windows entry checks presence of ELECTRON_RUN_AS_NODE through
getenv_s, so an empty value is not a reliable way to select application mode.
Remove every case-insensitive spelling from the child environment without
mutating the parent's environment. Keep native exit diagnostics to fixed codes
and numeric statuses; never print a native error, path or child output.

A real local Electron inspection also confirms that getAppPath() is the build
directory when Playwright launches bootstrap.js directly, not a runnable package.
For unpackaged hosts, pass the absolute current bootstrap module file instead.
Add a Windows-native unit fixture that builds and launches the real bootstrap's
windowless mode and requires committed native key metadata on a fresh profile.
This runs before packaged smoke and cannot be replaced by mocked key bytes.
The original full cold-restart journey and deadlines stay unchanged.

Sources: [pinned Windows entry](https://github.com/electron/electron/blob/v44.1.1/shell/app/electron_main_win.cc)
and [Microsoft getenv_s contract](https://learn.microsoft.com/en-us/cpp/c-runtime-library/reference/getenv-s-wgetenv-s).
The Windows launch fix still requires native confirmation; the macOS CLI probe
with an empty environment value does not reproduce Windows mode selection.

## T098 — Native property input during projection refresh

CI 34212459656's WebKit mobile journey loses the freshly filled Summary field
before save (first attempt fails, retry passes). Three isolated replays pass,
but a component test deterministically reproduces a native DOM edit being
repainted by an intervening same-entry projection before input event delivery.
Use an uncontrolled text/date input with a last-projected-value comparison:
apply external values only while the DOM still equals the previous projection;
preserve a native edit until its input event updates the existing draft refs.
Scope entry field identity by entry/property so an unreported draft cannot leak
into a different entry. Keep untouched hydration, latest-value save, date and
number validation, keyboard/IME behavior and existing journey deadlines.

## T099 — Prepare native test dependencies before parallel collection

CI 34220219342 proves the real parent/child key test passes on Windows x64, but
another suite fails Electron installation. ARM fails before reporting its
spawn result because stderr is null. Both logs show concurrent first-use
Electron downloads from separate test workers. Electron 44.1.1's installed
`index.js` synchronously runs `install.js` on first require, without a process
lock. Prepare and validate the pinned executable once in the Bun parent before
worker collection. Use the same preparation function from the PostgreSQL test
wrapper when desktop is selected, the affected unit-test launcher and the native
CI preparation step. Document preparation before direct desktop-only Vitest
commands. Keep the existing prohibition on Vitest global setup and preserve
parallel tests after preparation. Native spawn diagnostics must handle absent output
and report only a bounded error code/status, never a path or native key data.

### T100: structured resolution across page-history consolidation

CI run 34220219342 accepted the divergent remote property edit, then generated
`page-operations.consolidated` with identical structured values/version while
the owner reviewed the conflict. The resolution was refused solely because
that new canonical head was absent from the reviewed pair. Implement the
existing independent-field convergence boundary in database command execution:
walk at most 64 single-parent revisions belonging to this entry and authored
by accepted `page-operations.consolidated` mutations. Only when that chain
reaches a reviewed parent may the current head replace that parent in the
resolution lineage. Preserve the other reviewed parent and build from current
canonical state. A missing/foreign/branching history, unrelated mutation,
structured edit or exceeded bound remains stale. No snapshot decryption or
comparison, timeout changes, UI retries or invented successful state.
Reproduce both transparent consolidation and refused real structured edits at
the transaction boundary, then replay the original native offline journey.

### T101: deterministic native fixture teardown

UI-only stacked CI 34230311557 exercises the same a2f2eb9b executable tree.
Windows x64 passes every offline recovery/reconciliation assertion, then fails
because taskkill sees an already gone process before the ChildProcess exit
notification. ARM also passes the journey but removal reports EBUSY. Bun 1.4.0
parses maxRetries/retryDelay but its recursive native rm implementation does
not consume them. Use an owned-process observer registered before shutdown and
the existing 10 retries with linear 100 ms backoff, only for transient filesystem
errors; do not accept a surviving process or a permanently locked directory.
Keep this in the test harness with event-order and bounded-failure regressions.
The separate x64 initial onboarding launch ends at 277 ms after inspector
connection, before browser DevTools output; its cause remains under investigation.
Do not claim teardown fixes that startup failure or relax native flaky gates.

Sources: pinned Playwright coreBundle.js Electron waitForLine/close implementation;
[Bun 1.4.0 recursive rm](https://github.com/oven-sh/bun/blob/bun-v1.4.0/src/runtime/node/node_fs.rs).

### T102: retain native shutdown evidence

Desktop PR 171 passed all five native targets and merged as fb36befc. Main run
34241754881 passes the offline crash, restart, intact content and exactly-once
reconciliation assertions on Windows ARM, then fails teardown: the wrapper PID
is absent to taskkill but the owned ChildProcess still has no observed exit
after the existing 5 + 10 second deadlines. Playwright launches Electron through
a Windows shell, so the wrapper identity alone cannot establish Electron exit.
Retain the real Electron PID obtained at launch, fixed preload lifecycle stages,
owned-process exit state and pipe flags on cleanup failure.
Read-only OS liveness probes distinguish missing processes from permission or
probe errors. Never print command lines, environment, paths, content or raw
exceptions, synthesize process events, suppress failure or increase deadlines.
This diagnostic addition is not a claimed repair. The Linux ARM failure in the
same run was an upstream Electron download HTTP 500; a targeted infrastructure
retry passed after the upstream URL recovered.

The naturally subsequent backup PR run 34246091846 also reports a native
evaluation channel closing on ARM and a tracing-stop failure on x64. Observe
unexpected context closure before requested shutdown, await bounded diagnostic
collection during fixture cleanup, and prevent a failed trace export from
replacing the original test failure. Keep this observation passive; no launch,
evaluation or test retries are added.

### T103: bound authentication fixture setup

The renewed local Firefox gate on 0a43f6c1 timed out in authentication's
beforeEach before any browser action. No PostgreSQL error was recorded in the
corresponding interval; the trace does not identify the individual setup
operation, so the precise stalled operation remains unconfirmed. Inspection
finds that password seeding alone still uses an unbounded disposable client,
including its final socket close. Move it to the existing bounded fixture
boundary, retaining the actual stored scrypt format. Generate one credential
identity and hash per fixture invocation, outside retried work, and make its
insertion idempotent so a lost commit reply cannot create duplicate credentials.
Add explicit setup steps to preserve the failing operation in future traces.
Inject a committed insert with a lost reply and a stalled final close in focused
regressions; retain real authentication journeys and unchanged test deadlines.
This hardens a demonstrated missing bound, not a proven diagnosis of the earlier
Firefox timeout. Full delivery checks must run again on the resulting commit.
### Native channel evidence from UI PR 172

Run 34252039882 on documentation-only 2362b444 reproduces native failures on
both Windows architectures; the other native targets and all remaining required
jobs pass. It is not a reason to rerun for luck or accept flaky native journeys.

On x64 the offline journey confirms the recovered text, then the native main
inspector rejects `setDesktopOffline(false)` (test trace call 181). The subsequent
native inspector probe also fails (182), but renderer `page.evaluate` still
succeeds (184) and its native browser trace can be exported. The process log
records `Debugger ending`. This distinguishes an inspector transport loss from
an established application exit. The failing evaluation's effect is not known.

A separate x64 onboarding attempt reaches preload, ready and window-created.
Both inspector and browser CDP sockets connect, then browser CDP disconnects
with code 1006 before Electron initialization completes. Only afterwards does
Playwright forcibly kill the still present Electron process tree. No preload
quit or uncaught-exception event is recorded. Thus this case is also not proven
to be an application-requested shutdown.

On ARM the original browser locator channel closes; the existing trace-export
error masks it. The pending T102 change preserves the original exception and
adds bounded lifecycle/owned-process evidence, but has not yet run remotely.

Upstream historical Bun issues 27977 and 9911 describe different extra-pipe
connection and HTTP-upgrade failures fixed before the pinned 1.4.0 release.
Neither establishes the cause of these post-connect losses. No runtime switch,
WebSocket patch, retries, timeout extension or weakened native assertions is
justified by those reports alone.

Extend T102 to report a rejected native command before requested cleanup even
when the browser context stays open. Keep reporting independent of another
inspector evaluation: use the captured owned identities, allowlisted preload
stages and cached window-close state. Bound diagnostic waiting to one second,
preserve the original thrown value if reporting fails or hangs, and never retry
the command. Cover success, refusal, diagnostic failure and timeout explicitly.

### T104: package with the pinned Bun toolchain alone

The isolated Windows checkout on ccb450d5 passes all nine native journeys and
five additional offline-restart/onboarding pairs, but `bun run package` fails
immediately with `spawn npm ENOENT`. This machine has Bun 1.4.0 and no Node/npm.
Forge 7.11.2's CLI always resolves npm/yarn/pnpm for its startup version check;
existing developer machines and CI images masked that undeclared requirement.

Call the same pinned Forge core API from a Bun entry point for package, make and
publish. Keep the existing Forge config, signing hooks, pruning, makers and
release matrix. Declare core directly and retire the unused CLI dependency.
Forward the maintained release platform/architecture arguments, support Bun's
separator, reject unsupported targets/options before invoking the API, and do
not introduce a home-directory skip marker or install a second package manager.
Prove real packaging and installed smoke on Windows without Node/npm, test
argument forwarding/failures, and renew local/PR/main delivery gates and Trivy
because the dependency lock changes. This is separate from T102's unresolved
intermittent inspector loss; no causal claim links them.

### T105: confirm the owned native processes have actually exited

The two-core Windows fixture reproduces T102 locally: after successful revocation
assertions and requested normal shutdown, both captured wrapper and Electron PIDs
are absent, stdout/stderr have ended, the window is closed and the preload records
before-quit/will-quit/process-exit/quit, while Bun still exposes null exit/signal
codes. The old helper waits its deadlines and fails `taskkill` against an already
absent wrapper. This is confirmed process-exit notification loss, not a surviving
application or a reason to repeat a product operation.

On Windows, pass a read-only exit confirmation bound to both captured process
identities into native fixture cleanup. Require ESRCH for each valid PID; an
alive process, missing identity, permission error or unavailable probe is not
success. Observe confirmation within the existing graceful/forced deadlines and
remove temporary listeners/timers on every path. Never synthesize a ChildProcess
exit event/status or kill unrelated processes. Other platforms keep their existing
notification path. Cover missing notification, wrapper-only exit, unavailable
probe and permanent survival, then replay native Windows with the same two-core
constraint. Retain separate inspector-loss and packaged-startup uncertainties;
renew full local, PR and main gates before delivery.

T105 investigation update: the confirmation-only experiment passes its 24 focused
cases but is not a sufficient runtime repair (Playwright also owns pending child
exit listeners). The next constrained run fails a distinct launch with null exit
and signal state. Do not ship the polling experiment. Bun's upstream fix #39966
identifies double-closing extra Windows stdio handles, potentially closing other
process, pipe, thread or socket handles after reuse. Its isolated child-process
regression reproduces four unrelated handle closures on the pinned 1.4.0 and
passes on official 1.4.2 with identical input. Update the maintained exact Bun
runtime and image/types pins after validating constrained native journeys without
the experimental cleanup changes. Keep the diagnostic improvements and existing
assertions/deadlines; renew all local, image, PR and main gates.

Sources: https://github.com/oven-sh/bun/pull/39966 and
https://bun.sh/blog/bun-v1.4.1 (Windows corrections); 1.4.2 includes subsequent
regression corrections documented at https://bun.sh/blog/bun-v1.4.2.
