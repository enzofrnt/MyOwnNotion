# Implementation Plan: Expérience V1 proche de Notion et convergence locale

**Branch**: `codex/017-v1-notion-like-workspace` | **Date**: 2026-08-20 |
**Spec**: [spec.md](spec.md)

**Input**: Feature specification from
`/specs/017-v1-notion-like-workspace/spec.md`

## Summary

Remplacer l'interface provisoire par un espace de travail V1 cohérent et un
éditeur réellement proche de Notion, puis remplacer le bouton de sauvegarde et
la mutation `page.document.replace` comme chemin courant par une
autosauvegarde opérationnelle convergente.

L'éditeur visible utilise BlockNote Community avec son intégration Ariakit,
derrière un adaptateur propre à MyOwnNotion. Il apporte les blocs, la commande
`/`, la poignée, le glisser-déposer, la barre de formatage et les menus sans
recourir aux packages XL. Tailwind CSS et des primitives Ariakit communes
portent les tokens, thèmes, composants et comportements responsive de toutes
les surfaces V1.

La synchronisation éditoriale n'utilise pas le document ProseMirror/Yjs complet
de BlockNote comme autorité. Un package partagé MyOwnNotion construit un état
Loro : `LoroTree` porte la hiérarchie et les déplacements de blocs stables,
chaque bloc porte un `LoroText` riche et des métadonnées typées. Des mises à jour
incrémentales chiffrées sont persistées localement avant confirmation,
transportées par les routes HTTP et le signal SSE existants, appliquées sous
verrou serveur, puis matérialisées dans le document canonique pour lecture,
relations, recherche, export, historique et sauvegarde.

Cette séparation est volontaire : un prototype BlockNote/Yjs a correctement
fusionné deux éditions textuelles, mais une édition concurrente d'un bloc
déplacé a pu se rattacher à un bloc voisin, le déplacement ProseMirror étant
encodé comme suppression puis insertion. Le prototype Loro avec arbre mobile et
texte par bloc a convergé pour le même paragraphe, déplacement plus édition,
déplacements concurrents et suppression plus édition tout en conservant le
contenu supprimé.

## Technical Context

**Language/Version**: TypeScript 5.9.3 ; Node.js 24 ; WebAssembly distribué par
le package JavaScript Loro ; navigateurs définis par le canevas produit

**Primary Dependencies**: React 19.2, Vite 7.3, Fastify 5.7, PostgreSQL 18,
Drizzle 0.45, Dexie 4.2, BlockNote Core/React/Ariakit 0.54.x, Loro CRDT 1.14.x,
Tailwind CSS 4.3.x avec plugin Vite, Ariakit, dnd-kit et Lucide React ; aucune
dépendance BlockNote XL, aucun fournisseur de synchronisation hébergé

**Storage**: PostgreSQL pour identités, séquences, index de routage, mises à
jour et frontières ; enveloppes applicatives chiffrées pour mises à jour,
checkpoints et projections ; IndexedDB/Dexie pour checkpoint, mises à jour
locales, outbox et projection tous chiffrés ; fichiers sur le blob-store
existant

**Testing**: Vitest et fast-check pour modèle opérationnel, projection,
convergence, conflits et migrations ; tests d'intégration PostgreSQL ; contrats
API ; tests navigateur React ; Playwright multi-contextes pour édition,
offline, deux appareils, responsive, WebKit et accessibilité ; comparaisons
visuelles Playwright ; scénarios de sauvegarde/restauration ; tests de
performance dédiés

**Target Platform**: serveur Linux auto-hébergé et client Web PWA responsive ;
deux dernières versions majeures de Chrome, Edge, Firefox et Safari ; écran à
partir de 320 px et zoom 200 %

**Project Type**: monorepo pnpm d'application Web local-first avec API
auto-hébergée et package partagé de modèle opérationnel

**Performance Goals**: frappe visible en moins de 100 ms au p95 sur 500 blocs ;
éditeur utilisable en moins de 2 s ; écriture locale chiffrée confirmée sans
attendre le réseau ; lot réseau courant inférieur à 64 KiB ; changement
connecté visible sur l'autre appareil en moins de 2 s au p95 ; checkpoint de
500 blocs chargé en moins de 100 ms pour le seul modèle opérationnel sur la
machine de référence

**Constraints**: strictement mono-utilisateur mais jusqu'à 10 appareils et
plusieurs onglets ; aucune perte silencieuse ; tous les contenus et journaux
opérationnels chiffrés au repos ; modèle canonique indépendant de l'éditeur ;
pas de remplacement complet sur le chemin de frappe ; migration paresseuse et
retour arrière ; aucune expiration causée uniquement par une longue absence ;
WCAG 2.2 AA ; français initial ; aucun compte, licence ou service tiers requis

**Scale/Scope**: 100 000 pages, 1 000 000 blocs, pages interactives de 500 blocs,
10 appareils autorisés, suites de 10 000 changements distants et plusieurs
années de checkpoints/révisions consolidées ; toutes les surfaces V1 et les
surfaces 009 déjà présentes adoptent le système visuel commun

## Constitution Check

*GATE: Passed before research and re-checked after Phase 1 design.*

| Principe | Décision | Gate |
| --- | --- | --- |
| I. User Ownership and Local Resilience | Chaque transaction est chiffrée et durable localement avant envoi ; les appareils autorisés convergent après une longue absence ; le document canonique et les exports restent indépendants de l'éditeur | PASS |
| II. One Spec, Any Agent | Intention, choix, données, contrats, migration et validation sont documentés uniquement dans `specs/017-v1-notion-like-workspace`, avec une note de supersession dans la 006 historique | PASS |
| III. Incremental, Verifiable Delivery | Le travail est découpé en fondation opérationnelle, autosauvegarde, serveur, migration, éditeur, shell, surfaces puis convergence ; chaque tranche possède des tests autonomes | PASS |
| IV. Privacy and Security by Default | Mises à jour, checkpoints, projections, conflits et frontières sensibles réutilisent le chiffrement applicatif, la rotation, l'intégrité, les sauvegardes et l'expurgation existants | PASS |
| V. Simple, Modular Architecture | Le transport SSE, l'outbox, Dexie, PostgreSQL, les appareils et les fichiers sont conservés. Un seul package partagé isole le moteur opérationnel ; l'adaptateur empêche BlockNote ou Loro d'envahir le modèle canonique | PASS |
| VI. Accessible and Predictable Experience | Ariakit, alternatives clavier/toucher, focus explicite, thèmes, états de synchronisation, WCAG, 320 px, 200 %, WebKit et références visuelles sont des contrats et des gates | PASS |
| VII. Reproducible Toolchains | Dépendances TypeScript/WASM ajoutées par pnpm, versions verrouillées, licences MIT/MPL vérifiées ; aucun outil ou lockfile supplémentaire | PASS |
| VIII. Canonical Product Direction | Le plan met en œuvre les sections 3, 6.1, 7, 9 à 21, 28 à 32 et 42 à 47 amendées dans la même change ; mono-utilisateur, V1 et exclusions restent inchangés | PASS |

### Post-design re-check

- Le document canonique n'est ni supprimé ni remplacé par le format BlockNote.
- L'état opérationnel et la projection ont une relation autorité/artefact dérivé
  explicite, un digest commun et une réparation contrôlée.
- La nouvelle complexité distribuée est limitée au corps des pages ; items,
  placements, bases, fichiers et relations gardent leurs commandes existantes.
- La migration n'écrit rien sur une simple lecture et ne contourne ni sauvegarde
  préalable ni fenêtre de protocole.
- Aucun contenu opérationnel n'est stocké en clair ou envoyé à un service tiers.
- La stack essentielle n'héberge aucun éditeur de diagrammes séparé ; cette
  capacité ne peut revenir que comme moteur interne dans une feature future.

## Project Structure

### Documentation (this feature)

~~~text
specs/017-v1-notion-like-workspace/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── crdt-sync.md
│   ├── document-format-v3.md
│   ├── editor-adapter.md
│   └── ui-system.md
├── checklists/
│   └── requirements.md
└── tasks.md
~~~

### Source Code (repository root)

~~~text
packages/page-state/
├── package.json
├── src/
│   ├── document.ts
│   ├── block-tree.ts
│   ├── rich-text.ts
│   ├── canonical-projection.ts
│   ├── update-envelope.ts
│   ├── semantic-conflicts.ts
│   ├── checkpoints.ts
│   └── index.ts
└── tests/

packages/domain/src/document/
├── block.ts
├── document.ts
├── validate.ts
├── legacy.ts
└── export-markdown.ts

packages/database/
├── migrations/0008_page_operations.sql
└── src/
    ├── schema/index.ts
    └── repositories/page-operation-repository.ts

packages/client-core/src/
├── local-store/schema.ts
├── page-sync/
│   ├── local-page-state.ts
│   ├── encrypted-update-log.ts
│   ├── page-reconciler.ts
│   ├── migration.ts
│   └── tab-channel.ts
└── outbox/

packages/contracts/src/
├── content-api.ts
└── page-operations.ts

apps/api/src/
├── routes/page-operations.ts
├── page-state/
│   ├── page-operation-service.ts
│   ├── canonical-materializer.ts
│   ├── checkpoint-service.ts
│   └── page-conflict-service.ts
├── search/search-service.ts
├── backup/
└── security/

apps/web/src/
├── ui/
│   ├── tokens.css
│   ├── primitives/
│   ├── icons.tsx
│   ├── theme-provider.tsx
│   └── copy/
├── features/editor/
│   ├── blocknote-schema.ts
│   ├── editor-adapter.ts
│   ├── page-editor.tsx
│   ├── custom-blocks/
│   ├── editor-menus/
│   ├── editor-sync-status.tsx
│   └── legacy-tiptap/
├── features/navigation/
├── features/sync/
└── styles.css

apps/web/tests/
tests/e2e/
tests/performance/
~~~

**Structure Decision**: `packages/page-state` est la seule dépendance commune à
Loro. Il expose un modèle MyOwnNotion et des octets de mise à jour sans React,
BlockNote, Fastify, Dexie ou Drizzle. Le domaine conserve le contrat canonique
pur. Le client-core possède la durabilité locale ; l'API possède la transaction
serveur et la matérialisation ; l'adaptateur BlockNote reste dans le Web. Cette
frontière permet de remplacer l'éditeur ou le moteur opérationnel séparément et
empêche deux chemins d'écriture concurrents.

## Design

### 1. Autorité des données et invariants

Pour un corps de page migré, l'état opérationnel est l'autorité causale de
l'édition. Il contient toutes les opérations nécessaires pour produire un état
convergent. Le document `myownnotion.document+json` reste le contrat canonique
sémantique et une projection matérialisée à une frontière précise.

Chaque matérialisation enregistre :

- la frontière opérationnelle ;
- le digest de l'état opérationnel ;
- le digest du document canonique validé ;
- la version de format ;
- la dernière révision consolidée et si la projection contient des changements
  opérationnels plus récents.

Une projection dont le digest ou la validation ne correspond pas bloque la
publication de l'état « synchronisé », l'indexation et la compaction. Elle est
reconstruite depuis le checkpoint et les mises à jour ; le serveur ne choisit
jamais la projection comme gagnante contre l'état opérationnel.

Les commandes existantes restent canoniques pour items, placements, fichiers,
relations et bases. Seul `page.document.replace` cesse d'être le chemin normal
du corps d'une page.

### 2. Modèle opérationnel d'une page

Un `LoroDoc` contient :

- un `LoroTree` racine `blocks`, avec index fractionnels activés ;
- un nœud par bloc canonique, portant `blockId`, `type`, propriétés et version
  de schéma ;
- un `LoroText` fusionnable par bloc textuel, portant texte et marques ;
- des nœuds enfants pour listes, sections, tables et structures imbriquées ;
- une valeur opaque pour les blocs/propriétés inconnus ;
- des métadonnées de schéma, jamais de libellé d'interface localisé.

Chaque session d'éditeur utilise l'identifiant pair aléatoire créé par Loro.
Un identifiant n'est jamais dérivé de l'utilisateur ou de l'appareil et n'est
jamais partagé entre deux onglets. Recharger un checkpoint peut continuer avec
un nouveau pair ; les opérations non envoyées de l'ancien pair restent dans le
checkpoint et l'update log.

Les transformations de type et propriétés utilisent des registres, mais les
intentions concurrentes incompatibles sont détectées depuis les deltas et leurs
bases causales avant qu'une règle déterministe du registre ne masque le second
choix. Le texte riche converge toujours ; une suppression contre édition ou
déplacement, et deux transformations incompatibles du même champ, deviennent
des ambiguïtés durables.

### 3. Chemin local : transaction, chiffrement, autosauvegarde

L'adaptateur convertit chaque changement BlockNote local en opérations
minimales par identité : texte/marks vers `LoroText`, insertion/suppression/move
vers `LoroTree`, propriétés vers les métadonnées du nœud. Il n'effectue jamais
un diff du document complet pour remplacer l'état.

Après chaque transaction :

1. Loro commit le lot et produit ses octets locaux.
2. Le client chiffre et écrit atomiquement mise à jour, frontière, checkpoint
   éventuel et projection canonique locale dans Dexie.
3. Seulement après commit Dexie, l'interface affiche « enregistré sur cet
   appareil » et diffuse l'update aux autres onglets.
4. Un ordonnanceur groupe les lots réseau pendant une courte fenêtre, sans
   supprimer leurs identités ni retarder la durabilité.
5. Le propriétaire qui acquiert le verrou inter-contexte d'une file récupère
   seulement les lots `sending` de cette file, puis tente le transport. Aucun
   reset global au démarrage ne peut préempter l'envoi vivant d'un autre onglet.
   Une tentative suit uniquement ses propres revendications et les libère sur
   toute sortie antérieure au commit ; si son onglet disparaît, le navigateur
   libère son verrou et le successeur reprend les mêmes identités idempotentes.
   Le drainage découvre ensuite les identités de pages par un index de routage
   sans ouvrir leurs contenus chiffrés, puis échange leurs frontières avec une
   concurrence bornée. Il ne dépend pas du montage d'un éditeur : une page
   fermée reprend au lancement, au retour du réseau et après un signal de
   changement.

Les demandes de drainage concurrentes partagent une seule promesse couvrant la
totalité des passes coalescées. Un appel arrivé pendant une passe ne peut donc
pas reprendre après cette seule passe si son arrivée en a demandé une seconde ;
les barrières d'activation observent soit une file réellement drainée, soit un
état durable encore pending/offline.

Une confirmation de frontier strictement vide peut mettre à jour les marqueurs
internes du reconciler, mais elle ne republie pas la projection. Une notification
visible n'est émise que si le lot soumis, les updates distantes, le curseur, la
version vector, le digest canonique ou l'ensemble d'ambiguïtés a matériellement
changé. Cette frontière empêche une projection identique de se notifier elle-même
en boucle et de relancer des pulls sans fin.

Les fenêtres de mutation et de transport partagées entre onglets sont protégées
par Web Locks. Les noms ne contiennent que la base locale et la ressource
workspace/page ; les tests hors navigateur injectent une file déterministe de
même sémantique. Le verrou workspace couvre toute la passe
récupération-soumission-pull et le verrou page couvre une seule page, sans
acquisition imbriquée de la même ressource.

`BroadcastChannel` n'est qu'un accélérateur. Après le commit Dexie, l'émetteur
publie l'identité, une copie des octets et la version vector de l'update. Ces
octets ne deviennent jamais une autorité de contenu : le destinataire les
compare à l'update chiffrée dans IndexedDB ou prouve que l'état durable domine
déjà causalement leur frontier avant d'adopter exclusivement cet état partagé,
de notifier la projection et de demander un drainage borné. Un onglet qui ne
peut pas vérifier ou adopter reste bloqué sans accuser réception ; le canal
ferme avec la dernière session de page.

Pendant une rafale de saisie locale, la réplique visible garde sa base
positionnelle stable : les événements BlockNote déjà produits ne sont pas
réinterprétés contre une insertion distante arrivée entre deux touches. Chaque
geste reste commité dans l'autorité Dexie ; à la fin de la rafale, la session
importe la frontier durable complète et converge avant le prochain geste.

### 4. Chemin serveur : accepter, matérialiser, notifier

Une requête d'updates contient l'identité stable du lot, la page, l'appareil, la
base causale, le digest et les octets. Le serveur :

1. authentifie appareil, session, CSRF, protocole et blocage de rotation ;
2. verrouille l'état opérationnel de la page ;
3. rejoue idempotemment un lot déjà accepté ;
4. ouvre le checkpoint chiffré et importe les mises à jour manquantes ;
5. décode, valide et applique le lot ;
6. calcule les deltas sémantiques et ambiguïtés ;
7. matérialise et valide le document canonique ;
8. met à jour liens de page, usages de fichiers et projection de recherche ;
9. chiffre checkpoint/updates, écrit la frontière d'appareil et une révision
   consolidée si la politique le demande ;
10. ajoute une entrée au flux `changes`, commit, puis notifie par SSE.

Tout se produit dans une transaction PostgreSQL logique. Une validation,
intégrité ou matérialisation échouée n'avance ni frontière ni projection et
retourne un refus durable, jamais un état partiel.

Les checkpoints utilisent deux preuves volontairement distinctes. Le digest de
snapshot garantit l'intégrité des octets scellés. Le digest opérationnel est le
hash canonique de l'identité de page et de sa version vector ; il identifie le
même ensemble causal après un rejeu, indépendamment de l'ordre choisi par Loro
pour encoder une snapshot. À chaque rollover, le serveur rouvre les octets
protégés et compare projection canonique, version vector et digest causal avant
de promouvoir le checkpoint.

Le SSE reste un signal de position. Les clients récupèrent les updates par HTTP
et version vector ; aucun WebSocket, WebRTC ou fournisseur hébergé n'est requis.

### 5. Adaptateur BlockNote

BlockNote ne lit ni n'écrit directement Dexie, l'API ou le document canonique.
`editor-adapter.ts` expose :

- construction de blocs visibles depuis l'état opérationnel ;
- conversion de `getChanges()` en commandes minimales par `block.id` ;
- application de deltas distants par insertion, update, move ou suppression
  ciblée ;
- capture/restauration de sélection par identités et positions stables ;
- suspension des callbacks locaux pendant l'application distante ;
- conversion complète uniquement pour amorçage, diagnostic et réparation.

Les IDs BlockNote sont les UUID canoniques. Le mode collaboration Yjs natif de
BlockNote est désactivé. Les tests d'adaptateur imposent notamment qu'un move
distant plus une édition locale ne déplace jamais le texte vers un voisin.

### 6. Migration et compatibilité

Le protocole de synchronisation passe à la version 3 pour les écritures de corps
de page. La version 2 reste lisible et peut continuer les commandes non
éditoriales compatibles ; une tentative `page.document.replace` d'un client v2
sur une page migrée est refusée en lecture seule avec un problème explicite.

Une page v2 non migrée reste servie depuis son document canonique. À l'ouverture
de sa surface éditable v3 connectée, lorsque le client n'a aucune branche
locale à préserver :

1. le client draine toute création, conversion ou mutation v2 du corps en vol ;
2. toute mutation locale v2 en attente est d'abord confirmée, ou convertie en
   une mise à jour d'amorçage liée à sa révision de base ;
3. le client relit la tête canonique serveur, puis le serveur construit une
   seule snapshot opérationnelle initiale depuis cette tête ;
4. snapshot, projection identique, digests et état `active` sont commités
   atomiquement ;
5. le client vérifie et écrit ce snapshot chiffré avant de monter la session
   qui accepte les gestes. Une course avec la dernière écriture legacy relit
   la tête et retente de manière bornée.

Un client v3 qui commence à modifier hors ligne depuis une projection v2 ne
fabrique pas un checkpoint Loro indépendant présenté ensuite comme fusionnable.
Deux initialisations indépendantes posséderaient des identités internes
différentes malgré des UUID canoniques identiques. Il persiste donc une
`LegacyOfflineBranch` : révision/digest de base, projection locale v3 et suite
de transactions sémantiques. À la reconnexion, le serveur active la tête
canonique courante puis traduit une seule fois le delta `base/local/head` en
opérations sur cet état actif, à granularité caractère/marque et bloc UUID. Le
checkpoint actif retourné remplace la branche uniquement après commit Dexie.
Une seconde branche legacy concurrente suit exactement la même conversion et
ne peut jamais remplacer la page complète.

Tant qu'un éditeur legacy est monté, sa session est l'unique autorité qui
déclenche cette conversion, à une frontière de sa file sérielle. Les signaux
généraux de reconnexion, SSE ou rafraîchissement peuvent synchroniser les pages
déjà actives, mais ne convertissent jamais directement une branche qui accepte
encore des gestes. Une fois l'éditeur fermé, la branche durable devient au
contraire son propre jeton de reprise : le service la découvre par son index de
statut et peut la convertir sans remonter la page, après avoir drainé toute
création ou écriture v2 dont dépend sa révision de base. Cette reprise sans
session s'exécute avec la même concurrence bornée que les autres pages.

Si une demande de conversion rejoint une réconciliation déjà en vol, le
reconciler exécute une passe dédiée après celle-ci. Une fois le checkpoint
durable reçu, une session encore montée attend sa propre reprise active avant
de libérer les gestes suivants. Si l'appareil avait déjà récupéré un checkpoint
actif créé ailleurs, la branche locale reste prioritaire à l'ouverture puis une
passe active suit obligatoirement sa conversion pour importer le résultat
fusionné ; « synchronisé » reste impossible si une commande locale a échoué.

Une conversion confirmée de page vers dossier retire dans une même transaction
locale la projection éditoriale, les updates, ambiguïtés, checkpoints et
branches, comme le serveur retire son autorité opérationnelle sous verrou avant
de changer le type. Une requête d'un appareil devenue tardive reçoit alors un
refus de protocole explicite ; elle ne peut ni ressusciter le contenu détruit ni
faire boucler le client sur une erreur serveur générique.

Le paragraphe vide que l'éditeur opérationnel amorce pour fournir une identité
de bloc stable n'est pas du contenu utilisateur et ne rend donc pas la conversion
destructive. Cette règle est unique dans le domaine partagé et utilisée par la
projection optimiste comme par la transaction serveur ; toute propriété inconnue
reste au contraire traitée comme du contenu à préserver.

Le serveur annonce le protocole 3 dans `X-MyOwnNotion-Protocol` et le client
l'envoie dans `X-MyOwnNotion-Client-Protocol`. La fenêtre générale peut encore
laisser un client v2 exécuter les commandes inchangées ; les routes
`page-operations` exigent v3, et `page.document.replace` vérifie l'état de la
page avant de lire le body. Ce contrôle par capacité évite de bloquer
artificiellement les écritures non éditoriales encore compatibles.

Une lecture simple ne migre rien. Ouvrir l'éditeur en ligne constitue en revanche
le premier besoin d'écriture compatible et active directement la page avant le
premier geste. Si le transport disparaît, la page revient à une branche locale
durable ; une migration interrompue reste `pending` ou `legacy`, jamais à moitié
active. Le retour arrière applicatif peut lire la projection canonique ; il est
en lecture seule pour une page ayant reçu des opérations v3, sauf restauration
explicite de la sauvegarde préalable.

### 7. Checkpoints, longue absence et révocation

Chaque page conserve un update log append-only et des checkpoints chiffrés.
Deux usages restent strictement séparés :

- un checkpoint de replay **complet**, créé et vérifié automatiquement lorsque
  la queue depuis le checkpoint courant atteint 512 updates, accélère le
  chargement serveur sans retirer aucun octet de l'update log ; son historique
  Loro complet accepte donc encore une branche créée avant ce checkpoint ;
- un candidat de compaction **shallow** n'est créé qu'à la frontière courante et
  ne devient la nouvelle base qu'après les gardes ci-dessous.

Le serveur importe les updates de replay par lots causalement validés. Les
fenêtres de détection d'ambiguïtés et de rattrapage sont paginées : aucun plafond
de 10 000 lignes ne peut rendre invisible la première update d'un appareil qui
revient. Le curseur numérique fourni par le client n'est qu'un indice de
recherche : le serveur dérive le plus grand préfixe réellement prouvé par la
frontier durable. Le cas courant vérifie quelques reçus indexés ; un curseur
incohérent déclenche une recherche logarithmique sur les frontiers cumulatives,
sans pouvoir sauter une update ni rescanner tout l'historique. Pour décider si
une update doit être renvoyée, le serveur compare aussi sa frontier telle
qu'elle a été **écrite par son auteur**, et pas seulement la frontier serveur
fusionnée après acceptation, afin de ne pas renvoyer sa propre branche à
l'appareil qui revient. Dans chaque lot réseau borné, le client vérifie les
digests en parallèle puis importe les updates en une opération CRDT groupée ;
l'ordre durable et l'échec atomique du lot restent conservés.

Un checkpoint n'autorise l'effacement d'opérations que lorsque :

- sa projection canonique et son digest sont vérifiés ;
- les sauvegardes requises les contiennent ;
- aucune ambiguïté non résolue ni révision retenue ne dépend des opérations ;
- la frontière de chaque appareil encore autorisé domine la limite de
  compaction.

Le temps n'avance pas cette limite. Un appareil ancien reste un coût visible de
rétention. Sa révocation, après avertissement, retire sa frontière ; une future
requête de cet appareil est refusée avant import. Un nouvel appareil reçoit un
checkpoint courant et ne nécessite pas l'historique antérieur pour commencer.

### 8. Historique, conflits, sauvegarde et restauration

Les updates conservent la causalité technique. Une fenêtre globale par page
consolide les révisions visibles : elle se ferme après 30 secondes sans update,
au plus tard après 5 minutes d'édition continue, à une fin de session propre ou
avant import, restauration, résolution d'ambiguïté et changement de schéma. Un
ordonnanceur serveur clôt les fenêtres échues ; le prochain accès le fait aussi
après un arrêt, afin de ne pas dépendre d'un timer ou de la fermeture du
navigateur.

La projection canonique courante continue d'avancer pendant une fenêtre. Son
digest/frontier restent donc séparés de `lastConsolidatedRevisionId` et du
booléen `hasUnconsolidatedChanges`. Une révision créée est immuable et
correspond exactement à la frontier clôturée. Une restauration de révision
crée des opérations nouvelles qui convergent, plutôt que remplacer
silencieusement l'état courant.

Une suppression concurrente garde le nœud supprimé et son `LoroText` dans
l'historique opérationnel. Le conflit matérialisé référence les frontières et
les blocs concernés. Résoudre confirme la suppression ou recrée un nœud vivant
portant le même UUID canonique, le contenu choisi et un placement explicite ;
les checkpoints sources restent dans la rétention de l'historique. Une
insertion concurrente sous le bloc supprimé fait partie de la branche
récupérable : ses descendants successifs, leur ordre et les enfants de cellules
de tableau sont reconstruits dans l'ordre des opérations, pas réduits au seul
sous-arbre qui existait avant la suppression.

Les archives ajoutent états opérationnels, updates retenues, checkpoints,
frontières, ambiguïtés et projections. La restauration vérifie leur
correspondance. Les updates plus récentes d'un appareil autorisé hors ligne sont
ensuite importées normalement ; elles ne perdent pas contre la date de la
sauvegarde.

### 9. Système d'interface et migration visuelle

Tailwind v4 génère les styles sans runtime. Des variables CSS sémantiques
définissent couleurs, typographie, espaces, rayons, ombres, mouvement et z-index
pour thèmes clair/sombre/système. Les primitives Ariakit portent menu, dialogue,
popover, combobox, tooltip, tabs et focus ; les composants MyOwnNotion portent
la copie, les variantes et les états. Lucide fournit une seule famille
d'icônes.

BlockNote utilise la vue Ariakit entièrement restylable. Ses blocs, menus et
barres consomment les mêmes tokens que le shell. dnd-kit porte l'arbre de
navigation et son capteur clavier ; BlockNote garde son DnD interne derrière
l'adaptateur.

Le routeur de présentation sépare deux familles de surfaces. Le workspace
affiche uniquement le contenu et les vues de connaissance, avec une navigation
et des états compacts. Les réglages et opérations — sécurité, appareils,
stockage, sauvegardes, diagnostics et gestion administrative — sont montés dans
des destinations dédiées. Ils partagent les mêmes primitives mais ne sont pas
des enfants visuels du document courant. La navigation vers ces destinations
capture page active, sélection et ancre de lecture afin que le retour rétablisse
le contexte sans remonter en haut du document.

La migration avance par couches : tokens/primitives, shell, navigation,
éditeur, séparation workspace/configuration, surfaces asynchrones communes,
puis chaque feature visible. Les anciens sélecteurs CSS sont supprimés
seulement après couverture visuelle des deux thèmes, largeurs et zooms ; aucune
deuxième bibliothèque de composants générale n'est introduite.

### 10. Validation et ordre de livraison

Les tranches d'implémentation sont :

1. modèle opérationnel pur, projection et propriétés de convergence ;
2. persistance locale chiffrée, crash recovery et migration Dexie ;
3. tokens, primitives, shell et navigation ;
4. adaptateur BlockNote et éditeur minimal sur l'état local ;
5. blocs riches et interactions Notion-like ;
6. autosauvegarde, reprise et restauration de position ;
7. contrats/stockage serveur, matérialisation, protocole, migration lazy,
   sauvegarde, historique, compaction et matrice multi-appareils ;
8. scroll final, WebKit, clavier, toucher et accessibilité ;
9. migration de toutes les surfaces V1, français, thèmes, visuels et
   performance ;
10. suppression du chemin éditorial legacy après preuve de migration.

Chaque tranche garde l'application lisible et fournit un test indépendant. Le
chemin legacy reste derrière une frontière de compatibilité jusqu'à ce que les
tests de migration, sauvegarde et restauration soient verts.

Les tranches 3 à 6 peuvent être développées contre l'état local parce qu'aucun
chemin v3 n'est encore activé en production. La page reste sur le chemin legacy
tant que la tranche 7 n'a pas prouvé stockage serveur, rollback, sauvegarde et
migration ; le nouvel éditeur ne transforme donc jamais une préparation UI en
bascule de données partielle.

## Complexity Tracking

| Complexité assumée | Pourquoi nécessaire | Alternative plus simple rejetée parce que |
| --- | --- | --- |
| État opérationnel autoritaire plus projection canonique | Fusionner caractères, marques, blocs et moves hors ligne tout en conservant export, recherche et indépendance de l'éditeur | Le document JSON complet et la fusion à trois voies créent encore un conflit pour le même paragraphe et gèrent mal l'ordre |
| Nouveau package partagé `page-state` avec Loro/WASM | Client et serveur doivent appliquer exactement les mêmes opérations et projection sans coupler le domaine pur ou React | Mettre Loro seulement dans BlockNote empêcherait validation serveur, migration contrôlée et remplacement futur de l'éditeur |
| Update log, checkpoints et frontières par appareil | Longue déconnexion, idempotence, compaction sûre, sauvegarde et restauration avec travail local plus récent | Un dernier snapshot serveur ou une rétention temporelle peut rendre un appareil autorisé incapable de fusionner |
| Adaptateur BlockNote ↔ état opérationnel | Obtenir l'UX Notion-like sans faire du format ProseMirror/Yjs une autorité de données | La collaboration Yjs native est simple mais le prototype move+edit a rattaché l'édition à un bloc voisin |
| Migration de protocole v3 paresseuse | Empêcher anciens remplacements complets et nouveaux updates de s'écraser, sans réécrire 100 000 pages au déploiement | Une migration globale augmente durée, espace, risque de panne et rollback sans bénéfice pour les pages jamais éditées |
