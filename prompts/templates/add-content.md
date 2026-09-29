# Template: Add Content (crops, fish, recipes, upgrades, goals)

> **Recommended model:** Haiku 4.5 for small additions that follow the existing schema. Use Sonnet 5.5 if the new content needs new sprites with careful pixel art, or touches balance in a meaningful way.
> **Use:** after phase 06 at any time, when you want more variety. Fill in the `<…>` fields.

---

Add new content to the cozy idle farming game in this repo. **Only add data and sprites. Do not change systems.**

**Content to add:**
- <e.g. 3 new autumn crops: cranberry (regrows), pumpkin (giant variant not needed), yam>
- <e.g. 2 new recipes using them: cranberry sauce (T1), pumpkin pie (T3)>
- <optional notes on theme, rarity, price range>

Instructions:
1. Read `CLAUDE.md`, `docs/DATA_SCHEMAS.md`, `docs/ART_STYLE.md` and the relevant tables in `docs/BALANCE.md`.
2. Add entries to the right `src/data/*.ts` files, following the existing entries exactly. Derive the numbers from the BALANCE.md formulas, not by guessing. Put new crops at a similar value per in-game hour to other crops of the same season and tier.
3. For every new item, add sprites in `src/render/sprites/` using the existing string-grid format and **palette keys only**. Crops need every growth stage plus an item icon. Keep silhouettes distinct from existing sprites.
4. If you add recipes, check that the tier-derivation test still passes and that each new recipe's buff type fits its theme.
5. Add the new rows to the tables in `docs/BALANCE.md`.
6. If content was added to data tables, no migration is needed unless `GameState` changed. It should not have: if you think it must, stop and explain why.
7. Run `npm run typecheck && npm run lint && npm test && npm run build`. If `npm run simulate` exists, run it and confirm the pacing hasn't shifted by more than about 5%.
8. Commit, push, and open a PR titled `Content: <summary>`. List the new items with their key numbers.
