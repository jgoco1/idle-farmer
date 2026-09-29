# Phase 06: Cooking and Food Buffs

> **Recommended model:** Sonnet 5.5. This is feature work on established patterns. If the buff-stacking design or the offline interaction between buffs and timers turns out to be tricky, rerun on Opus.
> **Depends on:** Phase 05 merged. Crops and fish must both exist, because recipes use both.
> **Docs win:** the phase 00 owner decisions (`docs/GDD.md` §11) changed some details, including a real-time calendar with weekly seasons, timers in simulated minutes, and 7 buff types. Where this prompt conflicts with `docs/`, follow `docs/` and note the difference in `docs/PROGRESS.md`.

## Role and goal
You are adding **cooking** to a cozy idle farming and cooking browser game. The player turns crops and fish into dishes in the farmhouse kitchen. Dishes are worth more than their raw ingredients, and more importantly, **eating a dish gives a food buff**. The buff system is a key design idea from the game's owner:

> Each prepared food gives a *different* benefit, and the buff's **strength and duration scale with the recipe's difficulty and value**.

There is no hunger meter in this phase. Eating is always optional and always rewarding.

## Read first
`CLAUDE.md`, `docs/PROGRESS.md`, the Cooking and Buffs sections of `docs/GDD.md`, the recipe table and the tier → buff formulas in `docs/BALANCE.md`, and every existing `*Modifier` seam in `src/systems/`. List those seams in PROGRESS.md.

## Requirements
1. **Recipe data (`src/data/recipes.ts`).** Add the 22 recipes (6/7/5/4 by tier) from BALANCE.md §7. Each has an id, a name, ingredients (item ids and quantities), a cook time, a sell value, a buff type and an unlock condition. Every T3 and T4 dish can be cooked from one season's ingredients, and each season has its own T4 (Garden Banquet, Royal Sturgeon, Harvest Feast and Moonfin Sushi).
2. **Tier derivation.** Work out tier from the recipe's inputs, not by hand: `score = ingredient units + ingredient value / 50 + cook minutes / 60`, with thresholds 8 / 15 / 28 (GDD §7; BALANCE.md is authoritative). Add a unit test that checks every recipe's computed tier against the tier given in the design doc, so the data and the formula can't drift apart.
3. **Buff system (`src/data/buffs.ts`, `src/systems/buffs.ts`).**
   - The 7 buff types, each connected to an existing seam:

     | Buff | Seam it drives |
     |---|---|
     | Green Thumb (growth speed) | `growthModifier` |
     | Silver Tongue (sell price) | `sellPriceModifier` |
     | Angler's Luck (fishing rarity) | `fishingLuckModifier` |
     | Quick Bite (faster bites and trap rolls) | `fishingSpeedModifier` (from phase 05) |
     | Quick Hands (cook speed) | `cookSpeedModifier` (new) |
     | Busy Bees (automation speed) | `automationSpeedModifier` |
     | Scholar's Snack (XP gain) | `xpModifier` (stub; phase 07 uses it) |

   - Magnitude and duration come from the tier: `magnitude = 10% × tier × typeScale` and `duration = 6 minutes × 2^(tier − 1)` of simulated time. So T1 is +10% for 6 minutes and T4 is +40% for 48 minutes. Silver Tongue's scale is ×0.5, and Quick Hands and Scholar's Snack are ×1.5. BALANCE.md §7 has the exact values.
   - **Stacking rules:** one active buff per type. Eating a dish of a type that is already active keeps the **stronger** magnitude and the **longer** remaining time, so it never weakens or shortens anything. There are **3 slots** at the start; phase 07 adds +1 at Cooking level 7 and +1 from the Cozy Dinner bundle, up to a maximum of 5. If all slots are full and the player eats a new type, a confirmation offers to replace the buff with the least time left.
   - Buffs count down in simulated time and expire correctly during offline simulation. **Offline correctness:** if a growth buff expires 20 minutes into an 8-hour offline period, only those 20 minutes get the bonus. Handle this by splitting the offline step at buff expiry boundaries, and test it.
   - Show active buffs in the HUD (replacing the phase-01 placeholder) with an icon, a remaining-time ring or bar, and a tooltip with the exact effect.
4. **Kitchen and cooking (`src/systems/cooking.ts`, Kitchen panel).**
   - Clicking the farmhouse opens the Kitchen. It has a recipe book that shows known recipes with their ingredient availability (have/need) and each recipe's tier and buff.
   - A **cook queue** with 1 slot at first; upgrades add more. Cooking runs on simulated time and continues offline. Finished dishes go to the inventory.
   - **Recipe discovery:** some recipes are known at the start. Others unlock from milestones (for example, catch your first river fish), are bought as "recipe cards" in the shop, or are discovered by an optional "experiment" mode. Experiment mode lets the player pick 2 to 4 ingredients, and if they match an unknown recipe, it is learned. If they don't, nothing is wasted: the ingredients are returned with a friendly hint.
   - **Eat or sell:** in the Inventory, a dish has an **Eat** button that applies the buff (with the slot-replacement confirmation above), and it can be sold through the market.
   - **Winter is cooking season (GDD §6.5):** dishes that finish cooking in winter are **hearty**. They get a snowflake badge, and their buff lasts 50% longer whenever it is eaten. In winter, dishes also sell for +25%. The +50% Cooking XP in winter is recorded for phase 07. Hearty and normal copies of a dish need separate inventory stacks, or a flag on the stack.
   - Add a kitchen upgrade line (Stove, then Oven, then Pro Kitchen) with extra queue slots and faster cooking, and add it to `src/data/upgrades.ts`.
5. **Sprites.** Give every dish an item icon (bowls, plates and pies that read clearly at 16×16) and every buff type an icon. Add a steam animation on the farmhouse chimney while something is cooking.
6. **Economy check.** Add cooking to the pacing simulation. Cooking should always be worth more than selling the raw ingredients (T1 about +25%, T4 about +100%), and buffs should feel strong but not required. Write the tuning notes in BALANCE.md.

## Save
Bump `SAVE_VERSION` for known recipes, the cook queue, active buffs and buff slots. Add a migration and a test.

## Tests (minimum)
Tier derivation for all recipes, buff magnitude and duration per tier and type scale, hearty dishes (winter-cooked, +50% duration) and the winter sell bonus, every stacking and replacement rule, the slot cap, offline buff expiry splitting, cook queue timing online and offline, recipe discovery (success, and a failed experiment that loses no ingredients), each buff affecting its seam, and the migration. Extend the e2e test: cook a T1 dish, eat it, and assert that the buff appears in the HUD.

## Out of scope
The hunger or Fullness meter (the optional phase 10), XP and levels (phase 07; only the `xpModifier` stub exists) and sound (08).

## Definition of done
- All checks pass.
- Take screenshots of the Kitchen panel and of the HUD with two active buffs.
- Add a PROGRESS.md Phase 06 entry that includes a table of every recipe with its tier, buff, magnitude and duration.
- Open a PR titled `Phase 06: Cooking & food buffs`.
