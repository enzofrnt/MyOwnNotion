# Reproduire le fond à points d’AFFiNE

AFFiNE utilise un fond CSS en `radial-gradient` pour créer une grille de points, puis adapte sa position et son espacement selon le déplacement et le zoom du viewport.

## 1. Le fond à points

```css
.canvas-background {
  width: 100%;
  height: 100%;

  background-color: #ffffff;

  background-image: radial-gradient(
    #d0d0d0 1px,
    transparent 1px
  );

  background-size: 20px 20px;
}
```

Le `radial-gradient` crée un point de `1px`, puis `background-size` définit l’espace entre les points.

## 2. Adapter l’espacement au zoom

AFFiNE utilise une fonction proche de celle-ci :

```ts
function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function getBgGridGap(zoom: number) {
  const step = zoom < 0.5 ? 2 : 1 / (Math.floor(zoom) || 1);

  const gap = clamp(
    20 * step * zoom,
    10,
    50
  );

  return Math.round(gap);
}
```

Cela évite que les points deviennent trop proches ou trop éloignés.

## 3. Synchroniser le fond avec le pan et le zoom

À chaque changement du viewport :

```ts
function updateGrid(
  element: HTMLElement,
  zoom: number,
  translateX: number,
  translateY: number
) {
  const gap = getBgGridGap(zoom);

  element.style.backgroundPosition =
    `${translateX}px ${translateY}px`;

  element.style.backgroundSize =
    `${gap}px ${gap}px`;
}
```

Exemple :

```ts
updateGrid(
  document.querySelector('.canvas-background')!,
  viewport.zoom,
  viewport.translateX,
  viewport.translateY
);
```

Il faut appeler `updateGrid()` chaque fois que ton espace est déplacé ou zoomé.

## 4. Structure conseillée

```html
<div class="canvas-background">
  <div class="canvas-content">
    <!-- ton canvas / tes éléments -->
  </div>
</div>
```

L’idée est de laisser ton moteur de canvas gérer les objets, et de mettre la grille sur le conteneur situé derrière.

```text
canvas-background
├── fond à points CSS
└── canvas-content
    └── objets / nodes / formes
```

## Code AFFiNE correspondant

- Fond + synchronisation du viewport :  
  https://github.com/toeverything/AFFiNE/blob/canary/blocksuite/affine/blocks/root/src/edgeless/edgeless-root-block.ts#L78-L113

- Calcul de l’espacement selon le zoom :  
  https://github.com/toeverything/AFFiNE/blob/canary/blocksuite/affine/blocks/surface/src/utils/get-bg-grip-gap.ts

- Valeurs min/max de la grille :  
  https://github.com/toeverything/AFFiNE/blob/canary/blocksuite/affine/blocks/surface/src/consts.ts#L1-L10

## À retenir

Pour reproduire le comportement AFFiNE, il suffit principalement de gérer ces trois propriétés :

```ts
backgroundImage
backgroundPosition
backgroundSize
```

- `background-image` crée les points ;
- `background-position` suit le déplacement du canvas ;
- `background-size` suit le zoom.

Tu peux donc ajouter ce système autour d’un canvas ou d’un espace infini déjà existant sans avoir à modifier son moteur de rendu.
