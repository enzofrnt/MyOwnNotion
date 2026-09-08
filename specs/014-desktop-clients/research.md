# Research: Applications Desktop Electron Windows, macOS et Linux

## Decision 1 — Electron Forge comme orchestrateur de packaging

**Decision**: Utiliser Electron Forge pour le packaging et les makers natifs.
Bun.build produit le rendu Web et les processus main/preload. Vite reste
uniquement le serveur de développement et de preview du Web.

**Rationale**: Cette séparation respecte la Constitution VII et réutilise
exactement le rendu Web. Le hook Forge generateAssets invoque le build Bun;
aucun plugin de bundling Vite ne participe aux artefacts de production.

La fabrication DMG utilise un maker Forge local autour de `ditto` et `hdiutil`.
L'installation propre et un vrai essai de fabrication ont révélé que la chaîne
appdmg/macos-alias exige un addon V8/NAN incompatible avec Bun. Les outils macOS
évitent ce runtime supplémentaire et conservent le même format d'installation.
La copie préserve signatures, attributs et symlinks ; l'image est vérifiée avant
publication. Le test natif monte réellement l'image et contrôle son contenu.

**Alternatives considered**: `electron-builder` fournirait un autre chemin de
packaging, mais ajouterait un second choix d’outillage et une autre convention
de release sans besoin identifié; une copie générée de l’application Web
introduirait une divergence de rendu.

Sources: [Electron Forge — Getting Started](https://www.electronforge.io/),
[Forge — TypeScript configuration](https://www.electronforge.io/config/typescript-configuration).

## Decision 2 — Rendu local, privilèges minimaux et protocole applicatif

**Decision**: Charger les assets Web packagés localement via un protocole
applicatif contrôlé. Le serveur ne fournit que des données via HTTP(S); il ne
fournit jamais du code à exécuter. Activer isolation de contexte, sandbox,
absence de Node dans le rendu, CSP, allowlists d’origines/navigation et IPC
typé avec validation du sender.

**Rationale**: Le contenu du serveur est privé et potentiellement compromis.
La frontière native doit donc rester indépendante de la confiance accordée aux
données distantes. La recommandation Electron est d’éviter `file://` au profit
d’un protocole contrôlé et de ne pas exposer les APIs Electron au contenu Web.

**Alternatives considered**: Charger directement l’URL du serveur réduirait le
packaging mais ferait du serveur une source de code privilégiée; donner
`nodeIntegration` au rendu simplifierait les appels natifs mais violerait la
frontière de sécurité.

Sources: [Electron — Security](https://www.electronjs.org/docs/latest/tutorial/security),
[Electron — Context Isolation](https://www.electronjs.org/docs/latest/tutorial/context-isolation),
[Electron — Process Sandboxing](https://www.electronjs.org/docs/latest/tutorial/sandbox),
[Electron — protocol](https://www.electronjs.org/docs/latest/api/protocol/).

## Decision 3 — Protection OS de la clé locale

**Decision**: Étendre l’abstraction `SecureKeyStorage` de `packages/client-core`
avec un adaptateur desktop piloté par le processus principal. Utiliser l’API
asynchrone `safeStorage` pour protéger l’enveloppe de clé dans le Keychain
macOS, DPAPI Windows ou Secret Service Linux selon la plateforme. Le
client-core garde la responsabilité du chiffrement des enregistrements et de
l’effacement logique.

**Rationale**: IndexedDB reste le stockage du rendu et peut conserver une
projection chiffrée, mais il ne doit pas être présenté comme un coffre OS. La
documentation Electron recommande les opérations asynchrones de `safeStorage`
et signale que leurs garanties dépendent du secret store disponible; le client
doit donc exposer l’état `available/locked/unavailable` et échouer fermé.

**Alternatives considered**: Stocker la clé en clair dans le profil Electron
ou dans `localStorage` est exclu; utiliser une dépendance native de keychain
directement dans le rendu augmenterait la surface de compilation native et
contournerait l’isolation.

Source: [Electron — safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage).

## Decision 4 — Mise à jour et paquets en téléchargement direct

**Decision**: Publier sur la GitHub Release du tag, jamais sur un store :
Squirrel (ou WiX si Squirrel ne sort pas l’ARM64) pour Windows x64 et Windows
ARM64 ; DMG pour macOS ARM64 ; **AppImage, deb et rpm** pour Linux x64 et
Linux ARM64. Runners natifs : `windows-latest`, `windows-11-arm`, `macos-14`,
`ubuntu-24.04`, `ubuntu-24.04-arm`. SHA-512 sur chaque fichier ; Authenticode
et notarisation pour Windows et macOS. Le manifeste de mise à jour Linux
pointe vers l’AppImage de la même architecture.

**Rationale**: L’utilisateur veut les trois formats Linux habituels en
téléchargement, sans dépôt. Deb et rpm ne sont pas une publication sur un
store. L’AppImage reste le canal in-app le plus simple.

**Alternatives considered**: AppImage seul ; stores ; macOS Intel ; binaire
universel.

Sources: [Electron — autoUpdater](https://www.electronjs.org/docs/latest/api/auto-updater/),
[Electron — Code Signing](https://www.electronjs.org/docs/latest/tutorial/code-signing),
[Forge — Makers](https://www.electronforge.io/config/makers).

## Decision 5 — Configuration serveur injectée à l’exécution

**Decision**: Introduire une petite abstraction de profil runtime dans
`apps/web`. Le navigateur Web conserve le mode same-origin; le desktop fournit
un profil actif validé par le processus principal, et `ContentApi`/`SecurityApi`
utilisent la même base d’URL sans dupliquer les clients HTTP.

**Rationale**: `VITE_API_URL` est une valeur de build et ne suffit pas pour une
application installée qui peut changer de serveur. Une valeur runtime permet
l’onboarding et évite de recompiler l’application pour chaque installation.

**Alternatives considered**: Un proxy local Electron cacherait les différences
mais ajouterait un service et une surface réseau inutiles; une URL codée en dur
contredirait l’auto-hébergement.

## Decision 6 — Artefacts natifs, un OS et une architecture, le plus léger possible

**Decision**: Chaque job Forge invoque `package`/`make` avec un seul
`--platform` et un seul `--arch` parmi la matrice V1. `osxUniversal` reste
désactivé. Un job Linux exécute les trois makers (AppImage, deb, rpm) sur le
même runtime packagé. Le check de release refuse un fichier hors matrice, un
binaire PE/Mach-O/ELF étranger, ou `darwin`+`x64`.

**Rationale**: Electron livre déjà un Chromium par cible ; empiler les cibles
dans un zip « universel » n’apporte rien au propriétaire et augmente fortement
la taille. FR-016 demande le plus léger que l’hôte packagé permette.

**Alternatives considered**: Un build unique qui produit les trois OS depuis
macOS via cross-compilation Electron est possible pour certains makers mais
reste plus fragile, plus lourd en cache, et plus facile à mélanger par erreur
qu’une matrice native. Un binaire macOS universel (lipo) a été rejeté : deux
tranches Chromium pour une machine qui n’en exécute qu’une.

Sources: [Electron Forge — packagerConfig](https://www.electronforge.io/config/configuration#packager-config),
[electron-packager — platform/arch](https://electron.github.io/packager/main/interfaces/Options.html).
