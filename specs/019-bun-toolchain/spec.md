# Feature Specification: Chaîne d'outils unifiée sous Bun 1.4

**Feature Branch**: `codex/019-bun-1-4-toolchain`

**Created**: 2026-08-27

**Status**: Implemented and converged

**Input**: User description: "Après avoir livré tous les retours d'interface
dans une autre PR, migrer dans une PR dédiée tout le runtime, la compilation et
la gestion des paquets de l'application vers Bun 1.4. Le produit étant encore
avant la V1, la migration peut être cassante et ne doit pas maintenir l'ancien
système pour rien."

## Product Direction, Dependencies, and Scope

Cette feature concrétise les sections 38 à 46 et la phase 0 de la section 47 du
[canevas produit](../../docs/product/product-canvas.md). Elle remplace la chaîne
d'outils historique sans modifier la promesse fonctionnelle de l'application :
un environnement propre doit installer, vérifier, compiler, exécuter et
conteneuriser le même produit de façon reproductible, localement comme dans la
CI.

La feature 019 commence seulement après la fusion de la PR consacrée aux
retours d'interface et de liens. Elle forme une PR indépendante. Elle dépend
des applications Web et API, des packages partagés, de la suite de tests, des
images Compose et des portes de livraison existantes, dont elle doit préserver
le comportement et le niveau de contrôle.

La constitution 3.1.0 rend Bun exclusif pour le runtime TypeScript/JavaScript,
les espaces de travail, les scripts et la compilation de production. Cette
feature **est livrée et convergée** : `main` n'a ni double lockfile, ni double
gestionnaire, ni second runtime applicatif. Les mentions de pnpm ou Node.js
dans les `tasks.md` / `quickstart.md` des features 001–018 décrivent l'époque
où elles ont été construites ; elles ne sont plus la procédure à suivre.
La procédure vivante est [`docs/development.md`](../../docs/development.md)
(`bun ci`, `bun run …`).

Les clients Electron (014) ne font pas partie de cette feature. Ils sont le
**prochain travail d'implémentation**, sur la même chaîne Bun, avant la clôture
V1.

La migration ne change ni le modèle de données, ni les API, ni le protocole de
synchronisation, ni le chiffrement, ni l'interface. Les évolutions UI, la
synchronisation éditoriale, Electron et les fonctions produit restent dans
leurs features respectives. Une adaptation de code est admise uniquement si
elle est nécessaire pour conserver exactement le comportement sous le nouveau
runtime.

## Clarifications

### Session 2026-08-27

- Q: La migration doit-elle partager la PR des derniers retours UI ? → R: Non.
  Les retours UI sont terminés, fusionnés et validés avant le début de cette PR.
- Q: Faut-il maintenir pnpm ou un lancement direct sous Node.js en parallèle ?
  → R: Non. Le produit est avant la V1 ; la migration est volontairement à sens
  unique et retire les anciens chemins une fois leur équivalence prouvée.
- Q: « Tout le runtime et la compilation » désigne-t-il seulement le
  gestionnaire de paquets ? → R: Non. Cela couvre les applications, les scripts
  internes, les espaces de travail, les compilations Web et API, les tests, la
  CI et les images de production.
- Q: Les outils spécialisés existants doivent-ils tous être réécrits ? → R:
  Non. Un vérificateur de types, un moteur de tests ou un outil de navigateur
  peut rester lorsqu'il apporte une capacité distincte, à condition d'être
  installé, lancé et orchestré par Bun et de ne pas réintroduire un runtime ou
  un gestionnaire parallèle.
- Q: Quelle version cible ? → R: La version stable Bun 1.4 disponible au début
  de la feature est épinglée exactement et utilisée partout ; toute montée de
  version ultérieure fera l'objet d'un changement explicite du verrouillage.
- Q: Faut-il migrer des données utilisateur ? → R: Non. Aucun schéma ni format
  persistant ne change. Les données et sauvegardes existantes doivent rester
  lisibles sans conversion.
- Q: Quel moteur WebSocket employer sous Bun ? → R: Préférer le module `ws`
  intégré à Bun et ne pas charger l'implémentation npm en secours. Une petite
  adaptation du moment de l'upgrade et de l'authentification est acceptable si
  elle préserve Fastify, les contrôles de sécurité et le protocole existants ;
  remplacer tout le serveur HTTP uniquement pour adopter `Bun.serve()` ne
  serait pas proportionné à cette migration.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Préparer et lancer le dépôt avec un seul outil (Priority: P1)

En tant que contributeur partant d'une machine propre, je peux installer les
dépendances et lancer le développement avec la version déclarée d'un seul
outil, sans installer l'ancienne chaîne ni deviner quelle commande utiliser.

**Why this priority**: Une migration de runtime n'est réelle que si une machine
propre n'a plus besoin du système remplacé. Ce parcours conditionne tous les
autres travaux du dépôt.

**Independent Test**: Préparer un environnement sans Node.js, npm, Yarn ni
pnpm accessibles, installer uniquement la version déclarée de Bun, cloner le
dépôt, effectuer une installation verrouillée puis démarrer les applications
Web et API.

**Acceptance Scenarios**:

1. **Given** un clone propre et la version exacte déclarée de Bun, **When** le
   contributeur installe les dépendances en mode verrouillé, **Then** tous les
   espaces de travail sont installés et aucun autre gestionnaire n'est invoqué.
2. **Given** une version absente ou différente de Bun, **When** une commande du
   dépôt démarre, **Then** elle échoue rapidement avec la version attendue et
   une instruction exploitable.
3. **Given** des manifestes qui ne correspondent plus au verrouillage, **When**
   l'installation reproductible est lancée, **Then** elle échoue sans modifier
   silencieusement le fichier verrouillé.
4. **Given** les dépendances installées, **When** le développement est lancé,
   **Then** les applications Web et API démarrent, se rechargent après une
   modification pertinente et utilisent uniquement le runtime déclaré.

---

### User Story 2 - Compiler et exécuter les artefacts de production avec Bun (Priority: P1)

En tant qu'administrateur de l'installation, je reçois les mêmes applications
Web et API, compilées et exécutées avec Bun, sans dépendance de production au
runtime ou aux compilateurs remplacés.

**Why this priority**: Changer seulement l'installation locale laisserait la
moitié de la chaîne et les risques de compatibilité en production. Le runtime
et les artefacts livrés sont le cœur de la demande.

**Independent Test**: Compiler les deux applications depuis un clone propre,
inspecter leurs artefacts et images, démarrer la stack, puis exécuter les
contrôles de santé et un parcours applicatif représentatif.

**Acceptance Scenarios**:

1. **Given** les sources Web et API, **When** la compilation de production est
   lancée, **Then** Bun produit les artefacts complets sans invoquer les anciens
   compilateurs de production.
2. **Given** les artefacts produits, **When** la stack officielle démarre,
   **Then** l'API s'exécute sous Bun, le Web sert ses ressources, les migrations
   s'appliquent comme avant et les contrôles de santé deviennent sains.
3. **Given** les plateformes serveur prises en charge, **When** les images sont
   construites pour `linux/amd64` et `linux/arm64`, **Then** elles contiennent
   le runtime exact déclaré, fonctionnent sans Node.js et restent non
   privilégiées.
4. **Given** une installation ou sauvegarde existante, **When** les nouvelles
   images remplacent les précédentes, **Then** les données restent lisibles et
   aucun changement de schéma ou de protocole n'est requis par la migration.

---

### User Story 3 - Conserver toutes les preuves de qualité et de livraison (Priority: P1)

En tant que mainteneur, je lance une seule porte locale et retrouve dans la CI
les mêmes vérifications qu'avant, exécutées par la nouvelle chaîne sans test
ignoré ni divergence cachée.

**Why this priority**: La migration touche le mécanisme qui vérifie tout le
produit. Une suite apparemment verte mais partiellement contournée rendrait la
transition plus risquée que l'ancien système.

**Independent Test**: Lancer la porte locale complète, puis la CI de pull
request dans un environnement propre et comparer l'inventaire des étapes, les
rapports, les cinq profils navigateur, les constructions multiarchitecture et
les contrôles de sécurité attendus.

**Acceptance Scenarios**:

1. **Given** un changement de code, **When** la porte locale complète est
   lancée, **Then** format, lint, types, tests, couverture, performances,
   migrations, contrats, navigateurs, builds, images, sécurité, licences et
   Compose sont tous vérifiés via la nouvelle commande canonique.
2. **Given** une pull request, **When** la CI s'exécute, **Then** elle installe
   la version exacte de Bun, utilise le verrouillage strict et ne prépare pas
   Node.js ou pnpm pour les étapes du projet.
3. **Given** un test ou build en échec, **When** la porte locale ou distante
   atteint cette étape, **Then** l'échec reste bloquant et n'est ni masqué ni
   transformé en succès par la migration.
4. **Given** un push vert sur `main`, **When** la publication s'exécute, **Then**
   les images restent adressables par commit et proviennent des mêmes sources,
   verrouillage et scripts que ceux vérifiés dans la pull request.

---

### User Story 4 - Comprendre la rupture et les commandes actuelles (Priority: P2)

En tant que contributeur ou administrateur, je trouve une documentation unique
qui décrit les prérequis, commandes et images après migration, ainsi que la
suppression volontaire des anciens chemins.

**Why this priority**: Une chaîne techniquement correcte reste inutilisable si
les procédures courantes orientent encore vers l'outil supprimé.

**Independent Test**: Suivre la documentation depuis une machine propre,
rechercher les anciennes commandes dans les surfaces maintenues et vérifier
qu'aucune procédure active ne dépend du système retiré.

**Acceptance Scenarios**:

1. **Given** la documentation de développement et de déploiement, **When** un
   lecteur suit l'installation, les tests, les migrations, l'administration,
   la construction et Compose, **Then** chaque commande utilise la chaîne
   actuelle et fonctionne telle qu'écrite.
2. **Given** un contributeur habitué à l'ancien outil, **When** il consulte la
   note de migration, **Then** il comprend la rupture, le nouveau prérequis, le
   verrouillage et la manière de nettoyer seulement les caches obsolètes.
3. **Given** le dépôt après migration, **When** son contrat d'outillage est
   inspecté, **Then** les anciens lockfiles, métadonnées, caches CI, images de
   runtime et commandes actives ont disparu.

### Edge Cases

- Un hôte possède encore Node.js ou pnpm dans son `PATH` : aucune commande ne
  doit les choisir implicitement ni réussir uniquement grâce à leur présence.
- La version de Bun diffère d'un patch : le contrôle doit refuser l'exécution
  avant de produire un lockfile ou des artefacts différents.
- Une dépendance d'espace de travail possède un cycle, un `peerDependency` ou
  un script d'installation traité différemment : la migration doit détecter la
  divergence et conserver le graphe réellement verrouillé.
- Une commande tierce possède un shebang Node.js : le dépôt doit l'exécuter
  explicitement sous Bun ou remplacer cette dépendance, jamais dépendre du
  Node.js de l'hôte par accident.
- La compilation Web contient des feuilles de style, fontes, workers, service
  worker, manifeste PWA, imports dynamiques et variables publiques : tous les
  artefacts nécessaires doivent être produits avec les mêmes garanties de
  cache et de fonctionnement hors ligne.
- L'API utilise des modules natifs ou des API Node : chaque incompatibilité doit
  être adaptée ou remplacée et couverte par le test qui exerce son comportement.
- Le module WebSocket intégré à Bun exige que l'upgrade soit accepté avant
  qu'une authentification durable asynchrone rende la main à l'event loop : le
  serveur doit refuser synchroniquement une origine ou un cookie absents,
  borner strictement tout message reçu pendant la résolution de session, puis
  fermer la connexion si cette session n'est pas valide.
- Les tests d'intégration et navigateurs démarrent plusieurs piles en parallèle
  sur un runner limité : l'isolation et la limite de concurrence existantes
  doivent rester effectives.
- Le cache CI provient de l'ancienne chaîne : il ne doit ni contaminer
  l'installation Bun ni permettre de contourner le verrouillage.
- Une construction multiarchitecture utilise une architecture différente de
  l'hôte : les dépendances optionnelles et artefacts natifs doivent correspondre
  à la cible et non au poste qui a créé le lockfile.
- Un processus conteneurisé reçoit un signal d'arrêt : il doit terminer
  proprement, transmettre le bon code de sortie et ne pas laisser de migration
  ou écriture partielle.
- L'audit de dépendances de Bun ne restitue pas exactement la même sortie que
  l'ancien outil : la politique de sévérité reste inchangée et son absence ne
  doit pas devenir une exemption silencieuse.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Le dépôt MUST déclarer une version stable exacte de Bun 1.4 comme
  unique chaîne TypeScript/JavaScript prise en charge.
- **FR-002**: Le dépôt MUST versionner un seul verrouillage de dépendances Bun
  cohérent pour tous les espaces de travail et MUST retirer le verrouillage de
  l'ancien gestionnaire.
- **FR-003**: Une installation locale ou CI MUST pouvoir utiliser le mode
  verrouillé de Bun et MUST échouer si les manifestes et le verrouillage
  divergent.
- **FR-004**: Le contrôle d'outillage MUST refuser une version de Bun différente
  de celle déclarée ainsi que toute réintroduction active de Node.js, npm, Yarn
  ou pnpm comme runtime ou gestionnaire du projet.
- **FR-005**: Tous les scripts internes TypeScript/JavaScript MUST être lancés
  directement par Bun et MUST fonctionner sans exécutable Node.js disponible.
- **FR-006**: Les applications Web et API en développement MUST s'exécuter sous
  Bun avec un rechargement adapté aux modifications pertinentes.
- **FR-007**: Les compilations de production Web et API MUST être produites par
  Bun et MUST retirer les anciens compilateurs de production du chemin actif.
- **FR-008**: Les artefacts Web MUST conserver les ressources, workers,
  manifeste, comportement PWA, découpage de cache et variables publiques
  nécessaires au fonctionnement connecté et hors ligne.
- **FR-009**: L'API compilée ou directement exécutée MUST conserver son
  comportement HTTP, temps réel, administration, migrations, arrêt propre et
  journalisation sous le runtime Bun.
- **FR-010**: Tous les packages de l'espace de travail MUST conserver leurs
  frontières, exports, vérifications de types et constructions requises sous la
  nouvelle chaîne.
- **FR-011**: La suite existante de formatage, lint, types, tests, couverture,
  performances, migrations, contrats, navigateurs et sécurité MUST rester
  bloquante et exécutable par des commandes Bun canoniques.
- **FR-012**: Une unique commande locale Bun MUST exécuter l'inventaire complet
  des portes requises avant push, avec la stratégie de parallélisation et les
  limites de ressources documentées.
- **FR-013**: Tous les jobs CI TypeScript/JavaScript MUST installer la version
  exacte de Bun et effectuer une installation strictement verrouillée. Ils ne
  MUST pas restaurer `node_modules` ni le cache de paquets Bun entre runners
  sans démontrer par une mesure propre au dépôt que cette restauration réduit
  le temps total.
- **FR-014**: Les images Web et API MUST être construites pour les architectures
  prises en charge, ne MUST pas contenir Node.js comme runtime applicatif et
  MUST conserver leurs utilisateurs non privilégiés, secrets, santé et
  contrats Compose.
- **FR-015**: Les portes de publication MUST continuer à produire des images
  immuables liées au commit et MUST refuser la publication si une preuve
  requise manque ou échoue.
- **FR-016**: Les procédures maintenues MUST employer les commandes Bun pour le
  développement, les tests, les migrations, l'administration, les builds, les
  images, Compose et la publication.
- **FR-017**: Les références historiques utiles MAY nommer l'ancienne chaîne,
  mais aucune instruction active, aucun manifeste, aucun script, aucune CI et
  aucune image maintenue ne MUST en dépendre après fusion.
- **FR-018**: La migration MUST préserver le modèle de données, les migrations
  applicatives, les formats de sauvegarde, le protocole de synchronisation et
  les API ; elle ne MUST exiger aucune conversion de contenu utilisateur.
- **FR-019**: Les échecs de compatibilité découverts sous Bun MUST être corrigés
  par une adaptation minimale et couverts par le niveau de test qui prouve le
  comportement concerné.
- **FR-020**: L'analyse de dépendances, de licences, de secrets et des images
  MUST garder au moins la même politique de blocage après le changement
  d'outil.
- **FR-021**: La migration MUST documenter sa rupture, son installation propre,
  le nettoyage ciblé des caches obsolètes et le diagnostic d'une version Bun ou
  d'un verrouillage incorrect.
- **FR-022**: Le temps réel MUST utiliser le module `ws` intégré à Bun sans
  fallback npm ; l'upgrade adapté au runtime MUST conserver la validation
  exacte d'origine, cookie, session, appareil et CSRF, et toute file précédant
  l'authentification MUST rester bornée en nombre de messages et en octets.

### Key Entities

- **Contrat d'outillage**: Version exacte du runtime autorisé, gestionnaire,
  format de verrouillage, commandes canoniques et interdictions vérifiées.
- **Verrouillage de dépendances**: Graphe reproductible partagé par tous les
  espaces de travail et toutes les plateformes prises en charge.
- **Artefact de production**: Sortie Web, API ou image construite depuis les
  sources et le verrouillage vérifiés, identifiable par commit.
- **Porte de qualité**: Inventaire ordonné de preuves locales et CI dont toute
  absence ou tout échec bloque la livraison.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Depuis un clone propre disposant uniquement de la version
  d'outillage déclarée, 100 % des dépendances s'installent en mode verrouillé et
  les applications Web et API démarrent sans Node.js, npm, Yarn ou pnpm dans le
  `PATH`.
- **SC-002**: La porte locale complète et la CI de pull request réussissent avec
  100 % de l'inventaire de contrôles obligatoire, dont les cinq profils
  navigateur, sans étape désactivée pour faire passer la migration.
- **SC-003**: Les constructions Web, API et images utilisent toutes le même
  verrouillage et la même version déclarée ; une divergence de version ou de
  manifeste provoque un échec avant publication dans 100 % des tests dédiés.
- **SC-004**: Les images `linux/amd64` et `linux/arm64` démarrent la stack
  officielle, deviennent saines et réussissent le parcours de fumée sans
  runtime applicatif historique présent.
- **SC-005**: Cent pour cent des suites existantes concernant les données,
  l'authentification, l'édition, la synchronisation, le hors-ligne, les
  sauvegardes et la restauration restent réussies sans modification de leur
  résultat fonctionnel attendu.
- **SC-006**: Une seconde installation verrouillée sans changement laisse le
  verrouillage byte-identique, et les installations prises en charge sur macOS
  et Linux n'y introduisent aucune divergence de plateforme.
- **SC-007**: Toutes les procédures actives de développement et d'exploitation
  peuvent être suivies telles qu'écrites ; l'inventaire automatisé trouve zéro
  dépendance exécutable à l'ancien runtime, gestionnaire, lockfile, cache ou
  compilateur de production.
- **SC-008**: Tous les budgets de performance et de ressources déjà bloquants
  restent satisfaits, notamment la concurrence limitée à deux piles navigateur
  sur les runners contraints.
- **SC-009**: Une installation possédant des données antérieures démarre avec
  les nouvelles images et réussit les contrôles d'intégrité sans migration de
  contenu ni changement de version du protocole applicatif.
- **SC-010**: Les contrats temps réel passent sur une vraie écoute Bun avec le
  module `ws` résolu comme module intégré ; les refus d'origine, cookie,
  session, CSRF, protocole, taille et révocation gardent leurs résultats, et
  les limites de la file précédant l'authentification sont testées à leurs
  bornes exactes.

## Assumptions

- Bun 1.4.0 est la version stable disponible et installée au début de la
  feature ; elle sera épinglée partout plutôt que remplacée implicitement par
  `latest`.
- Les navigateurs Playwright, PostgreSQL, Docker et les outils système requis
  restent des dépendances externes spécialisées ; ils ne constituent pas un
  second runtime applicatif.
- Les bibliothèques compatibles avec les API Node peuvent rester si elles
  s'exécutent correctement sous Bun ; leur présence ne justifie pas un
  processus Node.js de secours.
- Les anciens artefacts publiés restent restaurables par leur propre version.
  Le dépôt courant ne maintient pas deux chaînes pour les reconstruire.
- Les modifications de dépendances strictement nécessaires à la compatibilité
  Bun sont dans le périmètre, mais aucun remplacement fonctionnel de framework
  ou redesign produit ne l'est.

## Out of Scope

- Toute évolution visible de l'interface, des liens, de l'arborescence ou de
  l'éditeur.
- Toute modification du protocole de synchronisation, du modèle canonique ou
  du format opérationnel des pages.
- Toute migration de base de données ou de contenu utilisateur.
- L'ajout des clients Electron, d'un nouveau service ou d'un conteneur externe.
- Le maintien d'un mode de secours pnpm/Node.js après fusion.
