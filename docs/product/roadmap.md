# Roadmap produit pilotée par Spec Kit

Cette roadmap traduit le
[`product-canvas.md`](product-canvas.md) en une séquence de features Spec Kit.
Le canevas reste la référence produit globale ; chaque dossier `specs/` définit
le périmètre testable d’une seule étape.

## Règles de progression

Une étape peut être spécifiée et planifiée en avance, mais son implémentation ne
commence que lorsque ses dépendances sont terminées ou explicitement isolées.
Chaque feature suit : spécification, clarification si nécessaire, plan, tâches,
analyse, implémentation, convergence, contrôles locaux, puis pull request.

Le numéro d'une feature est son identité stable, pas sa position définitive
dans la séquence. L'ordre des sections ci-dessous et leurs dépendances fixent
l'ordre prévu. Une nouvelle étape intermédiaire reçoit le prochain numéro libre
et est placée à l'endroit requis sans renommer les features déjà livrées ; la
roadmap et les dépendances concernées sont mises à jour ensemble.

## Fondation en cours

### 001 — Content foundations

**État** : convergence terminée
**Dossier** : [`specs/001-content-foundations`](../../specs/001-content-foundations/)
**Canevas** : sections 10, 11, 15, 17 à 20, 27 et 46

Cette feature établit le modèle canonique, la hiérarchie, l’identité des
contenus et fichiers, les primitives de révision, la persistance locale, la
réconciliation hors ligne et l’export de base. Les tâches T105 et T106 sont
terminées ; la convergence est donc achevée.

## V1 obligatoire

### 002 — Owner security foundation

**État** : implémentation livrée ; trois protocoles de validation humaine et
opérationnelle restent ouverts avant validation formelle de la release
**Canevas** : sections 5, 8, 9, 28, 29, 34 et 36 à 41

Authentification du propriétaire unique, passkeys, mot de passe alternatif,
sessions, appareils autorisés, chiffrement applicatif serveur et local, secrets
de déploiement, kit de récupération, rotation des clés, ainsi que la fondation
de livraison sécurisée : Compose/env, reverse proxy externe, CI, publication
GHCR et releases immuables requis par FR-030 à FR-035.

### 003 — Core workspace experience

**État** : implémentée et convergée
**Dépendance** : 001, 002
**Canevas** : sections 7 et 11 à 13

Navigation responsive, barre latérale, pages et dossiers utilisables, éditeur
par blocs, raccourcis, états de sauvegarde et accessibilité des parcours cœur.
La convergence visuelle et les interactions avancées volontairement restées
hors de cette fondation sont désormais prises en charge par la feature 017.

**La section 14 (bases de données et vues) n'est pas dans cette feature.** Elle
l'était jusqu'à la planification de 003, où cette entrée s'est révélée en
contradiction avec deux choses : la constitution, qui exige que « advanced
databases … MUST be delivered as separate specs rather than folded into the
core feature », et la feature 008 ci-dessous, qui revendiquait déjà la même
section. Une feature livrant un éditeur par blocs *et* une base de données à
cinq types de vues ne serait ni relisible ni testable indépendamment. Les cases
à cocher et les tâches simples restent dans 003 parce que ce sont des blocs
d'éditeur ; une entrée typée avec filtres enregistrés et vues Kanban ou
calendrier appartient à 009.

### 004 — Unified items and page/folder conversion

**État** : implémentée et convergée
**Dépendance** : 001, 003
**Canevas** : sections 11 et 12

Socle commun aux pages et aux dossiers, conversion dans les deux sens, et
séparation explicite entre les enfants de la hiérarchie et les pièces jointes
liées au contenu d'une page.

Cette feature a été insérée après la livraison de l'éditeur par blocs, quand
l'usage a montré que la section 11 du canevas décrivait mal le produit : elle
présentait pages et dossiers comme « deux objets distincts » alors qu'une page
fait déjà tout ce que fait un dossier, ce qui avait figé le type d'un élément à
sa création. Les entrées suivantes ont été décalées d'un rang pour lui faire
place, afin qu'un même numéro ne désigne jamais deux features différentes.

### 005 — Files and local storage

**État** : implémentée et convergée
**Dépendance** : 001 à 004
**Canevas** : sections 15 à 18

Expérience complète des fichiers et pièces jointes, prévisualisations,
quotas locaux, disponibilité hors ligne et déchargement sûr. L'ancien serveur
Draw.io a été retiré : les fichiers `.drawio` restent des pièces jointes
téléchargeables, sans éditeur externe ni service supplémentaire.

### 006 — Multi-device synchronization

**État** : implémentée et convergée
**Dépendance** : 001 à 005
**Canevas** : sections 9 et 17 à 20

Transport temps réel, rattrapage, compatibilité client-serveur, synchronisation
des fichiers, révocation d’appareil, historique et résolution visuelle des
conflits.

La feature 017 conserve ce transport, l'autorisation des appareils et le
rattrapage, mais remplace la granularité de synchronisation du corps des pages :
la fusion à trois voies par blocs livrée ici devient un filet de compatibilité,
pas le chemin éditorial V1 final.

### 007 — Backup, recovery and updates

**État** : implémentée et convergée
**Dépendance** : 002, 005, 006
**Canevas** : sections 27 à 34

Sauvegardes chiffrées vers Google Drive, vérification, restauration isolée,
export/import, migrations, mise à jour et retour arrière.

### 008 — Search and V1 release readiness

**État** : implémentée et convergée ; la validation formelle de release V1
reste conditionnée par les trois protocoles ouverts de la feature 002
**Dépendance** : 001 à 007
**Canevas** : sections 6, 21 et 35 à 45

Recherche V1, puis durcissement final transversal de la readiness V1,
validation d’intégration de toutes les features, installation documentée et
validation de tous les critères de sortie V1. La fondation Compose/env, reverse
proxy externe, CI, GHCR et releases immuables requise par FR-030 à FR-035 est
portée par la feature 002 et n’est pas dupliquée ici.

Cette readiness porte aussi le passage de langue global : la cohérence
française exigée par le canevas est validée sur l'application entière dans une
même livraison. Les features développées avant ce passage suivent la langue
active existante, externalisent leurs copies et gardent leurs valeurs
canoniques indépendantes des traductions ; aucune ne livre seule un fragment
d'interface dans une autre langue.

### 017 — V1 Notion-like workspace

**État** : spécification en cours
**Dépendance** : 003 à 008 ; intégration avec les surfaces de la 009 déjà
implémentées en avance, sans déplacer les bases avancées dans le périmètre V1
**Dossier** : [`specs/017-v1-notion-like-workspace`](../../specs/017-v1-notion-like-workspace/)
**Canevas** : sections 3, 6.1, 7, 11 à 21 et 43 à 47

Cette feature rend la qualité de l'interface et le modèle d'interaction proche
de Notion obligatoires pour la V1. Elle fait converger le shell, la barre
latérale, l'éditeur par blocs et toutes les surfaces déjà livrées autour d'un
système visuel commun. Elle fournit notamment l'insertion et les actions
contextuelles, la poignée et le déplacement de blocs, la barre de mise en forme
flottante, les blocs riches manquants, la restauration du scroll et la
correction clavier WebKit encore ouvertes après la 003.

Elle livre également l'autosauvegarde et la convergence multi-appareils du corps
des pages. Deux appareils du propriétaire peuvent modifier hors ligne le même
paragraphe, déplacer et éditer le même bloc, puis se resynchroniser sans
remplacement du document entier. Le modèle canonique reste la projection
durable et indépendante de l'éditeur ; le transport, les appareils, les
fichiers et les sauvegardes existants sont étendus plutôt que reconstruits.

La validation formelle de la V1 reste bloquée tant que cette convergence et les
protocoles ouverts de la feature 002 ne sont pas terminés.

### 018 — Durable realtime synchronization

**État** : implémentée, convergée et fusionnée
**Dépendance** : 002, 006, 017
**Dossier** : [`specs/018-durable-realtime-sync`](../../specs/018-durable-realtime-sync/)
**Canevas** : sections 9, 17 à 20, 28 à 35, 40, 42 et 43

Cette feature remplace le remplacement de document entier par des opérations
Loro durables, un canal WebSocket same-origin avec ACK après commit et une
reprise automatique hors ligne, après crash ou longue absence. Elle couvre
aussi les fichiers, la révocation d'appareil, les branches historiques, la
restauration et les régressions issues d'un HAR réel.

### 019 — Unified Bun 1.4 toolchain

**État** : implémentation en cours sur une pull request dédiée
**Dépendance** : 002, 016, 017, 018
**Dossier** : [`specs/019-bun-toolchain`](../../specs/019-bun-toolchain/)
**Canevas** : sections 38 à 47

Cette maintenance pré-V1 remplace en une fois pnpm, le runtime Node.js et les
builds de production historiques par Bun 1.4.0 exactement épinglé. Elle couvre
workspaces, lockfile, scripts, tests, CI, builds Web/API et images, sans changer
les données ni le protocole produit. Le temps réel conserve Fastify et utilise
le module `ws` intégré à Bun avec les mêmes protections de session.

### 016 — CI cache and selective tests

**État** : implémentée et validée localement ; prête pour la pull request
**Dépendance** : 002
**Dossier** : [`specs/016-ci-cache-selective-tests`](../../specs/016-ci-cache-selective-tests/)
**Canevas** : sections 38 à 42

Cette maintenance transversale est avancée avant les features 006 à 015 parce
que la durée de la CI ralentit déjà chaque livraison. Elle complète la fondation
de la feature 002 avec des caches cloisonnés par niveau de confiance, une
sélection conservatrice des tests impactés, une matrice navigateur isolée, des
preuves de sélection lisibles et l’annulation des exécutions de pull request
devenues obsolètes. Elle ne réduit ni le contrôle local complet, ni les gates de
`main`, de release, de sécurité, de construction ou de publication.

## Après la V1

### 009 — Databases and structured tasks

**État** : implémentée et convergée ; gate local exact réussi, prête pour la
pull request
**Dépendance** : 001 à 008
**Dossier** : [`specs/009-databases-structured-tasks`](../../specs/009-databases-structured-tasks/)
**Canevas** : section 14

Capacité base attachée aux pages canoniques, huit types de propriété, relations,
filtres, tris, regroupements, tâches structurées et vues table, liste, Kanban,
galerie et calendrier. La livraison inclut aussi l'offline, la synchronisation,
les conflits, la recherche, l'export, la sauvegarde, la restauration, le cycle
de vie et les budgets d'accessibilité/performance requis par cette feature.
Ses copies suivent la langue active via une frontière propre à la feature ; la
traduction française est activée avec le passage transversal de release plutôt
que comme une interface 009 partiellement traduite.

### 010 — Knowledge graph

Graphe local et global, périmètres, profondeur et filtres combinables. Canevas :
section 22.

### 011 — Whiteboards

Tableaux blancs, cartes, dessins, connexions et références canoniques. Une
éventuelle compatibilité Draw.io vient seulement ici ou dans une feature de
suivi, après les fondations V1, avec un moteur exécuté directement dans
MyOwnNotion — jamais avec un serveur Draw.io séparé ou un embed public. Canevas :
section 23.

### 012 — Public sharing and annotations

Liens publics, descendants, pièces jointes, annotations, confidentialité et
modération. Canevas : sections 24 et 25.

### 013 — MCP access

Autorisation, permissions granulaires, révocation et audit MCP. Canevas :
section 26.

### 014 — Desktop clients

**État** : spécifiée et planifiée ; prête pour l’analyse avant implémentation
**Dépendance** : 001 à 013
**Dossier** : [`specs/014-desktop-clients`](../../specs/014-desktop-clients/)
**Canevas** : section 7, avec les invariants des sections 5, 9, 17 à 20, 28 à 30 et 36 à 45

Applications Electron Windows et macOS, stockage sécurisé et mises à jour.
Canevas : section 7.

### 015 — iOS experience

Web app iOS avancée puis application native uniquement si les limites de la Web
app empêchent de satisfaire les exigences produit. Canevas : section 7.

## Condition de passage entre étapes

Une feature ne passe à l’état terminé que lorsque :

- sa checklist de spécification est complète ;
- `spec.md`, `plan.md` et `tasks.md` sont cohérents avec le canevas et la
  constitution ;
- toutes ses tâches sont terminées ;
- l’analyse et la convergence ne trouvent plus de travail bloquant ;
- les contrôles locaux et la CI réussissent ;
- la documentation et les preuves de validation sont à jour.
