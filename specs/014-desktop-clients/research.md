# Research: Applications Desktop Electron Windows et macOS

## Decision 1 — Electron Forge comme orchestrateur de packaging

**Decision**: Utiliser Electron Forge avec configuration TypeScript et makers
spécifiques aux plateformes. Garder le build du rendu sous le contrôle de la
configuration Vite existante; ne pas introduire une seconde application React.

**Rationale**: Forge regroupe packaging, makers, signature et publication et
s’installe avec Bun 1.4.0, qui produit un `node_modules` classique empaquetable
sans réintroduire pnpm, npm ni Yarn. Le plugin Vite Forge reste indiqué
comme expérimental dans sa documentation; le plan limite donc son usage aux
processus natifs si nécessaire et conserve `apps/web` comme build de rendu
réutilisée.

**Alternatives considered**: `electron-builder` fournirait un autre chemin de
packaging, mais ajouterait un second choix d’outillage et une autre convention
de release sans besoin identifié; une copie générée de l’application Web
introduirait une divergence de rendu.

Sources: [Electron Forge — Getting Started](https://www.electronforge.io/),
[Forge — TypeScript configuration](https://www.electronforge.io/config/typescript-configuration),
[Forge — Vite plugin](https://www.electronforge.io/config/plugins/vite).

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
macOS ou DPAPI/Secret Service selon la plateforme. Le client-core garde la
responsabilité du chiffrement des enregistrements et de l’effacement logique.

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

## Decision 4 — Mise à jour signée et publication par plateforme

**Decision**: Utiliser le processus principal pour la détection/validation et
le mécanisme de mise à jour Electron compatible avec les artefacts Forge:
Squirrel.Windows côté Windows, artefacts DMG/ZIP signés/notarisés côté macOS.
Publier depuis un workflow GitHub Actions sur runners natifs, après vérification
des signatures, empreintes, provenance et smoke tests.

**Rationale**: Electron indique que l’auto-update cible Windows et macOS et
qu’une application macOS doit être signée pour les mises à jour. La signature
et la notarisation sont également nécessaires pour une distribution macOS
normale sans contournement de Gatekeeper.

**Alternatives considered**: Un téléchargeur maison serait plus difficile à
vérifier et à restaurer; le Mac App Store et Windows Store imposeraient un
canal de distribution supplémentaire hors périmètre de la première release.

Sources: [Electron — autoUpdater](https://www.electronjs.org/docs/latest/api/auto-updater/),
[Electron — Code Signing](https://www.electronjs.org/docs/latest/tutorial/code-signing),
[Forge — Auto Update](https://www.electronforge.io/advanced/auto-update).

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
