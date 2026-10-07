# Validation — 6 octobre 2026

La demande ultérieure du 7 octobre remplace les contours pleins par le système
de rôles de [041](../041-content-color-system/spec.md). Les preuves ci-dessous
restent historiques pour les interactions et leur apparence au moment du relevé.

## Déploiement demandé depuis la conversation latérale — 7 octobre, 12:56 UTC

Après la validation isolée T043–T045, le propriétaire demande explicitement
d'appliquer les changements selon le procédé du fil principal. Le service 8082
est bien Vite/HMR, mais l'override local annule ses volumes : le source hôte
n'est pas observé. Aucun changement de montage ; build applicatif Bun réussi
(33 sorties, 23 assets), types web réussis, image `notion-api-isolated` reconstruite
et seul le service web recréé avec `--no-deps --no-build --force-recreate --wait`.
Web sain, démarrage `2026-10-07T12:56:13.10502184Z`. Les démarrages API/DB/Caddy
8082 et web/API 8080 restent identiques aux relevés avant intervention.
Vérification HTTP du source effectivement servi : libellé « Nouvel élément »,
commande permanente, passage à l'édition après création et contours `--pill`
présents sur 8082. Logs privés sous `work/side-kanban-new-element/` :
`web-build.log`, `image-build.log`, `deploy.log`. Les parcours et captures de la
validation précédente couvrent la modification Kanban ; ce déploiement ne
prétend pas valider les changements indépendants encore travaillés dans le fil principal.

## Nouvel élément permanent et contours pleins — 7 octobre, T043–T045

Demande de la conversation latérale : bouton « Nouvel élément » permanent,
création canonique au clic puis édition inline, couleurs pleines. Canevas §14,
FR003/024, plan et tâches alignés avant code ; skill ui-quality, lessons et guide
UI appliqués. Aucun changement de stockage, API ou synchronisation.

Contrôles sélectionnés pour cette passe bornée aux composants Kanban et à leur
composition : Biome format des neuf fichiers concernés, Biome check ciblé,
types web et racine, `git diff --check`, cinq fichiers Vitest (20 tests) et trois
parcours Playwright sur les cinq profils (15 succès). La matrice locale a construit
son bundle et ses piles isolées ; Firefox/WebKit utilisent le runtime Linux
prévu. Aucun redémarrage des instances 8080/8082, aucun commit ou push.
Les warnings existants de signatures `void` et de cascade CSS restent des
warnings ; aucune erreur de format, de types ou de lint ciblé. Un premier
contrôle de couleur lisait la transition intermédiaire de changement de thème :
le parcours final observe la couleur stabilisée plutôt qu'une durée arbitraire.

Vitest : commande permanente pendant attente/refus, double activation bloquée,
reprise, édition de la vraie nouvelle entrée et focus, sauvegarde avant activation
suivante, refus conservant la carte courante, entrée exclue du filtre disponible
pendant édition puis occurrence temporaire retirée à sa fermeture.
Playwright : commande au clavier en attente/refus ; deux créations successives
sans Enter intermédiaire, Échap conservant l'entrée, rechargement sans doublon,
Page → Dossier, sélection multiple/sans valeur et création hors ligne. Les mêmes
gestes restent dans la base sans volet. Bureau et largeur logique 320 px, thèmes
clair/sombre : texte/contour du bouton et contour des cartes égaux à la couleur
pleine du point de colonne, fonds teintés conservés.

Revue visuelle effectuée sur les captures Chromium bureau/mobile et WebKit
mobile, y compris `creation-expanded.png` : carte en édition, type Page/Dossier
et commande distincte toujours dessous ; contours fins pleins, texte lisible,
bouton sans changement de taille pendant création. Les thèmes et textes longs
gardent leurs repères. Pas de gap matériel sur cette nouvelle portée.
Preuves privées conservées sous `work/side-kanban-new-element/` (ignoré par Git),
avec captures `persistent-create-{1133,320}-{light,dark}.png`, création dépliée et
cinq logs de navigateur. Les corrections exécutables du fil principal sont
préservées ; cette validation ne prétend ni les couvrir ni avoir déployé 8082.

Convergence FR003/FR024 : critères et preuve cohérents, T043–T045 clos. Le protocole
de création transitoire figurant dans les comptes rendus plus anciens est historique.

## Édition stable des cartes — 7 octobre, T023/T024

FR017/018, plan et canevas §14 alignés avant code ; ui-quality + lessons et
guide UI appliqués. Dans Notion, Matière ouvre directement son sélecteur et
Examen se coche sans ouvrir l'entrée. Le crayon remplace le titre par un texte
éditable sans bordure, avec les mêmes coordonnées, largeur, hauteur et police.
Case de référence remise décochée ; titre et options non modifiés.

Revue réelle sur 8082 :

- Le titre court et les deux propriétés visibles ont exactement les mêmes
  coordonnées et métriques avant/après le crayon. Titre : 14 px, interligne
  20 px, hauteur 20 px ; champs : hauteurs 24/20 px inchangées. Les propriétés
  supplémentaires s'ajoutent en dessous. Curseur au bout du titre, aucun cadre.
- Titre sur deux lignes : clic physique sur le crayon, mêmes x/y, largeur
  214 px, hauteur 40 px, retrait vertical 10 px dans la carte. Le premier
  clic automatisé avait fait défiler le viewport ; la mesure physique exclut
  ce déplacement de l'automatisation et confirme la stabilité de l'interface.
- Titre temporaire saisi puis crayon d'une autre carte activé immédiatement :
  ancienne carte fermée, suivante ouverte, modification retrouvée au rechargement.
  Titre d'origine restitué et vérifié après rechargement.
- Depuis la carte fermée, Matière ouvre son sélecteur sans volet ni dépliage ;
  Examen se modifie directement et persiste après rechargement. Valeur initiale
  décochée restituée et vérifiée. 17 cartes au début et à la fin, aucune alerte.
- Capsule : commandes 26 px et icônes 16 px mesurées au pointeur. Clavier : Tab
  passe du titre à Examen, Échap ferme ; création vide annulée sans nouvelle
  entrée. Revue clair/sombre et 320 px : largeur du document 320 px, sans
  débordement global. Thème, viewport et sidebar restitués.

Captures privées inspectées : `work/notion-api/038-stable-edit-dark.png`,
`038-stable-edit-light.png`, `038-stable-edit-320.png`,
`038-stable-edit-320-dark.png`, référence `038-notion-stable-edit.png`.

37 tests ciblés réussis sur 8 fichiers : édition directe, contrôles conservés,
sauvegardes sérialisées/baseline, passage entre crayons pendant une écriture,
refus/reprise, création atomique/Entrée/vide/portails, caret, propriétés du volet,
mouvements du Kanban et retour discret. Le refus est vérifié par simulation
contrôlée dans les tests ; aucune panne provoquée sur les données du propriétaire.
Typecheck Web et racine, Biome ciblé sans erreur et build Bun 1.4.2 réussis
(33 sorties, 23 assets, 10 232 372 octets). Avertissements historiques de CSS et
union void conservés. Prérequis et cohérence de la feature vérifiés.

Web 8082 seul recréé à `2026-10-07T08:46:57.812472918Z` ; API 8082 et
web/API 8080 inchangés. T023/T024 convergés après cette revue réelle.

## Enregistrement discret — 7 octobre, T021/T022

FR016 et canevas §14 alignés avant code. Le seul badge d'attente affiché sous
les entrées est retiré de Kanban/galerie/liste ; conflits et erreurs restent
visibles, aucune commande de persistance ou de synchronisation n'est modifiée.
Scope borné : composants de rendu, copie inutilisée et règle CSS pending.

Sur 8082, ouvrir le crayon de « Nouvelle page », cocher Examen : aucun message
sous la carte, édition conservée et valeur retrouvée après rechargement.
Valeur initiale décochée restituée, fermeture par Échap. Revue réelle sombre,
clair et 320 px : aucun badge, formulaire inchangé, largeur de document 320 px
sans débordement global. Émulation de thème/viewport retirée. Captures privées
inspectées : `work/notion-api/038-save-quiet-dark.png`,
`038-save-quiet-light.png`, `038-save-quiet-320.png`.

- Régression de présentation Kanban/galerie/liste : 3 tests réussis ; entrées
  synced/pending conservées sans message, conflit toujours affiché.
- Éditeur automatique : 2 tests réussis ; sérialisation et refus/reprise sans
  boutons de validation. Première fixture de présentation corrigée pour employer
  un axe status compatible avec le Kanban.
- Typecheck Web, Biome ciblé et build Bun 1.4.2 réussis. Biome ne signale aucune
  erreur ; avertissements préexistants de cascade CSS et union void conservés.
  Build : 33 sorties, 23 assets, 10 228 770 octets.
- Prérequis Spec Kit et cohérence FR016/T021/T022 vérifiés ; diff sans erreur.
- Seul web 8082 recréé à `2026-10-07T08:18:35.308639338Z` ; démarrages API 8082,
  web/API 8080 inchangés. Aucun push ni nouveau commit demandé pour ce correctif.

ui-quality + lessons appliqués ; T021/T022 convergés après revue réelle.

## Référence et checkpoint

Checkpoint demandé sans tests : `0b3157a2`, avant toute modification de cette
feature. Observation directe dans Notion : Créer tâche ouvre une carte inline,
Entrée prépare la suivante, Échap retire la carte vide, clic ouvre l'aperçu
latéral. Consultation de Visibilité des propriétés. Carte synthétique retirée
vers la corbeille ; nombre initial rétabli. Aucun réglage Notion modifié.

## Revue manuelle sur 8082

- **US1** : deux titres successifs dans Pas commencé, sans navigation ; titre
  atomique et regroupement conservés après actualisation. Annulation du
  brouillon suivant par Échap sans entrée supplémentaire. Création d'un dossier
  dans En cours via le choix secondaire, également sans ouverture. Contrôle
  des nombres avant/après ; seules les entrées synthétiques ont été retirées.
- **US2** : Matière, Examen décoché/coché et dates sous le titre ; titres longs
  reviennent à la ligne. Masquer Examen dans Par état, recharger : le choix
  persiste. Matière conserve sa visibilité indépendante. Examen réactivé dans
  Par état pour restituer la préférence initiale. Les options vides sont omises.
- **US3** : ouvrir une carte conserve la route de la base. Titre, Examen,
  Matière et document modifiés dans le volet ; mêmes données en pleine page.
  Fermer conserve la position mesurée `211.5` et rend le focus à la carte.
  Échap ferme d'abord un menu de propriété sans fermer le volet. Réouverture
  d'une entrée existante en lecture seule puis contrôle pleine page.
- **Base intégrée** : entrée synthétique créée depuis sa table puis ouverte
  en volet ; la page hôte reste montée. Accès pleine page à la même entrée.
  Entrée synthétique retirée vers la corbeille et table revenue à zéro entrée.
- **Clavier/largeurs/thèmes** : saisie, Entrée, Échap, menus et retour focus ;
  à 320 px le volet mesure exactement 320 px, origine 0, sans dépassement.
  Revue du vrai écran clair via émulation temporaire de la préférence système,
  puis émulation retirée : préférence `system`, thème sombre rétabli.
- **Survol** : pointeur sur le bord interne de Par état ; toute la cellule
  peint le fond de survol (`rgb(48, 48, 45)` contre `rgb(58, 57, 53)` au repos).
  Largeur inchangée `95.5859375`, hauteur 32, rayon 6. Focus visible conservé.

Captures inspectées, privées et non suivies :
`work/notion-api/038-board-before-review.png`, `038-tab-hover-dark.png`,
`038-peek-light.png`, `038-peek-320-dark.png`, `038-side-peek-final-dark.png`.
Les données synthétiques de revue sont récupérables dans les corbeilles ;
aucune purge ni suppression d'entrée utilisateur.

## Contrôles ciblés

- Bun 1.4.2 ; Web et client-core typecheck réussis.
- Biome sur les 18 fichiers exécutables touchés : aucune erreur.
- Création inline/refus/reprise/anti-double/annulation : 1 test réussi.
- Board et mutations de propriétés : 23 tests réussis, dont visibilité/ordre
  sans perte de regroupement et exclusion des appartenances primaires lors
  d'une modification de source secondaire. Une première fixture texte avait
  `text` au lieu de `value` ; corrigée, contrôle repris et réussi.
- Client-core : création/édition atomique sur source secondaire, sourceId
  préservé : 1 test ciblé réussi (17 autres non sélectionnés).
- Build Web final : 33 sorties, 23 assets précachés, 10 212 935 octets.
- `git diff --check` réussi. Analyse de cohérence et prérequis Spec Kit validés.

Sélection bornée à la feature ; aucune matrice navigateur ni campagne globale,
conformément à la demande de concentrer le travail sur les retours. Aucune
publication Git demandée ni effectuée ; ces contrôles ne revendiquent pas
le gate complet de publication de toute la branche.

## Livraison et limites

Seul le Web de `myownnotion-notion-api` recréé, démarrage final
`2026-10-06T20:53:12.233568095Z`, HTTP 8082 = 200. API isolée inchangée
(`2026-10-04T19:51:13.811269801Z`). Web 8080 inchangé
(`2026-10-04T15:18:07.665527509Z`) et son API inchangée
(`2026-10-04T12:06:24.636775506Z`). Aucun volume réinitialisé.

Écarts volontaires : brouillon vide non persisté avant validation du titre,
volet de largeur responsive fixe ; modèles de création et aperçu centré hors
périmètre. La page synthétique hôte de l'essai intégré affichait déjà
« Enregistrement interrompu » avant l'essai ; son document n'a pas été modifié.
L'entrée de test et son éditeur se sont synchronisés correctement. Cette
condition antérieure n'est pas présentée comme corrigée par cette feature.

## Convergence

FR001–009 et SC001–004 couverts par les modifications, contrôles bornés et
observations ci-dessus. Tâches UI revues avec ui-quality et lessons. Aucun
écart matériel restant dans les quatre parcours demandés. La validation du
propriétaire reste à venir ; aucune nouvelle leçon n'est déclarée validée.

## Complément — 7 octobre 2026

Observation réelle Notion : création dépliée, crayon rouvrant les champs et
actions du menu. La seule carte Notion créée pour cette revue a été mise dans
la corbeille ; Pas commencé est revenu à 8. Aucun élément du propriétaire
supprimé ni préférence Notion modifiée.

Revue réelle 8082 :

- Création dépliée : titre, type Page/Dossier, État, Examen, date et Matière ;
  le choix d'une option ne ferme pas le brouillon. Création explicite sans
  navigation. Dossier créé à 320 px avec Examen coché et date, puis réouverture
  après rechargement : mêmes valeurs et type canonique.
- Crayon : titre, Examen et date modifiés ; propriété Matière conservée.
  Une première revue a révélé que les valeurs cachées dans la vue étaient
  omises à la réouverture. Enrichissement depuis l'entrée de même révision,
  régression ciblée ajoutée. Seconde modification d'une date native vérifiée
  après correction de la remontée des événements input.
- Actions : copie du lien ferme le menu sans erreur ; déplacement de la carte
  temporaire de En cours vers Terminé ; conversion page vide vers dossier puis
  retour page. Ajout de texte canonique, confirmation de conversion affichée,
  annulation : texte présent et identique en pleine page. Menu revu : icônes et
  libellés en rangées alignées, largeur fixe et destination secondaire.
- Volet : ouverture pendant le glissement observée
  (`database-peek-in`, 0.18 s, translateX 316.215 px à un instant intermédiaire).
  Pendant la sortie : volet encore monté, data-closing=true,
  `database-peek-out`. Après sortie : démonté et focus sur l'entrée.
  Boutons double chevron et expansion voisins ; expansion ouvre la même entrée.
- Table : bouton latéral visible au survol (opacité 1, cible 32 px), texte
  cliqué ouvre la saisie du titre ; Échap annule. Bouton latéral ouvre le volet
  sans déclencher cette saisie.
- En-tête replié : hauteur stabilisée 32 px, espace haut/bas du h3 = 4/4 px.
  Groupe redéplié pour restituer la préférence. Hover : teinte verte de la carte
  légèrement éclaircie, fond du bouton titre transparent.
- Thèmes/étroit : captures sombre et clair inspectées. À 320 px, volet de
  largeur 320 et origine 0 ; formulaire de 206 px sans débordement interne,
  body.scrollWidth = 320. Override de largeur retiré.

Captures privées inspectées, non suivies :
`work/notion-api/038-expanded-edit-20261007.png`,
`038-actions-final-20261007.png`, `038-convert-confirmation-20261007.png`,
`038-peek-320-20261007.png`, `038-create-320-20261007.png`,
`038-create-light-20261007.png`. Autres captures de contrôle :
`038-table-peek-final-20261007.png`, `038-peek-final-20261007.png`.

Contrôles bornés : 37 tests réussis sur les six fichiers de création,
présentation canonique, board, caret, interactions et mutations de propriétés.
Création teste type/colonne/case/date/relation ensemble, absence d'écriture sur
blur, refus/reprise et anti-double. Web typecheck et Biome des 19 fichiers :
aucune erreur (avertissements de spécificité/union void conservés).
Build final : 33 sorties, 23 assets, 10 222 416 octets, Bun 1.4.2.
`git diff --check` réussi. Aucun gate global ni publication Git.

### Fin de revue en attente

Le navigateur est devenu inaccessible pendant le dernier contrôle avec
animations réduites : les onglets 1–3 ne sont plus disponibles, tabs.list
renvoie zéro onglet. La réouverture demandée via open_in_codex est en attente
car la conversation n'est plus affichée. Demande asynchrone envoyée au
propriétaire pour rétablir l'accès. Aucun contournement par lecture du profil,
de stockage navigateur ou suppression en base.

À reprendre : contrôle manuel des animations réduites, ouverture du sélecteur
d'icône depuis le menu, restauration du thème système si l'ancien onglet
réapparaît et nettoyage **uniquement** de « Revue complète 038 — éditée »
(entrée `01a11524-6b32-7000-ad58-5a31dc50399a`, Terminé) et
« Dossier de revue 038 » (Pas commencé). Nombres attendus après nettoyage :
5/2/10/0. À la dernière lecture : 6/2/11/0. Le texte temporaire de revue reste
dans la première entrée ; aucune entrée propriétaire n'a été modifiée.
T013/T014/T016 restent ouverts : convergence complémentaire non déclarée.

Web isolé final recréé à `2026-10-07T07:14:27.880126044Z`, HTTP 8082 = 200.
API isolée et instance 8080 conservent leurs dates de démarrage du 4 octobre
documentées plus haut. Aucun volume réinitialisé.

## Correction suivante du 7 octobre — édition directe

Les décisions de validation explicite décrites dans la première passe sont
supersédées par FR003/010/014, T017/T018. Observation Notion : crayon déplie
les propriétés en lignes, sans commandes de validation ; cliquer sur le titre
de base ferme ce mode. Aucun contenu propriétaire modifié dans Notion.

Revue réelle 8082 :

- Capsule crayon/ellipsis commune bordée, cellules adjacentes avec séparateur,
  révélée au survol/focus ; icône origine/flèche/destination dans le menu.
  L'arbre compose le même ConvertItemControl, donc la même icône.
- « Dossier de revue 038 » : titre renommé en « Dossier de revue 038 — autosave »,
  Matière NSY103, case décochée et date 11/10/2026 14:20 ; menu de choix conserve
  l'édition. Clic extérieur ferme, rechargement restitue tous ces champs.
- Changement État vers En cours : l'éditeur reste monté jusqu'à fermeture,
  puis la carte est réellement dans sa colonne destination. Conversion Dossier
  vers Page sans navigation ; choix permanent reflète le nouveau type.
- « Revue complète 038 — éditée », contenant le texte synthétique antérieur :
  choix Dossier ouvre la confirmation canonique de perte du contenu ; annuler
  maintient le choix Page et l'édition. Échap ferme ensuite l'édition.
- « Revue auto 038 finale » créée par clic extérieur avec Dossier, Examen coché,
  Matière SMB111 et date 12/10/2026 09:45 : carte/type/champs identiques après
  rechargement, sans ouvrir l'entrée. Une date vide affiche Ajouter Date
  d’échéance et ouvre le contrôle natif uniquement à la demande.
- Sélecteur d'icône ouvert depuis le menu de la fixture puis fermé sans changement.
  Volet avec prefers-reduced-motion=reduce : animationDuration=0s, largeur
  657.13 px sur 1133 px ; bouton Fermer retire le volet immédiatement.
- Clair/sombre inspectés une fois la bascule de thème stabilisée. À 320 px,
  formulaire/rangées 206 px, scrollWidth=206 ; body.scrollWidth=320. Cibles
  tactiles conservées. Overrides retirés ; barre latérale et thème sombre rétablis.

Captures privées inspectées dans work/notion-api (ignoré) :
038-capsule-r2-20261007.png, 038-conversion-icon-r2-20261007.png,
038-inline-final-320-20261007.png, 038-inline-final-dark-20261007.png,
038-inline-final-light-stable-20261007.png, 038-delivered-form-dark-20261007.png.
La capture light sans « stable » a été prise pendant la transition et ne sert
pas de preuve de contraste. Aucune image privée ajoutée au Git.

Contrôles ciblés : 40 tests sur les sept fichiers carte/création, présentation,
board, caret, interactions et mutations (39 dans la passe commune, puis les
5 tests carte/création après ajout de la reprise d'une création refusée).
9 tests navigation/menu/signature supplémentaires réussis. Régressions utiles :
anti-double pendant attente, baseline avancée entre écritures, dernières valeurs
conservées après refus, fermeture extérieure après succès sans voler le focus,
reprise de création refusée sans création supplémentaire. Web typecheck/build
réussis avec Bun 1.4.2 ; build 33 sorties, 23 assets, 10 228 367 octets. Biome
12 fichiers : aucune erreur, 52 avertissements existants de spécificité/void.
git diff --check réussi. Pas de matrice globale ni publication Git.

Nettoyage via menus canoniques uniquement des trois fixtures de cette revue,
y compris les deux restantes de la première passe. Après rechargement :
Pas commencé=5, En cours=2, Terminé=10, Sans état=0 ; aucune carte « 038 » restante.
Données du propriétaire conservées. T013/T014/T016/T017/T018 complétés avec
ces preuves ; convergence technique réalisée, rendu proposé à revue propriétaire.
Les règles générales demandées sont intégrées au skill et guide UI ; une nouvelle
leçon de journal pourra suivre le retour du propriétaire sur le rendu livré.

Déploiement final web isolé : 2026-10-07T07:57:12.806102842Z ; HTTP8082=200.
API isolée inchangée (2026-10-04T19:51:13.811269801Z), web/API 8080 inchangés
(2026-10-04T15:18:07.665527509Z / 2026-10-04T12:06:24.636775506Z).
Dernière revue après redéploiement : champs inline/choix Page-Dossier présents,
aucune fixture, comptes 5/2/10/0, thème sombre et largeur habituelle 1133 px.

## Regroupement dans les réglages — 7 octobre

T019/T020, FR015/SC005. Observation Notion en lecture seule : Paramètres →
Grouper État → Grouper par, sélecteur de propriété. Aucun réglage Notion modifié.
Sur 8082 : entrée Grouper avec la propriété actuelle dans ViewSettingsPanel,
panneau dédié partagé, menu icône/nom/coche aligné ; suppression de la toolbar
Kanban et de ses styles, choix retiré du panneau Trier. Pas de nouvelles options
de sous-groupe, masquage ou couleur.

Revue manuelle complète de ce changement sur Suivi des tâches : État → Matière,
colonnes correspondantes immédiates, rechargement conserve Matière, passage par
l'autre vue Matière puis retour à Par état conserve son choix. Retour final à
État, comptes 5/2/10/0, aucune carte créée/modifiée. Propriétés visibles inchangées.
Le test de transition conserve aussi filtres/tris/visibilité et ne réinitialise
que l'ordre/repli de l'ancien axe. Aucun contrôle de regroupement au-dessus de la
base. Panneau Trier observé sans regroupement.

Clavier : Entrée ouvre le sélecteur, Entrée choisit Matière puis État ; après
l'attente le focus revient sur Grouper par. Le test étroit a confirmé le retour
du focus après écriture ; la désactivation temporaire du déclencheur empêchait
initialement le retour automatique du menu, corrigé avant livraison. Échap dans
la base intégrée ferme uniquement le sélecteur et rend le focus, panneau conservé.
Base intégrée 01a107a0 : mêmes réglages et écran Grouper ; aucun axe compatible,
état Aucun et aide pour ajouter une propriété compatible, sans mutation de source.
Revue sombre/clair à 1133 px et clair à 320×800 : panneau/menu dans le viewport,
rangées et icônes alignées. Largeur normale, thème et sidebar restaurés.

Captures privées ignorées : work/notion-api/038-group-settings-root-dark.png,
038-group-selector-dark.png, 038-group-panel-light.png,
038-group-selector-light-320.png et 038-group-panel-inline.png. Aucune donnée
privée copiée dans les artefacts suivis.

Contrôles bornés : 4 fichiers / 21 tests réussis (group-editor, database-board,
database-board-interaction, database-views). Le test de déplacement antérieur
attendait les destinations à la racine du menu : aligné sur le sous-menu réel,
puis réussi, avec les assertions refus/anti-double/reprise conservées.
Dernier ajustement focus : 2 tests group-editor reréussis, dont retour du focus
après refus. Web typecheck réussi, Biome 11 fichiers sans erreur (53 avertissements
de spécificité/void dans les fichiers existants), build Bun 1.4.2 : 33 sorties,
23 assets, 10 228 545 octets. git diff --check et prérequis Spec Kit réussis ;
cohérence spec/plan/tasks/contrat/036/canevas/guide revue. Pas de matrice globale.

Déploiement final web 8082 seulement : 2026-10-07T08:09:24.637976708Z, HTTP=200.
API isolée et web/API 8080 conservent leurs démarrages précédents. Aucun push ni
commit ajouté. Convergence de cette correction réalisée ; rendu proposé à la
revue du propriétaire.

Dernière vérification documentaire : 11 documents et 29 liens locaux valides.
La revue finale après redéploiement confirme l'aide de la base intégrée,
Réglages → Grouper État, comptes 5/2/10/0, sidebar visible et largeur 1133 px.

## Passage entre crayons dans la même colonne — 7 octobre

T025/T026, FR018/SC006 ; ui-quality et lessons appliqués. La vérification
antérieure entre deux colonnes ne couvrait pas le déplacement de la cible.
Reproduction réelle sur 8082 : appui sur le second crayon de En cours à
(841, 564.59375), repli immédiat du premier éditeur et déplacement de 110 px
vers le haut ; aucun éditeur ouvert après relâchement à la position initiale.
La nouvelle régression séparant appui/focus et activation échoue sur ce code.

Correction bornée : marqueur du crayon et reconnaissance dans la fermeture
extérieure du seul Kanban parent, hors création. L'appui/focus garde la carte
actuelle montée ; le clic existant attend sa sauvegarde puis bascule. Aucun
changement de CSS, API, synchronisation, permissions ou migration, aucune action
déclenchée sur pointerdown. Les interactions extérieures ordinaires et portails
conservent leur protocole. Un refus garde la saisie et la reprise.

Revue physique, sans clic DOM synthétique : mêmes cartes/mêmes coordonnées,
cible inchangée avant relâchement puis seconde carte seule en édition. Retour
vers le premier crayon après une saisie ajoutée au titre du second, avant le
délai d'autosave : bascule réussie, titre conservé après rechargement. Titre
initial restauré par l'UI et restitution confirmée après rechargement. Appui
sur le second crayon puis relâchement hors cible : premier éditeur conservé ;
Entrée sur le crayon focalisé ouvre le second, Échap ferme. En clair à 320×800,
Nouvelle page → ponon : cible (225, 607.59375) inchangée à l'appui, bascule au
relâchement ; document.scrollWidth=320. Rendu inspecté dans les captures privées
ignorées work/notion-api/038-pencil-same-column-fixed.png et
038-pencil-same-column-light-320.png. Aucune donnée privée suivie dans Git.

Contrôles : 10 tests dans database-card-inline, board-card-editor et
board-create-card réussis (écritures en attente, refus/reprise, gestes, fermeture
extérieure, création et portails). Web typecheck et Biome des trois fichiers
modifiés sans erreur ; build Bun 1.4.2, 33 sorties / 23 assets / 10 232 564 octets.
Prérequis Spec Kit et git diff --check réussis ; spec/plan/tasks cohérents.
Ces checks couvrent la seule séquence d'événements modifiée ; preuves antérieures
des styles et autres vues réutilisées, pas de matrice globale.

Web isolé 8082 redéployé à 2026-10-07T08:59:00.179577002Z. API isolée et web/API
8080 inchangés (démarrages 2026-10-04T19:51:13.811269801Z,
2026-10-04T15:18:07.665527509Z et 2026-10-04T12:06:24.636775506Z).
État final : 17 cartes, aucun éditeur ni alerte, titre initial restauré,
aucune saisie temporaire restante ; viewport/thème/sidebar restaurés.
Convergence de cette correction réalisée, aucun commit ni push ajouté.

## Proposition de sélecteur Page/Dossier — 7 octobre

T027/T028, FR019 ; ui-quality et lessons lus. Changement limité à database.css :
le rail #151514 devient transparent, son contour utilise 12 % du texte du thème.
Le choix actif mélange 86 % du fond teinté de la carte et 14 % du texte ; le
survol inactif utilise 6 %, actif 18 %. Les boutons conservent leur cible et un
rayon de 5 px pour suivre le rail de 8 px avec son retrait de 3 px. Aucun
changement de commande, données, synchronisation, permissions ou migration.

Revue réelle sur 8082 : carte grise, bleue et verte en édition, contour discret
et choix actif teinté. Même géométrie avant/après sur la carte grise : 242×38 px,
aux mêmes coordonnées ; boutons 32 px au pointeur fin. Dossier au survol reste
dans la teinte bleue ; Tab atteint Page avec focus-visible et outline solid.
Même carte verte inspectée en clair. À 320×800, création vide : rail 206×38 px,
document.scrollWidth=320 ; choisir Dossier puis Page change le choix actif et
l'icône sans fermer le brouillon. Captures claire et sombre inspectées ; Échap
annule le brouillon, 17 cartes finales, aucune entrée créée ni valeur modifiée.
Viewport, thème et sidebar restaurés. Aperçu rapproché livré au propriétaire.

Captures privées ignorées : work/notion-api/038-kind-before-dark.png,
038-kind-after-gray-dark.png, 038-kind-after-blue-dark.png,
038-kind-after-green-dark.png, 038-kind-after-green-light.png,
038-kind-create-folder-light-320.png, 038-kind-create-folder-dark-320.png
et 038-kind-proposal.png. Aucune image privée dans Git. Proposition proposée
à la revue du propriétaire ; aucune leçon ajoutée avant son retour.

Checks proportionnés au changement CSS : Biome sans erreur, build Bun 1.4.2
(33 sorties, 23 assets, 10 233 586 octets), prérequis Spec Kit et diff-check.
Pas de nouveau test recopiant les couleurs ni suite applicative relancée ;
les interactions existantes ne changent pas, leurs preuves précédentes restent
applicables. Spec/plan/tasks/guide et canevas §14 revus, aucun écart de périmètre.
Web isolé 8082 redéployé à 2026-10-07T09:34:39.606256298Z ; API isolée et web/API
8080 conservent les démarrages précédemment enregistrés. Aucun commit/push ajouté.

## Sélecteur séparé, compact et glissant — 7 octobre

T029/T030, FR019 ; ui-quality + lessons appliqués. Le propriétaire accepte la
proposition précédente ; le principe de couleur est capitalisé en L024.
database.css conserve seul la présentation : séparateur au-dessus du type,
rail 34 px au lieu de 38, boutons 28 px au lieu de 32, texte 13 px inchangé.
Le garde pointer:coarse porte les boutons à 44 px ; la revue réelle à 320 px
utilise le pointeur fin, sans prétendre avoir testé un appareil tactile physique.
Le fond unique ::before suit les aria-pressed existants avec transform/180 ms,
sans nouvelle donnée ni état optimiste. Aucun changement des commandes,
hors-ligne, synchronisation, permissions ou migration.

Sur 8082, séparateur et arrondis inspectés sur une carte grise en édition ;
le type Dossier déjà présent du propriétaire est conservé. Rail 242×34 px,
fond 117×28 px aligné aux boutons. Sur un brouillon vide, clics physiques
Page → Dossier : translations mesurées 0, 2.78, 15.39, 35.25, 53.05, 67.97 puis
119 px, et coordonnées des boutons inchangées (x=58/177, y=619.09375).
Retour à Page par Shift+Tab/Entrée : focus-visible conservé et fond revenu à 0.
Avec prefers-reduced-motion, transition none/0s et changement immédiat.

Conversion de SMB111 demandée sans confirmation de destruction : le dialogue
canonique s'ouvre, sélection Page et translation 0 restent en place ; Conserver
cette page annule sans conversion. Aucun contenu supprimé ni entrée modifiée.
À 320×800, création vide en clair/sombre : rail 206×34 px, translation Dossier
101 px, document.scrollWidth=320. Captures inspectées, Échap annule la création.
État final : 17 cartes, aucun éditeur ni dialogue/alerte visible ; viewport et
émulation de thème rétablis, préférence de sidebar du propriétaire conservée.

Preuves privées ignorées : work/notion-api/038-kind-compact-separator-dark.png,
038-kind-confirmation-keeps-page.png, 038-kind-compact-light-320.png et
038-kind-compact-dark-320.png. Aucune donnée privée suivie dans Git.
Checks CSS proportionnés : Biome sans erreur, build Bun 1.4.2 (33 sorties,
23 assets, 10 236 065 octets), prérequis Spec Kit et diff-check. Aucun nouveau
test miroir CSS ni suite applicative relancée ; comportements de conversion
inchangés, preuves de leurs tests précédents réutilisées.

Web isolé 8082 redéployé à 2026-10-07T09:45:24.410773013Z ; API isolée et web/API
8080 inchangés. Convergence de cet affinage réalisée, rendu prêt pour revue
propriétaire ; aucun commit/push ajouté.

## Conversion réactive et contour après Échap — 7 octobre

Avant correction, clic Dossier sur la carte avec contenu puis Échap : focus
rendu à Dossier, `:focus-visible` et outline solide de 1 px, Page toujours actif.
La commande exploratoire réconciliait le journal et synchronisait avant de
refuser ; le callback relisait ensuite l'arbre entier sans écriture effectuée.

T031/T032 : holdsContent positif ouvre directement la confirmation, sans
commande ni attente. Le garde canonique reste requis lors de la conversion ;
une information périmée peut encore demander confirmation avant toute écriture.
Après succès, seule la projection de l'élément est rafraîchie. La destination
visuelle pending est figée pour toute la demande, y compris lorsque la projection
canonique change avant la fin du callback. Un refus la retire et conserve le
message de reprise. Aucun changement du journal, chiffrement ou synchronisation.

Revue réelle sur 8082 :

- Page avec contenu : dialogue présent dès la fin du clic ; Page reste actif et
  le sélecteur n'est pas busy pendant la question. Échap laisse la carte ouverte,
  rend le focus à Dossier et garde outline-style none pour une ouverture au
  pointeur. Shift+Tab affiche à nouveau le focus ; ouverture par Entrée puis
  Échap garde le contour clavier normal. Le contenu de la page n'a pas changé.
- Carte temporaire vide : appui/relâchement physique, fond déjà en mouvement
  pendant aria-busy true (37 → 68 → 118 → 119 px), type réel encore Page ;
  glissement terminé avant la fin de la conversion. Dossier devient réellement
  actif au succès. Retour Dossier → Page observé : 119 → 82 → 0 px, destination
  pending page, puis succès sans retour transitoire vers Dossier.
- Réduction des animations : transition 0s et déplacement immédiatement à 119 px
  pendant l'attente ; pas de retard ajouté à la commande.
- Clair/sombre à 320 px : confirmation puis Échap, carte toujours ouverte,
  outline none, rail 206 × 34 px ; document scrollWidth 320. Ouverture de la
  carte au clavier après défilement natif. Desktop restauré à 1454 × 909 et
  préférence de thème système restaurée.

Captures privées ignorées : work/notion-api/038-kind-escape-no-selection.png,
038-kind-escape-light-320.png, 038-kind-escape-dark-320.png. Deux fixtures de
conversion créées puis mises seules à la corbeille ; 17 cartes et aucune édition
ou confirmation ouverte à la fin. Aucune entrée existante convertie ni supprimée.

Contrôles bornés selon docs/development.md : 14 tests dans quatre fichiers Web
(confirmation connue/périmée, annulation pointeur/clavier, attente/refus,
anti-double, stabilité de destination pendant projection, menu et autosave).
Parcours Playwright database-form-lifecycle « keeps conversion confirmation »
Chromium desktop, avec phase à 320 px et vérification du contenu conservé :
1 passé en 6,8 s sur le code final. Deux premières tentatives bloquaient dans
la préparation du parcours : sélecteur exact Type obsolète et ouverture d'une
entrée rangée dans une branche repliée ; une troisième cherchait le bouton
pleine page dans le contenu plutôt que la toolbar du volet. Le nouveau parcours
utilise le contrôle select natif nommé et la toolbar réelle ; aucun helper global
ni comportement de l'app n'a été modifié pour contourner ces échecs.

Types racine/Web et Biome des sept fichiers exécutables modifiés réussis ; build
Bun 1.4.2 : 33 sorties, 23 assets, 10 236 903 octets. Déploiement web isolé seul
à 10:05:45 UTC ; API 8082, web/API 8080 et données conservés. Aucune publication
Git demandée ; les modifications restent à relire dans le workspace.

## Durée réelle de conversion — 7 octobre, FR021 / T033–T036

Quatre coûts bornés corrigés :

- Page sans ouverture/reconciler ni état/update/branche durable : pas de lecture
  réseau avant commit local projection + outbox. Vérification des trois tables
  dans une transaction de lecture, nouvelle vérification des ouvertures après
  cette lecture. Dans tous les autres cas, handover existant conservé.
- Notifications : index des statuts de l'outbox et identités des conflits,
  sans déchiffrer les contenus. Même exclusion des recoveries et mêmes comptes
  pending/conflict/attention ; aucun nettoyage ni abandon de travail.
- Mutation : alias chargés uniquement pour les références reconnues de la
  commande, sans parcourir l'historique. Même remappage en un saut, ordre et
  doublons des références, validation et transaction atomique.
- Base native : le parent ne réhydrate pas les entrées détenues par son
  container ; le chemin legacy garde contenu, propriétés, relations et ordre.

Mesure manuelle sur la même carte temporaire de la base du propriétaire, avant
et après déploiement sur 8082. Activation clavier Enter, lecture DOM externe
jusqu'à aria-pressed du type réel et aria-busy retiré ; trois essais alternés
par sens, courte pause de 350 ms entre essais. Les durées incluent l'appel outil
et le polling, ce ne sont pas des mesures internes de CPU ou de synchronisation
serveur. Première tentative au pointeur abandonnée comme mesure : actualisations
de géométrie entre conversions empêchaient certains clics d'atteindre la cible.

| Sens | Avant (ms) | Après (ms) | Médiane avant → après |
| --- | --- | --- | --- |
| Page → Dossier | 1 636 / 1 574 / 1 463 | 792 / 942 / 452 | 1 574 → 792 ms |
| Dossier → Page | 467 / 784 / 828 | 322 / 669 / 958 | 784 → 669 ms |

Gain observé Page → Dossier : environ 50 % sur ce petit échantillon local.
La variabilité dans l'autre sens ne justifie pas une promesse générale de gain.
Les pages avec une autorité éditoriale conservent leur attente nécessaire ; leur
latence complète n'a pas été mesurée avant/après. Aucun changement de méthode de
synchronisation, stockage, clé ou format ; la confirmation et les gardes locales
et serveur demeurent obligatoires.

Revue réelle ui-quality + lessons : propriété Examen cochée puis conversion
immédiate, type Page et propriété toujours présents après rechargement. Page
existante avec contenu : question visible immédiatement, annulation par Échap
conservant Page et sans contour résiduel. Reprise clavier, clair/sombre à 320 px,
rail 206 × 34 px et document sans débordement global (scrollWidth = 320).
Captures privées ignorées : work/notion-api/038-conversion-fast-light-320.png
et 038-conversion-fast-dark-320.png. Carte temporaire seule mise à la corbeille ;
17 cartes, aucun éditeur/confirmation ouvert à la fin, viewport restauré à
1454 px et média emulé retiré. Aucune entrée existante convertie ni supprimée.

Contrôles sélectionnés selon docs/development.md, portée des appels connue :

- 80 tests Web dans dix fichiers : notifications, ouverture/journal de page,
  sérialisation/realtime, sélection structurée, cartes/autosave et conversion.
  Le nouveau test des compteurs utilise des contenus chiffrés avec une autre
  clé : le comptage doit réussir sans les ouvrir, ni supprimer les preuves.
- 172 tests client-core dans neuf fichiers : alias, outbox, atomicité, résolution,
  commandes de projection, mutations/réconciliation de bases et handover legacy.
  Régression avec 2 048 révisions non référencées, scan global interdit, références
  scalaires/tableaux et rollback quota.
- Cinq parcours Chromium desktop, dont conversion locale avec requêtes serveur
  maintenues bloquées, phase à 320 px et rechargement ; confirmation/Échap/contenu
  conservé, page convertie éditable, conversion vide et destruction confirmée
  conservant les enfants. Run final : cinq passés, 15,1 s.
  Commande : bun scripts/e2e/run-local-matrix.ts --project=chromium-desktop
  tests/e2e/database-form-lifecycle.spec.ts tests/e2e/item-conversion.spec.ts
  --grep 'converts a card without editorial history|keeps conversion confirmation|converts an empty page|accepting destroys|the converted page accepts'.
  Log ignoré : work/notion-api/038-conversion-performance-e2e-final.log.
- Types client-core/Web/racine, Biome des huit fichiers de cette optimisation,
  prérequis Spec Kit et git diff --check réussis. Build Bun 1.4.2 : 33 sorties,
  23 assets, 10 237 836 octets. Pas de test backend/API ni campagne complète :
  contrats, backend, migrations, dépendances et journal inchangés.

Une première régression de branche utilisait une page vide : l'ouverture seule
ne crée pas de travail durable. La fixture effectue maintenant un geste réel
et prouve la branche avant de tester le redémarrage. Première exécution E2E :
le cleanup retirait une route avant la fin de son handler, créant une erreur
« Route is already handled ». Attendre les handlers au cleanup corrige le test ;
aucun comportement produit modifié pour contourner ces échecs.

Déploiement web 8082 seul à 11:32:24 UTC ; API 8082 toujours démarrée le
4 octobre à 19:51:13 UTC, web/API 8080 à 15:18:07 / 12:06:24 UTC, données
préservées. Les modifications restent non committées, aucune publication Git
demandée pendant ce raffinement.

## Lecture et actualisation des bases — 7 octobre, FR022 / T037–T040

Périmètre connu : lectures de projections des bases, coordination de leurs
actualisations et première page complète locale. Les mutations, formats,
clés, migrations, permissions et règles de synchronisation sont inchangés.
Le HAR fourni est traité dans [039](../039-startup-transfer/validation.md).

- `listEntries` : une transaction de lecture sur placements/items/paires,
  `bulkGet` des paires actives puis déchiffrement par lots de 64 après fermeture
  de la transaction. Ordre de l'index, doublons, identités de source et d'entrée,
  lignes synthétiques et disponibilité conservés. Un payload illisible reste
  une erreur, sans succès partiel silencieux.
- `listDatabases` : tables lues en parallèle, propriétaires indexés par identité,
  mêmes priorités de définition et de présentation des sources/conteneurs.
- Bloc intégré : lecture directe de la source sélectionnée, fallback d'inventaire
  seulement pour une source legacy implicite, réutilisation du conteneur propre
  à la source et lectures indépendantes en parallèle.
- Bloc et page de base : drain d'actualisation unique ; les notifications pendant
  une lecture demandent une reprise, sans publier le tour périmé. `await refresh`
  attend la fin de la reprise. Démontage/changement d'identité empêchent la
  publication ; nouvelle activation compatible avec StrictMode. Les erreurs de
  lecture et d'action restent distinctes ; une reprise réussie ne masque pas un
  refus d'action. Toutes les notifications restent prises en compte.
- Service de vue legacy : retour local immédiat seulement pour la première page
  sans curseur et entièrement disponible. Couverture partielle, source/vue
  absente et curseur serveur conservent requête, erreurs et reprise existantes.
  Diagnostics pending/conflict et générations des curseurs locaux conservés.

### Mesure du coût de lecture

Fixture jetable scellée avec le codec chiffré réel et fake-indexeddb, vingt
propriétés par entrée. Deux échauffements puis huit mesures alternées par
méthode, avec égalité des résultats vérifiée. Le baseline reproduit l'ancienne
lecture sérielle ; ce benchmark mesure le coût local du repository, pas une
navigation complète, un serveur ou le stockage physique d'un navigateur.

| Entrées | Sériel médiane / p95 (ms) | Lot médiane / p95 (ms) |
| ---: | ---: | ---: |
| 100 | 5,51 / 7,51 | 2,24 / 3,36 |
| 1 000 | 92,45 / 125,01 | 24,61 / 26,01 |

À 1 000 entrées : environ 73 % de coût médian en moins et un `bulkGet` au lieu
de 1 000 lectures de paire. Script ignoré :
`work/notion-api/038-database-entry-read-benchmark.ts`.

Sur la vraie base à 17 cartes, trois bascules chaudes par sens, chronométrées
depuis l'extérieur de l'outil jusqu'au rendu DOM de la vue attendue :

| Vue cible | Avant (ms) | Après (ms) |
| --- | --- | --- |
| Matière | 380 / 265 / 265 | 264 / 342 / 267 |
| Par état | 268 / 277 / 265 | 273 / 275 / 267 |

**Aucun gain significatif de durée n'est établi sur ce petit jeu.** Les appels
outil et la lecture DOM représentent une part élevée des quelque 270 ms.
Une mesure faite avant stabilisation de la vue initiale après navigation est
écartée : elle ne correspondait pas à une bascule chaude réussie.

### Revue réelle et contrôles

Revue ui-quality + lessons sur 8082 : bascules Par état/Matière, passage du
crayon de « reprendre les notion de C » à « reprendre l’exo sur l’ACP », une
seule édition dépliée et fermeture par Échap. Ouverture de SMB111 en volet
canonique avec propriétés/contenu puis fermeture, les 17 cartes restant montées.
En clair/sombre à 320 px, titre, propriétés et rail restent lisibles, document
scrollWidth 320. Captures privées ignorées : `038-reading-dark-320.png` et
`038-reading-light-320.png` dans `work/notion-api/`. La capture claire initiale
prise pendant une transition n'est pas utilisée comme preuve de l'état stable.

Le bloc de la page de référence affiche son titre de source et sa table vide,
sans erreur de lecture de base. Les diagnostics éditoriaux séparés ne sont pas
masqués par cette optimisation. Une fixture seule créée pour 039 prouve titre
et case Examen après rechargement, puis est mise à la corbeille ; les réglages
indiquent ensuite zéro changement en attente et tous les changements acceptés.
Aucune entrée existante modifiée, convertie ou supprimée. État final : 17 cartes,
aucune édition ni confirmation ouverte, viewport 1454 × 909, média emulé retiré,
cache HTTP normal et barre latérale restaurée à son état masqué initial.

Contrôles sélectionnés selon [docs/development.md](../../docs/development.md),
pour ce périmètre de lecture borné :

- 64 tests client-core dans quatre fichiers : store, query, mutation et
  reconciliation des bases. Régressions ordre/identités/disponibilité, lots
  bornés hors transaction, payload illisible et priorités de présentation.
- 70 tests Web dans neuf fichiers, puis 12 de sérialisation de synchronisation
  dans un fichier distinct. Sources modernes/legacy/secondaires/absentes,
  lectures suspendues et rafales, démontage/changement de vue, erreurs/reprises,
  propriétés, première page locale, pagination distante et générations.
  Preuves : `038-reading-core-tests.log`, `038-reading-web-tests-final.log` et
  `038-reading-sync-tests.log`, ignorés dans `work/notion-api/`.
- Types client-core/Web/racine et Biome des fichiers exécutables modifiés réussis.
  Revue indépendante des chemins ordre/identités/couverture/curseurs sans nouvelle
  régression identifiée. Pas de campagne backend/API ou migration : leurs
  contrats et écritures sont inchangés ; pas de gate complet revendiqué.

Build de ce premier lot Bun 1.4.2 : 33 sorties, 23 assets précachés, 10 239 459 octets.
Web 8082 seul déployé à 11:54:04 UTC ; API 8082 et web/API 8080 conservent
leurs démarrages du 4 octobre. Base et données préservées. La maintenance de
table vide révélée par la validation est livrée ensuite, avec preuve ci-dessous.
Aucune publication Git demandée.

Neuf parcours Chromium desktop passent dans `038-reading-e2e-desktop-corrected.log`
(64 s projet) : propriétaire navigable/page/dossier, sources secondaires,
bloc lié/source retirée, activation/cancel pendant changement distant de colonne,
pagination jusqu'à 1 001 entrées, conversion locale avec réseau bloqué,
confirmation/Échap, annulation physique de création de propriété et brouillon
en cours de composition pendant une mise à jour distante. Sources secondaires
et activation/cancel passent aussi sur Firefox desktop, WebKit desktop,
Chromium mobile et WebKit mobile. La composition est relancée sur le code final
de FR023 dans ces quatre profils, et repasse sur Chromium desktop avec la
pagination ; ces preuves complémentaires clôturent les parcours requis.

Les premières exécutions ont trouvé des attentes de tests périmées : nom exact
du select natif Type, corps de table vide de hauteur nulle confondu avec son
en-tête, ancien bouton de fermeture et titre de volet désormais présent avec
celui du propriétaire monté. Les sélecteurs emploient le combobox accessible,
l'en-tête visible et le scope du volet réel. Le parcours de 1 001 entrées avait
déjà atteint toutes les lignes avant de buter sur son ancien bouton de fermeture.
Les assertions de pagination, focus et persistance ne sont pas supprimées.
Les runs interrompus et leurs retries ne constituent pas une preuve de succès.

## Étendue de table vide — FR023 / T041–T042

Reproduction réelle à 320 px : table intégrée large de 328 px dans un rail de
304 px, table/corps hauts de zéro, scrollWidth du corps égal à clientWidth.
Un geste physique horizontal sur l'en-tête laisse scrollLeft à zéro ; une
commande hors écran est inaccessible. Ce problème est distinct des lectures
optimisées mais empêche de préparer le parcours de composition sur mobile.

Correction finale : un élément de géométrie haut d'un pixel, `aria-hidden`,
large au minimum comme les colonnes, uniquement dans un corps complet vide en
page-flow. Aucun `tr` ou entrée n'est créé. Les corps partiels et remplis ne
reçoivent pas cet élément. Le scroll et le focus restent gérés par le hook
d'en-tête existant. Une première hauteur CSS sur la table vide fonctionnait
dans Chromium mais restait ignorée par WebKit ; elle est remplacée, sans
assouplir la vérification de géométrie. Le helper emploie focus puis clic normal
pour révéler la commande : mouse.wheel n'est pas supporté par WebKit mobile.

Preuve manuelle de la version finale sur 8082 : rail haut d'un pixel, étendue
108 px, zéro ligne, aria-hidden true et document scrollWidth 320. Geste physique
sur l'en-tête : scrollLeft 108 et transform -108 px ; bouton Ajouter une propriété
visible, hit-test vrai, formulaire ouvert puis annulé sans créer de propriété.
Navigation clavier depuis Modifier Nom puis largeur de Nom et Tab : Ajouter
obtient le focus à x284–312 px, scrollLeft 56 ; Entrée ouvre le formulaire, puis
annulation. Clair/sombre observés à 320 px ; captures privées
`038-empty-table-light-320.png` et `038-empty-table-dark-320.png`. La première
capture claire avec le panneau de configuration ouvert est remplacée par l'état
vide propre. Table remplie : 17 vraies lignes de hauteur 34,5 px, aucun refus de
lecture ; retour au Kanban, viewport 1454 × 909 via reset, média retiré et aucune
édition/confirmation ouverte. Aucune propriété ou entrée existante modifiée.

Contrôles finaux supplémentaires :

- 23 tests Web dans table-accessibility, table-scroll-observer et table-viewport.
  Preuve `038-empty-table-components.log` : trois fichiers passés.
- Composition/actualisation distante avec préparation d'une table vide large :
  corps de hauteur positive, aucun faux `tr`, étendue positive si débordement,
  première entrée puis valeurs locales/distant et identité du champ conservées.
  Firefox/WebKit desktop, Chromium/WebKit mobile : quatre projets passés en
  42 s, `038-empty-table-e2e-matrix-corrected.log`. Firefox et WebKit utilisent
  les runtimes Linux épinglés prévus par docs/development.md sur ce Mac.
- Chromium desktop : composition et pagination de 1 001 entrées repassent sur
  ce code final (deux tests, 31,4 s Playwright / 32 s projet),
  `038-empty-table-e2e-desktop-corrected.log`.
- Types racine et Biome TS/TSX/CSS/E2E réussis ; le CSS conserve ses 52
  avertissements existants de spécificité/important, sans erreur bloquante.
  Une relance de build E2E a été lancée en même temps qu'un build applicatif :
  le garde de service worker a correctement refusé leur sortie partagée.
  Les builds sont ensuite exécutés séquentiellement ; la relance E2E et le
  build applicatif final passent. Aucun contournement du garde n'est ajouté.

Build applicatif final Bun 1.4.2 : 33 sorties, 23 assets, 10 239 656 octets.
Image finale et web 8082 seul actualisés à 12:18:18 UTC. API 8082, Caddy 8082
et web/API 8080 gardent leurs démarrages antérieurs ; aucune DB recréée.
Logs ignorés `038-empty-table-build-final.log`, `038-empty-table-image-final.log`
et `038-empty-table-deploy-final.log`. Checkpoint de référence :
`cff368e40af761d7d61611fbc129b5c6239ea82b`, modifications non committées.

Convergence FR022/023 : mesures localisées, tests ciblés et cinq profils,
preuves UI réelle, ordres/identités/diagnostics/durabilité inchangés et aucune
fausse entrée. Pas de gap UI matériel restant sur ce périmètre. Prérequis
Spec Kit, références documentaires et espaces du diff vérifiés ; T037–T042
peuvent être clos. La baisse des octets de 039 n'est pas assimilée à une baisse
du temps utilisateur, ni le benchmark du repository à un démarrage complet.
