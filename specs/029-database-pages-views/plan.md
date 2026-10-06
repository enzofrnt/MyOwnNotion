# Implementation Plan: Bases de données comme pages et vues

**Branch**: `codex/029-database-pages-views` | **Date**: 2026-09-27 | **Spec**: [spec.md](spec.md)

## Summary

Faire d'une base un élément canonique de la hiérarchie. Une page de base possède zéro, une ou plusieurs sources ; chaque source a une page d'origine. Les entrées actives sont les pages et dossiers enfants directs de cette page. Les vues appartiennent à la page et pointent chacune vers une source. Une base intégrée affiche les vues de la page de base enfant. Les commandes de création, projections hors ligne, API, export/restauration et import Notion utilisent les mêmes identités et invariants. La session du 30 septembre 2026 dans `spec.md` prime sur le verrou « une source par page » et sur le bloc à vue unique.

## Technical Context

**Language/Version**: TypeScript 5.9, Bun 1.4.2, SQL PostgreSQL.

**Primary Dependencies**: React, BlockNote/ProseMirror, Hono API, Drizzle ORM, Vitest, Playwright ; bibliothèques déjà présentes.

**Storage**: PostgreSQL côté serveur ; stockage local chiffré et outbox côté client ; documents et définitions protégés par le chiffrement applicatif existant.

**Testing**: Vitest domaine/contrats/intégration API et DB ; Playwright pour chaque parcours UI modifié, desktop et 320 px ; gates de `docs/development.md`.

**Target Platform**: Web et hôtes Electron existants, utilisables hors ligne après chargement local.

**Project Type**: Monorepo Bun avec domaine, contrats, persistance, client core, API et Web.

**Performance Goals**: Une vue ne charge que les entrées de sa source active ; changer d'onglet ou de format ne duplique aucune entrée.

**Constraints**: Propriétaire unique ; chiffrement des contenus et données locales ; édition hors ligne ; synchronisation déterministe ; pas de nouveau service ni bibliothèque ; une source a une seule page d'origine et la suit ; cinq formats. Plusieurs sources par page de base sont dans le périmètre. Le déplacement d'une source sans sa page d'origine ne l'est pas.

**Scale/Scope**: Cinq stories couvrant éditeur, arborescence, persistance, import et sauvegardes.

## Constitution Check

| Principe | Décision et preuve attendue |
| --- | --- |
| I. Contrôle et résilience | Sources/entrées exportables et restaurables ; lecture/édition hors ligne ; corbeille récupérable. |
| II et VIII. Source de vérité | Sections 10, 11, 13, 14, 18–22, 27–33 et 42–44 du canevas citées dans la spec ; 009, 026 et 028 alignées. |
| III. Livraison vérifiable | Stories autonomes, tests de comportement et parcours Playwright pour chaque interaction ; tâches tenues à jour. |
| IV. Sécurité et migration | Révisions protégées et données locales chiffrées ; aucun contenu sensible dans les logs ; anciennes bases bloquent la migration jusqu'à une remise à zéro explicitement choisie. |
| V. Architecture simple | Source et présentation distinctes, éléments canoniques ; réutilisation des rendus existants ; aucune nouvelle infrastructure. |
| VI. UX prévisible | États et reprise ci-dessous ; création cohérente, navigation clavier et aucune suppression implicite de source. |
| VII. Outillage | Bun épinglé, migrations et checks du dépôt ; pas de deuxième runtime. |

**Gate avant recherche** : satisfait. Aucun conflit avec la constitution.

## Architecture et flux

1. **Identités** : `itemId` de la page `database` ou `database_view`, `sourceId` de la source et `viewId` de la vue sont des UUID distincts. Plusieurs lignes de source peuvent partager le même `ownerItemId`. `database_view` n'en possède aucune jusqu'à création d'une source, qui la convertit en `database`. Avec une seule source affichée, le titre visible est celui de la source.
2. **Hiérarchie** : racine/page/dossier acceptent les types ordinaires et les bases/vues liées selon la matrice de contenance ; `database` accepte seulement page/dossier enfants directs ; `database_view` est une feuille. Une entrée active est déterminée par son placement direct sous le conteneur propriétaire, pas par une liste parallèle. Les valeurs `(sourceId, entryId)` restent après déplacement.
3. **Définitions** : la source porte schéma, rôles et nom ; le conteneur de présentation porte une liste ordonnée de vues `{viewId, sourceId, format, filtres, tri, regroupement, propriétés visibles}`. La requête combine la source et la vue sélectionnées. Une vue liée ne duplique pas la source.
4. **Transactions** : création du conteneur, de sa source, de la première vue et du placement dans une seule mutation serveur et une projection optimiste équivalente. L'insertion du bloc ou lien dans le document est coordonnée avec la mutation de document ; un échec garde le brouillon et le point d'insertion pour réessai sans doublon. Créer depuis Kanban pose immédiatement la valeur du groupe.
5. **Cycle de vie** : supprimer une vue ne supprime pas sa source. La dernière vue d'une source, retirée depuis sa page d'origine, demande « vue seule » ou « vue et source ». Une vue d'une source née ailleurs ne propose pas de supprimer la source. Supprimer la page d'origine confirme avec le nombre de sources, supprime ces sources, et laisse les vues ailleurs avec le message « Aucun résultat : la source de données demandée n'existe plus. » Déplacer la page d'origine emmène ses sources. Une seule vue verrouille encore le changement de sa source.
6. **Projection et échanges** : API, sync et cache local publient type canonique, association propriétaire-source et vues séparément. Export, restauration et import partagent ce modèle ; les sauvegardes antérieures à 029 ne sont pas garanties après reset pré-V1.

### Migration et données pré-V1

Ajouter une migration numérotée après `0018`, sans réécriture silencieuse de l'historique. Elle refuse les installations avec anciennes sources/entrées/intégrations plutôt que de les effacer. La remise à zéro pré-V1 est **explicite et bornée à une installation de développement isolée** : relever les objets touchés, sauvegarder au besoin, confirmer le périmètre réel, puis utiliser `dev:stack:reset`. Cette commande efface aussi les fichiers et sauvegardes de cette installation ; elle ne doit jamais être lancée comme une simple migration de bases. Une installation qu'on souhaite conserver reste bloquée jusqu'à migration ou export adaptés. Tester un jeu neuf en export/restauration et synchronisation.

### Offline, conflits et sécurité

- Outbox et projection appliquent les mêmes invariants que serveur ; une erreur conserve un brouillon réessayable.
- Les mutations de source et de vue portent leurs révisions attendues ; en conflit, renvoyer l'état canonique pour réessai sans écrasement silencieux.
- Définitions, valeurs, vues et blocs utilisent les charges protégées existantes ; seules identités et placements nécessaires restent en clair. Ne jamais journaliser titres/propriétés.
- Source corbeille ou purgée : vue indisponible et lecture seule jusqu'à restauration, sans confondre avec projection locale partielle.

## Parcours et états UI — `ui-quality`

Ce plan applique [ui-quality](../../.agents/skills/ui-quality/SKILL.md) et son [journal de leçons](../../.agents/skills/ui-quality/lessons.md), notamment L-009 (propriétaire CSS unique), L-010 (preuve réelle), L-012 (node view ProseMirror) et L-015 (scroll local). Les huit [captures du propriétaire](references/README.md) guident la hiérarchie visuelle.

| Parcours | Vide/chargement | Succès | Erreur/reprise |
| --- | --- | --- | --- |
| Créer pleine page par `/` ou `+` | Menu clavier, action bloquée pendant création | Lien au curseur, ouverture de la base, Table vide | Erreur au point de commande, saisie conservée, réessai sans doublon |
| Créer intégrée | Bloc stable pendant chargement | Vues de la page enfant dans la largeur du texte | Bloc non confirmé récupérable et message local |
| Plusieurs sources | Titre de page, puis nom de la source de la vue active | Onglets de sources distinctes | Source absente : « Aucun résultat : la source de données demandée n'existe plus. » |
| Dernière vue d'une source | Confirmation : vue seule, ou vue et source | La source reste si seule la vue part | Une vue externe ne propose pas de supprimer la source |
| Supprimer la page d'origine | Confirmation avec le nombre de sources | Sources supprimées, vues ailleurs conservées | Annulation ne retire rien |
| Ajouter entrée page/dossier | Action « Nouvelle page/dossier » | Entrée ouvrable avec propriétés partagées | Valeurs saisies gardées ; pas d'entrée fantôme |
| Onglets et source | Source possédée visible même sans vue ; unique onglet verrouillé avec explication | Onglets aux formats/sources/réglages propres | Source absente/corbeille avertie ; édition désactivée |
| Bande du workspace | Base ou vue liée ouverte depuis arbre/lien | Onglet propre à chaque élément, icône source ou liée, retour et fermeture sans changer la source | Élément supprimé retiré de la bande ; voisin actif conservé |
| Vue liée | Sélecteur de source filtrable | Bloc unique et élément d'arbre fléché | Avertissement sans effacer bloc, source ou entrée |

Vérifier chaque surface en clair/sombre, à 320 px et desktop, clavier/focus. Le bloc intégré reste aligné au texte et son contenu large défile en interne. Les `+` respectent la contenance. Tests Playwright et revue visuelle consignés dans `validation.md` avant clôture des tâches UI.

## Maintenance UI — largeur et création de propriétés (2026-10-06)

Une base pleine page élargit à la largeur disponible le même conteneur partagé
par le titre et la vue ; des gouttières latérales égales réduisent l'asymétrie
induite par le menu de navigation. Les pages de prose et les blocs intégrés
restent bornés à leur colonne de lecture et conservent leurs gouttières.
La variante pleine page réutilise `--workspace-reading-width` et définit ses
deux gouttières sous le propriétaire CSS `features/databases/database.css`.

`PropertyEditor` garde son protocole de brouillon et FormData, mais présente
Nom et Type comme champs empilés et associés, puis les réglages conditionnels.
Les options restent contenues dans le panneau et le pied d'action sépare
Enregistrer d'Annuler. Tokens et primitives existants portent contraste et
cibles tactiles. Propriétaire visuel unique : `features/databases/database.css` ;
patrons durables dans `ui-quality` et le guide du système UI.

## Project Structure

### Documentation

```text
specs/029-database-pages-views/{spec.md,research.md,plan.md,data-model.md,contracts/,quickstart.md,tasks.md,validation.md,references/}
```

### Source Code

```text
packages/domain/src/{content,databases,document,export}/
packages/contracts/src/
packages/database/{migrations,src}/
packages/client-core/src/
apps/api/src/{routes,sync,backup,imports/notion}/
apps/web/src/{features,ui,services}/
apps/api/tests/, packages/*/tests/, apps/web/tests/, tests/e2e/
```

**Structure Decision**: Étendre les frontières présentes. Invariants au domaine et revalidés en SQL. Réutiliser les rendus Table/Kanban/Galerie/Liste/Calendrier.

## Phase 1 Design Gate

Identités, cycle de vie, flux hors ligne, migration et import détaillés dans [data-model.md](data-model.md), [contracts](contracts/) et [quickstart.md](quickstart.md). Aucun écart non justifié avec la constitution ; prêt pour tâches et analyse croisée.

### Ajustement visuel des entrées — 033

Le retour 033 FR-015/016 utilise PageTitleEditor/workspace-page-canvas et un
menu d'options partagé avec les cellules. Sauvegarde explicite des propriétés,
révisions, projections, documents et hiérarchie inchangés. Propriétaires CSS :
database.css (panneau/valeurs/prise) et workspace.css (colonne de lecture).
ui-quality/lessons et preuves/tests ciblés dans 033 ; E2E différés à la demande
explicite du propriétaire, sans push ni release.

## Extension034

Voir[034/plan.md](../034-notion-content-navigation/plan.md) pour le modèle
mathématique, les sommaires dérivés, la navigation scopée et le propriétaire
CSS des rangées de liste. Les primitives, thèmes et parcours existants sont
réutilisés ; la couche034 dispose de sa propre preuve ui-quality et lessons.


## Ajustement des liens et commandes — 035

Le retour du propriétaire du 4 octobre est défini dans
[035/spec.md](../035-item-links-database-insertion/spec.md), avec approche et
suivi dans ses plan.md/tasks.md. Il remplace les libellés précédents par les
créations « Page/Dossier/Base de données imbriqué(e) », élargit « Lien vers un
autre élément » aux bases, et fusionne les commandes d'affichage intégré et lié
dans un dialogue de choix. Le concept de vue liée et la propriété des sources
restent inchangés. L'import respecte is_inline et corrige les références
historiques inchangées ; la validation locale propre à035 ne revalide pas les
anciennes phases de cette feature.

## Extension 036 — 2026-10-04

[036](../036-multi-select-boards/spec.md) ajoute le regroupement Kanban par sélection multiple, sans repli table pour ce cas. Les anciennes preuves Matière restent historiques ; la restauration ciblée et la validation native sont suivies dans 036.

## Retour UI — ajout de propriété dans le contexte du schéma

Sur les vues non tabulaires, l'action de création appartient au panneau des
propriétés de la source, pas à la bande sous les onglets de vue. Le panneau de
configuration réutilise la même édition et sauvegarde existantes. La table
garde son bouton plus dans l'en-tête des colonnes, où il agit comme une colonne
contextuelle.

## Maintenance UI — titre de source dans une base intégrée

Le canevas §14 et FR-034 exigent que le nom de la source de la vue active soit
visible dans le bloc intégré, même lorsque ce bloc n'affiche qu'une source.
`DatabaseContainerPage` résout déjà la source à partir de l'onglet sélectionné
et réutilise `CurrentSourceTitle` : le titre se place au-dessus de la barre des
vues, suit leur sélection, reste éditable pour la source possédée et en lecture
seule pour une source liée. Le rendu garde le propriétaire CSS existant
`features/databases/database.css`. Appliquer `ui-quality` et son journal de
leçons, en particulier L-009 (propriétaire CSS unique), L-010 (preuve réelle)
et L-012 (node view ProseMirror) ; consigner les états et limites dans la
validation 029.

## Maintenance UI — déplacement d'une base intégrée

Le canevas §14 et FR-035 exigent un déplacement du bloc intégré en tant qu'unité,
sans calque de sélection inadapté ni fantôme déformé. Conserver la poignée
BlockNote et son protocole de drop. La tentative de remplacer son image clonée
par le `.bn-block-outer` vivant a rendu le déplacement inutilisable ; elle est
annulée. Garder la neutralisation de la surbrillance de sélection dans
`features/editor/editor.css`. Appliquer ui-quality/lessons L-009, L-010 et L-012 ;
tester manuellement le clone natif sur une base intégrée avant de choisir une
nouvelle stratégie de rendu et de convergence.

Correction de l'ancrage : le calcul du hotspot seul n'a pas résolu le placement
du bitmap natif, d'après le retour du propriétaire. Conserver le clone BlockNote
et son rendu, mais l'afficher en overlay fixe du viewport. Mémoriser le point
saisi au pointerdown de la poignée, puis conserver son écart au contenu cloné
par une translation mise à jour sur les événements dragover. Remplacer le
bitmap natif par un canvas transparent d'un pixel. Tenir compte du padding et
de la poignée extérieure. Ne toucher ni au DOM ProseMirror ni au protocole
de dépôt ; cacher l'overlay à l'annulation/au dépôt, laisser BlockNote supprimer
son clone et nettoyer les écouteurs. Dans le clone seulement, neutraliser les
gouttières des rails pleine page, qui repoussent la première colonne hors de
sa surface locale ; les styles restent possédés par `database.css`.
Vérifier le fantôme visible sur la page réelle
`01a112d2-5758-7000-81a8-60d69c00f34a`, puis après défilement et à largeur
réduite ; appliquer ui-quality/lessons L-010, L-012 et L-023.

Largeur du fantôme : mesurer la surface de base réelle au début du drag et
figer cette largeur en pixels sur le clone. Retirer sa limite compacte de
28 rem et son padding d'aperçu dans `editor.css`, puis mesurer l'ancrage après
cette mise en largeur pour garder son placement au curseur. La base et le
contenu du clone doivent avoir la même largeur à chaque viewport contrôlé ;
pas de transform de mise à l'échelle. Appliquer `ui-quality`/lessons L-009,
L-010 et L-012 ; vérifier les deux géométries et le rendu visible pendant des
gestes réels, puis le nettoyage à l'annulation.
