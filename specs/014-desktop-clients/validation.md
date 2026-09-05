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
