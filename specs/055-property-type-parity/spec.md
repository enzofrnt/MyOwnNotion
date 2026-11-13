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

## Complément de cadrage — 2026-11-11

Ce complément précise les US6, US8 et US9 et prime sur les constats historiques
lorsqu'ils décrivent une implémentation ou une validation. Il ne change ni les
exclusions validées ci-dessus ni le canevas produit (§ 4, 10, 14 et 17).
L'inventaire des autres types est une étude, pas une autorisation de les ajouter.
Les comportements exacts de Notion non documentés restent à observer sur un
workspace de test : ne pas supposer qu'une capture historique suffit.

- **FR-015 — Agrégation fiable** : pour une relation choisie, seule une propriété
  de la source réellement reliée et un calcul compatible sont proposés ; toute
  configuration devenue invalide est expliquée et ne présente jamais un compte
  de relations comme le résultat d'un autre calcul. Une même entrée présente le
  même résultat typé dans les vues, son volet et les formules ; filtres et tris
  concernés emploient ce résultat avant pagination, y compris hors ligne lorsque
  les données nécessaires sont disponibles.
- **FR-016 — Formule vérifiable** : l'éditeur permet de choisir une entrée pour
  l'aperçu, de consulter et insérer les propriétés et fonctions réellement
  prises en charge, de comprendre une erreur et de la corriger sans perdre son
  brouillon. L'aperçu correspond à l'entrée sélectionnée. Une expression invalide
  ne remplace pas silencieusement la dernière expression valide ; les références
  rompues, dépendances cycliques et fonctions non prises en charge sont signalées.
- **FR-017 — Lieu et carte** : une recherche de nom ou adresse affiche des
  résultats pertinents effectivement retournés par le fournisseur ; chargement,
  absence de résultat, erreur et reprise sont distincts. Une recherche plus
  récente ou effacée ne peut être remplacée par une réponse ancienne. La
  géolocalisation dépend d'une autorisation explicite et son refus laisse la
  recherche utilisable. La carte, la sélection, le filtre par nom ou adresse et
  le tri alphabétique sont vérifiés ; les lieux déjà enregistrés restent lisibles
  sans réseau ni clé. L'envoi de recherches et l'accès à la carte à un tiers
  sont expliqués ; aucun résultat fictif ni affirmation de confidentialité locale
  totale ne doit être présenté.
- **FR-018 — Preuves et compatibilité** : les parcours sont comparés à Notion
  (structure, états, clavier, clair/sombre, 320/390 px) puis testés dans les
  vues et le volet. Modifications de modèle, synchronisation, export et
  restauration préservent les données existantes ; une dépendance indisponible
  ou une donnée locale incomplète est signalée sans résultat trompeur.

### Scénarios indépendants supplémentaires

1. Deux lignes liées portent 10 et 20 : une somme vaut 30 dans la table, le volet
   et une formule qui la référence ; en filtrant `> 25`, la ligne reste trouvable
   côté serveur et local. Tester également moyenne sans valeur et source absente.
2. Deux entrées ont des valeurs distinctes : changer l'entrée d'aperçu change le
   résultat ; une expression invalide garde le brouillon et la version valide
   après fermeture ou échec. Tester renommage, suppression et cycle.
3. Rechercher un lieu, changer rapidement la saisie, puis sélectionner un
   résultat : seule la dernière recherche gagne et la valeur persiste. Tester
   erreur réseau, absence de clé, refus de position, carte indisponible et
   lecture d'un lieu enregistré hors ligne.
4. Les types absents ou incomplets sont inventoriés et classés avec preuves ;
   Personne, Bouton et les propriétés d'auteur restent hors périmètre tant que
   leur extension n'est pas explicitement décidée.

## Succès mesurable

- Les 8 types validés sont configurables depuis le menu de colonne et rendent
  leurs valeurs selon la configuration, sans perte de données.
- Toute surface modifiée a une preuve visuelle clair/sombre et un test automatisé
  du comportement modifié.
- Les tests existants restent verts ; les migrations sont couvertes.
