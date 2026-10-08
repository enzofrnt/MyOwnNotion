# Validation en cours

## Onglets du workspace — 28 septembre 2026

- Une base propriétaire et un élément de vue liée ouverts reçoivent chacun un onglet du workspace. Leurs identités et icônes restent distinctes ; les fichiers autonomes restent exclus.
- Le test ciblé `apps/web/tests/open-tabs-strip.spec.tsx` vérifie les deux onglets, l'indicateur de vue liée, l'état actif et l'activation d'une base. Les 13 tests de ce fichier passent.
- `bun run typecheck` passe sur tous les packages. Les tests unitaires ciblés des onglets, du déplacement de blocs et des icônes passent (25 tests). `git diff --check` passe.
- L'instance de développement liée au worktree répond sur `http://localhost:8080/` et ses quatre services sont sains.
- Revue visuelle encore à faire : l'outil de navigateur intégré rencontre le certificat de développement, et sa connexion Chrome a expiré. Aucune capture de cet état n'est donc validée ; les tâches UI correspondantes restent ouvertes.
- Les E2E restent différés conformément à la demande du propriétaire pendant cette phase de corrections et d'améliorations.

## Maintenance 2026-10-06 — action d'ajout de propriété

Pour les vues non tabulaires, l'action d'ajout se trouve maintenant avec le
schéma « Propriétés » dans le panneau de configuration. Le bouton plus de la
table reste dans l'en-tête des colonnes. Le typecheck Web passe et l'image Web
de l'instance isolée 8082 a été reconstruite ; 8082 répond HTTP 200, tandis que
le serveur Web de l'instance 8080 garde son démarrage inchangé. Les tests
automatisés ne sont pas relancés selon la demande du propriétaire. La revue
visuelle authentifiée reste à faire (T052).

## Maintenance largeur et formulaire — 2026-10-06

Décision : pleine largeur disponible uniquement pour une page contenant une
base pleine page ; titre et visualisation héritent de la même colonne. Les
pages éditoriales et bases intégrées gardent leur largeur de lecture. Les
champs Nom/Type/options du formulaire utilisent un patron vertical et des
actions distinctes, documenté dans le système UI. Aucun test applicatif n'est
relancé selon la demande du propriétaire. Le typecheck Web, le build Web et
`git diff --check` passent ; Biome signale 45 avertissements dans la grande
feuille `database.css`, sans erreur. L'image Web isolée est
reconstruite, seul le conteneur Web 8082 a été recréé, et les ports 8082/8080
répondent HTTP 200. API et base isolées n'ont pas redémarré ; les heures de
démarrage de l'instance principale 8080 sont inchangées. Les tâches T053/T054
restent ouvertes jusqu'à l'examen authentifié du rendu et des états.

## Ajustement des marges de base — 2026-10-06

Après le retour du propriétaire sur l'asymétrie, le conteneur d'une base pleine
page utilise des gouttières gauche/droite identiques et plus courtes ; titre,
barre des vues et visualisation gardent le même axe. Pages de prose et bases
intégrées inchangées. Build Web, format CSS et contrôle de diff passent ; tests
applicatifs laissés de côté selon la demande. Seul le Web isolé a été recréé ;
il est sain et les ports 8082/8080 répondent HTTP 200. L'API/la base isolées
n'ont pas redémarré, et les démarrages Web/API de l'instance principale restent
inchangés. Revue navigateur authentifiée après déploiement à confirmer.

Après le retour du propriétaire sur les marges trop serrées, le minimum passe
à 24 px et le maximum à 32 px. Les pages de prose et bases intégrées gardent
leurs gouttières habituelles. Build Web et format CSS passent ; seul le Web
8082 est reconstruit et recréé. 8082/8080 répondent HTTP 200 ; API isolée et
instance principale inchangées. La revue visuelle authentifiée reste à confirmer.

## Titre de source dans une base intégrée — 2026-10-06

Le bloc intégré affiche désormais le titre de la source de la vue sélectionnée,
y compris avec une seule source. Le titre suit les onglets ; une source du
conteneur reste modifiable et une source liée s'affiche en lecture seule. La
régression correspondante est ajoutée dans
`apps/web/tests/database-page-interaction.spec.tsx`, mais n'est pas exécutée,
conformément à la demande de ne pas lancer les tests. Le build et le typecheck
Web passent ; Biome et `git diff --check` passent. La capture authentifiée de la
page concernée et les états responsive/thèmes restent à vérifier (T057).
Après ces contrôles, l'image Web de l'instance isolée a été reconstruite et seul
son conteneur Web sur le port 8082 a été recréé. Les ports 8082 et 8080 répondent
HTTP 200 ; l'API isolée et les conteneurs de l'instance principale n'ont pas été
redémarrés.

## Déplacement du bloc intégré — 2026-10-06

L'ancienne surbrillance BlockNote est désactivée pour ce node view interactif.
La tentative de passer le `.bn-block-outer` vivant à `DataTransfer.setDragImage`
a rendu le fantôme inutilisable ; elle est annulée. Le rendu natif cloné par
BlockNote et la poignée restent en place, avec seulement la suppression du
calque de sélection éditoriale. Il faut reproduire le drag sur la page
authentifiée avant de choisir une autre stratégie (T059). Tests applicatifs non
lancés selon la demande du propriétaire.

### Premier essai d'ancrage — invalidé par le retour du propriétaire

Le calcul décrit ci-dessous vérifie les arguments de `setDragImage`, pas le
placement du bitmap réellement dessiné par le navigateur. Le propriétaire
signale que le fantôme reste à droite de l'écran ; cet essai ne valide donc
pas T060. La correction suivante remplace le bitmap par un overlay visible.

Sur la page fournie par le propriétaire
`http://127.0.0.1:8082/notes/01a112d2-5758-7000-81a8-60d69c00f34a`,
des gestes de souris natifs ont été effectués dans Chromium visible. Le bloc
intégré est `caa91fc5-c869-40dd-b269-2ebf2c0c3143`. Une instrumentation temporaire
de `DataTransfer.setDragImage` dans le navigateur a mesuré l'appel natif et
l'appel corrigé, sans remplacer le rendu ni le protocole de drag.

Au centre de la poignée, le contenu réel se trouve à (+16,668 ; -13,203) px du
point saisi. L'ancien hotspot (0 ; 0) place le contenu cloné à (+10 ; +13) px,
soit un décalage vertical de 26,203 px. Le hotspot corrigé (-7 ; 26) conserve
l'écart à (+17 ; -13) px. Les saisies en haut et en bas de la poignée donnent
respectivement les hotspots (-12 ; 18) et (1 ; 34). L'erreur d'arrondi est
inférieure à 0,5 px sur chaque axe, sur ces trois gestes.

À 933 × 400 px, après un défilement réel de 110 px du `.workspace-main`, le
hotspot reste (-7 ; 26) avec le même écart relatif. À 320 × 650 px, le geste
fonctionne et l'erreur reste inférieure à 0,5 px. Tous ces gestes sont annulés
par Échap. Un dépôt réel place ensuite la base entière avant son lien ; un
second dépôt la remet après le paragraphe vide d'origine. Les trois identifiants
et leur ordre d'origine sont conservés après rechargement, et la vue se charge.

Captures locales de la surface et du dépôt :
`work/notion-api/drag-anchor-drop.png` et
`work/notion-api/drag-anchor-restored.png`. Ces captures de page ne contiennent
pas le fantôme natif du système : sa position est vérifiée par les mesures des
appels natifs pendant les gestes. La fidélité optique de toutes les vues dans
le fantôme reste une limite distincte de T060 et n'est pas déclarée validée
par ces captures (T059 reste ouverte).

Biome ciblé, typecheck Web, build Web et `git diff --check` passent. Aucune
suite de tests applicatifs n'est lancée. Seul le conteneur Web isolé 8082 est
recréé ; HTTP 200 confirmé. L'API isolée et les conteneurs de l'instance 8080
gardent leurs dates de démarrage antérieures.

### Position visible du fantôme — T060 corrigée

Le clone BlockNote est maintenant affiché dans le viewport et déplacé par
translation sur les événements `drag`/`dragover`. Le bitmap natif est remplacé
par un canvas transparent d'un pixel ; son pixel RGBA mesuré est (0, 0, 0, 0).
La sélection éditoriale reste neutralisée et le protocole de dépôt est conservé.
L'aperçu garde ses dimensions existantes. Les gouttières pleine page sont
neutralisées dans ses rails et leurs enfants seulement : la colonne « Nom »
reste entièrement visible dans sa surface, au lieu d'être repoussée par la
gouttière inline de 415 px copiée depuis la page.

Sur la même page réelle, avec gestes de souris natifs dans Chromium visible,
le fantôme est désormais présent dans les captures de la page :

| État | Point du curseur | Bord gauche du fantôme | Écart contenu/curseur |
| --- | --- | --- | --- |
| Desktop 1454 × 909 | (518 ; 489) px | 524,668 px | (+16,668 ; -13,203) px |
| 933 × 400, scroll vertical 200 px | (212 ; 309) px | 218,668 px | (+16,668 ; -13,203) px |
| 320 × 650 | (133 ; 394) px | 139,668 px | (+16,668 ; -13,406) px |

Preuves inspectées : [desktop](references/drag-overlay-desktop.png),
[après scroll](references/drag-overlay-scroll.png) et
[320 px](references/drag-overlay-320.png). Ces captures montrent le fantôme
réellement affiché, contrairement à celles du premier essai. Près des bords
du viewport, il peut être partiellement hors écran : son point d'ancrage suit
toujours le curseur et n'est pas décalé pour tenter de faire tenir tout le bloc.

Échap supprime le fantôme et le canvas sur les trois parcours. Un dépôt réel
déplace le bloc entier au début de la page ; un second dépôt restaure sa place
d'origine. L'ordre de tous les identifiants est retrouvé après rechargement,
la base se charge et aucune erreur navigateur n'est relevée. Pas de fantôme,
de canvas ni d'écouteur de suivi conservé après la fin du geste. Les autres
formats de vue restent à contrôler pour la fidélité complète de T059.

Biome ciblé TS/TSX, format CSS, typecheck et build Web ainsi que
`git diff --check` passent. Le lint CSS contient des avertissements préexistants,
sans nouveau correctif global de cascade. Aucune suite de tests applicatifs
n'est lancée. Seul le Web isolé 8082 est reconstruit/recréé, HTTP 200 confirmé ;
les dates de démarrage des conteneurs principaux et de l'API isolée restent
inchangées.

### Largeur du fantôme — T061 corrigée

Le retour du propriétaire valide la position mais signale un aperçu trop
étroit. Le clone reprend désormais la largeur mesurée du bloc vivant au début
du geste. La limite générique de 28rem et le padding de 10 px de l'aperçu sont
neutralisés pour cette base uniquement. L'ancrage est mesuré après cette mise
en largeur ; le contenu n'est pas mis à l'échelle.

Sur la même page, des gestes de souris natifs dans Chromium visible confirment
les dimensions du cadre et de la surface clonée pendant le déplacement :

| État | Largeur source | Largeur cadre fantôme | Largeur contenu fantôme |
| --- | --- | --- | --- |
| Desktop 1454 × 909 | 688 px | 688 px | 688 px |
| 933 × 400, scroll vertical 200 px | 688 px | 688 px | 688 px |
| 320 × 650 | 220 px | 220 px | 220 px |

Captures inspectées : [desktop](references/drag-width-desktop.png),
[après scroll](references/drag-width-scroll.png) et
[320 px](references/drag-width-320.png). L'écart contenu/curseur reste
(+16,668 ; -13,000) px sur les trois gestes. Le padding calculé est nul et la
largeur maximale n'est plus plafonnée. Le fantôme peut dépasser le bord de la
fenêtre sans modifier son ancrage ni sa largeur.

Chaque geste est annulé par Échap : aucun fantôme ni canvas résiduel, aucune
erreur navigateur et aucune modification des données de la page. Le contrôle
de dépôt/restauration précédent reste applicable : cette correction concerne
uniquement les dimensions du clone. T059 reste ouverte pour les autres vues.

Biome ciblé, format CSS, typecheck Web, build Web et `git diff --check` passent.
Aucune suite de tests applicatifs n'est lancée. Seul le conteneur Web isolé
8082 est reconstruit/recréé, HTTP 200 confirmé. Les dates de démarrage de l'API
isolée et de l'instance principale sont inchangées.
