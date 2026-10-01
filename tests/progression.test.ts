// Phase 07: skills and XP, perks, the Farm Level and unlock gating, milestones, the goal board,
// the Community Board, and progression as a listener of events (also offline).

import { describe, expect, it } from 'vitest';
import { applyAction } from '../src/core/actions';
import { Game } from '../src/core/game';
import { awayRows, awayTotals } from '../src/ui/awaySummary';
import type { GameEvent } from '../src/core/events';
import { runOffline } from '../src/core/offline';
import { makeContext, processCalendar, step } from '../src/core/sim';
import { createInitialState, emptyPlot, type ActiveGoal, type GameState } from '../src/core/state';
import { buildCalendar } from '../src/core/time';
import { GAME_DATA, type GameData } from '../src/data';
import {
  COOKING_XP_BASE,
  FARM_LEVEL_MAX,
  FARM_LEVEL_POINTS,
  GOAL_GOLD_MIN,
  GOAL_SLOTS,
  GOAL_TARGET_MAX,
  GOAL_TARGET_MIN,
  GOLDEN_SCARECROW,
  MAX_SKILL_LEVEL,
} from '../src/data/balance';
import {
  CROP_IDS,
  FISH_IDS,
  RECIPE_IDS,
  seedOf,
  type ItemId,
  type SeasonId,
  type SkillId,
} from '../src/data/ids';
import { BUNDLES, BUNDLE_IDS, GOAL_TEMPLATES, MILESTONES } from '../src/data/quests';
import { SKILL_IDS, SKILL_PERKS } from '../src/data/skills';
import { buffSlotCount, dishBuff } from '../src/systems/buffs';
import { bundleBonuses, donate, isBundleDone } from '../src/systems/bundles';
import { cancelCooking, startCooking } from '../src/systems/cooking';
import { harvestOne, isReady } from '../src/systems/farming';
import { startReel } from '../src/systems/fishing';
import { addItem, countItem } from '../src/systems/inventory';
import { maxTraps, nextTrapSpot } from '../src/systems/locations';
import { unitPrice } from '../src/systems/market';
import { computeModifiers } from '../src/systems/modifiers';
import { areaOf, coverageOf, placeObject, stockOf } from '../src/systems/placement';
import {
  cookingXp,
  describeUnlocks,
  fishingXp,
  goalAchievable,
  goalTarget,
  goalText,
  grantXp,
  niceTarget,
  refillGoals,
  revalidateGoals,
  rewardsText,
  runProgression,
} from '../src/systems/progression';
import {
  earnedFarmLevel,
  farmPoints,
  levelForXp,
  perkTotals,
  pointsForFarmLevel,
  skillLevel,
  xpForLevel,
  xpToNext,
} from '../src/systems/skills';
import { msToNextSimEvent, onDayStarted, onSeasonChanged } from '../src/systems';
import { buySeeds, seedStock } from '../src/systems/shop';
import { tickTraps, trapCapacity, TRAP_INTERVAL_MS } from '../src/systems/traps';
import { buyUpgrade, requirementsFor } from '../src/systems/upgrades';
import { buyExpansion } from '../src/systems/expansions';
import { farmLevel, isUnlocked, unlockHint } from '../src/systems/unlocks';
import { createRng } from '../src/core/rng';
import { at, DATA_NO_PERKS, HOUR, NY, setFarmLevel } from './helpers';

const CREATED = at(NY, 2026, 1, 7, 10); // Wednesday; spring until Sunday 11 Jan, then summer, autumn (18 Jan), winter (25 Jan)
const NOON = at(NY, 2026, 1, 7, 12);
const SUMMER = at(NY, 2026, 1, 12, 12);
const WINTER = at(NY, 2026, 1, 28, 12);
const MIN = 60_000;

function farm(seed = 1, t = NOON): GameState {
  const s = createInitialState(CREATED, NY, seed);
  processCalendar(s, GAME_DATA, NY, t, []);
  return s;
}

function ctxAt(s: GameState, t = NOON, events: GameEvent[] = [], data: GameData = GAME_DATA) {
  return makeContext(s, data, buildCalendar(t, s.calendar, NY), events);
}

/** Sets a skill to exactly `level` (its XP to the level's threshold). */
function setLevel(s: GameState, skill: SkillId, level: number): void {
  s.progression.skills[skill].xp = xpForLevel(level);
}

/** Runs progression over some events, as the simulation does at the end of a step. */
function feed(s: GameState, events: GameEvent[], t = NOON): GameEvent[] {
  const out: GameEvent[] = [...events];
  const ctx = ctxAt(s, t, out);
  runProgression(s, ctx);
  return out;
}

const harvested = (crop: 'turnip' | 'potato' | 'pumpkin', qty: number): GameEvent => ({
  type: 'harvested',
  crop,
  qty,
  plot: 0,
  auto: false,
  shipped: 0,
});

describe('the XP curve (BALANCE.md §8)', () => {
  it('needs round(150 × 1.5^(L − 1)) XP per level: 150 … 3844, 11233 in all (BALANCE.md §8, tuned in phase 07)', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9].map(xpToNext)).toEqual([
      150, 225, 338, 506, 759, 1139, 1709, 2563, 3844,
    ]);
    expect([2, 3, 4, 5, 6, 7, 8, 9, 10].map(xpForLevel)).toEqual([
      150, 375, 713, 1219, 1978, 3117, 4826, 7389, 11233,
    ]);
    expect(xpForLevel(1)).toBe(0);
  });

  it('turns XP into levels 1 to 10 and stops there', () => {
    expect(levelForXp(0)).toBe(1);
    expect(levelForXp(149)).toBe(1);
    expect(levelForXp(150)).toBe(2);
    expect(levelForXp(374)).toBe(2);
    expect(levelForXp(375)).toBe(3);
    expect(levelForXp(11232)).toBe(9);
    expect(levelForXp(11233)).toBe(MAX_SKILL_LEVEL);
    expect(levelForXp(1_000_000)).toBe(MAX_SKILL_LEVEL);
    for (let l = 1; l <= MAX_SKILL_LEVEL; l++) expect(levelForXp(xpForLevel(l))).toBe(l);
  });

  it('is monotonic (a level never drops as XP grows)', () => {
    let last = 1;
    for (let xp = 0; xp < 5000; xp += 7) {
      const l = levelForXp(xp);
      expect(l).toBeGreaterThanOrEqual(last);
      last = l;
    }
  });
});

describe('XP from events', () => {
  it('Farming: the crop XP of every harvested unit (BALANCE.md §2 table)', () => {
    const s = farm();
    feed(s, [harvested('turnip', 3), harvested('potato', 2)]);
    expect(s.progression.skills.farming.xp).toBe(
      3 * GAME_DATA.crops.turnip.xp + 2 * GAME_DATA.crops.potato.xp,
    );
    expect(s.progression.skills.fishing.xp).toBe(0);
  });

  it('Farming XP follows the crop formula max(1, round(price^0.6 / 2)) for every crop', () => {
    for (const id of CROP_IDS) {
      const c = GAME_DATA.crops[id];
      expect(c.xp, id).toBe(Math.max(1, Math.round(c.basePrice ** 0.6 / 2)));
    }
  });

  it('Fishing: 6 / 14 / 30 / 100 by rarity plus floor(difficulty / 10), junk 2, half for a trap catch', () => {
    for (const id of FISH_IDS) {
      const f = GAME_DATA.fish[id];
      const base =
        { common: 6, uncommon: 14, rare: 30, legendary: 100 }[f.rarity] + Math.floor(f.difficulty / 10);
      expect(fishingXp(GAME_DATA, id), id).toBe(base);
      const s = farm();
      feed(s, [{ type: 'caught', catch: id, sizeCm: 10, location: f.location, viaTrap: false }]);
      expect(s.progression.skills.fishing.xp).toBe(base);
      const t = farm();
      feed(t, [{ type: 'caught', catch: id, sizeCm: 10, location: f.location, viaTrap: true }]);
      expect(t.progression.skills.fishing.xp).toBe(Math.floor(base / 2));
    }
    expect(fishingXp(GAME_DATA, 'old_boot')).toBe(2);
  });

  it('Cooking: round(8 × tier^1.5) = 8, 23, 42, 64', () => {
    expect([1, 2, 3, 4].map(cookingXp)).toEqual([8, 23, 42, 64]);
    expect(cookingXp(1)).toBe(COOKING_XP_BASE);
    const s = farm();
    feed(s, [{ type: 'cooked', recipe: 'vegetable_soup', tier: 2, hearty: false }]);
    expect(s.progression.skills.cooking.xp).toBe(23);
  });

  it("the Scholar's Snack buff (xpModifier) scales every skill's XP", () => {
    const s = farm();
    s.buffs.active.push({
      type: 'xp',
      magnitude: 0.3,
      tier: 2,
      remainingMs: 10 * MIN,
      source: 'blueberry_muffin',
    });
    const events: GameEvent[] = [harvested('turnip', 10)];
    runProgression(s, ctxAt(s, NOON, events));
    expect(s.progression.skills.farming.xp).toBe(Math.round(30 * 1.3));
  });

  it('Cooking XP is +50% in winter, and only Cooking', () => {
    const s = farm(1, WINTER);
    const events: GameEvent[] = [
      { type: 'cooked', recipe: 'vegetable_soup', tier: 2, hearty: true },
      harvested('turnip', 10),
    ];
    runProgression(s, ctxAt(s, WINTER, events));
    expect(s.progression.skills.cooking.xp).toBe(Math.round(23 * 1.5));
    expect(s.progression.skills.farming.xp).toBe(30);
    const t = farm(1, NOON);
    feed(t, [{ type: 'cooked', recipe: 'vegetable_soup', tier: 2, hearty: false }]);
    expect(t.progression.skills.cooking.xp).toBe(23);
  });

  it('emits one levelUp per level gained, even for a big jump', () => {
    const s = farm();
    const events: GameEvent[] = [];
    const ctx = ctxAt(s, NOON, events);
    grantXp(s, ctx, 'farming', 400); // 150 for level 2, 375 for level 3
    expect(events.filter((e) => e.type === 'levelUp')).toEqual([
      { type: 'levelUp', skill: 'farming', level: 2 },
      { type: 'levelUp', skill: 'farming', level: 3 },
    ]);
    expect(skillLevel(s, 'farming')).toBe(3);
  });
});

describe('level perks (BALANCE.md §8)', () => {
  const totalsAt = (skill: SkillId, level: number) => {
    const s = farm();
    setLevel(s, skill, level);
    return perkTotals(s, GAME_DATA);
  };

  it('has a shown perk for levels 2 to 10 of every skill', () => {
    for (const skill of SKILL_IDS) {
      const levels = SKILL_PERKS.filter((p) => p.skill === skill).map((p) => p.level);
      expect(levels).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10]);
      for (const p of SKILL_PERKS.filter((x) => x.skill === skill)) expect(p.text.length).toBeGreaterThan(3);
    }
  });

  it('Farming totals: sell +5/10/15%, growth +5/10/15%, double harvest 5/10/15%', () => {
    expect(totalsAt('farming', 1)).toMatchObject({ cropSell: 0, growth: 0, doubleHarvestChance: 0 });
    expect(totalsAt('farming', 2)).toMatchObject({ cropSell: 0.05, growth: 0 });
    expect(totalsAt('farming', 3).growth).toBe(0.05);
    expect(totalsAt('farming', 4).doubleHarvestChance).toBe(0.05);
    expect(totalsAt('farming', 5).growth).toBe(0.1);
    expect(totalsAt('farming', 6).cropSell).toBe(0.1);
    expect(totalsAt('farming', 7).doubleHarvestChance).toBe(0.1);
    expect(totalsAt('farming', 8).growth).toBe(0.15);
    expect(totalsAt('farming', 9).cropSell).toBe(0.15);
    expect(totalsAt('farming', 10)).toMatchObject({
      cropSell: 0.15,
      growth: 0.15,
      doubleHarvestChance: 0.15,
    });
  });

  it('Fishing totals: reel zone +5/15/25%, luck, traps +1 then +2, fish sell +10%', () => {
    expect(totalsAt('fishing', 2).reelZone).toBe(0.05);
    expect(totalsAt('fishing', 3).luck).toBe(0.05);
    expect(totalsAt('fishing', 4).trapCapacity).toBe(1);
    expect(totalsAt('fishing', 5).reelZone).toBeCloseTo(0.15, 10);
    expect(totalsAt('fishing', 7).trapCapacity).toBe(2);
    expect(totalsAt('fishing', 8).reelZone).toBeCloseTo(0.25, 10);
    expect(totalsAt('fishing', 9).luck).toBeCloseTo(0.3, 10);
    expect(totalsAt('fishing', 9).fishSell).toBe(0);
    expect(totalsAt('fishing', 10).fishSell).toBe(0.1);
  });

  it('Cooking totals: speed +10/20%, dish price +5/10%, buff duration +10/20%, save chance 10/20%, +1 slot', () => {
    expect(totalsAt('cooking', 2).cookSpeed).toBe(0.1);
    expect(totalsAt('cooking', 3).dishSell).toBe(0.05);
    expect(totalsAt('cooking', 4).buffDuration).toBe(0.1);
    expect(totalsAt('cooking', 5).ingredientSaveChance).toBe(0.1);
    expect(totalsAt('cooking', 6).cookSpeed).toBe(0.2);
    expect(totalsAt('cooking', 6).buffSlots).toBe(0);
    expect(totalsAt('cooking', 7).buffSlots).toBe(1);
    expect(totalsAt('cooking', 8).buffDuration).toBe(0.2);
    expect(totalsAt('cooking', 9).dishSell).toBe(0.1);
    expect(totalsAt('cooking', 10).ingredientSaveChance).toBe(0.2);
  });

  it('reach the modifiers the systems read', () => {
    const s = farm();
    setLevel(s, 'farming', 5);
    setLevel(s, 'fishing', 6);
    setLevel(s, 'cooking', 4);
    const m = computeModifiers(s, GAME_DATA, 'spring');
    expect(m.growthModifier).toBeCloseTo(1.1, 10);
    expect(m.cropSellBonus).toBe(0.05);
    expect(m.fishingLuckModifier).toBeCloseTo(0.15, 10);
    expect(m.reelZoneBonus).toBeCloseTo(0.15, 10);
    expect(m.trapCapacityBonus).toBe(1);
    expect(m.cookSpeedModifier).toBeCloseTo(1.1, 10);
    expect(m.buffDurationBonus).toBe(0.1);
  });

  it('crop, fish and dish sell prices follow their perks', () => {
    const s = farm();
    s.market.specials = [];
    const price = (item: ItemId) =>
      unitPrice(s, GAME_DATA, computeModifiers(s, GAME_DATA, 'spring'), item, 1);
    const before = { turnip: price('turnip'), koi: price('koi'), soup: price('vegetable_soup') };
    setLevel(s, 'farming', 2);
    expect(price('turnip')).toBe(Math.floor(GAME_DATA.items.turnip!.basePrice * 1.05));
    setLevel(s, 'fishing', 10);
    expect(price('koi')).toBe(Math.floor(before.koi * 1.1));
    setLevel(s, 'cooking', 3);
    expect(price('vegetable_soup')).toBe(Math.floor(before.soup * 1.05));
    expect(price('koi')).toBeGreaterThan(before.koi);
  });

  it('Farming: a double harvest doubles the yield with the perk chance', () => {
    const always: GameData = {
      ...GAME_DATA,
      perks: [
        { skill: 'farming', level: 2, text: 'test', effect: { kind: 'doubleHarvestChance', chance: 1 } },
      ],
    };
    const s = farm();
    setLevel(s, 'farming', 2);
    s.farm.plots[0] = { ...emptyPlot('planted'), crop: 'potato', growthMs: 999_999 };
    const events: GameEvent[] = [];
    const ctx = ctxAt(s, NOON, events, always);
    expect(isReady(s.farm.plots[0]!, always)).toBe(true);
    expect(harvestOne(s, ctx, 0, false)).toBe('harvested');
    const got = events.find((e) => e.type === 'harvested');
    expect(got && got.type === 'harvested' && got.qty % 2).toBe(0); // 2 or 4: never the plain 1 or 2 alone
    expect(got && got.type === 'harvested' && got.qty).toBeGreaterThanOrEqual(2);
    // Without the perk the yield is the plain 1 to 2, and the RNG is not touched extra.
    const t = farm();
    t.farm.plots[0] = { ...emptyPlot('planted'), crop: 'potato', growthMs: 999_999 };
    const before = t.rngState;
    harvestOne(t, ctxAt(t), 0, false);
    expect(t.rngState).not.toBe(before); // the yield roll
  });

  it('Fishing: the reel zone grows with the perk', () => {
    const s = farm();
    const ctx0 = ctxAt(s);
    const base = startReel(s, ctx0, 'koi').zoneWidth;
    setLevel(s, 'fishing', 5); // +5% then +10%
    const ctx1 = ctxAt(s);
    expect(startReel(s, ctx1, 'koi').zoneWidth).toBeCloseTo(base * 1.15, 10);
  });

  it('Fishing: traps hold one more at level 4 and two more at level 7', () => {
    const s = farm();
    s.upgrades.fish_trap = 1;
    expect(trapCapacity(computeModifiers(s, GAME_DATA))).toBe(5);
    setLevel(s, 'fishing', 4);
    expect(trapCapacity(computeModifiers(s, GAME_DATA))).toBe(6);
    setLevel(s, 'fishing', 7);
    expect(trapCapacity(computeModifiers(s, GAME_DATA))).toBe(7);
    s.fishing.traps.push({ id: 1, location: 'pond', slot: 0, progressMs: 0, contents: [] });
    tickTraps(s, ctxAt(s), 20 * TRAP_INTERVAL_MS);
    expect(s.fishing.traps[0]!.contents.reduce((n, c) => n + c.qty, 0)).toBe(7);
  });

  it('Cooking: speed and buff duration', () => {
    const s = farm();
    setLevel(s, 'cooking', 4);
    const m = computeModifiers(s, GAME_DATA);
    expect(m.cookSpeedModifier).toBeCloseTo(1.1, 10);
    const buff = dishBuff(GAME_DATA, 'vegetable_soup', false, m.buffDurationBonus);
    expect(buff.durationMs).toBe(Math.round(45 * MIN * 1.1));
  });

  it('Cooking level 7: a fourth buff slot; the Cozy Dinner bundle a fifth; never more than 5', () => {
    const s = farm();
    expect(buffSlotCount(s, GAME_DATA)).toBe(3);
    setLevel(s, 'cooking', 7);
    expect(buffSlotCount(s, GAME_DATA)).toBe(4);
    s.progression.completedBundles.push('cozy_dinner');
    expect(buffSlotCount(s, GAME_DATA)).toBe(5);
    s.buffs.baseSlots = 9;
    expect(buffSlotCount(s, GAME_DATA)).toBe(5);
  });

  it('Cooking level 5: a chance to save an ingredient, and cancelling gives back only what was used', () => {
    const always: GameData = {
      ...GAME_DATA,
      perks: [
        { skill: 'cooking', level: 2, text: 'test', effect: { kind: 'ingredientSaveChance', chance: 1 } },
      ],
    };
    const s = farm();
    setLevel(s, 'cooking', 2);
    addItem(s.inventory, 'turnip', 2);
    const ctx = ctxAt(s, NOON, [], always);
    expect(startCooking(s, ctx, 'roasted_turnip')).toEqual({ ok: true });
    expect(countItem(s.inventory, 'turnip')).toBe(1); // one turnip was never taken
    expect(s.kitchen.queue[0]!.saved).toBe('turnip');
    expect(cancelCooking(s, ctx, 0)).toEqual({ ok: true });
    expect(countItem(s.inventory, 'turnip')).toBe(2); // and none is conjured on cancel
  });
});

describe('the Farm Level (BALANCE.md §8–9)', () => {
  it('comes from points = Σ(skill level − 1) + milestones, by the table in balance.ts', () => {
    const s = farm();
    expect(farmPoints(s)).toBe(0);
    expect(farmLevel(s)).toBe(1);
    setLevel(s, 'farming', 2);
    expect(farmLevel(s)).toBe(1);
    setLevel(s, 'fishing', 2);
    expect(farmPoints(s)).toBe(2);
    expect(farmLevel(s)).toBe(2);
    s.progression.milestones.done.push('m01_first_seed', 'm02_first_harvest', 'm03_first_sale');
    expect(farmPoints(s)).toBe(5);
    expect(farmLevel(s)).toBe(3); // the five farming milestones alone are Level 3
    for (const skill of SKILL_IDS) setLevel(s, skill, 10);
    s.progression.milestones.done = MILESTONES.map((m) => m.id as never);
    expect(farmPoints(s)).toBe(27 + 15);
    expect(farmLevel(s)).toBe(FARM_LEVEL_MAX);
  });

  it("every level needs more points than the last, and Level 3 is a farmer's five milestones", () => {
    expect(FARM_LEVEL_POINTS).toHaveLength(FARM_LEVEL_MAX + 1);
    expect(FARM_LEVEL_MAX).toBe(10);
    for (let l = 2; l <= FARM_LEVEL_MAX; l++)
      expect(pointsForFarmLevel(l)).toBeGreaterThan(pointsForFarmLevel(l - 1));
    expect(pointsForFarmLevel(3)).toBeLessThanOrEqual(5);
    expect(pointsForFarmLevel(FARM_LEVEL_MAX)).toBeLessThanOrEqual(27 + 15); // reachable
    expect(pointsForFarmLevel(FARM_LEVEL_MAX + 2)).toBe(pointsForFarmLevel(FARM_LEVEL_MAX) + 10);
    for (let l = 1; l <= FARM_LEVEL_MAX; l++) {
      const s = farm();
      s.progression.milestones.done = MILESTONES.slice(0, 15).map((m) => m.id as never);
      // Spread the rest over the skills.
      let left = Math.max(0, pointsForFarmLevel(l) - 15);
      for (const skill of SKILL_IDS) {
        const give = Math.min(9, left);
        setLevel(s, skill, 1 + give);
        left -= give;
      }
      const at = farmPoints(s);
      if (at >= pointsForFarmLevel(l)) expect(earnedFarmLevel(s), `points ${at}`).toBeGreaterThanOrEqual(l);
    }
  });

  it('never drops below the level an older save carried (the floor)', () => {
    const s = farm();
    setFarmLevel(s, 6);
    expect(farmLevel(s)).toBe(6);
    expect(earnedFarmLevel(s)).toBe(1);
    for (const skill of SKILL_IDS) setLevel(s, skill, 10); // 27 points: level 8
    expect(farmLevel(s)).toBe(8);
    expect(earnedFarmLevel(s)).toBe(8);
    setFarmLevel(s, 12); // an old save's level can be past the table, and stays
    expect(farmLevel(s)).toBe(12);
  });

  it('is announced with what it opens, and only when it rises', () => {
    const s = farm();
    s.progression.goals = [];
    const events: GameEvent[] = [harvested('turnip', 134)]; // 402 Farming XP: level 3 = 2 points = Farm Level 2
    runProgression(s, ctxAt(s, NOON, events));
    const unlocked = events.filter((e) => e.type === 'unlocked');
    expect(events).toContainEqual({ type: 'farmLevelUp', level: 2 });
    expect(unlocked).toContainEqual({
      type: 'unlocked',
      what: 'New seeds in the shop: Garlic, Kale and Leek!',
      panel: 'shop',
    });
    expect(unlocked.map((u) => (u.type === 'unlocked' ? u.what : ''))).toContain(
      'New recipe cards in the shop: Berry Bowl!',
    );
    const again: GameEvent[] = [];
    runProgression(s, ctxAt(s, NOON, again));
    expect(again).toEqual([]);
  });

  it('describeUnlocks lists what each Farm Level opens (BALANCE.md §9)', () => {
    const text = (from: number, to: number) =>
      describeUnlocks(GAME_DATA, from, to)
        .map((u) => u.what)
        .join(' | ');
    expect(text(1, 2)).toMatch(/Garlic, Kale and Leek/);
    expect(text(2, 3)).toMatch(/Strawberry and Blueberry/);
    expect(text(2, 3)).toMatch(/Farmhand/);
    expect(text(2, 3)).toMatch(/River Access/);
    expect(text(3, 4)).toMatch(/Cauliflower, Corn and Cranberry/);
    expect(text(5, 6)).toMatch(/Melon and Pumpkin/);
    expect(text(5, 6)).toMatch(/Old Dock/);
    expect(text(0, 0)).toBe('');
  });
});

describe('the unlock gating matrix (BALANCE.md §9)', () => {
  /** Farm Level → what unlocks there, from the docs. */
  const SEEDS: Record<number, string[]> = {
    1: ['turnip', 'potato', 'wheat', 'tomato', 'yam'],
    2: ['garlic', 'kale', 'leek'],
    3: ['strawberry', 'blueberry'],
    4: ['cauliflower', 'corn', 'cranberry'],
    6: ['melon', 'pumpkin'],
  };

  it('every seed is locked below its Farm Level and open at it', () => {
    for (const [level, crops] of Object.entries(SEEDS)) {
      for (const crop of crops) {
        const need = Number(level);
        const def = GAME_DATA.crops[crop as (typeof CROP_IDS)[number]];
        const s = farm();
        setFarmLevel(s, need - 1);
        if (need > 1) {
          expect(isUnlocked(s, def.unlock), `${crop} below`).toBe(false);
          expect(unlockHint(s, GAME_DATA, def.unlock), crop).toMatch(new RegExp(`Farm Level ${need}`));
        }
        setFarmLevel(s, need);
        expect(isUnlocked(s, def.unlock), `${crop} at`).toBe(true);
      }
    }
    const all = Object.values(SEEDS).flat();
    expect(all.sort()).toEqual([...CROP_IDS].sort());
  });

  it('the shop marks a locked seed and refuses to sell it until the level is reached', () => {
    const s = farm(1, SUMMER); // summer stocks tomato, blueberry, corn, melon, wheat …
    s.gold = 10_000;
    const stock = seedStock(s, GAME_DATA, 'summer');
    for (const e of stock) expect(e.unlocked, e.crop).toBe(isUnlocked(s, GAME_DATA.crops[e.crop].unlock));
    const melon = stock.find((e) => e.crop === 'melon')!;
    expect(melon.unlocked).toBe(false);
    expect(buySeeds(s, ctxAt(s, SUMMER), 'melon', 1).ok).toBe(false);
    setFarmLevel(s, 6);
    expect(buySeeds(s, ctxAt(s, SUMMER), 'melon', 1)).toEqual({ ok: true });
  });

  it('recipe cards, expansions and upgrades follow the table', () => {
    const at5 = farm();
    setFarmLevel(at5, 4);
    expect(isUnlocked(at5, [{ kind: 'farmLevel', level: 5 }])).toBe(false);
    const cards: Record<string, number> = {
      wheat_flatbread: 1,
      berry_bowl: 2,
      tomato_pasta: 3,
      blueberry_muffin: 3,
      catfish_gumbo: 5,
      pumpkin_soup: 6,
      harvest_feast: 6,
    };
    for (const [id, level] of Object.entries(cards)) {
      const d = GAME_DATA.recipes[id as (typeof RECIPE_IDS)[number]].discovery;
      expect(d.kind).toBe('card');
      if (d.kind !== 'card') continue;
      expect(d.unlock).toContainEqual({ kind: 'farmLevel', level });
      const s = farm();
      setFarmLevel(s, level - 1);
      expect(isUnlocked(s, d.unlock), `${id} below`).toBe(level === 1);
      setFarmLevel(s, level);
      expect(isUnlocked(s, d.unlock), `${id} at`).toBe(true);
    }
    expect(GAME_DATA.expansions.river.requires).toContainEqual({ kind: 'farmLevel', level: 3 });
    expect(GAME_DATA.expansions.farm_3.requires).toContainEqual({ kind: 'farmLevel', level: 3 });
    expect(GAME_DATA.expansions.ocean.requires).toContainEqual({ kind: 'farmLevel', level: 6 });
    expect(GAME_DATA.expansions.farm_4.requires).toContainEqual({ kind: 'farmLevel', level: 6 });
    expect(requirementsFor(GAME_DATA.upgrades.sprinkler_tech!, 0)).toContainEqual({
      kind: 'farmLevel',
      level: 4,
    });
    expect(requirementsFor(GAME_DATA.upgrades.sprinkler_tech!, 1)).toContainEqual({
      kind: 'farmLevel',
      level: 7,
    });
    expect(GAME_DATA.upgrades.farmhand!.requires).toContainEqual({ kind: 'farmLevel', level: 3 });
    expect(GAME_DATA.upgrades.barn_storage!.requires).toContainEqual({ kind: 'farmLevel', level: 2 });
  });

  it('the river opens with Farm Level 3, the greenhouse also needs its bundle', () => {
    const s = farm();
    s.gold = 1_000_000;
    const ctx = ctxAt(s);
    expect(buyExpansion(s, ctx, 'river').ok).toBe(false);
    setFarmLevel(s, 3);
    expect(buyExpansion(s, ctx, 'river')).toEqual({ ok: true });
    setFarmLevel(s, 10);
    for (const id of ['farm_1', 'farm_2', 'farm_3'] as const) buyExpansion(s, ctx, id);
    expect(buyUpgrade(s, ctx, 'greenhouse').ok).toBe(false);
    s.progression.completedBundles.push('autumn_harvest');
    expect(buyUpgrade(s, ctx, 'greenhouse')).toEqual({ ok: true });
  });

  it('skill, milestone and bundle conditions are real (they used to read as never or always met)', () => {
    const s = farm();
    expect(isUnlocked(s, [{ kind: 'skillLevel', skill: 'fishing', level: 3 }])).toBe(false);
    setLevel(s, 'fishing', 3);
    expect(isUnlocked(s, [{ kind: 'skillLevel', skill: 'fishing', level: 3 }])).toBe(true);
    expect(isUnlocked(s, [{ kind: 'milestone', id: 'm03_first_sale' }])).toBe(false);
    s.progression.milestones.done.push('m03_first_sale');
    expect(isUnlocked(s, [{ kind: 'milestone', id: 'm03_first_sale' }])).toBe(true);
    expect(isUnlocked(s, [{ kind: 'bundle', id: 'pond_fish' }])).toBe(false);
    s.progression.completedBundles.push('pond_fish');
    expect(isUnlocked(s, [{ kind: 'bundle', id: 'pond_fish' }])).toBe(true);
  });
});

describe('milestones', () => {
  it('are the 15 of BALANCE.md followed by the v2-02 ones, in order, each with a warm line and a reward', () => {
    expect(MILESTONES.map((m) => m.id)).toEqual([
      'm01_first_seed',
      'm02_first_harvest',
      'm03_first_sale',
      'm04_first_expansion',
      'm05_first_sprinkler',
      'm06_first_catch',
      'm07_first_dish',
      'm08_first_buff',
      'm09_hire_farmhand',
      'm10_unlock_river',
      'm11_farm_level_5',
      'm12_cook_t3',
      'm13_unlock_ocean',
      'm14_first_bundle',
      'm15_greenhouse',
      'm16_first_parcel',
      'm17_first_decor',
      'm18_charm_25',
      'm19_first_project',
      'm23_charm_100',
    ]);
    for (const m of MILESTONES) {
      expect(m.flavor.length, m.id).toBeGreaterThan(20);
      expect(m.rewards.length, m.id).toBeGreaterThan(0);
      const o = m.objective;
      if ('count' in o) expect(o.count, m.id).toBe(1); // one-shot: a single event completes it
    }
  });

  it('every recipe with a milestone discovery is the reward of that milestone', () => {
    for (const id of RECIPE_IDS) {
      const d = GAME_DATA.recipes[id].discovery;
      if (d.kind !== 'milestone') continue;
      const m = MILESTONES.find((x) => x.id === d.id)!;
      expect(m.rewards, id).toContainEqual({ kind: 'recipe', id });
    }
  });

  /** The event that completes each milestone, and what it pays. */
  const TRIGGERS: [string, GameEvent, (s: GameState) => void][] = [
    ['m01_first_seed', { type: 'planted', crop: 'turnip', plots: [0] }, () => {}],
    ['m02_first_harvest', harvested('turnip', 1), () => {}],
    ['m03_first_sale', { type: 'sold', item: 'turnip', qty: 1, gold: 20, via: 'market' }, () => {}],
    ['m04_first_expansion', { type: 'purchased', what: 'farm_1', gold: 400 }, () => {}],
    ['m05_first_sprinkler', { type: 'placed', kind: 'sprinkler', col: 0, row: 0 }, () => {}],
    [
      'm06_first_catch',
      { type: 'caught', catch: 'bluegill', sizeCm: 12, location: 'pond', viaTrap: false },
      () => {},
    ],
    ['m07_first_dish', { type: 'cooked', recipe: 'roasted_turnip', tier: 1, hearty: false }, () => {}],
    ['m08_first_buff', { type: 'ate', recipe: 'roasted_turnip', buff: 'growth', hearty: false }, () => {}],
    [
      'm09_hire_farmhand',
      { type: 'purchased', what: 'farmhand', gold: 800 },
      (s) => void (s.upgrades.farmhand = 1),
    ],
    ['m10_unlock_river', { type: 'purchased', what: 'river', gold: 2000 }, () => {}],
    ['m12_cook_t3', { type: 'cooked', recipe: 'seafood_stew', tier: 3, hearty: false }, () => {}],
    ['m13_unlock_ocean', { type: 'purchased', what: 'ocean', gold: 8000 }, () => {}],
    ['m14_first_bundle', { type: 'bundleCompleted', bundle: 'pond_fish' }, () => {}],
    [
      'm15_greenhouse',
      { type: 'purchased', what: 'greenhouse', gold: 25000 },
      (s) => void (s.upgrades.greenhouse = 1),
    ],
  ];

  it.each(TRIGGERS)('%s completes from its event and pays its reward', (id, event, setup) => {
    const s = farm();
    s.progression.goals = []; // keep the goal board out of the way
    setup(s);
    const gold = s.gold;
    const seedsBefore = countItem(s.inventory, 'seed_turnip') + countItem(s.inventory, 'seed_potato');
    const out = feed(s, [event]);
    expect(s.progression.milestones.done, id).toContain(id);
    const m = MILESTONES.find((x) => x.id === id)!;
    for (const r of m.rewards) {
      if (r.kind === 'gold') expect(s.gold - gold, id).toBeGreaterThanOrEqual(r.amount);
      if (r.kind === 'recipe') expect(s.kitchen.known, id).toContain(r.id);
      if (r.kind === 'items') {
        const after = countItem(s.inventory, 'seed_turnip') + countItem(s.inventory, 'seed_potato');
        expect(after - seedsBefore, id).toBe(r.items[0]!.qty);
      }
    }
    expect(out.filter((e) => e.type === 'questDone' && e.id === id)).toHaveLength(1);
  });

  it('m11 completes on reaching Farm Level 5, by state rather than by an event', () => {
    const s = farm();
    s.progression.goals = [];
    for (const skill of SKILL_IDS) setLevel(s, skill, 4); // 9 points
    s.progression.milestones.done.push('m01_first_seed', 'm03_first_sale'); // 11 points: level 5
    expect(farmLevel(s)).toBe(5);
    feed(s, [{ type: 'buffExpired', buff: 'growth' }]); // any event lets progression settle
    expect(s.progression.milestones.done).toContain('m11_farm_level_5');
    expect(s.kitchen.known).toContain('scholars_stew');
  });

  it('m11 chains: a milestone that raises the Farm Level can complete another', () => {
    const s = farm();
    s.progression.goals = [];
    for (const skill of SKILL_IDS) setLevel(s, skill, 3); // 6 points
    s.progression.milestones.done.push(
      'm01_first_seed',
      'm03_first_sale',
      'm04_first_expansion',
      'm05_first_sprinkler',
    ); // 10: level 4
    expect(farmLevel(s)).toBe(4);
    const out = feed(s, [harvested('turnip', 1)]); // m02 -> 11 points -> level 5 -> m11
    expect(s.progression.milestones.done).toEqual([
      'm01_first_seed',
      'm03_first_sale',
      'm04_first_expansion',
      'm05_first_sprinkler',
      'm02_first_harvest',
      'm11_farm_level_5',
    ]);
    expect(out).toContainEqual({ type: 'farmLevelUp', level: 5 });
  });

  it('a T3 dish completes both "cook a dish" and "cook a T3 dish"; each only once', () => {
    const s = farm();
    s.progression.goals = [];
    feed(s, [{ type: 'cooked', recipe: 'seafood_stew', tier: 3, hearty: false }]);
    expect(s.progression.milestones.done).toEqual(['m07_first_dish', 'm12_cook_t3']);
    const again = feed(s, [{ type: 'cooked', recipe: 'seafood_stew', tier: 3, hearty: false }]);
    expect(again.filter((e) => e.type === 'questDone')).toEqual([]);
  });

  it('can be done in any order, and junk is not a fish', () => {
    const s = farm();
    s.progression.goals = [];
    feed(s, [{ type: 'purchased', what: 'river', gold: 2000 }]);
    expect(s.progression.milestones.done).toEqual(['m10_unlock_river']);
    feed(s, [{ type: 'caught', catch: 'old_boot', sizeCm: 0, location: 'pond', viaTrap: false }]);
    expect(s.progression.milestones.done).toEqual(['m10_unlock_river']);
    feed(s, [{ type: 'caught', catch: 'carp', sizeCm: 5, location: 'pond', viaTrap: true }]);
    expect(s.progression.milestones.done).toContain('m06_first_catch');
  });

  it('are driven by real actions and steps, not only by events pushed by hand', () => {
    const s = farm();
    s.progression.goals = [];
    const events: GameEvent[] = [];
    const ctx = ctxAt(s, NOON, events);
    expect(applyAction(s, ctx, { type: 'plant', crop: 'turnip', plots: [0] })).toEqual({ ok: true });
    expect(applyAction(s, ctx, { type: 'water', plots: [0] })).toEqual({ ok: true });
    expect(s.progression.milestones.done).toContain('m01_first_seed');
    step(s, ctx, 121_000);
    expect(applyAction(s, ctx, { type: 'harvest', plots: [0] })).toEqual({ ok: true });
    expect(s.progression.milestones.done).toContain('m02_first_harvest');
    expect(s.progression.skills.farming.xp).toBeGreaterThanOrEqual(GAME_DATA.crops.turnip.xp);
    addItem(s.inventory, 'turnip', 1);
    expect(applyAction(s, ctx, { type: 'sell', item: 'turnip', qty: 1 })).toEqual({ ok: true });
    expect(s.progression.milestones.done).toContain('m03_first_sale');
  });

  it('do not double-count when several contexts share one event log (a frame with a calendar step and ticks)', () => {
    const s = farm();
    s.progression.goals = [];
    const events: GameEvent[] = [harvested('turnip', 4)];
    runProgression(s, ctxAt(s, NOON, events));
    runProgression(s, ctxAt(s, NOON, events)); // a second context over the same array
    step(s, ctxAt(s, NOON, events), 100);
    expect(s.progression.skills.farming.xp).toBe(4 * GAME_DATA.crops.turnip.xp);
  });
});

/** What a brand-new farm can be asked for: its crops, its pond, and the three starter recipes. */
const START_TEMPLATES = ['harvest_crop', 'harvest_any', 'catch_fish', 'cook_distinct', 'eat_dish'];

describe('the goal board', () => {
  it('has 10 templates, each with a warm line', () => {
    expect(Object.keys(GOAL_TEMPLATES)).toHaveLength(10);
    for (const t of Object.values(GOAL_TEMPLATES)) expect(t.flavor.length, t.id).toBeGreaterThan(10);
  });

  it('a new farm opens with three goals it can do right away', () => {
    const s = createInitialState(CREATED, NY, 7);
    expect(s.progression.goals).toHaveLength(GOAL_SLOTS);
    for (const g of s.progression.goals) {
      expect(START_TEMPLATES).toContain(g.template);
      expect(goalAchievable(s, GAME_DATA, 'spring', g), g.template).toBe(true);
    }
    // Three different goals, not the same one three times.
    expect(new Set(s.progression.goals.map((g) => `${g.template}${JSON.stringify(g.objective)}`)).size).toBe(
      3,
    );
  });

  /** A farm at some stage of the game: level, expansions, recipes, fish and season. */
  function stage(seed: number, level: number, season: SeasonId): GameState {
    const s = createInitialState(CREATED, NY, seed);
    setFarmLevel(s, level);
    if (level >= 2) s.expansions.push('farm_1');
    if (level >= 3) s.expansions.push('river');
    if (level >= 6) s.expansions.push('ocean');
    if (level >= 4) s.kitchen.known.push('vegetable_soup', 'tomato_pasta', 'seafood_stew', 'cranberry_pie');
    if (level >= 5) s.stats.fishCaught = 6;
    if (level >= 3) s.progression.milestones.done.push('m03_first_sale');
    if (level >= 8) setLevel(s, 'fishing', 7);
    if (level >= 12) s.farm.greenhouse.push(emptyPlot('tilled'));
    s.progression.goals = [];
    void season;
    return s;
  }

  it('only ever draws goals the player can do at their unlock level (200 random stages)', () => {
    const seasons: SeasonId[] = ['spring', 'summer', 'autumn', 'winter'];
    for (let i = 0; i < 200; i++) {
      const level = 1 + (i % 12);
      const season = seasons[i % 4]!;
      const s = stage(i + 1, level, season);
      refillGoals(s, GAME_DATA, createRng(s), season);
      const goals = s.progression.goals;
      expect(goals.length, `level ${level} ${season}`).toBe(GOAL_SLOTS);
      const keys = new Set<string>();
      for (const g of goals) {
        expect(goalAchievable(s, GAME_DATA, season, g), `${g.template} at level ${level} in ${season}`).toBe(
          true,
        );
        expect(isUnlocked(s, GAME_DATA.goalTemplates[g.template].requires, GAME_DATA), g.template).toBe(true);
        const target = goalTarget(g.objective);
        expect(target).toBeGreaterThanOrEqual(1);
        if (['harvest_crop', 'harvest_any', 'ship_items'].includes(g.template)) {
          expect(target).toBeGreaterThanOrEqual(GOAL_TARGET_MIN);
          expect(target).toBeLessThanOrEqual(GOAL_TARGET_MAX);
        }
        const gold = g.rewards.find((r) => r.kind === 'gold');
        expect(gold && gold.kind === 'gold' && gold.amount).toBeGreaterThanOrEqual(GOAL_GOLD_MIN / 2);
        keys.add(goalText(GAME_DATA, g));
        const o = g.objective;
        if (o.kind === 'harvest' && o.crop) {
          expect(isUnlocked(s, GAME_DATA.crops[o.crop].unlock), `${o.crop} unlocked`).toBe(true);
          expect(GAME_DATA.crops[o.crop].seasons, `${o.crop} in ${season}`).toContain(season);
        }
        if (o.kind === 'catch' && o.location)
          expect(s.expansions.includes(o.location as never) || o.location === 'pond').toBe(true);
        if (o.kind === 'catch' && o.rarity) {
          const fish = Object.values(GAME_DATA.fish).filter(
            (f) =>
              f.rarity === o.rarity &&
              f.seasons.includes(season) &&
              (f.location === 'pond' || s.expansions.includes(f.location as never)),
          );
          expect(fish.length, `a ${o.rarity} fish in ${season}`).toBeGreaterThan(0);
        }
        if (o.kind === 'cook' && o.tier) {
          expect(s.kitchen.known.some((r) => GAME_DATA.recipes[r].tier >= o.tier!)).toBe(true);
        }
      }
      expect(keys.size, 'three different goals').toBe(GOAL_SLOTS);
    }
  });

  it('never asks for a fish, dish tier or template the player has not reached', () => {
    const s = stage(3, 1, 'spring');
    for (let i = 0; i < 30; i++) {
      s.progression.goals = [];
      refillGoals(s, GAME_DATA, createRng(s), 'spring');
      for (const g of s.progression.goals) {
        expect(START_TEMPLATES).toContain(g.template);
        if (g.objective.kind === 'catch') expect(g.objective.location).toBe('pond');
      }
    }
  });

  it('sizes the harvest target to the farm: a bigger farm is asked for more', () => {
    const small = stage(1, 1, 'spring');
    const big = stage(1, 1, 'spring');
    big.farm.plots = Array.from({ length: 48 }, () => emptyPlot('tilled'));
    const target = (s: GameState): number => {
      s.progression.goals = [];
      for (let i = 0; i < 20; i++) {
        s.progression.goals = [];
        refillGoals(s, GAME_DATA, createRng(s), 'spring');
        const g = s.progression.goals.find((x) => x.template === 'harvest_any');
        if (g) return goalTarget(g.objective);
      }
      return 0;
    };
    expect(target(big)).toBeGreaterThan(target(small));
    expect(niceTarget(3)).toBe(GOAL_TARGET_MIN);
    expect(niceTarget(13.4)).toBe(13);
    expect(niceTarget(47)).toBe(45);
    expect(niceTarget(233)).toBe(230);
    expect(niceTarget(99_999)).toBe(GOAL_TARGET_MAX);
  });

  it('is deterministic for a seed', () => {
    const a = stage(11, 6, 'spring');
    const b = stage(11, 6, 'spring');
    refillGoals(a, GAME_DATA, createRng(a), 'spring');
    refillGoals(b, GAME_DATA, createRng(b), 'spring');
    expect(a.progression.goals).toEqual(b.progression.goals);
    expect(a.rngState).toBe(b.rngState);
  });

  it('counts harvests toward its goal and finishes it: reward paid, a new goal drawn', () => {
    const s = farm(2);
    s.progression.goals = [
      {
        template: 'harvest_crop',
        objective: { kind: 'harvest', crop: 'turnip', count: 10 },
        progress: 0,
        rewards: [{ kind: 'gold', amount: 120 }],
      },
    ];
    s.progression.milestones.done.push('m02_first_harvest'); // its 25g would muddy the count
    const gold = s.gold;
    let out = feed(s, [harvested('turnip', 4), harvested('potato', 50)]);
    expect(s.progression.goals[0]!.progress).toBe(4); // potatoes do not count
    out = feed(s, [harvested('turnip', 6)]);
    expect(out.filter((e) => e.type === 'questDone' && e.kind === 'goal')).toHaveLength(1);
    expect(s.gold - gold).toBe(120);
    expect(s.progression.goalsDone).toBe(1);
    expect(s.progression.goals).toHaveLength(GOAL_SLOTS); // refilled
    expect(
      s.progression.goals.some(
        (g) => g.objective.kind === 'harvest' && g.objective.crop === 'turnip' && g.objective.count === 10,
      ),
    ).toBe(false);
  });

  it('pays items and recipe cards too', () => {
    const s = farm(2);
    s.progression.goals = [
      {
        template: 'eat_dish',
        objective: { kind: 'eat', count: 1 },
        progress: 0,
        rewards: [
          { kind: 'items', items: [{ item: 'seed_wheat', qty: 5 }] },
          { kind: 'recipe', id: 'berry_bowl' },
        ],
      },
    ];
    feed(s, [{ type: 'ate', recipe: 'roasted_turnip', buff: 'growth', hearty: false }]);
    expect(countItem(s.inventory, 'seed_wheat')).toBe(5);
    expect(s.kitchen.known).toContain('berry_bowl');
  });

  it('counts every kind of objective from its own event', () => {
    const s = farm(2);
    const goal = (template: ActiveGoal['template'], objective: ActiveGoal['objective']): ActiveGoal => ({
      template,
      objective,
      progress: 0,
      rewards: [{ kind: 'gold', amount: 50 }],
    });
    s.progression.goals = [
      goal('ship_items', { kind: 'ship', count: 30 }),
      goal('catch_fish', { kind: 'catch', location: 'river', count: 5 }),
      goal('cook_tier', { kind: 'cook', tier: 2, count: 3 }),
    ];
    feed(s, [
      { type: 'binCollected', gold: 100, items: 12 },
      { type: 'caught', catch: 'trout', sizeCm: 20, location: 'river', viaTrap: false },
      { type: 'caught', catch: 'bluegill', sizeCm: 20, location: 'pond', viaTrap: false }, // wrong water
      { type: 'caught', catch: 'old_boot', sizeCm: 0, location: 'river', viaTrap: false }, // junk
      { type: 'caught', catch: 'perch', sizeCm: 20, location: 'river', viaTrap: true }, // traps count
      { type: 'cooked', recipe: 'roasted_turnip', tier: 1, hearty: false }, // too low
      { type: 'cooked', recipe: 'vegetable_soup', tier: 2, hearty: false },
      { type: 'cooked', recipe: 'seafood_stew', tier: 3, hearty: false }, // a higher tier counts
    ]);
    const p = Object.fromEntries(s.progression.goals.map((g) => [g.template, g.progress]));
    expect(p).toEqual({ ship_items: 12, catch_fish: 2, cook_tier: 2 });
  });

  it('"cook different dishes" counts each recipe once', () => {
    const s = farm(2);
    s.progression.goals = [
      {
        template: 'cook_distinct',
        objective: { kind: 'cook', distinct: true, count: 3 },
        progress: 0,
        rewards: [{ kind: 'gold', amount: 50 }],
      },
    ];
    const cook = (recipe: 'roasted_turnip' | 'baked_potato' | 'grilled_bluegill'): GameEvent => ({
      type: 'cooked',
      recipe,
      tier: 1,
      hearty: false,
    });
    feed(s, [cook('roasted_turnip'), cook('roasted_turnip'), cook('baked_potato')]);
    expect(s.progression.goals[0]!.progress).toBe(2);
    expect(s.progression.goals[0]!.seen).toEqual(['roasted_turnip', 'baked_potato']);
    const out = feed(s, [cook('grilled_bluegill')]);
    expect(out.filter((e) => e.type === 'questDone' && e.kind === 'goal')).toHaveLength(1);
  });

  it('"earn gold in a day" ignores quest gold and starts again at the 06:00 refresh', () => {
    const s = farm(2);
    s.progression.goals = [
      {
        template: 'earn_gold_day',
        objective: { kind: 'earnGold', amount: 500, withinOneDay: true },
        progress: 0,
        rewards: [{ kind: 'gold', amount: 100 }],
      },
    ];
    feed(s, [
      { type: 'goldEarned', amount: 200, source: 'sale' },
      { type: 'goldEarned', amount: 999, source: 'quest' },
    ]);
    expect(s.progression.goals[0]!.progress).toBe(200);
    onDayStarted(s, ctxAt(s));
    expect(s.progression.goals.find((g) => g.template === 'earn_gold_day')?.progress ?? 0).toBe(0);
    expect(s.progression.goals).toHaveLength(GOAL_SLOTS);
  });

  it('swaps a goal that a change of season made impossible', () => {
    const s = farm(4);
    s.progression.goals = [
      {
        template: 'harvest_crop',
        objective: { kind: 'harvest', crop: 'turnip', count: 10 },
        progress: 3,
        rewards: [{ kind: 'gold', amount: 50 }],
      },
    ];
    expect(goalAchievable(s, GAME_DATA, 'spring', s.progression.goals[0]!)).toBe(true);
    expect(goalAchievable(s, GAME_DATA, 'summer', s.progression.goals[0]!)).toBe(false); // turnips are spring-only
    onSeasonChanged(s, ctxAt(s, SUMMER), 'summer');
    expect(s.progression.goals).toHaveLength(GOAL_SLOTS);
    for (const g of s.progression.goals) expect(goalAchievable(s, GAME_DATA, 'summer', g)).toBe(true);
    expect(
      s.progression.goals.some((g) => g.objective.kind === 'harvest' && g.objective.crop === 'turnip'),
    ).toBe(false);
    revalidateGoals(s, GAME_DATA, createRng(s), 'summer'); // and it is stable
    expect(s.progression.goals).toHaveLength(GOAL_SLOTS);
  });

  it('writes its title from the template', () => {
    const g: ActiveGoal = {
      template: 'catch_rarity',
      objective: { kind: 'catch', rarity: 'uncommon', count: 1 },
      progress: 0,
      rewards: [],
    };
    expect(goalText(GAME_DATA, g)).toBe('Catch an uncommon fish');
    expect(
      goalText(GAME_DATA, {
        template: 'catch_rarity',
        objective: { kind: 'catch', rarity: 'rare', count: 1 },
      }),
    ).toBe('Catch a rare fish');
    expect(
      goalText(GAME_DATA, {
        template: 'harvest_crop',
        objective: { kind: 'harvest', crop: 'potato', count: 20 },
      }),
    ).toBe('Harvest 20 Potatoes');
    expect(
      goalText(GAME_DATA, { template: 'cook_tier', objective: { kind: 'cook', tier: 2, count: 3 } }),
    ).toBe('Cook 3 T2 dishes');
    expect(
      goalText(GAME_DATA, {
        template: 'earn_gold_day',
        objective: { kind: 'earnGold', amount: 500, withinOneDay: true },
      }),
    ).toBe('Earn 500g in one day');
    expect(
      goalText(GAME_DATA, {
        template: 'catch_fish',
        objective: { kind: 'catch', location: 'river', count: 5 },
      }),
    ).toBe('Catch 5 fish at the river');
  });
});

describe('the Community Board', () => {
  const give = (s: GameState, bundle: (typeof BUNDLE_IDS)[number], item: ItemId, qty: number) =>
    donate(s, ctxAt(s, NOON, feedEvents(s)), bundle, item, qty);
  const eventsOf = new WeakMap<GameState, GameEvent[]>();
  function feedEvents(s: GameState): GameEvent[] {
    let e = eventsOf.get(s);
    if (!e) eventsOf.set(s, (e = []));
    return e;
  }
  function fill(s: GameState, id: (typeof BUNDLE_IDS)[number]): void {
    s.inventory.stackSize = 999;
    s.inventory.slots = Array.from({ length: 40 }, () => null);
    for (const slot of BUNDLES[id].slots) addItem(s.inventory, slot.item, slot.qty);
    for (const slot of BUNDLES[id].slots) expect(give(s, id, slot.item, slot.qty)).toEqual({ ok: true });
  }

  it('has the 6 bundles of BALANCE.md', () => {
    expect(BUNDLE_IDS).toEqual([
      'spring_crops',
      'summer_crops',
      'autumn_harvest',
      'pond_fish',
      'river_and_sea',
      'cozy_dinner',
    ]);
    expect(BUNDLES.spring_crops.slots).toEqual([
      { item: 'turnip', qty: 10 },
      { item: 'potato', qty: 10 },
      { item: 'strawberry', qty: 5 },
      { item: 'cauliflower', qty: 2 },
    ]);
    expect(BUNDLES.cozy_dinner.slots.map((s) => s.item)).toEqual([
      'roasted_turnip',
      'vegetable_soup',
      'fish_tacos',
      'seafood_stew',
    ]);
    expect(BUNDLES.spring_crops.reward.kind).toBe('goldenScarecrow');
    expect(GOLDEN_SCARECROW.bundle).toBe('spring_crops');
    expect(BUNDLES.summer_crops.reward).toEqual({ kind: 'inventorySlots', count: 4 });
    expect(BUNDLES.autumn_harvest.reward.kind).toBe('unlockGreenhouse');
    expect(BUNDLES.pond_fish.reward).toEqual({ kind: 'trapPerLocation', count: 1 });
    expect(BUNDLES.river_and_sea.reward).toEqual({ kind: 'fishingLuck', bonus: 0.1 });
    expect(BUNDLES.cozy_dinner.reward.kind).toBe('buffSlot');
  });

  it('takes items from the bag, at most what a slot still needs, and shows them as filled', () => {
    const s = farm();
    addItem(s.inventory, 'turnip', 25);
    expect(give(s, 'spring_crops', 'turnip', 4)).toEqual({ ok: true });
    expect(s.progression.bundles.spring_crops).toEqual([{ item: 'turnip', qty: 4 }]);
    expect(give(s, 'spring_crops', 'turnip', 99)).toEqual({ ok: true }); // only the 6 still needed go in
    expect(countItem(s.inventory, 'turnip')).toBe(25 - 10);
    expect(give(s, 'spring_crops', 'turnip', 1).ok).toBe(false); // full
    expect(give(s, 'spring_crops', 'wheat', 1).ok).toBe(false); // not in this bundle
    expect(give(s, 'spring_crops', 'potato', 1).ok).toBe(false); // none in the bag
    expect(give(s, 'spring_crops', 'potato', 0).ok).toBe(false);
    expect(isBundleDone(s, 'spring_crops')).toBe(false);
  });

  it('Spring Crops: a golden scarecrow (radius 3, +30% growth) to place on the field', () => {
    const s = farm();
    s.farm.grid = { cols: 8, rows: 6 };
    s.farm.plots = Array.from({ length: 48 }, () => emptyPlot('tilled'));
    s.lastPlantedCrop = Array.from({ length: 48 }, () => null);
    expect(stockOf(s, 'golden_scarecrow')).toBe(0);
    expect(placeObject(s, ctxAt(s), 'golden_scarecrow', 3, 3).ok).toBe(false);
    fill(s, 'spring_crops');
    expect(isBundleDone(s, 'spring_crops')).toBe(true);
    expect(stockOf(s, 'golden_scarecrow')).toBe(1);
    expect(placeObject(s, ctxAt(s), 'golden_scarecrow', 3, 3)).toEqual({ ok: true });
    expect(stockOf(s, 'golden_scarecrow')).toBe(0);
    expect(placeObject(s, ctxAt(s), 'golden_scarecrow', 5, 3).ok).toBe(false); // only one
    expect(areaOf(s, GAME_DATA, 'golden_scarecrow')).toEqual({ shape: 'square', radius: 3 });
    const cov = coverageOf(s, GAME_DATA)!;
    expect(cov.bonus[3 * 8 + 6]).toBe(0.3); // three tiles away
    expect(cov.bonus[3 * 8 + 7]).toBe(0); // four is out
    expect(cov.sprinkled.every((v) => v === 0)).toBe(true);
  });

  it('Summer Crops: four more bag slots, and the backpack adds on top of them', () => {
    const s = farm();
    const before = s.inventory.slots.length;
    fill(s, 'summer_crops');
    expect(bundleBonuses(s, GAME_DATA).inventorySlots).toBe(4);
    s.inventory.slots = s.inventory.slots.slice(0, before + 4);
    s.gold = 10_000;
    expect(buyUpgrade(s, ctxAt(s), 'backpack')).toEqual({ ok: true });
    expect(s.inventory.slots.length).toBe(16 + 4);
  });

  it('Autumn Harvest: unlocks the greenhouse', () => {
    const s = farm();
    const cond = [{ kind: 'bundle', id: 'autumn_harvest' }] as const;
    expect(isUnlocked(s, cond)).toBe(false);
    fill(s, 'autumn_harvest');
    expect(isUnlocked(s, cond)).toBe(true);
    const events = feedEvents(s);
    expect(events).toContainEqual({ type: 'bundleCompleted', bundle: 'autumn_harvest' });
    runProgression(s, ctxAt(s, NOON, events));
    expect(events.find((e) => e.type === 'unlocked')).toMatchObject({ panel: 'upgrades' });
  });

  it('Pond Fish: one more trap spot at every water', () => {
    const s = farm();
    s.expansions.push('river');
    expect(maxTraps(s, GAME_DATA)).toBe(4);
    fill(s, 'pond_fish');
    expect(maxTraps(s, GAME_DATA)).toBe(6);
    s.upgrades.fish_trap = 4;
    for (const [location, slot] of [
      ['pond', 0],
      ['pond', 1],
      ['river', 0],
      ['river', 1],
    ] as const) {
      s.fishing.traps.push({ id: s.fishing.traps.length + 1, location, slot, progressMs: 0, contents: [] });
    }
    expect(nextTrapSpot(s, GAME_DATA)).toEqual({ location: 'pond', slot: 2 });
    s.gold = 1_000_000;
    expect(buyUpgrade(s, ctxAt(s), 'fish_trap')).toEqual({ ok: true });
    expect(s.fishing.traps.at(-1)).toMatchObject({ location: 'pond', slot: 2 });
  });

  it('River & Sea: +0.10 fishing luck, permanently', () => {
    const s = farm();
    const luck = () => computeModifiers(s, GAME_DATA, 'spring').fishingLuckModifier;
    expect(luck()).toBe(0);
    fill(s, 'river_and_sea');
    expect(luck()).toBeCloseTo(0.1, 10);
  });

  it('Cozy Dinner: one more buff slot', () => {
    const s = farm();
    expect(buffSlotCount(s, GAME_DATA)).toBe(3);
    fill(s, 'cozy_dinner');
    expect(buffSlotCount(s, GAME_DATA)).toBe(4);
  });

  it('completing a bundle finishes the "first bundle" milestone and pays its gold', () => {
    const s = farm();
    s.progression.goals = [];
    const gold = s.gold;
    fill(s, 'cozy_dinner');
    runProgression(s, ctxAt(s, NOON, feedEvents(s)));
    expect(s.progression.milestones.done).toContain('m14_first_bundle');
    expect(s.gold - gold).toBe(1500);
  });

  it('does not lose a donation to hearty stacks: plain dishes go first', () => {
    const s = farm();
    addItem(s.inventory, 'roasted_turnip', 1, true);
    addItem(s.inventory, 'roasted_turnip', 1, false);
    expect(give(s, 'cozy_dinner', 'roasted_turnip', 1)).toEqual({ ok: true });
    expect(countItem(s.inventory, 'roasted_turnip', false)).toBe(0);
    expect(countItem(s.inventory, 'roasted_turnip', true)).toBe(1);
  });
});

describe('progression is a listener (offline too)', () => {
  function farmhandFarm(): GameState {
    const s = createInitialState(CREATED, NY, 3);
    s.progression.goals = [
      {
        template: 'harvest_any',
        objective: { kind: 'harvest', count: 40 },
        progress: 0,
        rewards: [{ kind: 'gold', amount: 200 }],
      },
      {
        template: 'harvest_crop',
        objective: { kind: 'harvest', crop: 'turnip', count: 25 },
        progress: 0,
        rewards: [{ kind: 'gold', amount: 100 }],
      },
      {
        template: 'catch_fish',
        objective: { kind: 'catch', location: 'pond', count: 5 },
        progress: 0,
        rewards: [{ kind: 'gold', amount: 100 }],
      },
    ];
    s.farm.grid = { cols: 6, rows: 4 };
    s.farm.plots = Array.from({ length: 24 }, () => emptyPlot('tilled'));
    s.lastPlantedCrop = Array.from({ length: 24 }, () => 'turnip');
    s.upgrades.farmhand = 2;
    s.upgrades.seed_planter = 2;
    s.upgrades.sprinkler = 0;
    s.automation.farmhandCooldownMs = 22_000;
    s.inventory.stackSize = 999;
    addItem(s.inventory, seedOf('turnip'), 900);
    s.farm.plots.forEach((p) => (p.waterMsLeft = 8 * HOUR));
    return s;
  }

  it('offline harvests count as XP and toward goals, exactly like the same time played', () => {
    const offline = farmhandFarm();
    const report = runOffline(offline, GAME_DATA, NY, CREATED, CREATED + 3 * HOUR);
    expect(report.simulatedMs).toBe(3 * HOUR);
    expect(offline.stats.cropsHarvested).toBeGreaterThan(100);
    expect(offline.progression.skills.farming.xp).toBeGreaterThan(300);
    expect(skillLevel(offline, 'farming')).toBeGreaterThanOrEqual(3);
    expect(report.events.filter((e) => e.type === 'levelUp').length).toBeGreaterThanOrEqual(2);
    // The goals finished while away, and paid.
    expect(offline.progression.goalsDone).toBeGreaterThanOrEqual(2);
    expect(
      report.events.filter((e) => e.type === 'questDone' && e.kind === 'goal').length,
    ).toBeGreaterThanOrEqual(2);
    expect(offline.progression.milestones.done).toEqual(
      expect.arrayContaining(['m01_first_seed', 'm02_first_harvest']),
    );

    // The same farm played in one-minute steps ends with the same XP, levels and goals (perks pinned off
    // so the rounding of fractional growth cannot shift a harvest by one visit).
    const a = farmhandFarm();
    const b = farmhandFarm();
    const ca = ctxAt(a, CREATED, [], DATA_NO_PERKS);
    step(a, ca, 3 * HOUR);
    const cb = ctxAt(b, CREATED, [], DATA_NO_PERKS);
    for (let t = 0; t < 3 * HOUR; t += MIN) step(b, cb, MIN);
    expect(b.progression.skills).toEqual(a.progression.skills);
    expect(b.progression.milestones.done).toEqual(a.progression.milestones.done);
    expect(b.progression.goalsDone).toBe(a.progression.goalsDone);
    expect(b.progression.goals).toEqual(a.progression.goals);
    expect(b.gold).toBe(a.gold);
    expect(b.rngState).toBe(a.rngState);
  });

  it('offline trap catches pay Fishing XP: one big step equals many small ones', () => {
    const make = (): GameState => {
      const s = createInitialState(CREATED, NY, 5);
      s.upgrades.fish_trap = 2;
      s.upgrades.trap_collector = 1;
      s.fishing.traps.push(
        { id: 1, location: 'pond', slot: 0, progressMs: 0, contents: [] },
        { id: 2, location: 'pond', slot: 1, progressMs: 0, contents: [] },
      );
      return s;
    };
    const big = make();
    const small = make();
    step(big, ctxAt(big), 10 * HOUR);
    for (let t = 0; t < 10 * HOUR; t += 5 * MIN) step(small, ctxAt(small), 5 * MIN);
    expect(big.progression.skills.fishing.xp).toBeGreaterThan(200);
    expect(small.progression.skills).toEqual(big.progression.skills);
    expect(small.stats.fishCaught).toBe(big.stats.fishCaught);
    expect(msToNextSimEvent(make(), ctxAt(make()))).toBe(TRAP_INTERVAL_MS); // a trap roll splits steps
  });

  it('a level-up in the middle of a long absence changes the rate from that moment on', () => {
    // 60 harvests' worth of XP in one step: the level-ups arrive at the visits, and the later crops grow faster.
    const s = farmhandFarm();
    const big = structuredClone(s);
    const small = structuredClone(s);
    step(big, ctxAt(big), 2 * HOUR);
    const cs = ctxAt(small);
    for (let t = 0; t < 2 * HOUR; t += 30_000) step(small, cs, 30_000);
    expect(big.progression.skills.farming.xp).toBeGreaterThan(0);
    // Within rounding (fractional growth rates), the same harvests: within 3%.
    expect(Math.abs(big.stats.cropsHarvested - small.stats.cropsHarvested)).toBeLessThanOrEqual(
      big.stats.cropsHarvested * 0.03,
    );
  });
});

describe('feedback and reporting', () => {
  it('the away summary lists skills that grew and goals and milestones finished', () => {
    const events: GameEvent[] = [
      { type: 'levelUp', skill: 'farming', level: 2 },
      { type: 'levelUp', skill: 'farming', level: 3 },
      { type: 'levelUp', skill: 'fishing', level: 2 },
      {
        type: 'questDone',
        id: 'm02_first_harvest',
        kind: 'milestone',
        title: 'Harvest a crop',
        rewards: '25g',
      },
      { type: 'questDone', id: 'harvest_any', kind: 'goal', title: 'Harvest 20 crops', rewards: '30g' },
      { type: 'questDone', id: 'eat_dish', kind: 'goal', title: 'Eat 2 dishes', rewards: '30g' },
    ];
    const totals = awayTotals({
      awayMs: 1,
      simulatedMs: 1,
      dayStarts: 0,
      seasonChanges: [],
      events,
      showSummary: true,
    });
    expect(totals).toMatchObject({ goalsDone: 2, milestonesDone: 1 });
    const rows = awayRows(
      { awayMs: 1, simulatedMs: 1, dayStarts: 0, seasonChanges: [], events, showSummary: true },
      { readyPlots: 0, dryPlots: 0 },
    ).map((r) => r.text);
    expect(rows).toContain('Skills grew while you were away: Farming level 3, Fishing level 2.');
    expect(rows).toContain('You finished 2 goals and 1 milestone. See the Goals panel.');
  });

  it('an offline catch-up flushes its events with `replaying` set, so the UI can summarise instead of toast', () => {
    const s = createInitialState(CREATED, NY, 3);
    const game = new Game(s, { data: GAME_DATA, lc: NY, now: () => CREATED });
    const seen: boolean[] = [];
    game.bus.on('levelUp', () => seen.push(game.replaying));
    s.progression.goals = [];
    s.farm.plots[0] = { ...emptyPlot('planted'), crop: 'turnip', growthMs: 200_000, waterMsLeft: 1 };
    s.upgrades.farmhand = 1;
    s.automation.farmhandCooldownMs = 5_000;
    s.progression.skills.farming.xp = 149; // one farmhand harvest (a quarter of 3 XP, at least 1) from level 2
    const report = game.catchUp(CREATED, CREATED + 30 * MIN);
    expect(report.events.some((e) => e.type === 'levelUp')).toBe(true);
    expect(seen).toEqual([true]);
    expect(game.replaying).toBe(false);
  });

  it('goal rewards vary: gold, seeds and a recipe card, and are always something', () => {
    const kinds = new Set<string>();
    for (let seed = 1; seed <= 80; seed++) {
      const s = createInitialState(CREATED, NY, seed);
      setFarmLevel(s, 4);
      s.progression.goals = [];
      s.progression.milestones.done.push('m03_first_sale');
      refillGoals(s, GAME_DATA, createRng(s), 'spring');
      for (const g of s.progression.goals) {
        expect(g.rewards.length).toBeGreaterThan(0);
        expect(g.rewards[0]).toMatchObject({ kind: 'gold' });
        kinds.add(g.rewards.map((r) => r.kind).join('+'));
        for (const r of g.rewards) {
          if (r.kind === 'recipe') {
            const d = GAME_DATA.recipes[r.id].discovery;
            expect(d.kind).toBe('card');
            expect(s.kitchen.known).not.toContain(r.id);
            expect(d.kind === 'card' && isUnlocked(s, d.unlock)).toBe(true);
          }
          if (r.kind === 'items') {
            const item = r.items[0]!.item;
            expect(item.startsWith('seed_')).toBe(true);
          }
        }
      }
    }
    expect([...kinds].sort()).toEqual(['gold', 'gold+items', 'gold+recipe']);
  });

  it('donating through the dispatch layer works, and finishing a bundle reports it', () => {
    const s = farm();
    s.progression.goals = [];
    s.inventory.slots = Array.from({ length: 12 }, () => null);
    addItem(s.inventory, 'roasted_turnip', 2);
    addItem(s.inventory, 'vegetable_soup', 1);
    addItem(s.inventory, 'fish_tacos', 1);
    addItem(s.inventory, 'seafood_stew', 1);
    const events: GameEvent[] = [];
    const ctx = ctxAt(s, NOON, events);
    for (const slot of BUNDLES.cozy_dinner.slots) {
      expect(
        applyAction(s, ctx, { type: 'donate', bundle: 'cozy_dinner', item: slot.item, qty: slot.qty }),
      ).toEqual({ ok: true });
    }
    expect(events).toContainEqual({ type: 'bundleCompleted', bundle: 'cozy_dinner' });
    expect(s.progression.completedBundles).toEqual(['cozy_dinner']);
    expect(
      applyAction(s, ctx, { type: 'donate', bundle: 'cozy_dinner', item: 'roasted_turnip', qty: 1 }).ok,
    ).toBe(false);
  });

  it('describes rewards in words for the toasts and the panel', () => {
    expect(rewardsText(GAME_DATA, [{ kind: 'gold', amount: 1500 }])).toBe('1,500g');
    expect(
      rewardsText(GAME_DATA, [
        { kind: 'gold', amount: 40 },
        { kind: 'items', items: [{ item: 'seed_potato', qty: 5 }] },
        { kind: 'recipe', id: 'berry_bowl' },
        { kind: 'xp', skill: 'cooking', amount: 30 },
      ]),
    ).toBe('40g and 5 × Potato Seeds and the Berry Bowl recipe and 30 Cooking XP');
  });
});
