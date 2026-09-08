# Validation desktop — reprise du 5 septembre 2026

Branche : `codex/014-desktop-completion`.
Source préservée : commit local `7dc9d030` et les 150 chemins modifiés/non suivis
copiés depuis `/Users/enzofournet/Git/MyOwnNotion`. Le checkout source n'a pas été
réinitialisé ni modifié par cette reprise.

Runtime : Bun 1.4.0 ; hôte Electron 44.1.1 ; production construite par Bun.

## Preuves acquises

- Compilation des workspaces et TypeScript racine réussie.
- Package macOS ARM64 construit et exécutable packagé lancé avec un profil
  temporaire : `app.isPackaged`, architecture, sandbox, isolation du contexte,
  absence de `require` dans le rendu et focus clavier vérifiés.
- Neuf parcours Electron implémentés ; sept parcours initiaux passés sur macOS ARM64 : profil/connexion/redémarrage,
  création hors ligne puis arrêt brutal et réconciliation, révocation effective
  avec comparaison du contenu chiffré de l'outbox, fichiers natifs, refus des
  liens dangereux, erreurs de connexion et état explicite des mises à jour non
  configurées. Les ajouts sauvegarde native et ouverture du navigateur système
  ont également passé. Le parcours signé réel vérifie l'écran de report,
  téléchargement corrompu refusé et nouvelle tentative réussie avant handoff.
  Les deux scans axe onboarding/workspace/sécurité et le démarrage hors ligne
  avec édition de texte ont passé lors des contrôles ciblés suivants.
- Tests de coffre : chiffrement OS asynchrone, refus Linux sans backend protégé,
  profils isolés, absence de remplacement implicite d'une clé, reprise d'une
  enveloppe historique exacte, refus d'un format futur/corrompu sans écrasement.
- Tests de mise à jour : signatures Ed25519 réelles, mauvaise clé/signature,
  téléchargement corrompu refusé, nouvelle mutation pendant téléchargement,
  reprise après erreur, refus de downgrade et de protocole incompatible.
- 65 tests ciblés d'authentification passés, dont assertions WebAuthn P-256
  réellement signées : origines configurées, mauvaise origine/challenge,
  absence de vérification utilisateur, compteur régressant et signature altérée.
  Les routes privées refusent les lectures anonymes et les appareils révoqués ;
  les mutations exigent le CSRF de la session.

Le commit suivant a aussi validé 373 fichiers / 3555 tests et le seuil de
couverture. Une revue complémentaire a reproduit un contournement par en-tête
Upgrade sur une route HTTP ordinaire ; le passage complet a été interrompu pour
corriger ce défaut avant push. Après restriction de l'exception à la route
WebSocket enregistrée, les 58 contrats d'authentification et les deux parcours
Electron connexion/reprise hors ligne passent. Aucune requête HTTP déguisée
n'obtient un accès anonyme ni ne contourne le CSRF dans ces régressions.

## Vérifications en cours et limites de preuve

Le passage local sur `b80cf514` a validé 372 fichiers / 3551 tests et le seuil
agrégé de couverture, les huit benchmarks, les migrations et 1290 tests de
contrat. La matrice navigateur a révélé des appels de préparation de tests sans
session et l'absence de CSRF sur le transfert de fichiers par morceaux ; ce
passage a été arrêté en échec, sans push. Les corrections suivantes ont validé
19 parcours ciblés de contenu/transfert, puis les deux parcours de compatibilité
et révocation. Les 58 contrats d'authentification passent avec le diagnostic sûr
`device_revoked` pour un détenteur de session valide, sans accès au contenu.

L'écran de connexion a été contrôlé dans le package macOS réel après correction
des styles actifs. Les tests vérifient la reprise après rejet IPC, la conservation
de la saisie, le CSRF courant sur chaque chunk et le refus d'une destination
externe. L'AppImage vérifiée devient exécutable par son propriétaire avant le
handoff ; neuf tests de récupération de mise à jour passent.

Le scan Trivy 0.70.0 de l'image API linux/amd64 a passé (HIGH/CRITICAL avec
correctif : zéro). La chaîne locale complète doit être relancée sur le commit
final : elle inclut les cinq navigateurs, le package, le smoke installé et les
parcours Electron. Le passage local complet, la CI de PR et la CI du commit
fusionné sur main ne sont pas encore attestés.

La matrice CI configure les cinq cibles natives avec PostgreSQL 18 ; elle doit
encore être exécutée. Windows ARM utilise un PostgreSQL x64 de test sous
émulation, sans ajouter ce serveur au package ARM64.

Les neuf installateurs signés/notarisés n'ont pas été produits. Aucun certificat
de distribution ni secret de publication n'est configuré dans GitHub lors de
cette reprise. Le workflow vérifie les signatures natives, l'architecture et les
empreintes avant de signer les manifests. L'existence de ce code ne prouve pas
une exécution de release. Le test N→N+1 signé, les démarrages invalides après
installation et la mesure 19/20 installations par cible restent à réaliser.

La mise à jour actuelle remet l'installateur vérifié au système, puis demande
au propriétaire de terminer l'installation et de redémarrer. Elle ne remplace
pas automatiquement le binaire et n'annonce pas un faux succès d'installation.
Le coffre utilise les migrations transactionnelles Dexie du cœur client ; le
format natif initial n'a pas de migration de contenu. Aucun checkpoint fictif
ne constitue une preuve de restauration.

La couverture d'accessibilité desktop et la parité exhaustive de tous les
parcours Web doivent être distinguées des sept parcours ciblés. Les critères
SC-001, SC-002, SC-006, SC-007 et SC-008 ne sont pas déclarés intégralement
validés à ce stade. Aucun merge ou publication n'est attesté dans ce document.

Le passage complet isolé sur `934c29ff` a validé 373 fichiers / 3555 tests avec
couverture, huit benchmarks, 333 tests d'intégration et 1290 contrats. Chromium
a ensuite terminé avec 258 succès et neuf échecs ; Firefox a reproduit les
symptômes. La passe a été interrompue et n'autorise aucun push. Le diagnostic
isolé a montré que la détection runtime Web recréait SecurityApi pendant sa
première authentification, laissant le canal temps réel `idle` jusqu'au prochain
événement réseau. Le Web conserve désormais son runtime final et le desktop
attend son profil avant l'authentification. Le scénario de graphe utilise aussi
la fixture API authentifiée. Les scénarios ciblés graphe, convergence de pages
fermées, temps réel, révocation/restauration et références visuelles passent
ensemble sur Chromium. Quinze tests de routage passent, dont le profil natif
retardé qui interdit toute authentification prématurée. La passe complète sur
le nouveau commit reste obligatoire.

Une installation depuis zéro a révélé les dépendances natives historiques du
maker DMG : `fs-xattr` déclenchait une compilation implicite non épinglée et
`macos-alias` repose sur V8/NAN, incompatible avec Bun. Le prototype de compilation
épinglée a été abandonné après l'échec réel de fabrication du DMG. Le maker est
remplacé par les outils natifs macOS sous Forge/Bun. La passe sur `110d2468`
avait validé couverture, performance, intégration et contrats ; elle a été
interrompue pendant les navigateurs pour intégrer cette correction. Elle ne
constitue pas une preuve complète pour le nouveau lockfile.

Le maker `hdiutil` a ensuite produit le DMG réel macOS ARM64 avec succès via
`bun run desktop:make`. Ses deux tests passent : montage réel avec vérification
des octets, modes exécutables, attributs macOS, symlinks internes et raccourci
Applications ; refus d'un nom sortant du répertoire de sortie. Types et format
passent. Deux installations figées depuis une copie neuve des manifests passent
avec Bun seul dans le PATH (aucun Node) et une empreinte du lockfile inchangée.
Les dépendances appdmg, fs-xattr et macos-alias ont disparu du lockfile. Le DMG
local reste non signé pour distribution et n'est pas publié.

La passe complète sur `642187a2` a validé couverture, performance, intégration,
contrats et les 267 scénarios Chromium desktop. Firefox a exposé une course
sur `/page` : la création locale était durable et le lien présent, mais le
gestionnaire de navigation consultait encore le tableau React antérieur.
Le second essai passe ; la politique `--fail-on-flaky-tests` refuse cette passe.
La correction résout l'identité depuis le stockage local, en conservant le
refus des cibles supprimées et la priorité d'une navigation plus récente.
La validation complète du prochain commit reste nécessaire.

La correction de navigation passe dix répétitions du parcours `/page` sur
Firefox dans le conteneur documenté, sans retry (48,5 s), ainsi que dix tests
unitaires de résolution/navigation et la vérification des types Web. La passe
complète précédente a été arrêtée après collecte de l'échec Firefox pour
relancer tous les contrôles sur le commit corrigé.

La passe complète sur `5b16f216` valide Chromium, Firefox et WebKit desktop. Le contrôle visuel Chromium mobile détecte une alerte coffre OS indue dans le navigateur Web. Le composant garde désormais le silence sans bridge natif ; un véritable refus IPC natif produit un état indisponible expurgé, y compris dans les diagnostics. Cinq tests de rendu couvrent navigateur, coffre disponible/verrouillé/indisponible et rejet IPC ; ils passent, ainsi que les types Web. La référence visuelle existante est conservée.

La passe `bun run checks:local` sur `1a0757446878ecc306c7a07e791626acf7e97f61`
termine avec code 0 le 5 septembre : couverture, performances, 333 tests
d'intégration, 1 290 contrats, cinq projets navigateur, neuf parcours Electron,
paquet macOS installé, builds et images amd64/arm64, smoke runtime, audit des
dépendances, secrets, analyse statique, licences et Compose. Le scan Trivy épinglé
ne trouve aucune vulnérabilité haute/critique corrigible sur l'image API dont les
entrées sont inchangées par les derniers correctifs Web. La PR est
[171](https://github.com/enzofrnt/MyOwnNotion/pull/171).

La première CI de cette PR valide le desktop macOS. Elle révèle trois problèmes
distincts sur les autres cibles : cluster PostgreSQL système absent sur Ubuntu
ARM64 ; GNU tar de Git Bash interprétant `C:`/`D:` comme hôte distant sur Windows ;
fermeture de la dernière fenêtre pendant le changement de profil, qui quitte
l'application sous Linux/Windows. T088/T089 corrigent ces points et exigent une
nouvelle preuve locale puis native sur chaque runner. GitGuardian signale aussi
la liste de noms de champs expurgés dans `diagnostics.ts` comme mot de passe ;
l'incident 36954749 est un faux positif à classer dans le service, sans secret à
révoquer. Aucune validation PR/main complète ni distribution signée n'est acquise.

Les neuf parcours Electron passent ensuite sur Linux ARM64 natif dans un
conteneur de validation isolé, avec GNOME Keyring, D-Bus et Xvfb (23,4 s).
Le parcours d'onboarding vérifie explicitement qu'aucun événement de fermeture
de toutes les fenêtres ne survient et qu'une seule fenêtre finale subsiste.
La copie de sources du conteneur exclut les fichiers AppleDouble générés par
l'archivage macOS ; ces métadonnées ne sont pas des migrations SQL du dépôt.
La nouvelle passe complète locale et la CI Windows restent nécessaires.

### WebKit parity follow-up — 2026-09-05

The first PR run `33945354096` exposed two browser failures in addition to the
native fixture/window failures addressed by `5170f415`:

- WebKit mobile lost the remembered long-page scroll position on both attempts.
  The restoration effect consumed its pending anchor before its first animation
  frame; a refreshed presentation-state object canceled that frame and the next
  effect had no pending anchor. Restoration now follows page readiness and
  activation, snapshots the remembered anchor for that activation, scopes DOM
  reads to the actual editor, waits for blocks, and yields to a new user gesture.
  Three lifecycle regressions fail against the previous effect and pass against
  the correction. The real mobile journey passes 5/5 without retries.
- WebKit desktop submitted an empty Owner value in the structured convergence
  journey. The retained trace shows the bulk fill completing without the field
  acquiring the requested text. The test now enters the properties with actual
  keyboard events and checks each visible draft before saving. The existing
  second-device, offline restart, compatible merge and same-field conflict
  assertions remain. The complete journey passes 5/5 without retries. An earlier
  instrumented diagnostic series had 9 passes and one WebKit internal navigation
  error; that series is not represented as green or as a reproduction of the
  empty-property failure.

Whole-workspace TypeScript and targeted lifecycle tests pass. These changes
still require the complete pre-push gate and fresh PR/main checks; the native
signing and installed-update release evidence remains separately outstanding.

### Native Windows asset validation — 2026-09-05

The full local gate on `a9bc261c` passed, including all five browser projects,
nine native Electron journeys, production builds, multi-architecture images
and every security/Compose check. PR run `33950316597` subsequently passes
native Linux x64, Linux ARM64 and macOS ARM64. Both Windows architectures
reach the web production build but reject its required-asset inventory:
the worker patterns expect `/` while native glob paths can contain `\`.
The shared validator now normalizes separators and identifies any missing
asset class in its error. Eight focused tests cover both path families,
missing assets with misleading source maps and incorrectly located workers;
all pass, along with a real production build. Full local and fresh native
Windows validation are still required for this correction. GitGuardian's
field-name-list false positive remains unresolved externally.

The first full gate for the asset correction stops on one obsolete source-text
assertion in the toolchain contract (3,576 other tests pass). That contract now
checks the extracted validator's build wiring; its actual asset acceptance and
refusal behavior is covered by the eight executable cases. The failed pass is
not pre-push evidence; the complete gate is rerun on the corrected commit.

The complete local gate passed on `d313353ff65829e3ca98729bd0701ff04391fe4d`
and that exact commit was pushed. CI run 33953944064 validates the Windows web
build, native package and installed launch. Its next refusal occurs during the
journey fixture's guarded migration: the deployment-key loader checks POSIX
permission bits on Windows, where those bits do not express the file ACL.

T093 adds strict current-owner Windows ACL validation and explicitly restricts
the fresh fixture key. Forty focused permission/native policy tests and all
workspace types pass locally. Native Windows policy tests also grant Everyone
read permission to the disposable synthetic key and require refusal. Their actual
Windows execution remains pending; local tests do not establish Windows success.
The guarded migration and permission enforcement remain required. The server's
supported production deployment remains Linux.

Evidence: `/tmp/mon-full-gate-desktop-isolated-ports.log`,
`/tmp/mon-desktop-windows-d313.log`, `/tmp/mon-windows-key-permissions-focused.log`,
`/tmp/mon-windows-key-permissions-types.log`. The platform ACL approach follows
[Microsoft's Set-Acl documentation](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.security/set-acl).

### Native Windows follow-up — server startup diagnostics

At `6e95cf35`, the complete local gate passed (3,581 coverage tests, all five
browser projects and native macOS lifecycle/package checks). PR run
33956926120 passed both Linux architectures and macOS. Both Windows runners
passed private deployment-key validation, packaging and packaged launch; native
journey setup then exited while starting a Playwright web server. The emitted
log omitted server stdout. Preserve both servers' output and failed native
reports so the next run identifies the cause. This is diagnostic coverage,
not evidence that the Windows journeys or feature delivery pass.

### Native Windows follow-up — portable Vite startup

The complete local gate passed on `2deadab1`. Native Windows run 33959629066
then exposed the startup failure: the preview script passed the POSIX expression
`${MYOWNNOTION_WEB_DIST_DIR:-dist}` literally as its output directory on Windows.
Vite now reads the host, port and output directory directly from environment
variables in its configuration. Package scripts contain no shell substitution.
Seven focused tests pass, including Windows paths with spaces and empty-value
defaults. An actual workspace preview serves a temporary directory containing
spaces on the requested port; web TypeScript checks also pass. Complete local
validation and native Windows confirmation remain required before delivery.

### Native Windows follow-up — crash fixture process lifetime

The full local gate and a fresh image scan passed on `00235bcb`. In PR run
33984962742, both Windows architectures reach actual workspace journeys.
The offline restart fails after killing only the main Electron PID: the next
host exits with code zero while attaching its debugger. Windows x64 also
reports an `EBUSY` profile removal after an otherwise successful revocation
journey. This is consistent with descendant processes retaining profile handles;
it is not evidence of lost offline content.

The disposable crash fixture now uses PID-scoped Windows `taskkill /T /F`,
which terminates descendants as documented by
[Microsoft](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/taskkill).
It awaits termination before restart, captures the process handle before
Playwright disposes the application, and retries transient profile-removal
locks with a bounded delay. Normal shutdown still first requests graceful close.
All nine native macOS journeys pass in 26 seconds, preserving the original
offline creation/text/reconciliation, trust revocation and update assertions.
The initial local helper attempt failed because it requested the process after
Playwright disposal; that attempt is not validation evidence. The corrected
run is `/tmp/mon-desktop-process-native-corrected.log`. Full local and fresh
Windows CI evidence remain required for T094.

### Native Windows follow-up — repeated ACL inspection cost

The complete local gate passed on `7e368060` (five browser profiles, nine native
macOS journeys, production/multi-architecture builds and security checks).
PR run 33989013305 confirms Windows x64 now restarts the crashed host, restores
the queued creation and recovers the offline page text. Eight of nine native
journeys pass; the remaining failure is synchronization after connectivity
returns, against the unchanged 20-second wait. Session validation returns 200.
The server log shows roughly 0.7-second multiples for ordinary protected
requests and an unfinished multi-mutation replay at the deadline. The Windows
key loader invokes a new PowerShell ACL inspection on every key lookup. T095
addresses that cost while retaining permission enforcement and key-file changes.

Evidence: `/tmp/mon-full-gate-desktop-process-tree.log`,
`/tmp/mon-desktop-7e-windows-x64.log`, and
`/tmp/mon-win7e-x64/.e2e-logs/chromium-desktop.log`. The permission cache design
requires verification against Bun 1.4.0's Windows stat implementation and actual
Windows metadata-change tests; elapsed-time correlation alone is not proof that
the pending replay will succeed after the correction.

T095 now passes 54 focused ACL/key-loader/native-fixture cases on macOS, strict
API/desktop types and Biome. Only positive permission verdicts are cached, with
an eight-file bound and exact BigInt identity/ChangeTime checks before and after
lookup. Key bytes are still freshly read. Native Windows tests exercise warm
cache invalidation for Everyone access, inherited ACLs, file replacement and
deletion/recreation; their Windows execution remains a required CI result.

The pinned runtime delegates stat through
[Bun 1.4.0's libuv binding](https://github.com/oven-sh/bun/blob/bun-v1.4.0/src/sys/sys_uv.rs#L509).
Its [pinned Windows libuv implementation](https://github.com/oven-sh/libuv/blob/8023581113b276e7c1aee3f82da57ca0893faab1/src/win/fs.c#L1927)
maps ChangeTime to ctime separately from CreationTime;
[Bun's BigInt conversion](https://github.com/oven-sh/bun/blob/bun-v1.4.0/src/runtime/node/Stat.rs#L64)
preserves nanoseconds. Microsoft's
[security-descriptor update contract](https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-fsa/2e97fa70-e1f5-410b-ba87-f1ffda39a8ed)
updates LastChangeTime when that descriptor changes. Full source chain and
local results: `/tmp/mon-windows-acl-cache-runtime-proof.md`,
`/tmp/mon-windows-acl-cache-tests.log`, `/tmp/mon-windows-acl-cache-types.log`.

The same PR run also reports the Windows ARM64 onboarding tree still loading
after restart at the unchanged 15-second readiness deadline, alongside the
offline replay failure. Both need fresh native confirmation; local success is
not a Windows success claim. Artifact: `/tmp/mon-win7e-arm/`.

The complete local attempt on `83269ec5` stops at the unchanged absolute coverage
gate: 338 uncovered functions (budget 337), 2,218 statements (2,216), and 2,471
branches (2,465). The missing Windows loader-error paths now have executable
regressions: a warm verdict is discarded after deletion, directory replacement,
access denial or a failed read; repaired access still requires a fresh descriptor
inspection. POSIX I/O failures also remain closed. Both permission/loader suites
pass 59 cases, with 100% functions, 99.06% statements and 97.8% branches for these
two production modules; API types and Biome pass. Full aggregate validation must
be repeated, with no changed thresholds. Evidence:
`/tmp/mon-full-gate-desktop-acl-cache.log`, `/tmp/mon-acl-loader-failures.log`.

PR run 33989013305 is complete: all five browser projects, Linux x64/ARM64,
macOS ARM64 and every other application/security check passed. Windows x64 and
ARM64 native lifecycle failures keep its quality gate red; no merge or main
validation is claimed by this run.

The full attempt on `e2e79947` passes all test assertions but retains one uncovered
branch above the absolute limit (2,466 versus 2,465). That branch was an impossible
empty-iterator fallback inside a map known to contain more than eight entries.
Eviction now visits and removes its first key directly, without a cast or a
synthetic test for an unreachable state. The real eight-entry/LRU regression and
all 59 loader/permission cases still pass, along with API types and Biome.
The full gate remains required on the resulting commit. Logs:
`/tmp/mon-full-gate-desktop-acl-loader-errors.log`, `/tmp/mon-acl-final-focused.log`.


### T096 — Cold restart diagnostics prepared (2026-09-08)

CI 33993754133: all five browser profiles, API/contracts/migrations, unit coverage,
performance, builds/security, native macOS and both Linux targets pass. Both
Windows targets fail cold offline readiness (8/9 native journeys); GitGuardian
still reports the separately identified false-positive incident. No merge or
main verification is claimed.

The unchanged macOS restart journey passes ten consecutive repetitions
(`/tmp/mon-desktop-restart-repeat.log`). The explicit native-context tracing
version also passes (`/tmp/mon-desktop-native-tracing.log`). A temporary local
failure probe confirms the original exception remains visible and the separate
Electron trace plus content-free state attachment are emitted; the probe was
removed and is not part of the repository. Its trace is retained at
`/tmp/mon-native-diagnostic-probe.zip`. This instrumentation localizes the next
Windows result; it is not a claimed product fix. T096 remains open.

The exact `bcd083f7` full local gate passes on 2026-09-08: all five browser
profiles, all nine macOS native journeys, coverage, performance, database,
migration, contract, image, security and Compose gates. Evidence:
`/tmp/mon-full-gate-desktop-native-diagnostics-final.log`. It was pushed to PR 171
only after that successful gate.

CI 34197827585 passes native macOS and Linux but reproduces the Windows cold
restart failure on both architectures. The new traces contain the same rejected
native unwrap, `The wrapped key could not be opened.`, during local content
initialization. No Web Lock is held or pending. Artifacts:
`/tmp/mon-bcd-win-x64` and `/tmp/mon-bcd-win-arm`.

Electron 44.1.1 stores Windows DPAPI key metadata in Chromium `Local State` and
commits pending preferences at orderly shutdown; the preferences writer also
uses a deferred write. The fixture terminates its first Windows x64 process
about five seconds after launch. This supports investigating missing durable
key metadata, but does not yet prove it. The next diagnostic compares only
presence and equality around the same abrupt stop. No timing assertion,
crash behavior, key format or application write path changes in this step.

Source references:
[pinned Electron preferences](https://github.com/electron/electron/blob/v44.1.1/shell/browser/browser_process_impl.cc),
[pinned Chromium DPAPI provider](https://github.com/chromium/chromium/blob/152.0.7977.65/components/os_crypt/async/browser/dpapi_key_provider.cc),
[preferences writer](https://github.com/chromium/chromium/blob/152.0.7977.65/base/files/important_file_writer.cc).

## Refus explicite du stockage local — 8 septembre 2026

T097 reproduit dans le navigateur le chargement sans fin après refus temporaire
réel d'ouverture d'IndexedDB. Le parcours échoue avant correction, puis passe sur
les cinq profils : erreur expurgée, arbre/éditeur indisponibles, rétablissement
du stockage et bouton Réessayer retrouvant la même page et son texte. Aucune
base ni enveloppe n'est supprimée. Les sept tests de hiérarchie, types Web et
Biome passent. Logs : `/tmp/mon-workspace-initialization-red.log`,
`/tmp/mon-workspace-initialization-five-profiles.log`,
`/tmp/mon-workspace-initialization-unit.log`.
Cette reprise UI ne répare pas le déchiffrement Windows ; le prochain commit
exécutable exige encore le gate local complet avant push.

## Clé Windows non enregistrée — preuve et correction en cours

La CI 34203443742 sur e02693c6 reproduit le même état sur Windows x64 et ARM64 :
Local State et la clé protégée sont absents avant l'arrêt brutal, puis présents
après redémarrage avec une nouvelle clé. Les traces natives antérieures montrent
le refus de déchiffrement correspondant. Les pièces jointes ne contiennent que
des booléens ; aucune clé, empreinte ou donnée personnelle n'est publiée.

La préparation Windows utilise désormais un mode interne du même exécutable,
sans fenêtre ni service applicatif. Electron prépare son chiffrement OS, quitte
normalement pour enregistrer ses préférences, puis le parent vérifie et force
sur disque le fichier avant de terminer son propre bootstrap. Le verrou
applicatif évite deux préparations concurrentes ; l'enfant ne l'acquiert pas.
Le démarrage refuse un enfant en échec, un délai dépassé ou des métadonnées
absentes/corrompues. Les enveloppes et données existantes ne sont pas réécrites.

Ordre vérifié dans les sources épinglées :
[bootstrap Electron 44.1.1](https://github.com/electron/electron/blob/v44.1.1/shell/browser/electron_browser_main_parts.cc),
[commit des préférences à la fermeture](https://github.com/electron/electron/blob/v44.1.1/shell/browser/browser_process_impl.cc),
[verrou déjà détenu](https://github.com/electron/electron/blob/v44.1.1/shell/browser/api/electron_api_app.cc).
Les seize tests ciblés passent (arguments avec espaces, démarrage empaqueté ou
de développement, enfant en échec, anciennes métadonnées conservées, fichier
absent/corrompu/trop grand et chemins relatifs refusés), ainsi que les types.
Le parcours natif exige maintenant la présence de la clé avant l'arrêt brutal,
sans attente supplémentaire. Le gate complet et les deux CI natives restent
obligatoires ; T096 n'est pas déclaré terminé.
Les 26 tests combinés de préparation Windows, coffre, migration et cycle de
fenêtre passent ; le build desktop passe également. Logs :
`/tmp/mon-windows-key-prime-focused.log`, `/tmp/mon-windows-key-prime-build.log`.
