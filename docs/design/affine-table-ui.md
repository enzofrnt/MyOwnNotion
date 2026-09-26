# Reproduire l’UI de tableau d’AFFiNE

Référence d’intention visuelle pour MyOwnNotion (comme
`affine-dotted-canvas-background.md` pour le graphe). On reprend l’UX AFFiNE —
boutons `+`, menus ligne/colonne, grille sobre, overlay de sélection — sans
porter BlockSuite : le modèle opérationnel reste `table` / `tableRow` /
`tableCell` + commandes page-state.

**État actuel (atelier)** — voir « Architecture MyOwnNotion » ci-dessous.

## Architecture MyOwnNotion (décision)

Modèle opérationnel inchangé : blocs `table` (`columnsJson`) › `tableRow` ›
`tableCell` avec identités stables (undo, CRDT, adapter). Ce qui change : la
couche de rendu suit le découpage AFFiNE.

| Brique AFFiNE | MyOwnNotion | Fichier |
| --- | --- | --- |
| `TableBlock` (wrapper, `<table>`) | node-view `table` : rails `+` + `<style>` scoped par `data-id` pour les pistes de colonnes | `custom-blocks/table.tsx` |
| `TableCell` (rich-text + `⋯`) | node-view `tableCell` : contentRef + handle colonne (ligne 0) / ligne (colonne 0) | idem |
| `hoverColumnIndex$` / `hoverRowIndex$` | store externe `table-ui-state.ts` (`useSyncExternalStore`) — aucune mutation du DOM ProseMirror | `custom-blocks/table-ui-state.ts` |
| `TableDataManager` | commandes BlockNote → adapter → `insert/delete/move-table-row/column` | `table.tsx` + `editor-adapter.ts` |
| `AddButton` | deux rails `+` (colonne à droite, ligne en bas) dans le node-view `table` — pas de coin | `table.tsx` / `editor-table.css` |
| `startDragToMoveColumn/Row` | le `⋯` est aussi poignée de drag : seuil 10 px, preview + indicateur dans un `popover="manual"` (top layer), `pointer capture`, Échap annule | `table.tsx` (`TableAxisHandle`) |
| `popMenu` | `popover` natif (top layer, sans portal Ariakit dans le node-view) | idem |

Règles dures (issues des crashs) :

1. **Jamais** muter le DOM d’un nœud ProseMirror hors de notre node-view
   (`.bn-block`, `.bn-block-group`, attributs `data-*`) : le `DOMObserver`
   re-rend le bloc → remount React → boucle → RAM. Les états de survol vivent
   dans le store React ; les pistes de colonnes passent par un `<style>` rendu
   **dans** le node-view et ciblé par `.bn-block[data-id="…"]`.
2. **Un seul `:has()`**, direct et sur le bloc tableau :
   `.bn-block:has(> .node-table)` (grille 2×2 : lignes | rail colonne /
   rail ligne | case vide, `overflow-x: auto`). Tiptap pose `node-table`,
   `node-tableRow`, `node-tableCell` sur le renderer React ; tout le reste
   passe par les sélecteurs frères `.node-tableRow ~ .bn-block-group` et
   descendants — jamais de `:has()` par cellule.
3. Side-menu BlockNote (`+` / 6 points) : sur le bloc `table` uniquement ;
   survol d’une cellule → `BlockSideMenu` (contrôleur maison sur
   `BlockPopover`) ancre le menu sur le tableau parent et fait glisser le
   tableau, pas la cellule.
4. Le nœud `table` est une feuille ProseMirror : il n’est pas re-rendu quand
   ses lignes changent. `useLiveTableBlock` suit `editor.onChange` et ne
   re-rend que si la signature (lignes, nombre de cellules, colonnes) bouge ;
   il publie ensuite le `TableLayout` (index ligne/colonne par cellule) que
   les cellules lisent pour savoir si elles portent un `⋯`.
5. Tab / Shift+Tab : extension `TableKeymapExtension` (priorité au-dessus du
   keymap BlockNote) — déplacement entre cellules, ajout d’une ligne après la
   dernière cellule. Un `onKeyDown` React arrive après ProseMirror et ne
   suffit pas.
6. Déplacement de ligne/colonne : commandes opérationnelles dédiées
   `move-table-row` / `move-table-column` (`packages/page-state`, contrats,
   undo, branche hors-ligne). Une ligne est un `LoroTreeNode.move`; une
   colonne est un delete + insert dans la séquence `tableColumns` — les
   cellules étant projetées par identité de colonne, elles suivent sans
   commande supplémentaire (les nœuds cellules sont aussi déplacés pour les
   tableaux antérieurs à l’identité de colonne). Deux replicas déplaçant la
   même colonne en concurrence convergent : la lecture dédoublonne par
   identité (première occurrence) et chaque mutation compacte la séquence.
   Côté éditeur, `EditorTableManager.moveRow/moveColumn` réinsèrent le même
   bloc dans une transaction ; BlockNote le remonte comme `move`, l’adapter
   le traduit (`columnMoves` = séquence minimale par plus longue
   sous-suite croissante — un drag = une commande). Une ligne ne peut pas
   quitter son tableau (l’adapter refuse).
7. Non persistables aujourd’hui (l’adapter refuse) : overlay de sélection
   multi-cellules. Le redimensionnement de colonne est une opération
   `set-table-column-width` (preview via draft UI, persistance au pointerup).

Gestes exposés (tous traduits par l’adapter en `insert/delete/move-table-row`,
`insert/delete/move-table-column`, `replace-text`) : rails `+` (ligne,
colonne), drag du `⋯` (ligne vers le haut/bas, colonne vers la gauche/droite,
avec preview et indicateur d’insertion), menu colonne (insérer à
gauche/droite, déplacer à gauche/droite, vider, supprimer), menu ligne
(insérer au-dessus/en dessous, dupliquer, monter/descendre, vider,
supprimer). Après un déplacement le curseur revient dans la première cellule
de la ligne / la cellule déplacée de la première ligne, pour ne pas laisser
le tableau en sélection de nœud. Le dernier élément d’un axe n’est pas
supprimable ; les bornes AFFiNE 50 colonnes / 10 000 lignes désactivent les
ajouts.

Constat atelier (25/09) : une page de dev contenait des tableaux dont l’état
serveur (4 colonnes) divergeait de ce que le client affichait (6 cellules par
ligne). Toute commande sur ces tableaux échoue côté API avec
`BlockTreeOperationError: table row … has 6 cells for 4 columns` (HTTP 500,
socket temps réel fermé en 4500 en boucle). L’UI ne peut pas réparer cela ;
c’est un sujet de cohérence page-state / projection à traiter séparément.

---

AFFiNE sépare son tableau en plusieurs briques simples :

```text
Table
├── TableBlock       → rendu global
├── TableCell        → cellule + menus ligne/colonne
├── TableDataManager → ajout/suppression/déplacement
├── SelectionLayer   → contour bleu de sélection
└── AddButton        → boutons + pour agrandir le tableau
```

L’idée à reprendre est surtout l’UX, pas toute l’architecture BlockSuite.

---

## 1. Structure du tableau

Le composant principal parcourt les lignes et colonnes puis rend une cellule pour chaque intersection.

```ts
rows.map((row, rowIndex) =>
  columns.map((column, columnIndex) => (
    <TableCell
      row={row}
      column={column}
      rowIndex={rowIndex}
      columnIndex={columnIndex}
    />
  ))
)
```

Dans AFFiNE :

https://github.com/toeverything/AFFiNE/blob/canary/blocksuite/affine/blocks/table/src/table-block.ts#L205-L286

Le tableau contient aussi deux couches supplémentaires :

```text
<table>
  cellules
  boutons d'ajout
  couche de sélection
</table>
```

---

## 2. Style des cellules

AFFiNE garde les cellules assez simples :

```css
.table-cell {
  position: relative;
  border: 1px solid #ddd;
  min-width: 120px;
  vertical-align: top;
}

.table-cell-content {
  min-height: 22px;
  padding: 8px 12px;
}
```

Valeurs utilisées :

```ts
ColumnMinWidth = 60;
ColumnMaxWidth = 240;
DefaultColumnWidth = 120;
DefaultRowHeight = 39;
```

Sources :

https://github.com/toeverything/AFFiNE/blob/canary/blocksuite/affine/blocks/table/src/table-cell-css.ts#L4-L25

https://github.com/toeverything/AFFiNE/blob/canary/blocksuite/affine/blocks/table/src/consts.ts

Chaque cellule contient un éditeur texte. Pour une version simple, un `contenteditable` suffit.

---

## 3. Menus de ligne et de colonne

AFFiNE affiche un petit bouton `...` au survol.

Pour une colonne :

```css
.column-menu {
  position: absolute;
  top: -8px;
  left: 50%;
  width: 28px;
  height: 16px;
  border-radius: 8px;
  opacity: 0;
}

.cell:hover .column-menu {
  opacity: 1;
}
```

Pour une ligne, le même principe est placé sur le côté gauche :

```css
.row-menu {
  position: absolute;
  left: -8px;
  top: 50%;
  width: 16px;
  height: 28px;
  border-radius: 8px;
}
```

Source :

https://github.com/toeverything/AFFiNE/blob/canary/blocksuite/affine/blocks/table/src/table-cell-css.ts#L38-L102

Le menu colonne propose notamment :

```text
Background color
Insert Left / Right
Move Left / Right
Duplicate
Clear column contents
Delete
```

Le menu ligne reprend le même principe avec Above / Below / Up / Down.

Code AFFiNE :

https://github.com/toeverything/AFFiNE/blob/canary/blocksuite/affine/blocks/table/src/table-cell.ts#L114-L360

---

## 4. Gestion des données

AFFiNE centralise toutes les modifications dans `TableDataManager`.

Les méthodes importantes sont :

```ts
addRow()
addColumn()

deleteRow()
deleteColumn()

insertRow()
insertColumn()

moveRow()
moveColumn()

duplicateRow()
duplicateColumn()

setColumnWidth()

clearRow()
clearColumn()
```

Source :

https://github.com/toeverything/AFFiNE/blob/canary/blocksuite/affine/blocks/table/src/table-data-manager.ts#L80-L375

Pour une implémentation plus simple, ce modèle suffit :

```ts
type TableData = {
  rows: {
    id: string;
    backgroundColor?: string;
  }[];

  columns: {
    id: string;
    width: number;
    backgroundColor?: string;
  }[];

  cells: Record<string, string>;
};
```

Une cellule peut être stockée avec une clé :

```ts
cells[`${rowId}:${columnId}`]
```

C’est aussi le principe utilisé par AFFiNE.

---

## 5. Sélection visuelle

AFFiNE ne change pas la bordure de toutes les cellules sélectionnées.

Il ajoute un rectangle positionné au-dessus du tableau :

```css
.table-selection {
  position: absolute;
  pointer-events: none;
  border: 2px solid var(--primary-color);
  border-radius: 2px;
}
```

Puis il calcule :

```ts
{
  top,
  left,
  width,
  height
}
```

à partir de la zone sélectionnée.

Source :

https://github.com/toeverything/AFFiNE/blob/canary/blocksuite/affine/blocks/table/src/selection-layer.ts#L64-L83

C’est une bonne technique pour sélectionner plusieurs cellules sans modifier leur style une par une.

---

## 6. Redimensionnement des colonnes

AFFiNE place une petite zone interactive sur le bord droit de chaque colonne :

```css
.column-resize {
  position: absolute;
  right: -3px;
  top: -1px;
  width: 5px;
  height: calc(100% + 2px);
  cursor: ew-resize;
}
```

> **MyOwnNotion — note d’atelier :** un overlay `position: absolute` *avec*
> Ariakit/portal + observers a provoqué un thrash CPU/RAM (~11 Go). La V1
> place les trois `+` AFFiNE dans les gouttières padding du `.bn-block`
> (boutons natifs, `pointer-events` ciblés, sans portal). Le scroll horizontal
> vit sur le `.bn-block-group` des lignes pour ne pas clipper le side-menu.

Source :

https://github.com/toeverything/AFFiNE/blob/canary/blocksuite/affine/blocks/table/src/table-cell-css.ts#L118-L136

Pendant le drag :

```ts
const newWidth = Math.max(
  60,
  initialWidth + event.clientX - initialX
);
```

AFFiNE garde une largeur temporaire pendant le déplacement puis sauvegarde la valeur au `mouseup`.

Code :

https://github.com/toeverything/AFFiNE/blob/canary/blocksuite/affine/blocks/table/src/selection-controller.ts#L63-L101

---

## 7. Déplacer lignes et colonnes

Le bouton `...` sert aussi de drag handle.

AFFiNE :

1. détecte un déplacement supérieur à environ `10px` ;
2. crée une preview de la ligne ou colonne ;
3. affiche un indicateur de destination ;
4. change l’ordre au `mouseup`.

Colonnes :

https://github.com/toeverything/AFFiNE/blob/canary/blocksuite/affine/blocks/table/src/selection-controller.ts#L137-L221

Lignes :

https://github.com/toeverything/AFFiNE/blob/canary/blocksuite/affine/blocks/table/src/selection-controller.ts#L223-L307

Pour une première version, un `splice()` suffit côté données.

---

## 8. Boutons `+` autour du tableau

AFFiNE affiche trois zones d’ajout :

```text
                    +
┌────────┬────────┐ │
│        │        │ │
├────────┼────────┤ │
│        │        │ │
└────────┴────────┘ +
         +          +
```

- à droite : ajouter une colonne ;
- en bas : ajouter une ligne ;
- dans l’angle : ajouter les deux.

CSS :

https://github.com/toeverything/AFFiNE/blob/canary/blocksuite/affine/blocks/table/src/add-button-css.ts#L4-L90

Logique :

https://github.com/toeverything/AFFiNE/blob/canary/blocksuite/affine/blocks/table/src/add-button.ts#L244-L325

AFFiNE permet aussi de tirer ces boutons pour créer plusieurs lignes/colonnes d’un coup. Pour reproduire l’UX principale, les trois boutons simples suffisent déjà.

---

## 9. Création du tableau

AFFiNE ajoute le tableau au slash menu :

```text
/table
→ Table
→ Create a simple table
```

Source :

https://github.com/toeverything/AFFiNE/blob/canary/blocksuite/affine/blocks/table/src/configs/slash-menu.ts#L10-L39

À la création, il initialise un tableau `2 x 2` :

```ts
dataManager.addNRow(2);
dataManager.addNColumn(2);
```

Source :

https://github.com/toeverything/AFFiNE/blob/canary/blocksuite/affine/blocks/table/src/commands.ts#L10-L50

Tu peux donc simplement partir sur :

```ts
createTable({
  rows: 2,
  columns: 2
});
```

---

# Architecture minimale à reproduire

```text
TableComponent
│
├── TableCell
│   ├── contenteditable
│   ├── row menu
│   ├── column menu
│   └── resize handle
│
├── SelectionOverlay
│
├── AddRowButton
├── AddColumnButton
└── AddRowColumnButton
```

Côté logique :

```ts
class TableManager {
  addRow() {}
  addColumn() {}

  insertRow() {}
  insertColumn() {}

  deleteRow() {}
  deleteColumn() {}

  moveRow() {}
  moveColumn() {}

  duplicateRow() {}
  duplicateColumn() {}

  resizeColumn() {}
}
```

C’est essentiellement ce découpage qui permet de reproduire une UI proche d’AFFiNE sans reprendre tout BlockSuite.

## Fichiers AFFiNE utiles

- Composant principal  
  https://github.com/toeverything/AFFiNE/blob/canary/blocksuite/affine/blocks/table/src/table-block.ts

- Cellules + menus  
  https://github.com/toeverything/AFFiNE/blob/canary/blocksuite/affine/blocks/table/src/table-cell.ts

- CSS cellules / handles  
  https://github.com/toeverything/AFFiNE/blob/canary/blocksuite/affine/blocks/table/src/table-cell-css.ts

- Gestion des données  
  https://github.com/toeverything/AFFiNE/blob/canary/blocksuite/affine/blocks/table/src/table-data-manager.ts

- Sélection / resize / drag  
  https://github.com/toeverything/AFFiNE/blob/canary/blocksuite/affine/blocks/table/src/selection-controller.ts

- Overlay de sélection  
  https://github.com/toeverything/AFFiNE/blob/canary/blocksuite/affine/blocks/table/src/selection-layer.ts

- Boutons `+`  
  https://github.com/toeverything/AFFiNE/blob/canary/blocksuite/affine/blocks/table/src/add-button.ts

- CSS boutons `+`  
  https://github.com/toeverything/AFFiNE/blob/canary/blocksuite/affine/blocks/table/src/add-button-css.ts

- Création via `/table`  
  https://github.com/toeverything/AFFiNE/blob/canary/blocksuite/affine/blocks/table/src/configs/slash-menu.ts
