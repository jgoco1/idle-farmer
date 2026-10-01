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
- Day/night is one full-scene overlay: `night_tint` with `multiply`, rising from 0% at 20:00 to 55% at midnight and falling back to 0% by 06:00 (local time), and `dusk_tint` with `soft-light` at up to 25% during dusk (18:30–20:00) and dawn (06:00–07:30). The tint is driven by the real local clock (`ctx.calendar`), not by simulated time. The HUD and panels are never tinted.

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

---

## 6. v2: world, decorations, trees, buildings and animals

Written by v2 phase 00. Everything in §1–§5 still holds: palette keys only, 1 px `k` outlines on objects, light from the top-left, sizes in multiples of 16, frames on the render clock.

**Scale rule in the world (amends §3).** The world is 576 × 352 logical px (36 × 22 tiles). The camera's zoom is the integer scale; the default zoom is §3's rule applied to the home region (320 × 192), so v1 players see the same scale. Positions stay whole logical pixels and the camera's offset is rounded to whole screen pixels, so nothing shimmers while panning. Letterboxing (a world smaller than the viewport at 1×) is `grass_dark`, as before. The static ground is cached in 16 × 16-tile chunks; the day/night tint covers the viewport, not the world.

### 6.1 Palette additions (2, making 49)

| Key | Name | Hex | Use |
|---|---|---|---|
| `a` | `lamp_glow` | `#ffe3a3` | the warm halo of lit lamps, lanterns, the lighthouse beam and lit windows at night. Only in glow sprites (`fx_glow_*`) and lit frames, never as a surface colour by day. |
| `A` | `slate` | `#5b6478` | slate roof tiles, the harbour lamp's iron, the lighthouse cap, a cow's nose shading. A cool grey-blue the warm `stone_*` pair cannot give. |

Everything else is drawn from the v1 palette: farmhouse paints use existing pairs (sage walls `G`/`H` with `h` shading; sky walls `J`/`c` with `j`), thatch uses `y`/`Y`/`P`, fruit uses `q`/`Q` (cherry, apple), `o`/`O` (apricot, persimmon), `i`/`I` with `O` (peach), `L`/`u` (pear), `u`/`U` (lemon); hens are `w`/`x` with a `q` comb and `o` beak and feet; cows are `w` with `k`/`K` patches and a `i` muzzle. Adding the two keys changes `tests/sprites.test.ts` "has the 47 colours" to 49 (v2-02 adds `a` with the lamps; v2-02 or v2-04 adds `A`, whichever first needs it).

### 6.2 Sizes and names

| Thing | Sprite size (px) | Footprint (tiles) | Anchor | Ids | Frames |
|---|---|---|---|---|---|
| Tree, every stage | **32 × 48** | 2 × 2 spot | bottom-center | `tree_<fruit>_sapling`, `tree_<fruit>_young`, `tree_<fruit>_<season>` (mature: spring, summer, autumn, winter) | 1 (a 2-frame sway for the mature canopy is optional, 900 ms) |
| Fruit overlay | 32 × 48 | – | bottom-center | `fx_fruit_<fruit>_<n>`, n = 1, 2, 3 (a little, some, full: `fruit / cap` ≤ ⅓, ≤ ⅔, more) | 1 |
| Coop | 48 × 48 | 3 × 2 | bottom-center | `obj_coop_1`, `_2`, `_3` | 1 (+ a lit-window night frame) |
| Barn | 64 × 64 | 4 × 3 | bottom-center | `obj_barn_1`, `_2`, `_3` | 1 (+ night frame) |
| Silo | 32 × 64 | 2 × 2 | bottom-center | `obj_silo_1`, `_2` | 1 |
| Trough (drawn beside the coop and barn) | 16 × 16 | – | top-left | `obj_trough_empty`, `_some`, `_full` | 1 |
| Hen | 16 × 16 | – (free, render only) | bottom-center | `animal_chicken_walk`, `_idle`, `_eat`, `_sleep` | walk 2 × 150 ms, idle 2 × 600 ms (look about), eat 2 × 200 ms (peck), sleep 1 |
| Cow | 32 × 32 | – | bottom-center | `animal_cow_walk`, `_idle`, `_eat`, `_sleep` | walk 4 × 180 ms, idle 2 × 900 ms (tail swish), eat 2 × 300 ms (graze), sleep 1 |
| Hearts (petting) | 16 × 16 | – | – | `fx_heart` | 3 × 120 ms, drawn as particles |
| Decoration 1 × 1 | 16 × 16 (lamps and tall pieces 16 × 32) | 1 × 1 | bottom-center | `decor_<id>` | 1; glow pieces have a second, lit frame chosen by time of day, not animated |
| Decoration 2 × 1 | 32 × 16 or 32 × 32 (arches, carts) | 2 × 1 | bottom-center | `decor_<id>` | 1 |
| Decoration 2 × 2 | 32 × 32 (well, stall, figurehead), 32 × 64 (windmill) | 2 × 2 | bottom-center | `decor_<id>`; the windmill's sails are a separate 2-frame `decor_windmill_sails` (1,200 ms) | 1 |
| Seasonal decoration | as its base | | | `decor_<id>_<season>` for the seasons that differ | 1 |
| Path, fence (auto-tiled) | 16 × 16 | 1 × 1 | top-left | `decor_<id>_<mask>`, mask 0–15 = N 1, E 2, S 4, W 8 of same-id neighbours | 1 |
| Farmhouse layers | 64 × 48 (walls), 64 × 48 (roof), 64 × 64 (roof with loft) | the v1 4 × 3 | top-left at (1, 1); the loft rises one tile into row 0 | `obj_farmhouse_walls_red` / `_sage` / `_sky`, `obj_farmhouse_roof_tile` / `_thatch` / `_slate`, each roof also as `…_loft` | 1 (the v1 chimney steam still plays on top) |
| Town project sites | the site's size × 16, plus one tile of height | see GDD §12.1 | bottom-center | `obj_<project>_<stage>`, stage 0 = ruin | 1 (fountain water 2 × 400 ms; lighthouse beam is drawn as a glow, not a frame) |
| Parcel overgrowth, sign | 16 × 16 | 1 × 1 | bottom-center | `obj_tall_grass`, `obj_weeds` (v1), `obj_stump` (v1), `obj_for_sale` | 1 |
| Community Board, beach (v2-01) | 16 × 16 | 1 × 1 | bottom-center / tile | `obj_board` (a notice board under a little roof), `tile_sand` (the path's grain in paler `y`/`x`) | 1 |
| Items | 16 × 16 | – | – | `item_<fruit>`, `item_sapling_<fruit>`, `item_egg`, `item_large_egg`, `item_milk`, `item_hay`, `item_corn_feed`, `item_<recipe>` | 1 |
| Edge pip | 16 × 16 | – | – | `ui_pip_arrow` (rotated in 4 steps) plus the target's item icon | 1 |

The generated sets (16 masks per path or fence) are built from a few hand-drawn parts (centre, straight, corner, end) by a helper in `src/render/sprites/`, and `tests/sprites.test.ts` checks the generated sprites like any other.

### 6.3 Trees

- **Stages grow up the same 32 × 48 frame:** a sapling is a stick with a few leaves in the bottom 16 px; a young tree is a thin trunk and a canopy about 20 px across; a mature tree fills the frame (canopy about 28 px across, trunk 5 px wide), its canopy rising about one tile above the spot. Orchard trees are **smaller and rounder than the v1 forest `obj_tree`**, so the orchard reads as planted.
- **Three canopy families** keep seven trees consistent: `round` (apple, pear, persimmon), `tall` (lemon, cherry), `spread` (apricot, peach). Trees of one family share a canopy shape; each has its own leaf shading and blossom colour.
- **Seasons:** spring blossom (pink `i`/`I` on cherry, apricot and peach; white `w` on apple, pear and lemon), summer full green, autumn gold and orange leaves (`u`, `o`, `O` mixed into `G`), winter bare branches (`m`, `M`) with a line of `w` snow. The two winter bearers (persimmon, lemon) keep their leaves in winter, snow-dusted, with fruit showing.
- **Fruit** is an overlay in the fruit's colours (1 or 2 px fruit with a 1 px highlight, no outline inside the canopy), in three fullness levels, so seven trees need 21 overlays, not 7 × 4 × 3 full sprites.

### 6.4 Buildings and animals

- The **coop** is a small red-roofed hen house on legs with a ramp and a nest window; level 2 adds a side run with a wire front, level 3 a second storey and a weathervane. The **barn** is the classic red barn with white trim (`R`/`r` walls, `w` trim, `M` doors); level 2 adds a hay loft door, level 3 a lean-to and a cupola. The **silo** is a tall `N`/`n` metal cylinder with a `A` slate cap; level 2 adds a little chute to the troughs. Each building has a lit-window night frame.
- **Hens** are 10–12 px tall inside their 16 × 16 cell, **cows** about 28 × 20 px inside 32 × 32, both with a 1 px `k` outline and a 1 px `K` ground shadow drawn by the renderer. Walking faces left or right by flipping the frame at draw time (no separate right-facing sprites). Asleep, hens tuck their heads (a round shape) and cows lie down.
- Animals are drawn in the yard between the ground and the tall objects, sorted by their feet like every other object.

### 6.5 Lamps and glow at night

- A glowing piece has two frames: frame 0 by day, frame 1 **lit** (a `U`/`O` flame or bulb and `a` panes). The renderer picks the frame from the calendar: lit from dusk (18:30) to dawn (07:30).
- After the day/night tint (§3), the renderer draws a **halo** for each visible lit piece: `fx_glow_small` (16 × 16) or `fx_glow_large` (32 × 32), made of `a` pixels in a soft round pattern (dense centre, sparse edge; dithering is allowed here), with the `lighter` composite at an alpha that follows the night tint's strength (0 by day, full at midnight). That is how fireflies are drawn (phase 08), so glow never touches the scene cache and allocates nothing per frame.
- The lighthouse beam is a long, thin `a` wedge from the lamp room, rotating on the render clock (a full turn every 8 s), drawn with the halos and clipped to the sea. Under reduced motion it stays still, pointing out to sea.
- Lit farmhouse, coop and barn windows use the same halo at a lower alpha.

### 6.6 Keeping the decoration sets consistent

- **One material per set, used everywhere in it.** Cottage: pale painted wood (`P`, `p`, `w`), cobbles (`N`, `n`), flowers in `i`, `u`, `V`. Seaside: weathered driftwood (`p`, `N`, `K`), rope (`y`, `Y`), sea blues (`c`, `B`), sand (`y`). Harvest Fair: warm red brick (`R`, `r`), straw (`y`, `Y`, `u`), pumpkin orange (`o`, `O`), dark wood (`m`, `M`).
- **Same outline and light as v1:** a 1 px `k` outline on every placed piece, top-left highlights, a `K` shadow on the bottom-right edge. Paths and fences are terrain-like: paths have no outline (like `tile_path`), fences do (like `obj_fence_h`).
- **A 16 px grid inside every piece:** posts, legs and lamp stands sit on tile centres or edges, so pieces placed side by side line up.
- **Every set has one path, one fence, one lamp and one showpiece**, so any set can decorate a whole area on its own.
- Check each new piece at 1× and 3× next to the farmhouse, a crop and another piece of its set, by day and at midnight (debug time-warp), and in winter with the snow dusting.

### 6.7 Worked examples

Both use only v1 palette keys and pass the rules of `tests/sprites.test.ts` (width and height multiples of 16, equal rows, palette keys only, no `t`/`T`).

**Mature cherry tree in spring bloom (`tree_cherry_spring`), 32 × 48, bottom-center.** The canopy rises about a tile above its 2 × 2 spot; pink `i`/`I` blossom; trunk `m`/`M`/`p`. The summer, autumn and winter sprites keep the same outline and trunk and change only the canopy's colours.

```ts
export const treeCherrySpring: SpriteDef = {
  id: 'tree_cherry_spring',
  anchor: 'bottom-center',
  frames: [[
    '................................',
    '................................',
    '................................',
    '................................',
    '................................',
    '................................',
    '................................',
    '................................',
    '................................',
    '................................',
    '.............kkkkkk.............',
    '..........kkkGHHHHGkkk..........',
    '........kkGHHIGGGGHHGGkk........',
    '.......kGHHGGGGGiGGGHHGGk.......',
    '......kGHIGGGGGGGGGGGGGGGk......',
    '.....kGHGGGGiGGGGGIGGGgGGGk.....',
    '.....kHGGGGGGGGGGGGGGGGGgGk.....',
    '.....kHGGGGGGGGGGGGGGGGGgGk.....',
    '....kGHGIGGGGGgGGGGGGiGGGggk....',
    '....kHGGGGGGGGGGGGGgGGGGGggk....',
    '....kHGGGGGGGGGGGGGgGGGGGggk....',
    '....kGGGGGGiGGGGIGGGGGGgGggk....',
    '...kGHGGGGGGGGGGGGGGGGgGgggk....',
    '...kGHGGGGGGGGGGGGGGGGgGgggk....',
    '...kHGGGIGGGGGGgGGGGiGGGgghgk...',
    '...kGGGGGGGGGGGGGGGGGGGgghggk...',
    '...kGGGGGGGGGGGGGGGGGGGgghggk...',
    '...kGGGGGGGGgGGiGGGGgGGGgghhk...',
    '...kgGGiGGGGGGGGGGGGGGggghhgk...',
    '...kgGGiGGGGGGGGGGGGGGggghhgk...',
    '....kgGGGGGGGGGGGGGGgGgghhhk....',
    '....kggGGGGIGGGGgGGGgggghhhk....',
    '....kggGGGGIGGGGgGGGgggghhhk....',
    '....kgggGGGGGGGGGGGggiggghhk....',
    '.....kgggGgGGGgGGgggghhhhlk.....',
    '.....kggggggggggggghhhhhlk......',
    '......kkgghhggghhhhhhllkk.......',
    '........kkhhhlhhhllllkk.........',
    '..........kkkkmMMmkkkk..........',
    '.............kmMpmk.............',
    '.............kmMpmk.............',
    '.............kmMpmk.............',
    '.............kmMpmk.............',
    '.............kmMpmk.............',
    '.............kmMpmk.............',
    '............kmMMpMmk............',
    '...........kmMmMMmMmk...........',
    '...........kkkkkkkkkk...........',
  ]],
};
```

**Hen, idle (`animal_chicken_idle`, frame 1 of 2), 16 × 16, bottom-center.** White body `w`, cream wing `x`, red comb `q`, orange beak and feet `o`. The real sprite adds a second idle frame (`frameMs: 600`) that turns the head (the eye moves one pixel); the walk, eat and sleep frames keep the same body.

```ts
export const animalChickenIdle: SpriteDef = {
  id: 'animal_chicken_idle',
  anchor: 'bottom-center',
  frames: [[
    '................',
    '................',
    '.......kk.......',
    '......kqqk......',
    '.....kwwwwk.....',
    '.....kwkwwk.....',
    '....koowwwk.....',
    '.....kkwwwwk....',
    '......kwwwwwkk..',
    '.....kwwwxwwwk..',
    '.....kwwxxxwwk..',
    '......kwxxxwk...',
    '.......kkkkk....',
    '........o.o.....',
    '.......oo.oo....',
    '................',
  ]],
};
```

### 6.8 As built in v2 phase 02

- **Palette:** `a` (`lamp_glow`) and `A` (`slate`) are in `src/render/palette.ts`, so the palette has 49 colours.
- **How the sprites are made:** `src/render/sprites/draw.ts` is a small character canvas (`Pix`: rectangles, lines, ellipses, shaded boxes, paste, outline). The decorations (`decorPieces.ts`), the six path and fence families (`decorTiles.ts`), the town's stages (`town.ts`), the farmhouse styles (`farmhouse.ts`) and the halos and festival bits (`decorFx.ts`) are built from shapes on it and checked by `tests/sprites.test.ts` like hand-written sprites. All use palette keys only.
- **Auto-tiled sets:** `decor_<id>_<mask>` for mask 0 to 15 (N 1, E 2, S 4, W 8), plus `decor_<id>` = the straight east-west piece (mask 10) for the shop and the ghost. Paths have no outline and a rounded patch with arms towards joined sides (their edge pixels line up, which a test checks); fences have the usual outline.
- **Lamps:** a sprite with `lit: true` has two frames, day and lit, picked by the renderer (`SpriteDef.lit`, not animated). Halos are `fx_glow_small` (16 × 16) and `fx_glow_large` (32 × 32), dithered `a` pixels drawn with `lighter` after the night tint at an alpha that follows the tint (`glowStrength` in `src/render/decorDraw.ts`: gentle at dusk, full at midnight, steady under reduced motion). Where each piece's lights sit is the `PIECE_GLOWS` table there; the town's lights are `TOWN_GLOWS`.
- **Seasonal pieces** have a sprite for each season that differs (`decor_flower_bed_<season>` for all four; `decor_sandcastle_winter`, `decor_pumpkin_stack_winter`); the others fall back to the base sprite. **Snow:** every placed piece is dusted in winter by `snowdusted()` (`src/render/sprites/types.ts`): the top edge of each column turns `white_warm`. It is cached per sprite in `spriteFrameAt(id, frame, snowy)`.
- **Footprints and positions:** a piece's sprite is centred on its footprint with its bottom on the footprint's bottom edge (`decorPosition`); paths and fences sit on their tile. The windmill's sails are the separate 2-frame `decor_windmill_sails` (1,200 ms), drawn over its hub.
- **Farmhouse:** one finished sprite per combination, `obj_farmhouse_<paint>_<roof>[_loft]` (paint red, sage, sky; roof tile, thatch, slate), composed at load from the v1 sprite by recolouring the walls (leaving the door) and the roof. The original is `obj_farmhouse`. The loft is a 64 × 64 sprite: the roof and chimney rise one tile, a copy of the facade's upper rows sits between, and a dormer window stands on the roof. (ART_STYLE §6.2 listed separate `walls` and `roof` layer sprites; combined sprites are simpler to draw and test.)
- **Town stages:** `obj_<project>_<n>`, n = 0 the ruin, then one per stage, each the site's size plus one tile of height (the bridge 80 × 32, the bakery and fountain 48 × 64, the bandstand 48 × 48, the lighthouse 32 × 64, the hall 64 × 64), placed with their bottom on the site's bottom. The fountain's last two stages have 2 water frames (400 ms). The lighthouse beam is drawn as a glow wedge (a full turn every 8 s, clipped to the sea, still under reduced motion); the bakery's smoke and the band's notes are particles (`steam`, and a new `note` kind); the band is `fx_band` (2 frames, 420 ms); the festival lights are two `obj_lights_pole` and five `obj_lights_string` tiles across the square.

