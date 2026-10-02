# Hearthfield Idle: Session Runbook

This folder holds the prompts that build a cozy idle farming and cooking browser game, with a look inspired by Stardew Valley and Minecraft. Each numbered file is a complete prompt for **one Claude Code session**. Run them in order, and have each one produce **one PR**. Merge that PR before you start the next session.

> "Hearthfield Idle" is only a working title. Phase 00 lets you rename it.

**Status:** v1 (phases 00–09) is complete and live. **Phase 10 is on hold.** v2 is next: see [v2 below](#v2-bigger-world-decorations-orchard-animals).

---

## Decisions already made (from the planning session)

| Topic | Decision |
|---|---|
| Play style | **Hybrid farm scene.** A pixel-art scene with clickable zones: farm plots, a pond, a kitchen and a market stall. There is no walking character. Automation provides the idle part. |
| Art | **Pixel art generated in code.** Sprites are small pixel grids that share one palette and are drawn to canvas at runtime. No outside image files or licensing. |
| Needs / hunger | **Skipped for v1.** Cooked dishes give **food buffs** instead. Each dish has its own effect, and its strength and duration scale with the recipe's difficulty and value. An optional "Fullness" meter can come later (phase 10). |
| Workflow | **Sequential.** One session and one PR per phase, merged before the next phase starts. |
| Stack | Vite, TypeScript, Vitest and Playwright. Canvas 2D draws the scene and plain DOM/CSS draws the panels. No framework and no game engine. Deploys to GitHub Pages. |

### Phase 00 owner decisions (recorded in `docs/GDD.md` §11)
- **Two clocks.**
  - A real-time **calendar** follows the player's local clock. Night runs from 20:00 to 06:00, there's a daily refresh at 06:00, and seasons change **weekly** at Saturday → Sunday midnight. Every save starts in spring.
  - Every timer (growth, cooking, buffs, traps) runs on short **simulated time**, measured in minutes.
- **Timers:** watering lasts 2 h (dry plots grow at half speed), the shipping bin is collected hourly, and sprinklers keep plots permanently watered.
- **Food buffs:** 7 buff types (Quick Bite, `fishingSpeed`, was added) and 3 starting buff slots.
- **Content:** 16 fish, including one legendary per season. 22 recipes. Winter is cooking season: dishes cooked in winter are "hearty", with +50% buff duration.

**Docs win.** The prompts were written before phase 00. They have been updated to match these decisions, and each one also says that where it conflicts with `docs/`, the session follows `docs/` and records the difference in `docs/PROGRESS.md`.

---

## Execution order and model choice

| # | Prompt file | Model | Depends on | What you get |
|---|---|---|---|---|
| 00 | `00-design-doc.md` | **Opus 5.5** | none | `CLAUDE.md`, a game design doc, data schemas, balance formulas, an art style guide, and the progress log |
| 01 | `01-foundation.md` | **Opus 5.5** | 00 | A playable empty farm scene: game loop, save/load, offline progress, sprite renderer, UI shell, CI and Pages deploy |
| 02 | `02-farming.md` | Sonnet 5.5 | 01 | Crops, soil, watering, growth stages, seasons and harvest |
| 03 | `03-economy-market.md` | **Opus 5.5** | 02 | Gold, a market with changing prices, the shop and farm expansion |
| 04 | `04-automation-upgrades.md` | Sonnet 5.5 | 03 | Sprinklers, farmhands, auto-sell and tool upgrades (the idle loop) |
| 05 | `05-fishing.md` | Sonnet 5.5 | 04 | Fishing spots, a timing minigame, idle fish traps and rarity |
| 06 | `06-cooking-buffs.md` | Sonnet 5.5 | 05 | Kitchen, recipes, cook queue, recipe discovery and **food buffs** |
| 07 | `07-progression-goals.md` | Sonnet 5.5 | 06 | Player level, skills, quests, collections and unlock gating |
| 08 | `08-polish-audio-ux.md` | Sonnet 5.5 | 07 | Sound, music, juice (animations and particles), a tutorial, settings and a mobile layout |
| 09 | `09-balance-qa.md` | **Opus 5.5** | 08 | A headless economy simulator, pacing tuning, a bug sweep and performance work |
| 10 | `10-optional-needs.md` | Sonnet 5.5 | 09 | *(Optional)* A gentle Fullness meter tied to food buffs |

Reusable templates you can run at any point after phase 01:

| Template | Model | Use when |
|---|---|---|
| `templates/phase-review.md` | Opus 5.5 | Before you merge any phase PR, as a second opinion |
| `templates/bugfix.md` | Sonnet 5.5 | You found a bug while playtesting |
| `templates/add-content.md` | Haiku 4.5 (or Sonnet) | You want more crops, fish or recipes that follow the existing schema |
| `fixes/fishing-result-pause.md` | Sonnet 5.5 (Haiku 4.5 possible) | Ready to run: fishing results vanish when the player keeps tapping after a catch |

### Why these models
- **Opus 5.5 handles the phases that set things every later phase inherits.** Phase 00 fixes the design and schemas. Phase 01 fixes the architecture: the save format, the tick model and the renderer. Phases 03 and 09 are numerical: price curves, idle pacing and offline gains. A mistake in any of these spreads into every later phase, so the stronger reasoning model is worth what it costs.
- **Sonnet 5.5 handles feature phases.** Once the patterns exist (a data file, a pure system, a panel and tests), adding fishing or cooking is mostly careful work that follows those patterns. Sonnet does this fast and well.
- **Haiku 4.5 handles content data only.** Adding ten more crops to a typed data file with tests is a narrow, well-specified job.
- If a Sonnet phase struggles (it keeps breaking tests or drifts off the plan), rerun it on Opus. That usually costs less than several fix-up rounds.

### Why this order
1. Design comes before code, so every session works from the same written source of truth.
2. The foundation comes before features. The save/load, tick and render pipelines are the hardest things to change later.
3. The order is **Farming → Economy → Automation**. Crops have to exist before they can be sold, and selling has to exist before automation can be worth buying. After these three phases, the core idle loop is playable.
4. **Fishing comes before Cooking,** because recipes use both crops and fish.
5. Progression comes after all the content exists, because it gates and ties that content together.
6. Polish and balance come last. Tuning numbers before every system exists means doing the tuning twice.

---

## How to launch each session

1. **One-time setup:** merge this `prompts/` folder into `main`. The repo was empty before this, so make `main` the default branch on GitHub if it isn't already.
2. Start a new Claude Code session on `jgoco1/idle-farmer`, pick the model from the table, and send a short kickoff message:
   > Read `prompts/01-foundation.md` and carry out that phase exactly as written. Open a PR to `main` when done.

   You can also paste the whole file as the message. Both work, but the short kickoff keeps the prompt versioned in the repo.
3. When the session opens its PR, **playtest it**. Use the Pages preview once phase 01 sets it up, or run `npm install && npm run dev` locally.
4. Optionally, run `templates/phase-review.md` in a separate Opus session, or type `/code-review` in the same session.
5. Send feedback in the **same** session until you're happy, then merge.
6. Start the next phase in a **new** session. Fresh context gives better quality, and `docs/PROGRESS.md` carries the memory across.

---

## Tips for managing the process

- **`docs/PROGRESS.md` is how sessions remember.** Each phase adds a section covering what it built, how it differs from the plan, known issues and notes for the next phase. Read it after each phase. It's the quickest way to see what really happened.
- **`CLAUDE.md` holds the standing rules.** Phase 00 creates it and later phases only add to it. If you notice a session making the same mistake repeatedly, add a rule there.
- **Keep scope tight.** Each prompt has an *Out of scope* list. When a session has a good idea outside its scope, it records it in `docs/IDEAS.md` rather than building it. Review that backlog after phase 09.
- **Protect save compatibility.** Every save-schema change needs a version bump and a migration, so your playtest save keeps working from phase to phase. If a PR wipes your save, send it back.
- **Playtest every phase.** Tests show the logic is correct but not whether the game is fun. Five minutes of play will catch pacing and feel problems early.
- **Rerun instead of piling on fixes.** If a phase goes badly wrong, close the PR, add notes to the top of the prompt ("Previous attempt did X; avoid it"), and rerun it in a fresh session.
- **Keep PRs small.** If a phase's PR is over about 3,000 changed lines, which is most likely in 01 or 06, ask the session to split it into stacked commits or two PRs.
- **Watch CI.** After a session opens a PR, you can ask it to "watch the PR and fix CI failures". It will subscribe to PR events and push fixes.
- **Changing the vision later.** Edit `docs/GDD.md` in a small PR of its own first, then run the next phase. Prompts read the design doc, so the change carries forward.
- **Optional project automation.** Phase 01 adds a `.claude/settings.json` SessionStart hook that runs `npm ci`, so every later session starts with dependencies installed and can run tests right away.
- **GitHub Pages** needs a public repo, or a paid plan for private repos. If Pages isn't available, the CI build artifact and local `npm run dev` still work.

---

## Target repository layout (built up across phases)

```
CLAUDE.md                     # standing conventions (phase 00, amended later)
docs/
  GDD.md                      # game design doc (00)
  ART_STYLE.md                # palette, sprite sizes, UI look (00)
  BALANCE.md                  # formulas + tuning tables (00, tuned in 03/09)
  DATA_SCHEMAS.md             # TypeScript interfaces for content + save (00)
  PROGRESS.md                 # handoff log, appended every phase
  IDEAS.md                    # out-of-scope backlog
  RELEASE.md                  # release checklist (09)
src/
  main.ts
  core/      loop.ts state.ts save.ts time.ts events.ts rng.ts
  data/      crops.ts fish.ts recipes.ts items.ts upgrades.ts expansions.ts buffs.ts skills.ts quests.ts
  systems/   inventory.ts farming.ts economy.ts automation.ts fishing.ts cooking.ts buffs.ts progression.ts
  render/    palette.ts spriteCache.ts renderer.ts scene.ts sprites/*.ts
  ui/        hud.ts panels/*.ts styles.css
  audio/     sfx.ts music.ts
tests/       *.test.ts  e2e/smoke.spec.ts
scripts/     simulate.ts (09)
.github/workflows/ ci.yml deploy.yml
.claude/settings.json         # SessionStart hook
prompts/                      # this folder
```

---

## v2: bigger world, decorations, orchard, animals

The owner chose these features after playing v1. The prompts are in `prompts/v2/`. They work the same way as v1: one session and one PR per phase, merged in order.

### Owner decisions for v2
| Topic | Decision |
|---|---|
| Features | A bigger world with a pannable camera, a decoration shop and town projects, fruit trees, chickens and cows |
| Fruit trees | Mature over **real calendar days**, taken from the real clock and not limited by the offline cap. They never wither and bear fruit only in their seasons. |
| Decorations | Cosmetic only. They may feed a "charm" score that unlocks more decorations, milestones and goals, but they give **no income bonus**. |
| Animals | Gentle: an unfed animal just doesn't produce, with no other penalty. They are fed from farm produce (hay from wheat, feed from corn). No quality tiers and no artisan machines. |
| Games of chance | None: no casino, slots or alternatives to them |
| Phase 10 (Fullness meter) | On hold |

### Order and models
| # | Prompt file | Model | Depends on | What you get |
|---|---|---|---|---|
| v2-00 | `v2/00-design.md` | **Opus 5.5** | v1 | Updated GDD, BALANCE, schemas and art style for all four features, plus a list of open questions for you |
| v2-01 | `v2/01-world-camera.md` | **Opus 5.5** | v2-00 | A world 2–3× bigger, a camera with pan and zoom on mouse, touch and keyboard, land parcels, and browser tests added to CI |
| v2-02 | `v2/02-decor-town.md` | Sonnet 5.5 | v2-01 | The decoration shop, Decorate mode, charm, and town projects (the late-game gold sink) |
| v2-03 | `v2/03-orchard.md` | Sonnet 5.5 | v2-02 | Fruit trees in the orchard, real-day maturity, and fruit recipes |
| v2-04 | `v2/04-animals.md` | Sonnet 5.5, then an Opus review | v2-03 | Coop, barn, chickens and cows, feed, eggs and milk, new recipes including a winter gold-buff dish |
| v2-05 | `v2/05-balance-polish.md` | **Opus 5.5** | v2-04 | A balance pass (buffs back to 10–25%, an orchard worth planting, earlier first milk, Busy Bees for animals), tap-to-inspect labels on phones, an optional Paint toggle for drag-to-farm, a feed store, and opt-in screenshot updates |

**Why this order:** v2-01 changes the coordinate system that everything else sits on, so it goes first and on Opus. The decoration shop comes next because it fixes the biggest balance problem the phase 09 simulator found: gold stops mattering after about day 7. Trees and animals then fill the new land.

### How to run v2
- Start each session with: *"Read `prompts/v2/NN-….md` and carry out that phase exactly as written. Open a PR to `main` when done."*
- **After v2-00, answer its open questions** (world size, which regions are parcels, how fruit is produced) in the same session. This is the same step as after v1 phase 00.
- **Every v2 phase changes the save** (versions 8, 9, 10 and 11). Keep one long-running playtest save, and send back any PR that breaks it.
- **The balance simulator is the safety net:** each phase runs `npm run simulate`. Check the PR for the "gold still to spend" table and the phase 09 checks.
- As in v1, when you say a phase is done, a checking session can verify it: build it, run the unit and browser tests, send screenshots, fix small test problems, and merge with your approval.
