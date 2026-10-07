# Validation — 6 octobre 2026

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
