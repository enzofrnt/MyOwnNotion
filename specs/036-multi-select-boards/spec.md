# Feature Specification: Kanban par sélection multiple

**Created**: 2026-10-04
**Status**: Implémenté et vérifié
**Branch**: codex/notion-api-import
**Input**: Comprendre et implémenter la fonctionnalité manquante de la vue Matière ; conserver un vrai Kanban.

## Product direction and scope

Canevas §4.2 (aucune perte silencieuse), §4.3 (hors ligne), §14 (bases et vues), §29 (import), §42–44 (validation). Dépend de 009/029 et 028. Complète le regroupement natif, sans convertir les propriétés ni dupliquer les entrées. People reste exclu. Pas de sous-groupes, regroupement par relations, nouveau type de propriété ou remise à zéro.

## User Scenarios & Testing

### US1 — Lire et configurer un Kanban par matières (P1)

Une entrée portant A et B apparaît dans les deux colonnes, avec la même identité et le même contenu. Les colonnes gardent labels, couleurs, ordre et repli. Une propriété masquée reste un axe fonctionnel.

**Independent test**: source avec titres, sélection multiple et trois options ; entrée A+B, entrée sans valeur, filtre et tri ; lecture locale et serveur puis rechargement.

**Acceptance**: A+B apparaît une fois dans chaque colonne ; total d'entrées unique ; vide dans Sans [propriété] ; aucune colonne pour une option retirée ; filtre/tri appliqués avant regroupement ; axe configurable et création disponibles avec seulement une sélection multiple ; axe indisponible signalé, sans substitution silencieuse.

### US2 — Déplacer une carte sans perdre ses autres matières (P1)

Depuis la représentation A d'une entrée A+B, déplacer vers C donne B+C. Depuis A vers B donne seulement B. Depuis Sans valeur vers C donne C. Déplacer vers Sans valeur retire toutes les sélections ; cette conséquence est annoncée avant l'action. Un geste annulé ne modifie rien. Une erreur ne prétend pas au succès et permet de recommencer.

**Independent test**: souris, menu de destination et boutons clavier/tactile ; vérifier toutes les représentations et leur persistance, y compris hors ligne.

### US3 — Retrouver les Kanbans Notion importés (P1)

L'import conserve les vues Kanban groupées par sélection multiple avec leur identité, nom, filtres, tris et propriétés visibles. Les deux vues historiquement converties en tables sur 8082 sont rétablies après sauvegarde vérifiée, en conservant tous les autres réglages et onglets, dont ceux ajoutés par le propriétaire.

**Independent test**: fixture d'import et réparation gardée, relecture après modification d'une propriété puis rechargement.

### US4 — Lire un Kanban sobre et manipuler ses commandes contextuelles (P1)

Demande du propriétaire du 2026-10-04 : améliorer l'apparence à partir de sa capture Notion. Les colonnes et cartes dominent, les formulaires permanents disparaissent des cartes et les colonnes vides restent légères. La création d'entrée existante est conservée ; cette passe ne crée pas de nouveau parcours de création par colonne.

**Independent test**: vrai Kanban à plusieurs colonnes et cartes, titre long, icône et colonne vide ; menus de destination et regroupement ; ouverture/Échap, déplacement, refus/retry, repli ; clair/sombre, desktop/320 px et cinq profils navigateur. Les appartenances multiples, la persistance et le hors ligne des US1–US3 restent valides.

## Requirements

- FR-001 : Regrouper par chaque option active sélectionnée, sans doublons de carte dans une colonne ni duplication d'entrée canonique.
- FR-002 : Total et pagination comptent les entrées uniques ; comptages de groupes comptent les appartenances du corpus filtré. La couverture incomplète garde les garanties existantes et ne présente pas de total complet inventé.
- FR-003 : Les sélections absentes/vides ou uniquement retirées apparaissent dans Sans valeur ; une option retirée reste conservée dans les données historiques. Un déplacement conserve les autres options ; si des valeurs historiques retirées empêchent une écriture, il est refusé explicitement sans nettoyage silencieux.
- FR-004 : Lecture, configuration et création natives acceptent sélection multiple, sélection simple et statut ; les réglages d'axe et de groupe restent cohérents. L'axe ne dépend pas de sa visibilité.
- FR-005 : Tout déplacement indique sa colonne d'origine ; il retire cette appartenance, ajoute la destination et conserve les autres. Un déplacement vers la même colonne est sans mutation. Sans valeur retire toutes les valeurs avec indication préalable lisible.
- FR-006 : Les mêmes règles s'appliquent aux déplacements souris, clavier et tactile ; une erreur est visible et réessayable, aucune fausse annonce de succès.
- FR-007 : Les écritures utilisent les mutations canoniques existantes, les révisions et le stockage chiffré ; le fonctionnement hors ligne et la reprise de synchronisation restent possibles.
- FR-008 : Importer n'aplatit plus ces Kanbans en tables. Réparer uniquement les vues de l'instance isolée ayant encore l'état connu de l'ancienne réparation ; sauvegarder, contrôler les révisions, vérifier les deux représentations de vue et l'idempotence ; aucun remplacement d'édition du propriétaire.
- FR-009 : Présenter des colonnes légèrement teintées par leur option, des en-têtes compacts avec compte séparé et des cartes centrées sur le titre et l'icône existante. Les commandes secondaires sont discrètes au repos, visibles au survol/focus et disponibles au toucher sans survol préalable. Aucun déplacement de mise en page lors de leur apparition.
- FR-010 : Le menu d'une carte propose les destinations au clavier, à la souris et au toucher ; Échap ferme sans mutation et rend le focus. La destination Sans valeur indique la suppression de toutes les sélections avant activation. Le regroupement reste configurable depuis le panneau compact Grouper des réglages de la vue (038). Les refus et actions en cours restent explicites ; après un déplacement réussi le focus rejoint la même entrée dans sa destination.
- FR-011 : Une carte Kanban reprend une teinte franche de l'option qui la regroupe, distincte du fond plus sombre et discret de la colonne. Les cartes ont un contour fin, accordé à la couleur sans détourner l'attention. Sans valeur conserve une surface neutre. Texte, focus, survol, déplacement et menu restent lisibles en clair et en sombre.
- FR-012 : Les fonds doux des couleurs de contenu sont définis une seule fois dans les tokens centraux et calibrés pour chaque thème : nuances claires en thème clair, tons profonds mais saturés en thème sombre. Cette palette s'applique aux badges, propriétés, surlignages et surfaces Kanban. Les couleurs pleines restent réservées aux libellés et repères qui demandent un accent ; aucun composant ne définit sa propre palette.

## Edge cases

Options dupliquées, vides ou retirées ; destination déjà sélectionnée ; axe masqué/retiré ; ordre sauvegardé incomplet ; source liée ; plus de 100 entrées ; déplacement annulé ou refusé ; révision concurrente ; propriété modifiée après restauration.

## Success Criteria

SC-001 : Tous les scénarios de lecture/mouvement passent avec mêmes valeurs côté local et serveur.
SC-002 : Les parcours passent sur les cinq profils navigateur, aux deux thèmes et à 320 px/desktop pour les états touchés ; défilement interne sans débordement de page.
SC-003 : Matière sur 8082 est un Kanban natif vérifié, autres onglets et instance UI inchangés.
