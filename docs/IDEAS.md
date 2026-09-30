# Ideas Backlog

Ideas that came up during a phase but were outside its scope. Add one line per idea: **what**, **why**, and **which phase or version** could own it. Reviewed after phase 09.

- **Winter-only recipes** (hot cocoa, leek soup) and a winter kitchen speed bonus, to make winter cooking week richer. Owner liked the winter-cooking direction; add via `templates/add-content.md` after phase 06, or in phase 09 if pacing needs it.
- **Rain days** that water every plot, tied to the real calendar. Adds weather (out of scope for v1).
- **A bigger scene on narrow phones**: at 360 px wide and a 1× pixel ratio the integer-scale rule leaves the scene at 320 × 192 CSS px with 16 px tap targets. A portrait layout (taller scene, or 2× with horizontal panning) would be friendlier. Phase 08 (mobile).
- **Decor on locked lots**: reeds along the future river, a "For sale" sign on the old dock, so locked zones read as clickable before they are bought. (Phase 03 put two old trees on the greenhouse lot until `farm_3`.) Phase 05 (river/ocean) or 08 (polish).
- **A clearer "watered" cue**: wet and dry soil differ only by one shade, which is subtle at 1× on phones. A few droplet pixels or a darker rim on wet plots would read faster. Phase 08 (polish).
- **Selling or composting unplantable seeds** (out-of-season seeds sit in the bag until their season returns). Phase 03 kept seeds unsellable; a buy-back at a fraction of the price, or a compost bin that gives a small growth boost, could fit phase 04 or 08.
- **"Harvest all ready" and "Water all" buttons** in addition to shift-click, for touch players who find shift-click unavailable and dragging fiddly. Phase 08 (mobile).
- **Take part of a stack back out of the Shipping Bin**, and a "ship 10" button. Phase 03 ships and returns whole stacks; phase 04's per-item auto-sell toggles may want finer control. Phase 04 or 08.
- **A market price history view** (a bigger sparkline with daily numbers on tap). The 7-day sparkline is tiny on phones. Phase 08 (mobile/polish).
- **Coins flying from the bin to the HUD counter** instead of a "+N" popup at the bin. Phase 08 (juice).
- **A "bag full" notice from the farmhand** (a speech bubble over the sprite and one toast per pickup) instead of skipping ready crops silently. Phase 04 only mentions waiting crops in the away summary. Phase 08 (polish).
- **A visible sprinkler radius on hover** in normal play (not only in placement mode) and coloured soil for scarecrow-boosted plots. Phase 08 (polish).
- **Buy seeds from the farmhand's route**: a planter that draws down gold to restock its last crop (opt-in, with a cap), so a lapsed seed supply does not stall the farm. Phase 09 if the idle pacing shows farms stalling.
- **Golden scarecrow** (Spring Crops bundle reward, radius 3, +0.30): `scarecrowBonus` and `areaOf` in `src/systems/placement.ts` are the seams. Phase 07.
- **Choose where a trap goes** (drag it to any free water tile, or three traps in the river's wider water), and a trap "bait" item that skews its pool. Phase 05 sets traps out automatically at two fixed spots per water. Phase 08 (polish) or 09.
- **A "line out" cooldown or minimum bite wait after each catch**, if phase 09 finds active fishing too strong (BALANCE.md "Phase 05 tuning notes"). Phase 09.
- **Fish sounds and a rod-tug rumble on touch devices** (`navigator.vibrate`) during the reel. Phase 08.
- **Show the fish behind the "!"**: a silhouette that peeks up when the bite lands, so a rare or legendary bite is exciting. Phase 08 (juice).
- **A pause button and auto-cancel** when the Fishing panel is closed for a long time, so a forgotten cast does not hold a session for days. Phase 08.

- **Cook ×N and a recipe favourites list**: a quantity stepper next to Cook and a pin for the dishes you cook most. Phase 08 (UI polish).
- **A dish on the windowsill**: a plated dish or a cat that appears at the farmhouse while something is on the stove. Phase 08 (juice).
- **A sparkle when a buff starts and a soft chime when it ends**: hook `buffStarted` and `buffExpired`. Phase 08 (audio and juice).
- **A "Running now" buff summary in the Kitchen** so phone players, whose HUD strip is hidden, still see what is active. Phase 08 (mobile).
