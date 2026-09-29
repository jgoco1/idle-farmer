# Phase 05: Fishing

> **Recommended model:** Sonnet 5.5. This is a self-contained feature that follows the existing system, panel and data patterns. The minigame is moderately fiddly but well specified.
> **Depends on:** Phase 04 merged.
> **Docs win:** the phase 00 owner decisions (`docs/GDD.md` §11) changed some details, including a real-time calendar with weekly seasons, timers in simulated minutes, and 7 buff types. Where this prompt conflicts with `docs/`, follow `docs/` and note the difference in `docs/PROGRESS.md`.

## Role and goal
You are adding **fishing** to a cozy idle farming and cooking browser game. Fishing offers two ways to play. **Active fishing** is a short, relaxing timing minigame that rewards attention with rarer fish. **Idle fishing** uses fish traps that fill over time. Fish can be sold now and cooked later (phase 06).

## Read first
`CLAUDE.md`, `docs/PROGRESS.md`, the Fishing section of `docs/GDD.md`, the fish table and rarity formulas in `docs/BALANCE.md`, and the existing economy, automation and RNG code.

## Requirements
1. **Fish data (`src/data/fish.ts`).** Add the 16 fish and 3 junk items from BALANCE.md. Each fish has an id, a name, a location (Pond, River or Ocean), its seasons, a time-of-day window on the player's **local clock** (from the phase-01 calendar), a rarity (Common, Uncommon, Rare or Legendary), a difficulty, a size range, and a base price. There is **one legendary per season**: Petal Koi, Sun Marlin, Ember Salmon and Moonfin. Every location always has a common fish available. Seaweed is junk that later becomes a cooking ingredient.
2. **Locations.** The pond is available from the start. The River (FL3) and the Ocean via the Old Dock (FL6) are unlocked with gold, in the same way as farm expansions. Each unlock visibly changes the scene: a river appears along the edge, or a dock sprite is added. Clicking a water zone opens the Fishing panel for that location.
3. **Active fishing minigame (`src/ui/panels/fishing.ts` plus pure logic in `src/systems/fishing.ts`).**
   - Cast by holding and releasing to set the cast power (a strong cast slightly improves the odds), then wait 3 to 10 real seconds for a bite, shown with a "!" and a bobber dip. The wait passes through a new `fishingSpeedModifier` seam.
   - A **cozy** reel minigame. Recommended design: a horizontal bar with a moving "sweet zone". The player holds a button (or Space) to keep the marker inside the zone. The catch meter fills while the marker is inside and drains slowly while it is outside. Fish difficulty sets the zone's size and how fast it moves. There is no failure penalty beyond the fish escaping.
   - Put the minigame logic in pure functions of `(state, input, dt)` so it can be tested. Keep the UI to rendering and input only.
   - Support keyboard, mouse and touch. Add an **accessibility option**, "Relaxed fishing", that widens the zone and slows it down, and add it to Settings.
4. **Catch selection.** Pick the fish with weighted random selection filtered by location, season and time. Rarity weights come from BALANCE.md and pass through a `fishingLuckModifier` seam, which phase-06 buffs will drive. Record catches in a **Fish Collection** log with the first-catch date and the largest size, shown as a tab in the Fishing panel with silhouettes for fish not yet caught.
5. **Idle fishing: Fish Traps (`fish_trap`, `trap_collector`).** Traps are an upgrade placed at water zones, **2 per location**. Each trap rolls a catch every **3 minutes of simulated time**, holds **5 items**, and **ignores time of day**, so night fish reach players who never play at night. The pool is Common and Uncommon fish plus junk. The trap interval also passes through `fishingSpeedModifier`. The player collects by clicking the trap. The Trap Collector upgrade empties traps at every shipping-bin pickup. Traps must be correct under offline large-step simulation.
6. **Fishing Rod upgrades (`fishing_rod`).** The player starts with the Old rod and can buy Bamboo, Fiberglass and Iridium rods in the Upgrades panel. They widen the reel zone and slightly improve rarity.
7. **Sprites.** Give every fish an item icon. Add sprites for the bobber, trap, river and dock tiles, and a splash animation. Ripples on the water should look calm and cozy.
8. **Economy integration.** Fish are sellable items that use the phase-03 market dynamics. Add them to the pacing simulation. In it, active fishing can be modelled as "N catches per real minute while active".

## Save
Bump `SAVE_VERSION` for unlocked locations, traps, the rod level and the collection log. Add a migration and a test.

## Tests (minimum)
Catch-table filtering by location, season and local time (including windows that wrap past midnight, such as Moonfin's 16:00–10:00), weighted rarity with a fixed seed, the luck and speed modifier seams, reel meter physics (a scripted input sequence gives a deterministic catch or escape), relaxed mode parameters, trap accumulation online and offline, the trap capacity limit, and the migration. Extend the e2e test: open the pond panel and complete one catch with scripted input, or use a debug "auto-win" hook that is only active in test or debug builds.

## Out of scope
Cooking fish or fish recipes (phase 06), fishing XP or skills (07) and sound effects (08). Emit events so that these can hook in later.

## Definition of done
- All checks pass.
- Take a screenshot of the fishing minigame in progress.
- Add a PROGRESS.md Phase 05 entry.
- Open a PR titled `Phase 05: Fishing`.
