# Ideas Backlog

Ideas that came up during a phase but were outside its scope. Add one line per idea: **what**, **why**, and **which phase or version** could own it. Reviewed after phase 09.

- *Partly absorbed by v2 (v2-03/04): Persimmon Pudding and Lemon Meringue Pie are cookable from winter-fresh ingredients (BALANCE §13.8); the winter kitchen speed bonus is still open. v4-03 plans Hot Cocoa as a Press House drink (cocoa from its shelf, BALANCE §14.4).* **Winter-only recipes** (hot cocoa, leek soup) and a winter kitchen speed bonus, to make winter cooking week richer. Owner liked the winter-cooking direction; add via `templates/add-content.md` after phase 06, or in phase 09 if pacing needs it.
- **Rain days** that water every plot, tied to the real calendar. Adds weather (out of scope for v1).
- *Done in v2-01 (GDD §12.1 "Phones"): the scene fills the space between the HUD and the toolbar at ≥ 2× and one finger pans.* **A bigger scene on narrow phones**: at 360 px wide and a 1× pixel ratio the integer-scale rule leaves the scene at 320 × 192 CSS px with 16 px tap targets. A portrait layout (taller scene, or 2× with horizontal panning) would be friendlier. Phase 08 (mobile).
- *Partly done in v2-01: locked parcels are overgrown with a "For sale" sign, and the old dock's shore has one until it is bought; reeds along the future river are still open.* **Decor on locked lots**: reeds along the future river, a "For sale" sign on the old dock, so locked zones read as clickable before they are bought. (Phase 03 put two old trees on the greenhouse lot until `farm_3`.) Phase 05 (river/ocean) or 08 (polish).
- **A clearer "watered" cue**: wet and dry soil differ only by one shade, which is subtle at 1× on phones. A few droplet pixels or a darker rim on wet plots would read faster. Phase 08 (polish).
- *Partly done after v3-00: any stack can be discarded from the Inventory panel, and out-of-season seeds are marked there; a buy-back or compost bin is still open.* **Selling or composting unplantable seeds** (out-of-season seeds sit in the bag until their season returns). Phase 03 kept seeds unsellable; a buy-back at a fraction of the price, or a compost bin that gives a small growth boost, could fit phase 04 or 08.
- *Done in v2-06.* **"Harvest all ready" and "Water all" buttons** in addition to shift-click, for touch players who find shift-click unavailable and dragging fiddly. Phase 08 (mobile).
- **Take part of a stack back out of the Shipping Bin**, and a "ship 10" button. Phase 03 ships and returns whole stacks; phase 04's per-item auto-sell toggles may want finer control. Phase 04 or 08.
- **A market price history view** (a bigger sparkline with daily numbers on tap). The 7-day sparkline is tiny on phones. Phase 08 (mobile/polish).
- **Coins flying from the bin to the HUD counter** instead of a "+N" popup at the bin. Phase 08 (juice).
- **A "bag full" notice from the farmhand** (a speech bubble over the sprite and one toast per pickup) instead of skipping ready crops silently. Phase 04 only mentions waiting crops in the away summary. Phase 08 (polish).
- **A visible sprinkler radius on hover** in normal play (not only in placement mode) and coloured soil for scarecrow-boosted plots. Phase 08 (polish).
- *Done in v2-06 (the Seed Order upgrade).* **Buy seeds from the farmhand's route**: a planter that draws down gold to restock its last crop (opt-in, with a cap), so a lapsed seed supply does not stall the farm. Phase 09 if the idle pacing shows farms stalling.
- **Choose where a trap goes** (drag it to any free water tile, or three traps in the river's wider water), and a trap "bait" item that skews its pool. Phase 05 sets traps out automatically at two fixed spots per water. Phase 08 (polish) or 09.
- **A "line out" cooldown or minimum bite wait after each catch**, if phase 09 finds active fishing too strong (BALANCE.md "Phase 05 tuning notes"). Phase 09.
- **Fish sounds and a rod-tug rumble on touch devices** (`navigator.vibrate`) during the reel. Phase 08.
- **Show the fish behind the "!"**: a silhouette that peeks up when the bite lands, so a rare or legendary bite is exciting. Phase 08 (juice).
- **A pause button and auto-cancel** when the Fishing panel is closed for a long time, so a forgotten cast does not hold a session for days. Phase 08.

- *Done in v2-06.* **Cook ×N and a recipe favourites list**: a quantity stepper next to Cook and a pin for the dishes you cook most. Phase 08 (UI polish).
- **A dish on the windowsill**: a plated dish or a cat that appears at the farmhouse while something is on the stove. Phase 08 (juice).
- **A sparkle when a buff starts and a soft chime when it ends**: hook `buffStarted` and `buffExpired`. Phase 08 (audio and juice).
- **A "Running now" buff summary in the Kitchen** so phone players, whose HUD strip is hidden, still see what is active. Phase 08 (mobile).

- **A goal reroll** ("Not today", once a day per goal) and a small badge on the Goals toolbar button when a goal is close to done or a new milestone is next. Phase 08 (UI polish).
- *Partly done in v2-06 (the Farm Level chip; skill levels are still open).* **Farm Level and skill levels in the HUD** (a small "Lv 4" chip that opens the Goals panel), so the level the shop's "Reach Farm Level N" hints mention is always visible. Phase 08.
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
- *Done in v2-05: Busy Bees also shortens animal production cycles (`animalSpeedModifier`).* **Busy Bees that matters late**: once the farmhand is Level 3+, it is never the bottleneck, so `automationSpeed` is worth ~0 gold. Let it also shorten the Shipping Bin interval or speed regrowth of automated plots. v2 balance.
- *Absorbed by v2-03/04: Persimmon Pudding (winter, T3 Silver Tongue) and Peach Cobbler (summer, T3 Silver Tongue), BALANCE §13.8.* **A gold-buff dish for winter** (and a second one for summer): today's winter dishes boost XP, fishing and cooking, so keeping buffs up in winter is about XP, not gold. Could ride the "winter-only recipes" idea above. v2 content.
- **Goal draws that do not depend on how an offline walk is split**: goals are redrawn with the seeded RNG at the end of a step, so the same absence walked in different step sizes can draw different goals (and seed or card rewards). A separate RNG stream for goals, or drawing only at the end of a catch-up, would make an absence fully reproducible. v2 engine.
- **A "Pull up" hint and confirm**: phase 09 lets the Hoe pull up a regrower that has given a harvest; a tooltip on such plots ("Hoe: pull up") and a one-time confirmation would make the rule discoverable. Later polish.
- **A human-like fisher in the simulator**: the bots model active fishing as catches per minute; replaying the real reel minigame with a reaction-time model would test the minigame's difficulty curve and Relaxed fishing. Tooling.
- *Done in v2-06 (the Seed Order upgrade).* **Seed restocking for idle farms** (see "Buy seeds from the farmhand's route" above): the simulator confirms it: an automated farm of single-harvest crops stalls overnight without a big seed stock, which is the main thing a casual player must remember before leaving. v2.

v2 phase 00 (design update; ideas kept out of v2 on purpose):
- **Rotating decorations** (only flipping in v2) and **seasonal decoration packs** sold for one season a year. Later v2 content via `templates/add-content.md`.
- **A world minimap** in a corner, with the edge pips' targets on it. Could follow v2-01 if the world grows again. *v4 grows it to 36 × 36 and still leaves the minimap out (GDD §13.2); edge pips cover the north.*
- **More animal kinds** (ducks, goats, sheep) and **more tree kinds** (cherry blossom that bears nothing, a golden apple): out of scope for v2 (GDD §9); a later content phase.
- **Grafting and tree quality, animal affection and breeding**: out of scope (GDD §9). Not planned.
- *Done in v2-05.* **Busy Bees that also shortens animal cycles** (see "Busy Bees that matters late" above): v2 keeps animal cycles fixed; a later balance phase could use this seam.
- **A town-square noticeboard of townsfolk requests** (deliver 10 eggs by Sunday): would need NPCs or a new quest kind; out of v2 scope.

v2 phase 01 (world and camera):
- *Done in v2-05: the Paint toggle (a per-device pref) and Alt-drag on desktop.* **Drag-painting a tool across plots with a modifier** (for example Alt-drag): v2 made every drag a pan, so on desktop a tool now goes plot by plot or Shift-click for the whole field. A held modifier could bring painting back without breaking the "a drag never runs a tool" rule for touch. Later polish.
- **Region-aware toasts for more events**: v2-01 adds the "→ Region" suffix and click-to-pan to the bin, trap, cooking and parcel toasts; v2-02–04 should route decoration, tree and animal toasts through `toastAt` in `src/main.ts` too. v2-02–04.
- *Done in v2-05: a phone's default view and Home centre on the plot grid.* **Start the phone view on the field**: on a narrow phone the default view (the home region's centre at the height-fitting zoom) shows the field and market but not the farmhouse. Centring on the field's middle, or remembering the last view per orientation, could read better. Later polish.


v2 phase 02 (decorations, charm and town projects):
- **A longer Shipping Bin pickup window as a town reward**: the phase prompt listed it among example rewards, but GDD §12.2's project table (which wins) does not give one. It would be a quality-of-life reward for the bandstand or lighthouse. Later balance.
- **A decoration preview on touch screens**: Decorate mode shows its green or red ghost under a mouse pointer only; on a touch screen a tap places at once, and a refused tile says why in a toast. A drag-to-position ghost with a confirm button would be gentler. Later polish.
- **Rearrange without the slot cap getting in the way**: with 100 slots at first, a player who has bought a whole set cannot place it all until projects finish. "Swap" (pick up one, place another in one click) or a stock-to-slot indicator on each chip could help. Later polish.
- **Stage items that wait for later phases**: apples, persimmons, eggs, large eggs and milk join the bakery's and the hall's stages in v2-03 and v2-04 (`LATER_STAGE_ITEMS` in `src/data/townProjects.ts`). v2-03 and v2-04.
- **Placing decorations in the Orchard and the Paddock**: allowed today (outside tree spots); v2-04's coop, barn and silo are placed on free tiles, so a decoration already there blocks them. The building-placement check should say which decoration is in the way, or offer to pick it up. v2-04.
- **Festival lights and the band across the whole square**: v2-02 hangs one string between two poles and puts four musicians on the bandstand; a fuller square (bunting between all the buildings, dancing townsfolk) would be pure art work. Later polish.

v2 phase 03 (the orchard):
- *Done in v2-05: fruit value ×4–7, a full orchard is 5–6% of gold on days 14–21 (BALANCE §13.14).* **Orchard income is about 1% of gold, not the 5–15% BALANCE §13.10 expected** (6–8k a day against bots earning 0.5–1M a day by day 7–14). Raising fruit prices or fruit per day by about 5× would reach the band; a later balance phase should decide whether the orchard should matter more (the owner fixed the tree table). Later balance.
- *Done in v2-05: the first tap shows the label, the second picks.* **A tree tooltip on touch screens**: the label shows under a mouse pointer; on a phone a tap picks the fruit and nothing names the tree. A first tap that shows the label and a second that picks would be gentler. Later polish.
- **A farmhand that walks the orchard**: the sprite walks to the tile below a tree it picked from, one trip per tree; a proper route (a short loop along the rows) would read better. Later polish.
- **Sway for mature canopies** (ART_STYLE §6.2 lists a 2-frame sway as optional): not drawn. Later polish.
- **Fruit waiting on a bare winter tree** stays drawn on the branches until picked (nothing is lost, GDD §12.1); falling leaves and a "ripe" glint would tell the player it is waiting. Later polish.
- **Move a tree by dragging it**: Move in the Trees tab enters a spot-picking mode; dragging a tree between spots in the scene would be quicker, but a drag is a pan (GDD §12.1). Later polish.

v2 phase 04 (animals):
- *Done in v2-05: an animal label on hover and on the first tap (name, building, trough, store, next product).* **Tell the player which hen is which**: a hover label with an animal's name, trough and next product (like the tree tooltip); on a phone a long press. Names exist and can be changed in the Ranch panel, but nothing in the scene shows them. Later polish.
- **Plant a little wheat and corn for the animals**: the bots buy feed when a trough is nearly dry and make it from the wheat and corn they happen to keep; a "keep N spare" hint in the Auto-Seller for wheat and corn would make the loop smoother for players.
- **The farmhand also collecting eggs** (GDD §9 decision 10 chose not to); a later balance phase could use it for a second automation tier.
- **A sleeping "z" over the animals at night** and a rooster at dawn (audio): cosmetic, render-only.
- *Partly done in v2-05: hay and corn feed live in the ranch's feed store (600 of each); eggs and milk still take bag slots.* **Bag pressure from feed and products:** hay, corn feed, eggs and milk take bag slots (the bots keep stage items too); a "Feed store" tab in the silo or an overflow into the bin could ease it if players feel it.

v2 phase 05 (balance and polish):
- **A steadier buff check**: the paired Chef-versus-control median at day 7 swings ±15 points between nearby settings and seed sets (the two bots make the same purchases half a day apart and that compounds). Averaging days 5–9, or 16+ seeds for this one pair, would make the check judge the buffs rather than the dice. Tooling.
- **Bigger town stage asks for fruit**: with v2-05's fruit yields the bakery's 30 apples and the hall's 20 persimmons are about one day of one tree; 100 or more would keep them a real orchard errand. Later balance (needs the owner: GDD §12.2 lists the stages).
- **A label for buildings on touch** (trough, store, next product) like the animal label, before a tap collects. Later polish.
- **Paint strokes that start off the field**: a Paint drag that begins on grass pans, so a stroke must start on a plot; starting anywhere and painting only plots would suit a phone better if players ask. Later polish.

v3 phase 00 (platform shell):
- **Check for a new version while the game stays open**: the service worker looks for an update only when the page loads, so a tab left open for days never sees one; `registration.update()` once a day would. Later polish (Pages only).
- **Steam achievements from milestones**: `Platform.achievements.unlock(id)` exists as a seam; mapping milestones to achievement ids belongs to v3-02.
- **A toast that waits on the update offer**: the "new version" toast fades after a few seconds like any other; a small persistent "Update" chip by the Settings button would be easier to find. Later polish.

v2 phase 06 (ideas kept out of it on purpose):
- **Seed Order for next season's crops.** The order buys only what the planter last planted, in season and ripe in time, so on the first Sunday of a new season it has nothing to buy until the player plants the new season's crop by hand once; an "also stock the best crop for next season" setting would close the gap. A later balance phase.
- **Harvest all for the greenhouse** (it follows Shift-click and leaves the greenhouse plots alone, as Shift-click always has).
- **Cook ×N for the Experiment tab** and a "keep favourites cooking" repeat. Later UI polish.

v4 phase 00 (the North; ideas kept out of v4 on purpose):
- **A mill** (wheat to flour, bread recipes): wheat already has ten recipes (thirteen with v4), hay and a bakery stage; another station to tend adds no new kind of play (GDD §13.10). A later content phase if wheat feels idle.
- **A "Mountain" decoration set** (stone paths, log fences, lanterns, a wooden bench under the pines) for the north parcels' spare grass. Later content via `templates/add-content.md`.
- **Flower-varietal honey**: hives near crops or trees in bloom (never decorations, which are cosmetic) make a blossom or heather honey with its own price. v4-03 keeps one honey (GDD §13.6).
- **Drinks and honey in town stages**: the projects' asks are the owner's; drinks could be alternative items in a later content pass (GDD §13.9).
- **A repeatable late sink** after the catalogue is spent (a keen player runs out around day 35–40 even with v4, BALANCE §14.8): something cosmetic and endless, never income. Owner call.
- **An auto-stocking pantry** for the restaurant (a level or upgrade that restocks the menu from the bag at each bin pickup, like the silo): v4-02 has a one-click Restock instead. Later, if players ask.
- **A third north field** ("High Meadow", 24 plots, in part of the woods) if the owner wants more land (GDD §13.12 question 3).
- **A brewery** with ale, cider and mead: only if the owner answers yes to GDD §13.12 question 1 (store age ratings).

