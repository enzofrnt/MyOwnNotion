# Implementation Plan: Couleurs de contenu

## Summary

Maintenance bornée des tokens CSS et de leurs consommateurs existants. Les
mesures Notion sont dans research.md ; leur palette détaillée est une référence,
pas une dépendance ni une promesse de reproduction pixel exacte. Canevas §§14/17,
39 et 43.6 et FR024 de 038 alignés avec la nouvelle demande. 040 reste implémenté,
sa validation finale est différée.

## Technical Context

Bun 1.4.2, CSS natif/color-mix, React/BlockNote existants. Pas de dépendance,
API, migration, permission ou écriture de données supplémentaire. Les noms de
couleurs et ColorToken stockés restent inchangés ; hors ligne identique.

## Constitution Check

I/IV : données locales et chiffrement inchangés. II/V : une feature et les
propriétaires CSS existants. VI : focus, lisibilité, métriques et thèmes vérifiés
réellement. III/VII : format/types ciblés et compilation ; E2E et gate complet
explicitement reportés par le propriétaire le 7 octobre. Aucun push ni release.
Pas de seuil de couverture modifié ni exception permanente.

## Design

apps/web/src/ui/tokens.css garde les valeurs brutes : une teinte d'accent par
famille, texte éditorial existant lisible, coefficients communs par thème et
rôles dérivés (-foreground, -soft, -wash, -badge, -border). Les ratios s'appliquent dans le
même espace sRGB que les couches transparentes mesurées. Le gris utilise les
surfaces neutres, sans prétendre être une teinte vive.

Ratios initiaux : 6 % accent pour la colonne sombre, 20 % pour la carte,
48 % sur surface active pour le badge et 25 % transparent pour le contour.
En clair : 4 %, 8 %, 16 % et 15 %. La revue a ajouté -foreground :
52 % accent + texte principal en clair, 100 % accent en sombre, pour les
compteurs et commandes colorées. Le point garde le seed intact. Ajustement
seulement après revue réelle.
Le survol reprend une augmentation de luminosité de 2,5 points HSL (clair :
réduction équivalente), sans gris ajouté au titre. Recette commune au thème.

database.css choisit ces rôles, avec correspondance des neuf tons dans son
propriétaire actuel. Les cartes/boutons conservent une bordure 1 px, stabilisant
leur géométrie. Le sélecteur Page/Dossier garde sa dérivation du support (L-024).
Les badges table/kanban/options partagent le rôle fort. editor.css reprend déjà
-soft, donc callouts et highlights reçoivent automatiquement le fond partagé.
Le laboratoire présente aussi contour/accent/fonds distincts.

Les neutres sombres se rapprochent des niveaux mesurés : canvas #191919,
élément #202020, panneau #252525, survol #262626, actif #373737, contour discret.
Les couleurs d'état et de commande restent séparées de la palette de contenu.

## UX states and verification

Suivre [ui-quality](../../.agents/skills/ui-quality/SKILL.md), son
[journal](../../.agents/skills/ui-quality/lessons.md) L-009/010/021/024 et le
[guide](../../docs/design/ui-system.md). Repos, hover, focus, vide, édition,
désactivé, option longue, badge d'un autre ton sur carte colorée ; clair/sombre,
desktop et 320 px. Captures et styles calculés dans validation.md. Palette,
volet et callouts vérifiés au laboratoire sans modifier de contenu propriétaire.
E2E différés ; aucune validation automatisée globale présentée comme passée.
