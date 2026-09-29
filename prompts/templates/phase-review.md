# Template: Phase PR Review (a second opinion before merging)

> **Recommended model:** Opus 5.5.
> **Use:** in a fresh session, after a phase session opens its PR. Replace the `<…>` placeholders.

---

Review PR #<PR_NUMBER> on this repo (`<PHASE NAME>`). Don't push changes. Report back to me in chat.

1. Read `CLAUDE.md`, `docs/GDD.md`, `docs/PROGRESS.md` and the phase prompt `prompts/<PHASE_FILE>.md`. That prompt is the spec this PR was built from.
2. Check out the PR branch and run `npm ci && npm run typecheck && npm run lint && npm test && npm run build && npm run test:e2e`. Report any failures.
3. **Spec compliance.** Go through each numbered requirement and each "Definition of done" item in the phase prompt, and mark it ✅ done, ⚠️ partial or ❌ missing, with a one-line note.
4. **Scope creep.** List anything built that the phase prompt puts out of scope or doesn't mention.
5. **Architecture rules from CLAUDE.md:**
   - Are systems pure, with no DOM access?
   - Does all content live in `src/data/`?
   - Does all randomness go through the seeded RNG?
   - Was `SAVE_VERSION` bumped, with a migration and a migration test?
6. **Offline correctness.** Does every new timed behaviour give the same result in one large offline step as in many small steps? Is there a test for it?
7. **Bugs.** Run `/code-review high` on the PR diff, or review it for correctness bugs yourself if that isn't available.
8. **Play it.** Run the dev server with Playwright. Use `?debug` time-warp to play through this phase's features for a few minutes, and take 2 or 3 screenshots. Comment on the feel and the visuals.

Output:
- A verdict: **Merge**, **Merge after small fixes**, or **Needs rework**.
- A prioritised list of issues. For each, give a ready-to-paste instruction I can send back to the original phase session.
