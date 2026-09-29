# Art Style Guide

The look: **chunky, warm pixel art** somewhere between Stardew Valley's cosy farm and Minecraft's blocky readability. Colours are warm and slightly desaturated, outlines are a dark warm brown (never pure black), and everything sits on a 16 × 16 grid. All art is generated in code from string grids; there are no image files and nothing is loaded from the network.

---

## 1. Palette (47 colours)

Each colour has a **name** (used in code, e.g. `PALETTE.soil_dark`) and a **one-character key** (used inside sprite grids). `.` is transparent and is not a palette entry. Keys are case-sensitive; the lowercase/uppercase pair is usually the dark/light version of the same hue.

### Outline and neutrals

| Key | Name | Hex | Use |
|---|---|---|---|
| `k` | `outline` | `#2b1d1a` | outlines on all sprites, UI text |
| `K` | `shadow` | `#4a3430` | drop shadows, inner dark edges |
| `n` | `stone_dark` | `#6b625c` | stones, path edges, metal |
| `N` | `stone_light` | `#a09689` | stone tops, path, metal shine |
| `w` | `white_warm` | `#fff4dc` | highlights, sparkles, foam tips |

### Soil and sand

| Key | Name | Hex | Use |
|---|---|---|---|
| `d` | `soil_dark` | `#4e3326` | tilled soil furrows, dry |
| `s` | `soil_mid` | `#6f4a33` | tilled soil base, dry |
| `S` | `soil_light` | `#8e6445` | soil highlights, untilled dirt |
| `e` | `soil_wet_dark` | `#35241c` | watered soil furrows |
| `E` | `soil_wet` | `#4f3426` | watered soil base |
| `y` | `sand` | `#dcc28e` | beach, path, wheat |
| `Y` | `sand_dark` | `#b99a68` | sand shading, wheat shading |

### Grass and foliage

| Key | Name | Hex | Use |
|---|---|---|---|
| `h` | `grass_dark` | `#44692e` | grass shading, tufts |
| `g` | `grass_1` | `#5d8a3a` | grass base |
| `G` | `grass_2` | `#78a64a` | grass light, crop leaves |
| `H` | `grass_3` | `#9cc062` | grass highlight, sprouts |
| `l` | `leaf_dark` | `#2f5231` | tree canopy shadow, dark leaves |
| `L` | `leaf_light` | `#b5d27a` | leaf highlights, spring blossom leaves |

### Water

| Key | Name | Hex | Use |
|---|---|---|---|
| `b` | `water_1` | `#2c5a84` | deep water |
| `B` | `water_2` | `#3d7aab` | water base |
| `c` | `water_3` | `#68a6cc` | shallow water, ripples |
| `C` | `water_foam` | `#cde6ec` | foam, splash, sparkles on water |

### Wood and roof

| Key | Name | Hex | Use |
|---|---|---|---|
| `m` | `wood_dark` | `#5a3a25` | wood shadow, bark |
| `M` | `wood_mid` | `#7d5634` | planks, fence posts |
| `p` | `wood_light` | `#a67a4b` | plank tops, dock |
| `P` | `wood_pale` | `#c9a26d` | plank highlights, baskets |
| `r` | `roof_dark` | `#8a3a33` | roof shading, brick |
| `R` | `roof_light` | `#b8573f` | roof tiles, market awning stripes |

### Produce and accents

| Key | Name | Hex | Use |
|---|---|---|---|
| `q` | `red` | `#c9463b` | tomato, strawberry, apple, hearts |
| `Q` | `red_light` | `#e67a5f` | red highlights |
| `o` | `orange` | `#d9822b` | pumpkin, carrot-ish, fire |
| `O` | `orange_light` | `#f0ab52` | pumpkin light, lamp light |
| `u` | `yellow` | `#e3bf45` | corn, flowers, lemon |
| `U` | `yellow_light` | `#f6e08f` | highlights on yellow |
| `v` | `purple` | `#74467f` | turnip top, eggplant-ish, dusk flowers |
| `V` | `purple_light` | `#a574b0` | purple highlights |
| `i` | `pink` | `#d98c98` | blossoms, koi, salmon |
| `I` | `pink_light` | `#f3bcc0` | blossom highlights |
| `j` | `berry_blue` | `#4a5ea6` | blueberries, sardine back |
| `J` | `berry_blue_light` | `#7a90d2` | blue highlights |
| `x` | `cream` | `#efe4c8` | turnip body, cauliflower, garlic, plates |

### UI and lighting

| Key | Name | Hex | Use |
|---|---|---|---|
| `z` | `ui_parchment` | `#f2e1b6` | panel background |
| `Z` | `ui_parchment_dark` | `#d8bd88` | panel inner border, disabled |
| `f` | `gold` | `#f2c14e` | coins, gold text, stars |
| `F` | `gold_dark` | `#c28b2c` | coin rim, gold shading |
| `t` | `night_tint` | `#1d2748` | night overlay colour (multiply, not used in sprites) |
| `T` | `dusk_tint` | `#e0875a` | dawn/dusk overlay colour (soft-light, not used in sprites) |

In code (`src/render/palette.ts`):

```ts
export const PALETTE = {
  outline: '#2b1d1a', shadow: '#4a3430', /* … */ dusk_tint: '#e0875a',
} as const;
export type PaletteName = keyof typeof PALETTE;

export const KEY_TO_NAME = { k: 'outline', K: 'shadow', /* … */ T: 'dusk_tint' } as const satisfies Record<string, PaletteName>;
export type PaletteKey = keyof typeof KEY_TO_NAME;
```

Rules: never write a hex colour outside `palette.ts`. CSS uses the same colours via custom properties generated from the palette (`--c-ui_parchment` etc.).

---

## 2. Sprite conventions

- **Base tile: 16 × 16 pixels.** Larger objects (farmhouse, market stall, greenhouse, trees) are multiples of 16 and are defined as one bigger grid, not as separate tiles.
- **Format:** an array of strings, one string per row, one character per pixel. Every character must be a palette key or `.` (transparent). All rows have the same length. A unit test checks every sprite for this.

  ```ts
  export interface SpriteDef {
    id: string;                     // 'crop_turnip_4', 'tile_grass_a', 'item_turnip'
    frames: readonly (readonly string[])[];   // one or more frames of equal size
    frameMs?: number;               // animation speed; omit for static sprites
    anchor?: 'top-left' | 'bottom-center';    // bottom-center for crops, trees, buildings
  }
  ```

- **Naming:** `tile_*` terrain, `crop_<id>_<stage>` crop stages 0–4, `item_<id>` inventory icons, `obj_*` placed objects and buildings, `ui_*` icons, `buff_<type>` buff icons, `fx_*` effects.
- **Crops have 5 stages:** 0 seed (a few pixels in the soil), 1 sprout, 2 mid-growth, 3 near-ready, 4 ready. Crop sprites are drawn **on top of** the soil tile with transparent backgrounds. Ready crops should have their produce clearly visible and a distinct colour. A separate `crop_dead` sprite covers every withered crop.
- **Outlines:** 1 px `outline` (`k`) around objects and items. Terrain tiles have no outline. Light comes from the **top-left**: highlights on the top/left edges, `shadow` or the darker pair on the bottom/right.
- **Readability:** each item icon must be recognisable at 16 × 16 from its silhouette alone. Avoid dithering except on water and large terrain.
- **Animation frame counts:**

  | Thing | Frames | Frame time |
  |---|---|---|
  | Water tiles | 2 | 600 ms |
  | Ready crop sway / sparkle | 2 | 400 ms |
  | Sprinkler spray (06:00–07:00 only) | 3 | 120 ms |
  | Scarecrow bob | 2 | 800 ms |
  | Farmhand walk | 4 | 150 ms |
  | Farmhand harvest pop | 2 | 100 ms |
  | Chimney steam while cooking | 3 | 250 ms |
  | Fishing bobber idle / bite dip | 2 / 2 | 500 / 100 ms |
  | Splash | 3 | 80 ms |

  Frames animate on the render clock, never on the simulation clock, so animation cannot affect game logic.

---

## 3. Rendering scale rule

- The scene is authored at a **logical size of 320 × 192 px** (20 × 12 tiles).
- It is drawn at the **largest integer scale** that fits the scene area: `scale = max(1, floor(min(availW / 320, availH / 192)))`. No fractional scaling, ever. Leftover space is filled with the `grass_dark` background colour (letterboxing).
- On canvas: `ctx.imageSmoothingEnabled = false` after every resize and context reset.
- In CSS, for the canvas and every element that shows a sprite:

  ```css
  .pixel, canvas {
    image-rendering: pixelated;
    image-rendering: crisp-edges;   /* Firefox fallback */
  }
  ```

- Sprites are rasterised once to offscreen canvases at 1× and cached (`spriteCache.ts`). They are drawn with `drawImage` at integer positions × `scale`. Positions are always whole logical pixels.
- Sprites shown in the DOM (item icons in panels) are drawn to a small canvas or converted to a data URL once, and displayed at 2× (32 px) with the pixelated rule.
- Day/night is one full-scene overlay: `night_tint` with `multiply` at up to 55% opacity at midnight, and `dusk_tint` with `soft-light` at up to 25% at dawn and dusk. The HUD and panels are never tinted.

---

## 4. UI look

- **Panels:** parchment (`ui_parchment`) inside a 2-pixel-scaled wood frame: outer 2 px `outline`, then 4 px `wood_mid` with a 2 px `wood_light` top/left bevel and a `wood_dark` bottom/right bevel, then a 2 px `ui_parchment_dark` inner line. Built with CSS borders and `box-shadow` (no border images needed). Corners are square.
- **Buttons:** `wood_light` face, `outline` border, `wood_dark` bottom edge 2 px thicker (a pressed look moves the face down by 2 px). Primary actions use a `grass_2` face; disabled buttons use `ui_parchment_dark` with 60% text opacity.
- **HUD:** a thin wood strip along the top of the screen. Gold uses `gold` text with a 1 px `outline` text shadow.
- **Text:** `outline` on parchment, `white_warm` on wood. Minimum 14 px CSS for body text (phase 08 checks contrast to WCAG AA).
- **Font plan (no network fonts):**

  ```css
  --font-ui: "Pixelify Sans", "Silkscreen", "Press Start 2P", ui-monospace, "Cascadia Mono",
             "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
  ```

  The pixel fonts in the stack are used only if the player already has them installed; the guaranteed result is the system monospace, set bold, with `-webkit-font-smoothing: none` where supported. Numbers that float over the canvas (`+22`, damage-style popups) use a **tiny built-in bitmap font**: digits 0–9, `+ - . , : % g K M` drawn as 3 × 5 string grids with the same sprite format, so they are always crisp.
- **Icon sizes:** sprites are 16 × 16; in the HUD and panels they display at 2× (32 × 32 CSS px); inventory slots are 40 × 40 px with the icon centred; touch targets are at least 44 × 44 px (phase 08).

---

## 5. Worked sprite examples

### Grass tile (`tile_grass_a`), 16 × 16, no transparency

```ts
export const tileGrassA: SpriteDef = {
  id: 'tile_grass_a',
  frames: [[
    'gggggggggggggggg',
    'ggGgggggggghgggg',
    'gGHGgggggggggggg',
    'ggGggggghggggGgg',
    'gggggggghhggggGg',
    'gggggggggggggggg',
    'gggghggggggGgggg',
    'ggghhgggggGHGggg',
    'gggggggggggGgggg',
    'gGgggggggggggggg',
    'gggggggGggggghgg',
    'ggggggggggggghhg',
    'gghggggggggggggg',
    'gghhggggGggggggg',
    'gggggggGHGgggggg',
    'ggggggggGggggggg',
  ]],
};
```

### Turnip, ready stage (`crop_turnip_4`), 16 × 16, drawn over soil

```ts
export const cropTurnip4: SpriteDef = {
  id: 'crop_turnip_4',
  anchor: 'bottom-center',
  frames: [[
    '................',
    '......k...k.....',
    '.....kGk.kGk....',
    '....kGHGkGHGk...',
    '....kgGGkGGgk...',
    '.....kgGGGgk....',
    '......klGlk.....',
    '.....kvVvvvk....',
    '....kvVVvvvvk...',
    '....kxwxxxxxk...',
    '....kwxxxxxxk...',
    '.....kxxxxxk....',
    '......kxxxk.....',
    '.......kxk......',
    '........k.......',
    '................',
  ]],
};
```

### Gold coin icon (`ui_gold`), 16 × 16

```ts
export const uiGold: SpriteDef = {
  id: 'ui_gold',
  frames: [[
    '................',
    '................',
    '.....kkkkkk.....',
    '....kUUffffk....',
    '...kUffffffFk...',
    '...kUffFFffFk...',
    '...kffFffFfFk...',
    '...kffFffffFk...',
    '...kffFffffFk...',
    '...kffFffFfFk...',
    '...kfffFFffFk...',
    '...kffffffFFk...',
    '....kfFFFFFk....',
    '.....kkkkkk.....',
    '................',
    '................',
  ]],
};
```

### Checklist for a new sprite
1. Use palette keys only; run the sprite validation test.
2. Outline items and objects with `k`; light from the top-left.
3. Check it at 1× and at 3× next to its neighbours in the scene.
4. Give it a distinct silhouette from other items in the same category.
