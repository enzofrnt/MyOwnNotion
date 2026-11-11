# Plan: renommage inline dans l'arbre

**Feature**: `056-tree-inline-rename`
**Spec**: `spec.md`

## Approche

Le champ remplace le libellé dans la ligne, à la position exacte du nom, plutôt
que d'ouvrir une surface séparée. Trois raisons :

1. Le défaut vient d'un dialogue natif. Supprimer la dépendance est la
   correction ; la remplacer par une modale applicative l'aurait seulement
   déplacée.
2. L'application sait déjà éditer en place (titre de page, entrées de base).
   Réutiliser ce geste garde un seul contrat : Entrée valide, Échap annule, le
   clic extérieur valide.
3. La ligne reste identifiée pendant la saisie (icône, emplacement, sélection),
   ce que le prompt masquait.

## Composants et propriétaires

| Élément | Fichier |
| --- | --- |
| Champ de renommage | `apps/web/src/features/navigation/navigation-inline-rename.tsx` (nouveau) |
| Primitive de saisie | `ui/primitives/native-input.tsx`, `NativeInput density="compact"` |
| Styles | `apps/web/src/features/navigation/navigation.css` (`.tree-inline-rename*`) |
| Câblage de l'arbre | `apps/web/src/features/hierarchy/hierarchy-explorer.tsx` |
| Écriture du nom | `renameSelectedItem` existant (titre de page) → `item.rename` |
| Tests composant | `apps/web/tests/navigation-inline-rename.spec.tsx` |
| Journeys | `tests/e2e/helpers.ts`, `tests/e2e/keyboard-navigation.spec.ts`, `tests/e2e/live-sync.spec.ts` |

## États et parcours

- **Repos** : le champ est un `input` natif stylé, fond surface élevée, bordure
  `border-strong`, 12 px, hauteur 22 px (24 px au pointeur grossier), dans une
  ligne de 30 px.
- **Focus** : bordure et contour `--ui-color-focus`. Aucun anneau propre au
  survol.
- **Occupe** (`aria-busy`) : `readOnly` pendant l'écriture, opacité réduite,
  champ conservé.
- **Refus** : reste ouvert, saisie conservée, focus rendu au champ ; le bandeau
  de problème existant explique le refus.
- **Clavier** : `F2`, `Entrée`, `Échap` ; le focus revient à la ligne
  (tabindex roving) après une fermeture clavier.
- **Pointeur** : clic droit → même champ ; clic hors du champ valide ; aucun
  événement de la ligne (navigation, menu, drag) ne reçoit les clics du champ.
- **IME** : les `keydown` de composition sont ignorés.

## Données

Aucun changement d'API, de schéma ni de synchronisation. Le nom reste porté par
`item.rename` avec la révision courante relue juste avant l'écriture, comme le
titre de page ; un conflit de révision est retenté puis signalé.

## Risques

- **Double écriture** (Entrée puis blur) : gardé par un drapeau « settled » dans
  le composant.
- **Vol de focus** : la fermeture par blur ne rend pas le focus à la ligne ;
  seules les fermetures clavier le font.
- **Largeur** : le champ prend la place du nom (`flex: 1 1 auto`, `min-width:
  0`), les actions de ligne gardent leur largeur ; vérifié à 390 px.
- **Ligne draggable** : `TreeDropTarget` ignore déjà les cibles `input` ; le
  champ porte en plus `data-no-tree-drag`.

## Validation

`validation.md` : tests composant, typecheck, lint, journeys e2e ciblés et
captures clair/sombre/390 px obtenues sur l'application réelle.

## Correctif annexe requis

Le chemin e2e ne pouvait pas démarrer : `0021_database_entry_numbers.sql`
n'enregistrait pas sa version dans `schema_migrations`. Le garde-fou de mise à
jour refusait alors toute base neuve (« reviewed migrations remain unapplied »).
La ligne manquante est ajoutée et un test statique
(`packages/database/tests/migration-registry.spec.ts`) empêche la récidive.
