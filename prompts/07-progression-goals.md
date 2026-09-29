# Phase 07: Progression, Goals and Collections

> **Recommended model:** Sonnet 5.5. This phase ties existing systems together through events and data. It needs broad awareness of the codebase more than deep algorithmic work.
> **Depends on:** Phase 06 merged.

## Role and goal
You are adding **long-term progression** to a cozy idle farming and cooking browser game. All the core systems now exist: farming, the market, automation, fishing and cooking. This phase gives the player **direction and a sense of growth**: levels, skills, gentle goals, and collections to complete. It must also gate unlocks so that content is revealed at a satisfying pace.

## Read first
`CLAUDE.md`, `docs/PROGRESS.md` (all phases), the Progression section of `docs/GDD.md`, the XP curve and pacing targets in `docs/BALANCE.md`, and the event bus in `src/core/events.ts`. Progression should **listen for events** rather than being wired into every system.

## Requirements
1. **Skills and XP (`src/systems/progression.ts`).**
   - Add three skills, **Farming**, **Fishing** and **Cooking**, each with its own XP and level (1 to 10). Each earns XP from its matching events (harvest, catch, cook), scaled by the value or tier of the item.
   - The `xpModifier` seam from phase 06 (the Scholar's Snack buff) now takes effect.
   - Every level gives a small, clearly shown perk, taken from a data table (`src/data/skills.ts`). Examples: Farming 5 gives a chance of double harvest, Fishing 3 gives a wider reel zone, and Cooking 7 gives +1 buff slot.
   - Add an overall **Farm Level** made up of the skill levels plus milestones. It gates content unlocks, such as seeds, fishing locations, recipes and upgrades. Wire in the unlock conditions that already exist in the data, and replace any temporary unlock logic.
2. **Goals and quests (`src/data/quests.ts`).**
   - **Goal board:** 3 active goals at a time, drawn from a pool. Examples: "Harvest 20 parsnips", "Earn 500g in a day", "Catch a rare fish" and "Cook 3 different T2 dishes". Completing one gives gold, items or recipe cards, and a new goal is drawn. Goals must always be achievable at the player's current unlock level.
   - **Story milestones:** a short chain of 10 to 15 fixed milestones that act as a gentle tutorial for the whole game. Examples: plant your first seed, sell your first crop, buy a sprinkler, catch a fish, cook a meal, reach Farm Level 5. Each one comes with a short, warm line of flavour text. This chain is the player's main sense of direction.
3. **Collections (a "Community Board" in the style of Stardew's bundles).** Add 5 or 6 bundles, each a themed set of items to donate: a Spring Crops bundle, a Pond Fish bundle, a Cozy Dinner bundle, and so on. Completing a bundle gives a meaningful permanent reward, such as unlocking the Greenhouse, an extra buff slot, a new fishing location, or a golden scarecrow. Show donated items as filled-in slots.
4. **Goals panel.** Replace the stub with tabs for Goals, Milestones, Skills, Collections, and the Fish Collection from phase 05 (move it here or link to it). Show clear progress bars.
5. **Feedback.** Add toasts for level-ups and goal completion, a small celebration effect (pixel confetti or sparkles through the event bus), and an unlock notification that points at the new thing, for example "New seeds in the shop!".
6. **Statistics.** Add a Stats tab with lifetime gold, crops harvested, fish caught, dishes cooked, time played and days passed. The phase-09 balance work will use these.
7. **Pacing check.** Extend the simulation so the greedy bot follows the milestones. Record roughly when each milestone is reached, check the result against the BALANCE.md targets, and tune.

## Save
Bump `SAVE_VERSION` for skills, goals, milestones, bundles and stats. For existing saves, the migration should backfill sensible progress. For example, if the player already owns a sprinkler, mark the "buy a sprinkler" milestone as done, and grant a reasonable amount of starting XP.

## Tests (minimum)
The XP curve, level perks being applied, the unlock gating matrix (nothing is visible before its conditions are met), goal generation only producing achievable goals, milestone progression driven by events, bundle completion rewards, the migration backfill, and offline events counting toward goals.

## Out of scope
Sound and music (phase 08), the tutorial overlay (08; milestones are the in-game guide for now), balance beyond what the pacing check needs (09), and needs or Fullness (10).

## Definition of done
- All checks pass.
- Take a screenshot of the Goals panel.
- Add a PROGRESS.md Phase 07 entry with a table of milestone timings from the simulation.
- Open a PR titled `Phase 07: Progression & goals`.
