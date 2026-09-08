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

Le gate sur b5a9b60d passe 382 suites / 3 618 tests de couverture, les huit
benchmarks, 333 tests de base, douze scénarios de migration et 1 312 contrats.
Chromium révèle ensuite une régression T097 : remettre l'état à loading lors
d'un changement du callback de navigation retire momentanément la ligne
focalisée. Le test de clavier échoue dix fois sur dix. Le gate est arrêté
en échec, sans push (`/tmp/mon-desktop-windows-key-prime-full-gate.log`).

L'état initial fournit déjà le squelette et Réessayer recharge l'application.
Retirer cette remise à loading conserve donc la reprise après refus réel sans
recréer l'arbre pendant la navigation. Les vingt répétitions Chromium
(clavier et refus/récupération) passent, puis les huit cas des quatre autres
profils passent. Logs : `/tmp/mon-keyboard-b5a-repeat.log`,
`/tmp/mon-keyboard-recovery-corrected-repeat.log`,
`/tmp/mon-keyboard-recovery-four-profiles.log`. Le nouveau commit doit repasser
le gate complet avant push.

## Préparation Windows — frontière de lancement

Le gate local complet passe sur 9e9dcdc6 : 382 suites / 3 618 tests de couverture,
huit benchmarks, 333 tests de base, douze migrations, 1 312 contrats, les cinq
profils navigateur, neuf parcours macOS, le paquet installé, les deux
architectures d'images et les contrôles de sécurité/Compose. Le commit est poussé
après relecture de l'inventaire. Log :
`/tmp/mon-desktop-key-prime-focus-final-gate.log`.

La CI 34212459656 confirme macOS et Linux x64/ARM64, mais les deux Windows
échouent désormais au lancement du paquet, avant les parcours de reprise.
Les tests injectant le processus auxiliaire n'exerçaient pas son environnement.
Le sélecteur ELECTRON_RUN_AS_NODE est maintenant retiré, toutes casses comprises,
au lieu d'être fourni vide : l'entrée Windows épinglée vérifie sa présence.
Le comportement macOS ne suffit pas à confirmer cette frontière Windows.

Une inspection réelle du host local confirme aussi que getAppPath() est le
dossier .vite/build lorsque bootstrap.js est lancé directement. Le lancement
auxiliaire non empaqueté reçoit désormais le fichier bootstrap courant. Les
erreurs de préparation ne publient qu'une catégorie fixe et un statut numérique.

Les 73 tests desktop exécutables sur macOS et les types passent. Quatre nouveaux
cas vérifient le retrait du sélecteur sans modifier l'environnement parent.
Un nouveau cas réservé à Windows compile et lance le vrai bootstrap avec une
continuation sans fenêtre, exige son démarrage puis relance le même profil en
vérifiant la stabilité de la clé sans afficher ses octets. Il doit encore passer
sur les deux runners natifs, puis les parcours d'arrêt brutal d'origine restent
obligatoires. Logs : `/tmp/mon-windows-child-launch-focused.log`,
`/tmp/mon-windows-child-launch-types.log`. T096 reste ouvert.

## T098 — Native property input durability — 2026-09-08

CI 34212459656 additionally reports a WebKit mobile flake in the visual database
journey: immediately after filling Beta's Summary, its value is empty. The retry
passes, so the no-flaky gate correctly fails. Three isolated unmodified replays
pass, but a component reproduction and a two-device native reproduction both
fail before correction when a projection arrives between native text insertion
and input-event delivery.

The text/date control preserves that pending native edit while still accepting
untouched projection changes. Entry/property keys prevent an undelivered edit
from crossing entry identities. No validation, event timing, retry or assertion
threshold is weakened. The new native scenario saves and reopens the retained
value after the remote schema update.

Fifteen focused form, grid and value-editor cases pass, including unchanged
hydration and latest-input save, plus fourteen native journeys across all five
profiles: six WebKit mobile runs (three repetitions of the new and original
journeys), and two on each other profile. No retries. Web/root types and Biome
pass. The complete desktop gate and updated native Windows CI remain separate
pending delivery requirements.

Evidence: `/tmp/mon-9e9-webkit-mobile-ci.log`,
`/tmp/mon-native-field-projection-red.log`,
`/tmp/mon-native-field-projection-webkit-red.log`,
`/tmp/mon-native-field-identity-fixed.log`,
`/tmp/mon-native-field-related-tests.log`,
`/tmp/mon-native-field-editor-tests.log`,
`/tmp/mon-native-field-projection-webkit-fixed.log`,
`/tmp/mon-native-field-projection-other-profiles.log`.

## T099 — Deterministic native test preparation — 2026-09-08

CI 34220219342 runs the real parent/child test successfully on Windows x64
(7.2 seconds, two launches, preserved key). That job fails collection of the
WebAuthn parser suite during Electron installation. ARM fails reading null
stderr before its spawn verdict can be reported. Both logs contain overlapping
first-use Electron downloads from independent workers. Native macOS and both
Linux jobs pass. Packaged Windows launch and cold restart remain unverified.

The installed Electron 44.1.1 module starts its installer on first require.
The initial global-setup prototype proves serialized installation but conflicts
with the repository's existing Bun quality contract. The final shared preparation
runs in the Bun parent launcher (full/affected tests), and native CI calls that
same entrypoint before Vitest. It requires an absolute executable file. Native
test errors tolerate missing stdout/stderr and expose only a bounded spawn code
and status. Application behavior and the no-global-setup contract are unchanged.

A disposable copied Electron package without its binary or path marker passes
two concurrent Vitest workers with exactly one installation invocation:
`/tmp/mon-electron-cold-setup-probe.log` (`status: 0, downloads: 1, workers: 2`).
No installed dependency or owner profile is modified by the probe. All 73 local
desktop cases pass (one Windows-only case skipped); desktop/root types pass.
Logs: `/tmp/mon-electron-test-preparation-unit.log`,
`/tmp/mon-electron-test-preparation-types.log`,
`/tmp/mon-711-windows-x64-job.log`, `/tmp/mon-711-windows-arm-job.log`.

The complete a495126b local attempt passes 3,624 coverage cases, performance,
database and migration gates, then is interrupted during contracts to correct
this newly observed CI preparation race. The 4e08971c integrated attempt passes
4,250 coverage cases, all pre-browser gates and is interrupted during its first
browser project. Both exit 130 and neither is an accepted complete gate.
Their logs are `/tmp/mon-desktop-native-input-full-gate.log` and
`/tmp/mon-pre-v1-native-drafts-full-gate.log` respectively.

The c382dc53 complete attempt fails exactly that existing no-global-setup
contract (3,623 cases pass); its gate is not accepted. After moving preparation
to the Bun parent, all 46 quality/impact/invocation contracts and 73 desktop
cases pass, plus root types. A fresh disposable package again requires exactly
one installation for two parallel workers, now with separate Bun preparation
and no Vitest setup hook: `preparationStatus: 0, status: 0, downloads: 1, workers: 2`.
Logs: `/tmp/mon-desktop-prepared-electron-full-gate.log`,
`/tmp/mon-electron-parent-preparation-contracts.log`,
`/tmp/mon-electron-parent-preparation-unit.log`,
`/tmp/mon-electron-parent-preparation-types.log`,
`/tmp/mon-electron-cold-parent-preparation.log`.

### T100 — reviewed entry resolution and automatic history (2026-09-08)

CI 34220219342 WebKit mobile failed the offline structured journey at line 383:
after explicit resolution the aggregate status remained `conflict`. The trace
shows the reviewed remote property revision followed by an automatic
`page-operations.consolidated` revision with identical structured values/version.
The server refused the subsequent resolution solely because its head advanced.

A transaction regression reproduces this refusal. The real authenticated API,
operational page edits and controlled 30-second history timer reproduce it too
on unmodified code (`/tmp/mon-resolution-real-history-red.log`). The correction
recognizes at most 64 accepted, same-entry, single-parent consolidation headers;
it advances only the reviewed parent, keeps the other ancestry and preserves
current body contents. Genuine structured edits, foreign/branching/missing
lineage, rejected mutations and an excessive chain remain refused.

Fifteen transaction tests and nine actual page-history/API tests pass
(`/tmp/mon-resolution-bounded-history.log`), including exact lineage, encrypted
readback, retained body edits and unchanged unseen values on refusal. Strict
root types pass (`/tmp/mon-resolution-types-local.log`). The reproduction
checkout uses local workspace package links; its vendor dependencies are
read-only links, and the primary checkout remained unchanged during diagnosis.
Native replay, the complete renewed gate and PR/main evidence remain pending.

T100 native replay: the original `survives restart, merges compatible fields`
journey passes twice on each of Chromium desktop/mobile, Firefox desktop and
WebKit desktop/mobile (10 cases, all five projects, 100 seconds; no retries).
Firefox/WebKit use the maintained Linux container. Evidence:
`/tmp/mon-resolution-five-browser-replay.log`. This includes restart durability,
compatible field convergence, explicit conflict review and two-parent lineage.
The full gate on the preceding `5ecbfa2b` was deliberately interrupted once this
new CI defect was reproduced; it is not successful pre-push evidence.

### T101 — native fixture teardown and startup diagnosis (2026-09-08)

Root a2f2eb9b CI 34229831747 passed all five native targets. The next run of
the same executable tree, stacked documentation PR 172 / CI 34230311557,
exposed x64 and ARM teardown defects after all offline recovery assertions
had passed. x64 taskkill raced an already gone process; ARM removal returned
EBUSY. A separate x64 onboarding launch failed 277 ms after the inspector
connected, before browser DevTools output. Its cause is not yet established.

The extracted teardown regression fails on the existing implementation
(`/tmp/mon-native-cleanup-red.log`). The removal-policy regression also fails
before correction (`/tmp/mon-native-profile-removal-red.log`); pinned Bun's
native recursive rm parses but does not use maxRetries/retryDelay. The harness
now observes owned process exit before issuing shutdown, awaits that evidence
when taskkill races exit, and implements the same ten linear 100 ms retries for
transient removal errors. A surviving process and a permanent lock still fail.
Twelve teardown tests include a real Bun child and all bounded refusal paths;
the desktop corpus passes 85 cases plus the one Windows-specific local skip
(`/tmp/mon-native-teardown-desktop-unit.log`). Root TypeScript passes.

A test-only native preload now records at most 32 content-free lifecycle events
and numeric exit status, printed only on failed launch. It keeps the real app
entry point and does not catch application exceptions, retry startup, delay
readiness or relax any journey. A windowless real macOS Electron launch verifies
preload, ready, normal quit and zero exit (`/tmp/mon-native-probe-smoke.log`).
Complete gate/native Windows confirmation and the distinct startup diagnosis
remain pending; this is not a claim that teardown fixes startup.
# Main shutdown investigation — T102

The merged desktop commit fb36befc passed every native target in PR 171. Main
run 34241754881 subsequently passed all offline recovery assertions on Windows
ARM but failed process cleanup after the wrapper PID disappeared. This remains
unresolved; it is not a demonstrated loss of offline content. The Linux ARM
download HTTP 500 cleared on a targeted infrastructure retry.

Bounded shutdown diagnostics now distinguish wrapper/Electron OS liveness,
unavailable probes, runtime exit state, pipe state and allowlisted native
lifecycle stages. Sixteen focused cleanup/evidence tests pass, including a real
owned Bun process, absence versus permission refusal, bounded records and
redaction. Strict workspace types pass. Complete local, native PR and renewed
main checks remain pending; this change is diagnostic, not a claimed repair.

### T103 authentication fixture follow-up

The 0a43f6c1 complete local run failed the strict Firefox gate: one beforeEach
exceeded 60 seconds before any browser action. Its trace does not identify which
setup operation waited, and PostgreSQL logged no corresponding error. The run
was interrupted after recording that failure; it is not pre-push evidence.

Password setup still had an unbounded connection/query/final close. Its extracted
fixture now uses the existing bounded client and preserves a single credential
ID/hash across idempotent insert retries. Two fault-injection regressions first
failed against the old helper, then passed: a permanently pending socket close,
and a committed insert followed by a lost reply. Strict workspace types and
changed-file formatting/lint pass. Named setup steps will retain the precise
operation if another stall occurs. These focused checks establish the new
bounds; they do not prove the original stall's precise cause. Real browser and
complete delivery evidence remain pending on this revision.

### T102 additional native-channel observation

UI PR run 34252039882 reproduces Windows failures on unchanged desktop code.
Its x64 offline trace loses only the main inspector while renderer evaluation
and browser trace export still succeed; its onboarding trace loses browser CDP
before initialization, while the process tree is still present. These details
are recorded in the plan. Extend the diagnostic boundary to rejected offline
commands before cleanup: report captured process identities and cached window
state without querying the broken inspector. The command is never retried.
Four focused tests pass for success, original-error preservation, unavailable
reporting and a one-second reporting deadline. Strict workspace types and
changed-file format/lint pass. No application behavior or deadline is relaxed.

The preceding 1036fadc full local run passed 3,651 coverage tests, performance,
database/migration and 1,313 contract tests. It was held before its browser stage
and then deliberately stopped to include the additional diagnostic; it is not
a completed pre-push gate. A fresh complete run is required on this commit.

### T104 Bun-only packaging

A fresh Windows x64 fixture with no Node/npm reproduces the original package
failure: Forge CLI exits at `npm --version` with `spawn npm ENOENT`. Replacing
that CLI entry with the pinned Forge core API produces the actual Windows app
and passes installed smoke (`platform=win32`, `architecture=x64`, `packaged=true`)
on the same machine, without installing npm or creating a Forge skip marker.
Twelve command tests pass, including the maintained release argument forms,
unsupported-target refusal, nested publication options and error propagation.
Strict workspace types, formatting/lint and the desktop policy check pass.
Installer creation and renewed complete/PR/main gates remain pending; this fix
is separate from the unresolved intermittent Windows inspector failures.

### T105 demonstrated Windows runtime ownership defect

A two-core Windows reproduction of the original cleanup records both owned
processes absent, ended pipes, a closed window and normal quit stages while Bun
still exposes no exit notification. A polling-only experiment passes its unit
cases but does not address Playwright's own process observers and is not retained.
The next constrained run also loses a native launch. The maintained regression
then reproduces Bun 1.4.0 invalidating four unrelated descriptors after extra-pipe
cleanup and passes on 1.4.2. All nine native journeys pass on 1.4.2 under the same
CPU constraint without the polling experiment. See feature 019's maintenance
plan and validation for the exact pin change and upstream ownership fix.

The 55d74ada full local gate passed 3,667 coverage tests, eight performance groups,
341 database cases, 12 migration cases, 1,313 contracts and Chromium desktop.
It was deliberately stopped during the browser matrix to incorporate the proven
runtime repair, so it is not pre-push success. Full local and remote gates remain
required on the updated candidate.
