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

La numérotation ci-dessous fixe l’ordre prévu. Si une urgence impose un nouvel
élément intermédiaire, la roadmap et les dépendances concernées doivent être
mises à jour ensemble.

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

**État** : spécifiée et planifiée ; prête pour l’implémentation après réussite de l’analyse
**Canevas** : sections 5, 8, 9, 28, 29, 34 et 36 à 41

Authentification du propriétaire unique, passkeys, mot de passe alternatif,
sessions, appareils autorisés, chiffrement applicatif serveur et local, secrets
de déploiement, kit de récupération, rotation des clés, ainsi que la fondation
de livraison sécurisée : Compose/env, reverse proxy externe, CI, publication
GHCR et releases immuables requis par FR-030 à FR-035.

### 003 — Core workspace experience

**État** : prévue
**Dépendance** : 001, 002
**Canevas** : sections 7 et 11 à 13

Navigation responsive, barre latérale, pages et dossiers utilisables, éditeur
par blocs, raccourcis, états de sauvegarde et accessibilité des parcours cœur.

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

**État** : prévue
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

**État** : prévue
**Dépendance** : 001 à 004
**Canevas** : sections 15 à 18

Expérience complète des fichiers et pièces jointes, prévisualisations,
Draw.io, quotas locaux, disponibilité hors ligne et déchargement sûr.

### 006 — Multi-device synchronization

**État** : prévue
**Dépendance** : 001 à 005
**Canevas** : sections 9 et 17 à 20

Transport temps réel, rattrapage, compatibilité client-serveur, synchronisation
des fichiers, révocation d’appareil, historique et résolution visuelle des
conflits.

### 007 — Backup, recovery and updates

**État** : prévue
**Dépendance** : 002, 005, 006
**Canevas** : sections 27 à 34

Sauvegardes chiffrées vers Google Drive, vérification, restauration isolée,
export/import, migrations, mise à jour et retour arrière.

### 008 — Search and V1 release readiness

**État** : prévue
**Dépendance** : 001 à 007
**Canevas** : sections 6, 21 et 35 à 45

Recherche V1, puis durcissement final transversal de la readiness V1,
validation d’intégration de toutes les features, installation documentée et
validation de tous les critères de sortie V1. La fondation Compose/env, reverse
proxy externe, CI, GHCR et releases immuables requise par FR-030 à FR-035 est
portée par la feature 002 et n’est pas dupliquée ici.

## Après la V1

### 009 — Databases and structured tasks

Propriétés, relations, filtres, tris, vues table, Kanban, galerie, liste et
calendrier. Canevas : section 14.

### 010 — Knowledge graph

Graphe local et global, périmètres, profondeur et filtres combinables. Canevas :
section 22.

### 011 — Whiteboards

Tableaux blancs, cartes, dessins, connexions et références canoniques. Canevas :
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
