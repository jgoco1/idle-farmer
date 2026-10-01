# Ideas Backlog

Ideas that came up during a phase but were outside its scope. Add one line per idea: **what**, **why**, and **which phase or version** could own it. Reviewed after phase 09.

- *Partly absorbed by v2 (v2-03/04): Persimmon Pudding and Lemon Meringue Pie are cookable from winter-fresh ingredients (BALANCE §13.8); the winter kitchen speed bonus is still open.* **Winter-only recipes** (hot cocoa, leek soup) and a winter kitchen speed bonus, to make winter cooking week richer. Owner liked the winter-cooking direction; add via `templates/add-content.md` after phase 06, or in phase 09 if pacing needs it.
- **Rain days** that water every plot, tied to the real calendar. Adds weather (out of scope for v1).
- *Done in v2-01 (GDD §12.1 "Phones"): the scene fills the space between the HUD and the toolbar at ≥ 2× and one finger pans.* **A bigger scene on narrow phones**: at 360 px wide and a 1× pixel ratio the integer-scale rule leaves the scene at 320 × 192 CSS px with 16 px tap targets. A portrait layout (taller scene, or 2× with horizontal panning) would be friendlier. Phase 08 (mobile).
- *Partly done in v2-01: locked parcels are overgrown with a "For sale" sign, and the old dock's shore has one until it is bought; reeds along the future river are still open.* **Decor on locked lots**: reeds along the future river, a "For sale" sign on the old dock, so locked zones read as clickable before they are bought. (Phase 03 put two old trees on the greenhouse lot until `farm_3`.) Phase 05 (river/ocean) or 08 (polish).
- **A clearer "watered" cue**: wet and dry soil differ only by one shade, which is subtle at 1× on phones. A few droplet pixels or a darker rim on wet plots would read faster. Phase 08 (polish).
- **Selling or composting unplantable seeds** (out-of-season seeds sit in the bag until their season returns). Phase 03 kept seeds unsellable; a buy-back at a fraction of the price, or a compost bin that gives a small growth boost, could fit phase 04 or 08.
- **"Harvest all ready" and "Water all" buttons** in addition to shift-click, for touch players who find shift-click unavailable and dragging fiddly. Phase 08 (mobile).
- **Take part of a stack back out of the Shipping Bin**, and a "ship 10" button. Phase 03 ships and returns whole stacks; phase 04's per-item auto-sell toggles may want finer control. Phase 04 or 08.
- **A market price history view** (a bigger sparkline with daily numbers on tap). The 7-day sparkline is tiny on phones. Phase 08 (mobile/polish).
- **Coins flying from the bin to the HUD counter** instead of a "+N" popup at the bin. Phase 08 (juice).
- **A "bag full" notice from the farmhand** (a speech bubble over the sprite and one toast per pickup) instead of skipping ready crops silently. Phase 04 only mentions waiting crops in the away summary. Phase 08 (polish).
- **A visible sprinkler radius on hover** in normal play (not only in placement mode) and coloured soil for scarecrow-boosted plots. Phase 08 (polish).
- **Buy seeds from the farmhand's route**: a planter that draws down gold to restock its last crop (opt-in, with a cap), so a lapsed seed supply does not stall the farm. Phase 09 if the idle pacing shows farms stalling.
- **Choose where a trap goes** (drag it to any free water tile, or three traps in the river's wider water), and a trap "bait" item that skews its pool. Phase 05 sets traps out automatically at two fixed spots per water. Phase 08 (polish) or 09.
- **A "line out" cooldown or minimum bite wait after each catch**, if phase 09 finds active fishing too strong (BALANCE.md "Phase 05 tuning notes"). Phase 09.
- **Fish sounds and a rod-tug rumble on touch devices** (`navigator.vibrate`) during the reel. Phase 08.
- **Show the fish behind the "!"**: a silhouette that peeks up when the bite lands, so a rare or legendary bite is exciting. Phase 08 (juice).
- **A pause button and auto-cancel** when the Fishing panel is closed for a long time, so a forgotten cast does not hold a session for days. Phase 08.

- **Cook ×N and a recipe favourites list**: a quantity stepper next to Cook and a pin for the dishes you cook most. Phase 08 (UI polish).
- **A dish on the windowsill**: a plated dish or a cat that appears at the farmhouse while something is on the stove. Phase 08 (juice).
- **A sparkle when a buff starts and a soft chime when it ends**: hook `buffStarted` and `buffExpired`. Phase 08 (audio and juice).
- **A "Running now" buff summary in the Kitchen** so phone players, whose HUD strip is hidden, still see what is active. Phase 08 (mobile).

- **A goal reroll** ("Not today", once a day per goal) and a small badge on the Goals toolbar button when a goal is close to done or a new milestone is next. Phase 08 (UI polish).
- **Farm Level and skill levels in the HUD** (a small "Lv 4" chip that opens the Goals panel), so the level the shop's "Reach Farm Level N" hints mention is always visible. Phase 08.
- **Bundle planning help**: mark which bundle slots can be filled this season, and show "in season again in 2 days" for the rest, so the seasonal bundles read as a plan and not a wall. Phase 08 or 09.
- **Perk toasts with a preview** of the next perk ("Farming 4 gives a 5% double harvest"), and a tiny sparkle on the crop that doubled. Phase 08 (juice).
- **A sound and a longer flourish for a bundle or a Farm Level** (the confetti is silent and short). Phase 08 (audio).
- **Per-skill XP floaters**: a small "+3 XP" that rises from the plot, catch or dish. Phase 08 (juice).
- **A "what changed while you were away" list of unlocked content** in the away summary (new seeds, recipe cards, upgrades). The unlock events are silent offline today; only the toolbar buttons pulse. Phase 08.
- **Milestone chain art**: a small illustrated trail (a path with 15 stones) on the Milestones tab instead of a list. Phase 08.
- **A daily goal streak** (three goals done in a day) for the casual idler. Owner call; phase 09 if idle pacing wants a reason to visit.


- *Done in v2-01 (GDD §12.1 "Camera and controls").* **Pinch-to-zoom and two-finger pan for the scene** on phones (today: a 2× button and a pan switch). Phase 09 or later.
- **A real-device audio pass**: listen on phone speakers and headphones, tune `vol` in `SOUNDS` and `loopNotes`, and consider a per-season second melody. Phase 09.
- **A dog as well as a cat**, chosen by save, with a second pet sprite and a sleeping-pose variation at night. Later polish.
- **Number format everywhere** (panels, toasts, popups), and a Settings "Compact HUD" for phones. Later polish.
- **A sticky tab row and collapsible sections** for the Goals and Upgrades bottom sheets on phones. Later polish.

Phase 09 (simulator findings, for v2):
- *Absorbed by v2 (v2-01 parcels, v2-02 decorations and town projects, v2-03/04 saplings and the ranch; BALANCE §13.4 "Gold still to spend"). The "gift to the market" that raises price floors was not taken: it would be an income bonus.* **A late-game gold sink**: by day 7 a keen player has earned 3 million gold and every upgrade, expansion and card together costs about 523k, so gold means nothing for the last three weeks of a 30-day run. Farmhouse rooms, decorations, town projects on the Community Board, or a "gift to the market" that raises every price floor. v2 content.
- **Busy Bees that matters late**: once the farmhand is Level 3+, it is never the bottleneck, so `automationSpeed` is worth ~0 gold. Let it also shorten the Shipping Bin interval or speed regrowth of automated plots. v2 balance.
- *Absorbed by v2-03/04: Persimmon Pudding (winter, T3 Silver Tongue) and Peach Cobbler (summer, T3 Silver Tongue), BALANCE §13.8.* **A gold-buff dish for winter** (and a second one for summer): today's winter dishes boost XP, fishing and cooking, so keeping buffs up in winter is about XP, not gold. Could ride the "winter-only recipes" idea above. v2 content.
- **Goal draws that do not depend on how an offline walk is split**: goals are redrawn with the seeded RNG at the end of a step, so the same absence walked in different step sizes can draw different goals (and seed or card rewards). A separate RNG stream for goals, or drawing only at the end of a catch-up, would make an absence fully reproducible. v2 engine.
- **A "Pull up" hint and confirm**: phase 09 lets the Hoe pull up a regrower that has given a harvest; a tooltip on such plots ("Hoe: pull up") and a one-time confirmation would make the rule discoverable. Later polish.
- **A human-like fisher in the simulator**: the bots model active fishing as catches per minute; replaying the real reel minigame with a reaction-time model would test the minigame's difficulty curve and Relaxed fishing. Tooling.
- **Seed restocking for idle farms** (see "Buy seeds from the farmhand's route" above): the simulator confirms it: an automated farm of single-harvest crops stalls overnight without a big seed stock, which is the main thing a casual player must remember before leaving. v2.

v2 phase 00 (design update; ideas kept out of v2 on purpose):
- **Rotating decorations** (only flipping in v2) and **seasonal decoration packs** sold for one season a year. Later v2 content via `templates/add-content.md`.
- **A world minimap** in a corner, with the edge pips' targets on it. Could follow v2-01 if the world grows again.
- **More animal kinds** (ducks, goats, sheep) and **more tree kinds** (cherry blossom that bears nothing, a golden apple): out of scope for v2 (GDD §9); a later content phase.
- **Grafting and tree quality, animal affection and breeding**: out of scope (GDD §9). Not planned.
- **Busy Bees that also shortens animal cycles** (see "Busy Bees that matters late" above): v2 keeps animal cycles fixed; a later balance phase could use this seam.
- **A town-square noticeboard of townsfolk requests** (deliver 10 eggs by Sunday): would need NPCs or a new quest kind; out of v2 scope.

v2 phase 01 (world and camera):
- **Drag-painting a tool across plots with a modifier** (for example Alt-drag): v2 made every drag a pan, so on desktop a tool now goes plot by plot or Shift-click for the whole field. A held modifier could bring painting back without breaking the "a drag never runs a tool" rule for touch. Later polish.
- **Region-aware toasts for more events**: v2-01 adds the "→ Region" suffix and click-to-pan to the bin, trap, cooking and parcel toasts; v2-02–04 should route decoration, tree and animal toasts through `toastAt` in `src/main.ts` too. v2-02–04.
- **Start the phone view on the field**: on a narrow phone the default view (the home region's centre at the height-fitting zoom) shows the field and market but not the farmhouse. Centring on the field's middle, or remembering the last view per orientation, could read better. Later polish.


v2 phase 02 (decorations, charm and town projects):
- **A longer Shipping Bin pickup window as a town reward**: the phase prompt listed it among example rewards, but GDD §12.2's project table (which wins) does not give one. It would be a quality-of-life reward for the bandstand or lighthouse. Later balance.
- **A decoration preview on touch screens**: Decorate mode shows its green or red ghost under a mouse pointer only; on a touch screen a tap places at once, and a refused tile says why in a toast. A drag-to-position ghost with a confirm button would be gentler. Later polish.
- **Rearrange without the slot cap getting in the way**: with 100 slots at first, a player who has bought a whole set cannot place it all until projects finish. "Swap" (pick up one, place another in one click) or a stock-to-slot indicator on each chip could help. Later polish.
- **Stage items that wait for later phases**: apples, persimmons, eggs, large eggs and milk join the bakery's and the hall's stages in v2-03 and v2-04 (`LATER_STAGE_ITEMS` in `src/data/townProjects.ts`). v2-03 and v2-04.
- **Placing decorations in the Orchard and the Paddock**: allowed today (outside tree spots); v2-04's coop, barn and silo are placed on free tiles, so a decoration already there blocks them. The building-placement check should say which decoration is in the way, or offer to pick it up. v2-04.
- **Festival lights and the band across the whole square**: v2-02 hangs one string between two poles and puts four musicians on the bandstand; a fuller square (bunting between all the buildings, dancing townsfolk) would be pure art work. Later polish.
