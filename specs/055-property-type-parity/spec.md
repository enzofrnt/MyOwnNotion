# Feature Specification: Parité Notion des types de propriété

**Feature**: `055-property-type-parity`
**Date**: 2026-11-06
**Statut**: Validée par le propriétaire (réponses du 2026-11-06)

## Problème

Les types de propriété existent partiellement, mais leur configuration est
cachée dans le panneau « Propriétés » et leur comportement ne suit pas Notion :
Nombre n'a aucun format, Date seulement « inclure l'heure », État est une simple
sélection, Identifiant n'a pas de préfixe, Agrégation ne fait que `count`,
Formule est un champ texte, Fichiers est un champ minimal, Lieu n'existe pas.
Les types donnent donc l'impression de « ne rien faire ».

## Décisions validées

- **Lieu** : recherche Google Places + vue Carte comme Notion. Clé Google requise.
- **Formule** : interface Notion (éditeur, propriétés, fonctions, aperçu, débogage,
  types), **sans IA**.
- **Fichiers** : mêmes types/limites que Notion.
- **Notifications de date** : exclues (le propriétaire ne les voit pas dans son
  Notion ; une ligne « Notifications » avait été observée sur la page de test,
  elle est hors périmètre de cette passe).
- **État** : groupes fixes À faire / En cours / Terminé ; plusieurs options par
  groupe ; une option par défaut.
- **Nombre** : tous les formats, décimales, et affichages Nombre / Barre / Anneau.
- **Identifiant** : comme Notion (préfixe, numéros uniques, lecture seule).
- **Hors périmètre** : Relation, Bouton, Personne, Créée par, Dernière modification
  par, assistante IA de formule, remplissage automatique par l'IA.

## Parcours utilisateur

### US1 — Configurer une propriété comme dans Notion (P1)
Depuis l'en-tête de colonne, l'utilisateur ouvre « Modifier la propriété » et voit
un panneau latéral avec les réglages du type ; les changements s'appliquent à
toutes les vues.

**Critères** : panneau accessible au clavier, Échap le ferme, focus rendu au
déclencheur, thèmes clair/sombre, libellés/ordre Notion, note « s'applique à
toutes les vues » quand Notion l'affiche.

### US2 — Nombre (P1)
Formats (nombre, séparateurs, pourcentage, devises), décimales, affichage
Nombre/Barre/Anneau ; valeur stockée inchangée ; rendu et filtres/tris corrects.

### US3 — Dates (P1)
Date simple/avec heure/plage ; formats de date et d'heure ; dates automatiques
(Date de création, Dernière modification) en lecture seule et formatées.

### US4 — État (P1)
Groupes fixes, options multiples par groupe, couleurs, option par défaut,
affichage en sélection ; filtres/tris/groupes par état.

### US5 — Identifiant (P2)
Préfixe configurable, numéros uniques par base, à partir de 1, jamais modifiés,
y compris pour les pages supprimées ; lecture seule.

### US6 — Agrégation (P2)
Relation, propriété cible, calcul parmi les 24 fonctions Notion, résultat
lecture seule, filtrable/triable.

### US7 — Fichiers et médias (P2)
Upload et lien, plusieurs fichiers, aperçus, types/limites Notion, suppression.

### US8 — Formule (P2)
Éditeur dédié avec propriétés, palette de fonctions et documentation, aperçu,
mode débogage, type de résultat ; erreurs explicites ; lecture seule.

### US9 — Lieu (P3)
Recherche Google Places, position actuelle, adresse ; valeur coordonnées/nom/
adresse ; filtre/tri textuels ; vue Carte avec pins.

## Exigences fonctionnelles

- **FR-001** Le menu de colonne expose « Modifier la propriété » et ouvre un
  panneau de configuration latéral.
- **FR-002** Les réglages sont persistés par propriété et s'appliquent à toutes
  les vues.
- **FR-003** Nombre : format, décimales, affichage Nombre/Barre/Anneau ; le nombre
  stocké ne change pas.
- **FR-004** Date : formats Notion, heure masquée/12/24, plages ; Notification
  exclue.
- **FR-005** Date de création / dernière modification : lecture seule, format
  d'affichage aligné sur les dates.
- **FR-006** État : groupes fixes, options multiples par groupe, défaut unique,
  couleurs ; filtre/tri/groupe.
- **FR-007** Identifiant : préfixe, numérotation unique et stable, lecture seule.
- **FR-008** Agrégation : relation, propriété cible, 24 calculs, lecture seule.
- **FR-009** Fichiers : upload/lien, multi-fichiers, aperçus, limites Notion.
- **FR-010** Formule : éditeur sans IA, propriétés, fonctions/docs, aperçu,
  débogage, type de résultat, erreurs.
- **FR-011** Lieu : Google Places (recherche/adresse/position), stockage local,
  filtre/tri textuels, vue Carte ; message clair si la clé manque.
- **FR-012** Aucune perte de données : les propriétés existantes restent lisibles
  et les migrations sont explicites.
- **FR-013** Accessibilité clavier, focus, Échap, thèmes clair/sombre, largeurs
  320/390 px pour les surfaces concernées.
- **FR-014** Clés Google et secrets jamais journalisés ; clé navigateur restreinte.

## Cas limites

- Propriété existante sans configuration : valeurs par défaut, aucune migration
  destructive.
- Conversion de type avec valeurs : dialogue d'impact existant conservé.
- Agrégation sans relation/propriété cible : contrôles désactivés avec explication.
- Formule invalide : message local, ancienne valeur conservée.
- Fichier trop volumineux/type refusé : erreur près du champ.
- Lieu sans clé Google : recherche désactivée + explication, pas de faux résultat.
- Identifiant sur base existante : numérotation rétroactive stable.

## Hors périmètre

Relation, Bouton, Personne, Créée par, Dernière modification par, IA de formule,
remplissage IA, notifications de date, synchronisation temps réel.

## Succès mesurable

- Les 8 types validés sont configurables depuis le menu de colonne et rendent
  leurs valeurs selon la configuration, sans perte de données.
- Toute surface modifiée a une preuve visuelle clair/sombre et un test automatisé
  du comportement modifié.
- Les tests existants restent verts ; les migrations sont couvertes.
