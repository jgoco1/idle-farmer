# Store listing kit

Shared by every store the game ships to: Google Play and the App Store (v3-01) and Steam (v3-02). Written in v3 phase 00.

> **The name is a placeholder.** "Hearthfield Idle" is the working title. The owner picks the final name and an app id (for example `io.github.jgoco1.hearthfield`) before v3-01; store ids can't be changed after the first upload. Replace `{{GAME_NAME}}` below when the name is chosen.

## Descriptions

**Short description** (Google Play allows 80 characters; this is 76):

> A cozy pixel farm that keeps growing while you're away. Farm, fish and cook.

**Long description:**

> {{GAME_NAME}} is a gentle idle farming game in hand-made pixel art. Plant turnips, water your rows and watch the farm fill in, at your own pace.
>
> Your farm keeps going while you're away. Come back to ripe crops, full fish traps and a kitchen that finished cooking. A real-world calendar turns the seasons once a week, so spring crops give way to summer, autumn and a quiet winter greenhouse.
>
> Grow the farm: hire a farmhand, put down sprinklers and scarecrows, open new fields and a greenhouse. Cast a line in the pond, the river and the sea, and fill your Fish Collection. Cook dishes that give your farm a boost. Plant an orchard that bears fruit across real days, keep hens and cows, decorate every corner, and help the town finish its projects.
>
> No ads. No in-app purchases. No accounts, no tracking, no network. Your farm lives on your device.

**Feature bullets:**

- A farm that grows while you're away, with a "while you were away" summary when you return
- Real-world seasons: the crops, the light and the music change with the week
- Farming, fishing and cooking that all feed each other
- An orchard, a hen coop and a cow barn, with animals that are never punished
- Decorations and town projects, purely for the joy of it
- Hand-drawn pixel art, procedural music, and a relaxed fishing mode
- Plays offline; no ads, no purchases, no data collected
- Touch, mouse and keyboard; interface size and reduced-motion settings

## Content rating answers

The same answers for the IARC questionnaire (Google Play), Apple's age rating and Steam's content survey:

| Question | Answer |
|---|---|
| Violence, blood, fear | None |
| Sexual content, nudity, crude humour | None |
| Language | None |
| Drugs, alcohol, tobacco | None |
| Gambling or simulated gambling, loot boxes, chance-based items for money | None. Nothing is bought with money, and nothing imitates a game of chance |
| User-generated content, chat, interaction between players | None |
| Location sharing, personal data, data collection | None (see `docs/privacy.md`) |
| In-app purchases, ads | None |
| Unrestricted internet access | No; the game makes no network calls |

Expected result: Everyone / PEGI 3 / 4+.

Privacy policy URL for every listing: `https://jgoco1.github.io/idle-farmer/privacy.html` (built from `docs/privacy.md` by the Pages build).

## Screenshot shot list

`npm run shots:store` captures every shot at every size below from the demo save (`tests/fixtures/store-demo.json`, made by `npm run demo-save`: the Active Player bot after two weeks), at 12:30 on a fixed date, into `store-shots/<store>/` (not committed). The sizes are in `scripts/store/sizes.ts`.

Shots, in this order, at every size:
1. **The farm** at the default view: fields, sprinklers, scarecrows, the farmhouse and the pond.
2. **The Kitchen** open: the recipe book.
3. **The Ranch** open: the coop and barn, troughs and the feed store.
4. **Fishing** open: the waters and the cast.

| Store | Size name | Pixels | Orientation | Verified |
|---|---|---|---|---|
| Google Play | Phone | 1080 × 1920 | portrait | not verified this session |
| Google Play | 10" tablet | 2560 × 1440 | landscape | not verified this session |
| App Store | iPhone 6.9" | 1320 × 2868 | portrait | not verified this session |
| App Store | iPad 13" | 2064 × 2752 | portrait | not verified this session |
| Steam | Desktop 16:9 | 1920 × 1080 | landscape | not verified this session |

None of the sizes could be checked against the stores' current documentation from this session (no store access); they are the sizes the stores asked for at the time of writing. Check each before uploading, and adjust `scripts/store/sizes.ts` if one has changed. Ideas for later: a 7" tablet set for Google Play, and a landscape phone set.

## Icons and art: checklist for the owner

Generated so far: `public/icon-512.png` (square), `public/icon-maskable-512.png` (turnip inside the safe circle), `public/icon-192.png`, `public/icon.svg` (`npm run icons`). Everything else is still to make. Sizes are as the stores asked for at the time of writing; confirm each in the store's console before uploading.

**Google Play**
- [ ] App icon: 512 × 512 PNG, 32-bit, up to 1 MB (`icon-512.png` fits; Play adds its own mask and shadow)
- [ ] Feature graphic: 1024 × 500 JPEG or 24-bit PNG, no transparency
- [ ] Phone screenshots: 2–8 (from `shots:store`)
- [ ] Tablet screenshots: up to 8 each for 7" and 10" (from `shots:store`)
- [ ] Adaptive launcher icon (v3-01, in the Android project): 108 × 108 dp foreground and background layers

**App Store**
- [ ] App icon: 1024 × 1024 PNG, no transparency, no rounded corners (the system rounds it)
- [ ] iPhone 6.9" screenshots: 1–10 (from `shots:store`)
- [ ] iPad 13" screenshots: 1–10 (from `shots:store`)
- [ ] Optional app preview video

**Steam** (Steamworks "Graphical assets")
- [ ] Header capsule: 920 × 430
- [ ] Small capsule: 462 × 174
- [ ] Main capsule: 1232 × 706
- [ ] Vertical capsule: 748 × 896
- [ ] Screenshots: at least 5, 1920 × 1080 (from `shots:store`)
- [ ] Page background: 1438 × 810 (optional)
- [ ] Library capsule: 600 × 900
- [ ] Library header: 920 × 430
- [ ] Library hero: 3840 × 1240
- [ ] Library logo: 1280 wide or 720 tall, transparent PNG
- [ ] Community / client icon: 184 × 184 JPG, and a 32 × 32 `.ico` for the desktop shortcut
- [ ] Capsules show the game's name and art only: no review quotes or award text

**Web (already done)**
- [x] `manifest.webmanifest`: name, short name, `display: standalone`, theme and background colours, 192 and 512 px icons and a maskable 512 px icon; Chromium reports no installability errors (`e2e/platform.spec.ts`).
