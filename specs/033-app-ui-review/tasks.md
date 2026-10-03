# Tasks: Revue complète et composants communs

Sources : [spec](spec.md), [plan](plan.md),
[ui-quality](../../.agents/skills/ui-quality/SKILL.md),
[lessons](../../.agents/skills/ui-quality/lessons.md).

## Phase 1 — Préparation

- [x] T001 Conserver référence initiale, données et instance dans specs/033-app-ui-review/verification.md.
- [x] T002 Inventorier familles/composants actifs/états et exceptions dans specs/033-app-ui-review/verification.md.

## Phase 2 — US1 : revue complète

Test indépendant : chaque surface active ou conditionnelle a une preuve et un résultat.

- [x] T003 [US1] Ajouter compositions réelles mémoire des états conditionnels dans apps/web/src/ui/ui-lab*.
- [x] T004 [US1] Appliquer ui-quality + revue/corrections des conflits, réconciliation et historique dans apps/web/src/features/{sync,reconciliation,history}/ et specs/033-app-ui-review/assets/.
- [x] T005 [US1] Appliquer ui-quality + revue/corrections des fichiers, aperçus et états de transfert dans apps/web/src/features/files/ et specs/033-app-ui-review/assets/.
- [x] T006 [US1] Appliquer ui-quality + revue/corrections des formats de base, propriétés, filtres et overlays dans apps/web/src/features/databases/ et specs/033-app-ui-review/assets/.
- [x] T007 [US1] Appliquer ui-quality + revue des autres familles, éditeur/menus/liens, navigation, recherche/graphe, auth/récupération/réglages/desktop dans apps/web/src/features/ et specs/033-app-ui-review/assets/.

## Phase 3 — US2 : bibliothèque commune

Test indépendant : mêmes rôles partagés, actions/focus conservés et exemples utilisables.

- [x] T008 [US2] Consolider les besoins répétés dans apps/web/src/ui/primitives/ ; remplacer usages concernés dans apps/web/src/features/ sans toucher modèles métier.
- [x] T009 [US2] Vérifier les comportements modifiés dans apps/web/tests/ avec tests pertinents, sans E2E ni tests miroirs CSS.
- [x] T010 [US2] Appliquer ui-quality + preuves des composants communs aux deux thèmes/largeurs, clavier/tactile/mouvement réduit dans specs/033-app-ui-review/verification.md.

## Phase 4 — US3 : livraison observable

Test indépendant : instance HMR, guide actuel et preuves consultables, données conservées.

- [x] T011 [US3] Actualiser docs/design/ui-system.md et exemples apps/web/src/ui/ui-lab* avec contrats/recettes/exception réels.
- [x] T012 [US3] Vérifier instance et captures finales dans specs/033-app-ui-review/verification.md.

## Phase 5 — Convergence

- [x] T013 Exécuter types/lint/tests/build pertinents et enregistrer limites dans specs/033-app-ui-review/verification.md.
- [x] T014 Converger FR-001…008/SC-001…005 et maintenir specs/033-app-ui-review/tasks.md, sans présenter non-vu comme vérifié.

## Dépendances et stratégie

T001→T002→T003 puis T004…007 par famille. Besoins communs observés→T008→T009/T010.
T011/T012→T013/T014. Lire/rassembler les fichiers indépendants par lots ; edits
séquentiels. Incrément utile initial : états rares rendus proprement dans le lab.
La passe complète ne s’arrête pas à cet incrément. Pas de délégation nécessaire.

## Retours du propriétaire — pièces jointes et création en ligne

- [x] T015 [US1] Implémenter et vérifier la projection des fichiers intégrés depuis le document local, sans import indépendant, dans apps/web/src/features/{attachments,hierarchy}/ et apps/web/tests/page-attachments.spec.ts, page-attachment-panel.spec.tsx (FR-009).
- [x] T016 [US1] Appliquer ui-quality et ses leçons : trombone, retrait léger et titre tronqué selon la largeur réelle des actions dans apps/web/src/features/navigation/navigation.css ; préserver ouverture/fermeture et clavier/tactile (FR-009/010).
- [x] T017 [US3] Vérifier les surfaces réelles et exemples isolés, clair/sombre, 320/1280 px, vide/rempli et clavier ; conserver preuves/contrôles dans specs/033-app-ui-review/{verification.md,assets/}, sans E2E ni reset.
- [x] T018 [US1] Retirer les compteurs et garder les actions de ligne visibles tant que les pièces jointes sont ouvertes ; appliquer ui-quality et conserver une capture après interaction ailleurs (FR-011). Interprétation du compteur corrigée ensuite par T020.
- [x] T019 [US1] Localiser l'état d'ouverture à la ligne, stabiliser les commandes et le contexte des éditeurs ; tester fermeture au départ et absence de rendus inutiles, mesurer ouverture/fermeture et navigation réelles, documenter preuve/limites sans E2E (FR-011).

## Clarification — compteurs réduits et preview du glisser de bloc

- [x] T020 [US1] Rétablir les compteurs locaux dédoublonnés avec badges plus petits, appliquer ui-quality/lessons, mettre à jour canevas/017 et vérifier rempli/vide/inconnu/noms longs aux deux thèmes et largeurs (FR-011).
- [x] T021 [US1] Corriger le repère de dépôt de bloc pour cibler l'éditeur actif, conserver snapping/dépôt/annulation et accent bleu ; tests ciblés multi-éditeurs et preuve réelle sur fixture mémoire, selon ui-quality/lessons (FR-012).
  - La validation automatisée autorisée le 2026-10-03 confirme maintenant le survol/dépôt/annulation natifs avec un autre éditeur masqué ; capture validation-native-block-drop-preview-chromium.png et parcours block-editor.spec.ts. Les données du propriétaire restent intactes.

## Retour — fluidité des PJ d'une autre page

- [x] T022 [US1] Dissocier inspection PJ et navigation active dans hierarchy-explorer.tsx / tree-attachment-disclosure.tsx ; tester une ligne non active, absence de rendu du parent/éditeur et fermeture au changement de vue (FR-011).
- [x] T023 [US1] Appliquer ui-quality + lessons : jonction et actions d'une ligne inspectée non sélectionnée, exemple mémoire ouvrable, mesures réelles avant/après du parcours autre page, preuves clair/sombre et étroites ; consigner limites dans verification.md, sans E2E.

## Retour — proportions de la poignée de bloc

- [x] T024 [US1] Appliquer ui-quality + lessons à la poignée : marges égales autour du dessin, bouton rectangulaire et écart au texte ; mesurer la vraie surface, vérifier menu/clavier, thèmes et largeur étroite sans E2E (FR-013).
- [x] T025 [US1] Appliquer ui-quality + lessons au centrage réel de l'ajout et de la poignée sur la première ligne de texte : titres 1–4, long/vide, paragraphe, largeur/thèmes/tactile ; tests ciblés et preuves dans verification.md, sans E2E (FR-014).

## Retour — présentation des entrées et prise de colonne

- [x] T026 [US1] Retirer le fond gris de la prise de colonne, préserver cible et interaction, appliquer ui-quality/lessons et documenter survol/focus/geste réel (FR-015).
- [x] T027 [US1] Réutiliser l'en-tête/canevas canonique pour les pages et dossiers entrées, partager le menu/pastilles des options, garder brouillons et sauvegarde ; tests ciblés, selon ui-quality/lessons (FR-016).
- [x] T028 [US3] Ajouter la composition d'entrée au lab mémoire, vérifier états/clavier/thèmes/320/1280 px et page réelle sans modifier les données ; consigner preuves et limites dans verification.md et le guide (FR-016).

## Retour — interactions des propriétés d’entrée

- [x] T029 [US1] Remplacer la sauvegarde explicite par une file automatique durable : pauses/blur/Entrée/choix, concurrence, saisies pendant écriture, erreur et reprise ; tests ciblés (FR-017).
- [x] T030 [US1] Menus contextuels et configuration de propriétés, ajout/duplication/type/options avec protections d’impact, sélecteur recherchable/création/couleur ; partager primitives et palette (FR-018).
- [x] T031 [US1] Poignées à six points, ordre des propriétés source, preview bleue, glisser/clavier/annulation et persistance unique au dépôt ; conserver valeurs et rôles (FR-019).
- [x] T032 [US3] Appliquer ui-quality + lessons, vérifier les parcours en fixtures mémoire, page réelle en lecture, thèmes/320/1280/clavier/tactile ; actualiser preuves, guide et contrôles ciblés sans E2E.

## Retour — icônes des propriétés

- [x] T033 [US1] Ajouter un choix facultatif à la propriété de source, compatible avec les définitions existantes ; validation/contrat, révision chiffrée et absence d’impact sur les valeurs (FR-020).
- [x] T034 [US2] Extraire le sélecteur utilisé par les vues et le partager avec les propriétés ; choix/retrait automatiques depuis leur configuration et les réglages de la base, symbole par défaut et affichage commun (FR-020).
- [x] T035 [US1] Vérifier persistance, type/duplication, fusion et lecture des définitions anciennes ; tests ciblés de domaine/contrat/interface, sans E2E.
- [x] T036 [US3] Appliquer ui-quality + lessons : revue réelle/mémoire du sélecteur, deux thèmes, 320/1280 px, clavier/tactile ; guide et preuves dans verification.md.

## Retour — menu au clic et champ composé

- [x] T037 [US1] Unifier clic/clic droit/Maj+F10 sur le menu du libellé, conserver configuration et retour du focus ; adapter les tests ciblés (FR-018).
- [x] T038 [US2] Partager InputSurface/NativeInput dans les trois recherches ; croix à l'intérieur de la pastille, retrait de la seule valeur et focus de recherche ; supprimer les anciens propriétaires CSS (FR-021).
- [x] T039 [US3] Appliquer ui-quality + lessons : preuves réelles/mémoire clair/sombre, 320/1280, clavier/tactile, plusieurs choix longs et retrait/recherche ; documenter guide, contrôles et limites, sans E2E.

## Phase 6: Convergence

- [ ] T040 Actualiser les tests de valeurs d’entrée pour observer la sauvegarde automatique durable, la concurrence et la reprise sans bouton explicite, selon FR-017 et Constitution III (partial).
- [ ] T041 Rejouer les parcours de fichiers via les blocs de l’éditeur et vérifier la projection sidebar, l’inspection indépendante et la fermeture au changement de vue, selon FR-009/010/011 (contradicts).
- [ ] T042 Couvrir configuration directe clic/clic droit/clavier, choix/retrait de symboles, champ composé et ordre des propriétés indépendant des colonnes ; appliquer ui-quality + lessons avec preuves visuelles dans verification.md, selon FR-018/019/020/021 (partial).
- [x] T043 Confirmer la preview et le dépôt/annulation natifs de blocs dans l’éditeur actif avec un autre onglet masqué ; appliquer ui-quality + lessons et conserver la preuve permettant de clore T021, selon FR-012/013/014 (missing).
- [ ] T044 Corriger tous les échecs unitaires/E2E et contrôles de la matrice complète sans affaiblir les garanties ; enregistrer les suites et résultats dans verification.md, selon FR-008 et Constitution III/VII (partial).
- [ ] T045 Publier après checks:local réussi sur le commit exact, ouvrir/attacher la PR et corriger sa CI jusqu’au succès du dernier commit ; consigner les références et limites, selon FR-008 et Constitution III/VII (missing).

- [ ] T046 Rétablir l’action de réordonner les colonnes dans les paramètres de visibilité avec les primitives existantes ; préserver largeur/visibilité et ordre du schéma, couvrir les limites en unitaire et la persistance en E2E (régression de 009 FR-018 découverte en convergence ; ui-quality + lessons).

- [ ] T047 Protéger l'identité des sources dans les écritures locales et serveur ; refuser les doublons sans écriture partielle, tester créations/suppressions/promotions et export canonique (029, Constitution IV/V).
- [ ] T048 Préserver la vue active de chaque page de base après remontage/rechargement, sans enregistrer de contenu en clair ; tests et preuve E2E (009/029).
- [ ] T049 Corriger les régressions d'interaction/accessibilité révélées par la matrice : accès à l'entrée sous un titre long, confirmation de conversion après fermeture du menu et contraste des textes/actions en thème clair. Appliquer ui-quality + lessons, tests clavier et preuves clair/sombre/320 px, conserver la palette des propriétés.

- [ ] T050 Rebrancher le chargement progressif dans les conteneurs de vues (026 FR-011/SC-005, maintenus par 029) : requête sur toute la source et réglages de la vue courante, couverture partielle honnête, curseur stable, états de synchronisation et retour/focus sur la dernière entrée au-delà de 1 000 lignes. Appliquer ui-quality + lessons et conserver le parcours E2E réel.

- [ ] T051 Corriger les derniers écarts mobiles révélés par la matrice : contraste du bouton destructif au survol en clair et fermeture du panneau avant création dans le parcours de confidentialité. Appliquer ui-quality + lessons, conserver audit d'accessibilité et capture réelle, sans affaiblir les assertions de chiffrement.
- [ ] T052 Rétablir les contrôles de sécurité avant publication : versions corrigées des dépendances signalées par l'audit, lecture des liens Git comme chemins suivis sans lire leur cible non suivie ; tests de lecture et scan de l'image candidate avec la version Trivy de la CI. Conserver seuils et règles des scans.

- [ ] T053 Stabiliser l'action d'ajout de propriété pendant l'actualisation d'une nouvelle base : placer le statut temporaire après la vue, observer connexion et position du bouton pendant le clic réel, conserver activation/annulation et répéter les deux parcours sur Firefox Linux et Chromium. Appliquer ui-quality + lessons, sans attendre la fin de synchronisation pour rendre l'action utilisable.
