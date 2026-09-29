# Phase 06: Cooking and Food Buffs

> **Recommended model:** Sonnet 5.5. This is feature work on established patterns. If the buff-stacking design or the offline interaction between buffs and timers turns out to be tricky, rerun on Opus.
> **Depends on:** Phase 05 merged. Crops and fish must both exist, because recipes use both.

## Role and goal
You are adding **cooking** to a cozy idle farming and cooking browser game. The player turns crops and fish into dishes in the farmhouse kitchen. Dishes are worth more than their raw ingredients, and more importantly, **eating a dish gives a food buff**. The buff system is a key design idea from the game's owner:

> Each prepared food gives a *different* benefit, and the buff's **strength and duration scale with the recipe's difficulty and value**.

There is no hunger meter in this phase. Eating is always optional and always rewarding.

## Read first
`CLAUDE.md`, `docs/PROGRESS.md`, the Cooking and Buffs sections of `docs/GDD.md`, the recipe table and the tier → buff formulas in `docs/BALANCE.md`, and every existing `*Modifier` seam in `src/systems/`. List those seams in PROGRESS.md.

## Requirements
1. **Recipe data (`src/data/recipes.ts`).** Add about 20 recipes across 4 tiers from BALANCE.md. Each has an id, a name, ingredients (item ids and quantities), a cook time, a sell value, a buff type and an unlock condition. Include a range: simple T1 dishes (roasted turnip, grilled fish), T2 dishes (vegetable soup, fish tacos), T3 dishes (seafood stew, fruit pie) and T4 showpieces (a harvest feast or legendary fish dish).
2. **Tier derivation.** Work out tier from the recipe's inputs, not by hand: `f(ingredientCount, totalIngredientValue, cookTime)` from BALANCE.md. Add a unit test that checks every recipe's computed tier against the tier given in the design doc, so the data and the formula can't drift apart.
3. **Buff system (`src/data/buffs.ts`, `src/systems/buffs.ts`).**
   - Buff types, each connected to an existing seam:

     | Buff | Seam it drives |
     |---|---|
     | Green Thumb (growth speed) | `growthModifier` |
     | Silver Tongue (sell price) | `sellPriceModifier` |
     | Angler's Luck (fishing rarity) | `fishingLuckModifier` |
     | Quick Hands (cook speed) | `cookSpeedModifier` (new) |
     | Busy Bees (automation speed) | `automationSpeedModifier` |
     | Scholar's Snack (XP gain) | `xpModifier` (stub; phase 07 uses it) |

   - Magnitude and duration come from the tier using the BALANCE.md formula. For example, T1 gives +10% for 5 in-game hours, and T4 gives +40% for 2 in-game days. Use whatever BALANCE.md specifies.
   - **Stacking rules:** one active buff per type. A stronger buff replaces a weaker one. A buff of equal or lower strength refreshes the duration up to the stronger one's remaining time, and never shortens it. The maximum number of active buff slots starts at 2 or 3, and phase 07 can raise it.
   - Buffs count down in in-game time and expire correctly during offline simulation. **Offline correctness:** if a growth buff expires 2 hours into an 8-hour offline period, only those 2 hours get the bonus. Handle this by splitting the offline step at buff expiry boundaries, and test it.
   - Show active buffs in the HUD (replacing the phase-01 placeholder) with an icon, a remaining-time ring or bar, and a tooltip with the exact effect.
4. **Kitchen and cooking (`src/systems/cooking.ts`, Kitchen panel).**
   - Clicking the farmhouse opens the Kitchen. It has a recipe book that shows known recipes with their ingredient availability (have/need) and each recipe's tier and buff.
   - A **cook queue** with 1 slot at first; upgrades add more. Cooking takes real or in-game time and continues offline. Finished dishes go to the inventory.
   - **Recipe discovery:** some recipes are known at the start. Others unlock from milestones (for example, catch your first river fish), are bought as "recipe cards" in the shop, or are discovered by an optional "experiment" mode. Experiment mode lets the player pick 2 to 4 ingredients, and if they match an unknown recipe, it is learned. If they don't, nothing is wasted: the ingredients are returned with a friendly hint.
   - **Eat or sell:** in the Inventory, a dish has an **Eat** button (it applies the buff and shows a confirmation if it would replace a stronger buff) and it can be sold through the market.
   - Add a kitchen upgrade line (Stove, then Oven, then Pro Kitchen) with extra queue slots and faster cooking, and add it to `src/data/upgrades.ts`.
5. **Sprites.** Give every dish an item icon (bowls, plates and pies that read clearly at 16×16) and every buff type an icon. Add a steam animation on the farmhouse chimney while something is cooking.
6. **Economy check.** Add cooking to the pacing simulation. Cooking should usually be worth more than selling the raw ingredients (T1 about +20%, T4 much more), and buffs should feel strong but not required. Write the tuning notes in BALANCE.md.

## Save
Bump `SAVE_VERSION` for known recipes, the cook queue, active buffs and buff slots. Add a migration and a test.

## Tests (minimum)
Tier derivation for all recipes, buff magnitude and duration per tier, every stacking and replacement rule, the slot cap, offline buff expiry splitting, cook queue timing online and offline, recipe discovery (success, and a failed experiment that loses no ingredients), each buff affecting its seam, and the migration. Extend the e2e test: cook a T1 dish, eat it, and assert that the buff appears in the HUD.

## Out of scope
The hunger or Fullness meter (the optional phase 10), XP and levels (phase 07; only the `xpModifier` stub exists) and sound (08).

## Definition of done
- All checks pass.
- Take screenshots of the Kitchen panel and of the HUD with two active buffs.
- Add a PROGRESS.md Phase 06 entry that includes a table of every recipe with its tier, buff, magnitude and duration.
- Open a PR titled `Phase 06: Cooking & food buffs`.
