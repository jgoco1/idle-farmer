# Template: Bug Fix

> **Recommended model:** Sonnet 5.5. Use Opus 5.5 for bugs in offline simulation, save migration or the economy.
> **Use:** in a fresh session whenever playtesting turns up a bug. Fill in the `<…>` fields. Vague reports lead to vague fixes.

---

Fix a bug in the cozy idle farming game in this repo.

**Bug:** <one-sentence summary>
**Steps to reproduce:**
1. <step>
2. <step>

**Expected:** <what should happen>
**Actual:** <what happens instead>
**Where / when:** <browser, desktop/mobile, after offline time?, save version if known>
**Save export (optional):** <paste the base64 string from Settings → Export save, if relevant>

Instructions:
1. Read `CLAUDE.md` and `docs/PROGRESS.md` first, and follow the architecture rules.
2. **Reproduce the bug first** with a failing unit test or Playwright test. If I pasted a save, load it in a test fixture.
3. Find the root cause. Explain it in two or three sentences before you change anything.
4. Make the smallest fix that makes the test pass. Don't refactor unrelated code or add features.
5. If the fix changes `GameState`, bump `SAVE_VERSION` and add a migration and a test.
6. Run `npm run typecheck && npm run lint && npm test && npm run build && npm run test:e2e`.
7. Add a line to the "Known issues / fixed" section of `docs/PROGRESS.md`.
8. Commit, push, and open a PR titled `Fix: <summary>`. The PR body should give the root cause and name the test that now covers the bug.
