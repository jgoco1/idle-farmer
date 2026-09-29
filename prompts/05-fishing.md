# Phase 05: Fishing

> **Recommended model:** Sonnet 5.5. This is a self-contained feature that follows the existing system, panel and data patterns. The minigame is moderately fiddly but well specified.
> **Depends on:** Phase 04 merged.

## Role and goal
You are adding **fishing** to a cozy idle farming and cooking browser game. Fishing offers two ways to play. **Active fishing** is a short, relaxing timing minigame that rewards attention with rarer fish. **Idle fishing** uses fish traps that fill over time. Fish can be sold now and cooked later (phase 06).

## Read first
`CLAUDE.md`, `docs/PROGRESS.md`, the Fishing section of `docs/GDD.md`, the fish table and rarity formulas in `docs/BALANCE.md`, and the existing economy, automation and RNG code.

## Requirements
1. **Fish data (`src/data/fish.ts`).** Add about 12 fish from BALANCE.md. Each has an id, a name, a location (Pond, River, Ocean or Dock), its seasons, a time-of-day window, a rarity (Common, Uncommon, Rare or Legendary), a difficulty, a size range, and a base price. Add a few pieces of "junk" loot (an old boot, seaweed) for charm. Seaweed can be a cooking ingredient later.
2. **Locations.** The pond is available from the start. River and Ocean/Dock are unlocked with gold, in the same way as farm expansions. Each unlock visibly changes the scene: a river appears along the edge, or a dock sprite is added. Clicking a water zone opens the Fishing panel for that location.
3. **Active fishing minigame (`src/ui/panels/fishing.ts` plus pure logic in `src/systems/fishing.ts`).**
   - Cast by holding and releasing to set the cast power, then wait a short random time for a bite, shown with a "!" and a bobber dip.
   - A **cozy** reel minigame. Recommended design: a horizontal bar with a moving "sweet zone". The player holds a button (or Space) to keep the marker inside the zone. The catch meter fills while the marker is inside and drains slowly while it is outside. Fish difficulty sets the zone's size and how fast it moves. There is no failure penalty beyond the fish escaping.
   - Put the minigame logic in pure functions of `(state, input, dt)` so it can be tested. Keep the UI to rendering and input only.
   - Support keyboard, mouse and touch. Add an **accessibility option**, "Relaxed fishing", that widens the zone and slows it down, and add it to Settings.
4. **Catch selection.** Pick the fish with weighted random selection filtered by location, season and time. Rarity weights come from BALANCE.md and pass through a `fishingLuckModifier` seam, which phase-06 buffs will drive. Record catches in a **Fish Collection** log with the first-catch date and the largest size, shown as a tab in the Fishing panel with silhouettes for fish not yet caught.
5. **Idle fishing: Fish Traps.** Traps are an upgrade that can be placed at water zones, up to N per location. Each trap rolls a catch every X in-game hours (the fish pool is limited to Common and Uncommon, plus junk) and holds up to K items. The player collects from the trap by clicking it, and a later auto-collect upgrade can do this instead. Traps must be correct under offline large-step simulation.
6. **Fishing Rod upgrades.** Add Bamboo, Fiberglass and Iridium rods, sold in the Upgrades panel. They widen the reel zone and slightly improve rarity.
7. **Sprites.** Give every fish an item icon. Add sprites for the bobber, trap, river and dock tiles, and a splash animation. Ripples on the water should look calm and cozy.
8. **Economy integration.** Fish are sellable items that use the phase-03 market dynamics. Add them to the pacing simulation. In it, active fishing can be modelled as "N catches per real minute while active".

## Save
Bump `SAVE_VERSION` for unlocked locations, traps, the rod level and the collection log. Add a migration and a test.

## Tests (minimum)
Catch-table filtering by location, season and time, weighted rarity with a fixed seed, the luck modifier seam, reel meter physics (a scripted input sequence gives a deterministic catch or escape), relaxed mode parameters, trap accumulation online and offline, the trap capacity limit, and the migration. Extend the e2e test: open the pond panel and complete one catch with scripted input, or use a debug "auto-win" hook that is only active in test or debug builds.

## Out of scope
Cooking fish or fish recipes (phase 06), fishing XP or skills (07) and sound effects (08). Emit events so that these can hook in later.

## Definition of done
- All checks pass.
- Take a screenshot of the fishing minigame in progress.
- Add a PROGRESS.md Phase 05 entry.
- Open a PR titled `Phase 05: Fishing`.
