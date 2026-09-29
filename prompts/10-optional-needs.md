# Phase 10 (Optional): Gentle Fullness Meter

> **Recommended model:** Sonnet 5.5. This is a contained system that builds on the buff code from phase 06.
> **Depends on:** Phase 09 merged. Run it only if you want a needs system after playing the finished v1.

## Role and goal
Add an **optional, never-punishing Fullness meter** to a cozy idle farming and cooking browser game. It should make eating a thoughtful choice without ever creating stress. When it is empty, the player simply has no food buffs. It never slows the player down, never harms them and never creates urgency.

## Read first
`CLAUDE.md`, `docs/PROGRESS.md`, the "Optional future: Fullness meter" section of `docs/GDD.md`, and `src/systems/buffs.ts`.

## Requirements
1. **The meter.** Fullness runs from 0 to 100 and drains slowly over in-game time. Eating a dish adds Fullness based on its tier (a T4 feast fills a lot). The player can't eat past 100: the Eat button shows "Too full" and a tooltip saying how long until there's room.
2. **Link to buffs.** This is the core design. The meter controls **how many buffs the player can keep up at once**, not whether the player can function. Choose one of these models, justify it in the PR, and make the other easy to switch to with a config flag:
   - **A. Capacity model:** the number of buff slots available depends on the Fullness band. For example, above 70 gives full slots, 30 to 70 gives one fewer, and below 30 gives one slot.
   - **B. Well-fed bonus:** while Fullness is above 60, every active buff gets +X% magnitude. There is no penalty below that.
3. **Toggle.** Add a Settings toggle, "Fullness meter (optional)", which is **off by default**. When it is off, the game behaves exactly as in v1.
4. **UI.** A small pixel bowl or belly icon in the HUD next to the buffs, with a fill level and a tooltip. Show Fullness gained in the tooltip of each dish.
5. **Offline behaviour.** Fullness drains while offline, but buffs that were active when the player left keep their original offline behaviour. The meter never removes anything.

## Save
Bump `SAVE_VERSION` for the Fullness value and the setting, and add a migration and a test.

## Tests
Drain and fill maths, the eat cap, both link models, the toggle being off reproducing v1 behaviour exactly (compare simulator output), offline drain, and the migration. Rerun `npm run simulate` with the meter on and off, and add the results to BALANCE.md.

## Definition of done
- All checks pass.
- Add a PROGRESS.md Phase 10 entry.
- Open a PR titled `Phase 10: Optional Fullness meter`.
