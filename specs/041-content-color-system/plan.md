# Implementation Plan: Couleurs de contenu

## Summary

Maintenance bornée des tokens CSS et de leurs consommateurs existants. Les
mesures Notion sont dans research.md ; leur palette détaillée est une référence,
pas une dépendance ni une promesse de reproduction pixel exacte. Canevas §§14/17,
39 et 43.6 et FR024 de 038 alignés avec la nouvelle demande. 040 reste implémenté,
sa validation finale reprend avec la publication.

## Technical Context

Bun 1.4.2, CSS natif/color-mix, React/BlockNote existants. Pas de dépendance,
API, migration, permission ou écriture de données supplémentaire. Les noms de
couleurs et ColorToken stockés restent inchangés ; hors ligne identique.

## Constitution Check

I/IV : données locales et chiffrement inchangés. II/V : une feature et les
propriétaires CSS existants. VI : focus, lisibilité, métriques et thèmes vérifiés
réellement. III/VII : format/types ciblés et compilation ; E2E et gate complet
initialement reportés par le propriétaire le 7 octobre, puis réautorisés pour
le commit, le push et la PR. Aucun changement de seuil ni release.
Pas de seuil de couverture modifié ni exception permanente.

## Design

apps/web/src/ui/tokens.css garde les valeurs brutes : une teinte d'accent par
famille, texte éditorial existant lisible, coefficients communs par thème et
rôles dérivés (-foreground, -soft, -wash, -badge, -border). Les ratios s'appliquent dans le
même espace sRGB que les couches transparentes mesurées. Le gris utilise les
surfaces neutres, sans prétendre être une teinte vive.

Ratios courants : 6 % accent pour la colonne sombre, 20 % pour la carte,
46 % sur surface active pour le badge et 25 % transparent pour le contour.
En clair : 4 %, 8 %, 16 % et 15 %. Le rôle -foreground mélange l'accent au
texte principal : 52 % accent en clair, 80 % en sombre, pour les compteurs
et commandes colorées. Le point garde le seed intact. Les ratios initiaux
48 % badge / 100 % commande sombre et leur correction mesurée sont consignés
ci-dessous et dans validation.md.
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

Reprise de publication du 7 octobre : le CSS de production réduit les recettes
color-mix à leur premier accent, contrairement au rendu de développement.
La reproduction inclut global.css et le plugin Tailwind du build. Mettre les
arguments de chaque recette dans un token intermédiaire `-mix` préserve la
fonction native jusqu'au calcul navigateur, sans changer accents, coefficients
ou consommateurs. Vérifier les neuf familles sur le bundle de production :
colonne/carte/badge distincts de l'accent, texte et commandes lisibles dans
les deux thèmes. Le contraste du badge jaune sombre, mesuré à 4,42:1 avec le
ratio initial de 48 %, impose un coefficient commun de badge à 46 % ; aucun
traitement de couleur spécifique au jaune. Le texte coloré sombre utilise
80 % accent + 20 % texte principal : l'accent bleu seul n'atteignait pas 4,5:1
sur la colonne ni au survol de création. Ce coefficient commun conserve la
teinte et couvre aussi le survol sur fond de carte. Le parcours et les captures appartiennent à T011 ; les E2E
et tous les contrôles de publication sont désormais autorisés.

## UX states and verification

Suivre [ui-quality](../../.agents/skills/ui-quality/SKILL.md), son
[journal](../../.agents/skills/ui-quality/lessons.md) L-009/010/021/024 et le
[guide](../../docs/design/ui-system.md). Repos, hover, focus, vide, édition,
désactivé, option longue, badge d'un autre ton sur carte colorée ; clair/sombre,
desktop et 320 px. Captures et styles calculés dans validation.md. Palette,
volet et callouts vérifiés au laboratoire sans modifier de contenu propriétaire.
E2E et gate de publication repris ; aucune validation automatisée globale
présentée comme passée avant leur sortie réussie.
