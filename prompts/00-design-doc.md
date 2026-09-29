# Phase 00: Game Design Doc, Schemas and Conventions

> **Recommended model:** Opus 5.5. Every later session reads and relies on what this phase writes: the design, the data schemas and the balance formulas. Getting them right here matters more than anywhere else.
> **Depends on:** nothing. The repo holds only `prompts/`.
> **Output:** documentation only. **Do not write game code in this phase.**

## Role and goal
You are the lead designer and technical architect for a **cozy idle farming and cooking browser game**. Its look combines Stardew Valley and Minecraft: chunky pixel art, warm colours and a gentle pace. Later sessions will build the game one phase at a time, following the prompt files in `prompts/`. Your job is to write the documents that all of them treat as the source of truth.

Start by reading `prompts/README.md` and skimming every file in `prompts/`. You need to know what each later phase will build, so that the docs you write give each of them what it needs.

## Fixed decisions (do not change)
- **Play style:** a hybrid farm scene. One screen shows a pixel-art farm with clickable zones: a grid of farm plots, a pond or river, a farmhouse kitchen, and a market stall or shipping bin. There is **no walking character**. The player clicks zones and uses panels. Idle progress comes from timers and automation, and it continues while the game is closed (offline progress).
- **Art:** sprites are generated in code as small pixel grids (16×16 base tiles, drawn at an integer scale) that use one shared palette. Nothing is loaded over the network.
- **Needs:** there is **no hunger meter in v1**. Cooked food gives **buffs**. Each dish has a specific effect, and the buff's strength and duration grow with the recipe's tier. Tier comes from ingredient count, ingredient value and cooking time. Document a possible future "Fullness" meter as an optional extension only.
- **Stack:** Vite, TypeScript (strict), Vitest and Playwright. Canvas 2D draws the scene and DOM/CSS draws the panels. No UI framework and no game engine. Deployed to GitHub Pages.
- **Content targets for v1:** about 15 crops across 4 seasons (including some that regrow and some that span several seasons), about 12 fish across 3 locations and several rarities, about 20 recipes across 4 tiers, 8 to 10 automation and tool upgrades, and 3 or 4 farm-expansion steps.

## Deliverables

### 1. `docs/GDD.md`: Game Design Document
- A one-paragraph pitch and 3 to 5 design pillars, such as *cozy, never punishing, always something growing*.
- **The core loop:** plant → grow → harvest → sell or cook → upgrade → automate → expand. Include a simple ASCII diagram.
- **Time model:** real time mapped to in-game time. Recommend a length for an in-game day (for example, 1 day = 10 real minutes) and a season length. Explain how growth timers, day/night and seasons follow from it. Say how offline progress is calculated and what its cap is (for example, a maximum of 8 hours at full rate, then reduced).
- **Screen layout:** an ASCII mock-up of the single farm scene with its zones and the HUD (gold, day/season/time, active buffs, notifications) and the side panels (Inventory, Shop, Market, Kitchen, Fishing, Upgrades, Goals, Settings).
- **Systems,** one section each: Farming, Economy/Market, Automation/Upgrades, Fishing, Cooking and Buffs, Progression and Goals, and Audio/Feel. Each section covers the player actions, the idle behaviour, the unlock conditions, and which phase builds it.
- **Food buffs design:**
  - Buff types: growth speed, sell price, fishing luck/rarity, fishing speed, cook speed, automation speed and XP gain. Add more if they make sense.
  - Each recipe maps to one buff type, chosen to match the theme. For example, a fish stew boosts fishing luck.
  - Recipe tier (T1 to T4) is worked out from the recipe's inputs using a formula you define in BALANCE.md.
  - Stacking: one active buff per type. A new buff replaces the current one only if it is stronger, otherwise it refreshes the duration. The total number of active buffs is capped (for example, 3, rising with progression).
- **Optional future: the Fullness meter** (phase 10). Describe it briefly. It must be gentle and never punish the player.
- **Out of scope for v1:** multiplayer, NPC romance, combat and mines, and a walkable character. List these explicitly.

### 2. `docs/BALANCE.md`: formulas and starting numbers
- The formulas as code-like expressions:
  - growth time
  - base sell price
  - market price movement (demand drops as you sell, then recovers over time, with a floor and a ceiling)
  - upgrade cost curves (geometric, with the growth ratio stated)
  - automation throughput
  - fish rarity weights
  - recipe tier → buff magnitude and duration
  - XP curve
  - offline progress cap and reduction
- Starting **data tables** for every crop, fish, recipe, upgrade and expansion. Give ids, names, seasons, costs, times, sell values, ingredients and buff type. These are first drafts, and phases 03 and 09 will tune them.
- Pacing targets. For example: first automation bought within 10 to 15 minutes, first T4 recipe after about 3 to 5 hours of combined active and idle play, and no dead time where the player waits more than about 2 minutes with nothing to do early in the game.

### 3. `docs/ART_STYLE.md`
- A palette of 32 to 48 named colours with hex codes (for example, `soil_dark`, `grass_1`, `water_2`, `wood_light` and `ui_parchment`), grouped by use. Aim for warm, slightly desaturated colours that read as Stardew/Minecraft.
- Sprite conventions: a 16×16 tile grid, sprite definitions as arrays of strings in which each character is a palette key, 4 or 5 growth stages per crop, and roughly how many animation frames to use.
- The rendering scale rule: integer scaling only, `imageSmoothingEnabled = false`, and a crisp-pixels CSS rule.
- The UI look: a parchment or wood panel style, a pixel font plan (a CSS stack with a system monospace fallback, and no network fonts), and the icon size.
- 2 or 3 worked sprite examples written in the string-grid format, for example a turnip at stage 4 and a grass tile.

### 4. `docs/DATA_SCHEMAS.md`
TypeScript interfaces for every content type and the save state. Include `CropDef`, `FishDef`, `RecipeDef`, `ItemDef`, `UpgradeDef`, `BuffDef`, `ExpansionDef`, `QuestDef`, `GameState` and `SaveFile` (with a `version` field). Use string-literal id types so that references can be type-checked. Explain how systems read `data/` and change `state`.

### 5. `CLAUDE.md` (repo root): standing rules for every future session
Include at least these rules:
- Read `docs/GDD.md`, `docs/PROGRESS.md` and the relevant section of `docs/BALANCE.md` before coding.
- **Architecture rules:**
  - Game logic lives in `src/systems/` as pure functions of `(state, data, dt/rng)`, with no DOM or canvas access.
  - Content lives only in `src/data/`.
  - Rendering lives in `src/render/` and UI in `src/ui/`. Both read state and send actions.
  - All randomness goes through the seeded RNG in `src/core/rng.ts`.
- **Save rules:** any change to `GameState` needs a `SAVE_VERSION` bump and a migration function plus a test for it. Never break an existing save.
- **Quality bar:** `npm run typecheck && npm test && npm run build` must pass. Every new system needs unit tests.
- **Scope rule:** stay inside the current phase's prompt. Log ideas outside it in `docs/IDEAS.md`.
- **Handoff rule:** before finishing, add a section to `docs/PROGRESS.md` with *Built / Deviations / Known issues / Next-phase notes*.
- **Git:** make small, descriptive commits and open one PR per phase against `main`.

### 6. `docs/PROGRESS.md` and `docs/IDEAS.md`
Create both. In PROGRESS.md, write the Phase 00 entry. Create IDEAS.md with a heading and no entries yet.

## Out of scope
Any code, `package.json`, build config, CI or sprite implementations.

## Definition of done
- All six documents exist, are internally consistent (the same ids appear in the GDD, BALANCE and SCHEMAS docs), and match the fixed decisions above.
- The content counts meet the targets.
- There is a short section at the end of GDD.md listing any questions for the human owner. Also state these questions in your final chat message.
- Commit, push, and open a PR to `main` titled `Phase 00: Game design doc & conventions`. The PR body should summarise the key design choices and the open questions.
