import { describe, expect, it } from 'vitest';
import type { GameEvent } from '../src/core/events';
import { makeContext } from '../src/core/sim';
import { createInitialState, type GameState } from '../src/core/state';
import { buildCalendar } from '../src/core/time';
import { GAME_DATA } from '../src/data';
import { roundNice } from '../src/data/balance';
import { EXPANSIONS, FARM_EXPANSIONS } from '../src/data/expansions';
import { canAfford, earn, spend } from '../src/systems/economy';
import { buyExpansion, nextFarmExpansion, remapPlotIndex, resizePlots } from '../src/systems/expansions';
import { addItem, countItem } from '../src/systems/inventory';
import { buySeeds, maxAffordableSeeds, seedStock } from '../src/systems/shop';
import { farmLevel, isUnlocked, provisionalFarmLevel, unlockHint } from '../src/systems/unlocks';
import { buyUpgrade, upgradeCost } from '../src/systems/upgrades';
import { buildLayout, buildZones, sceneryFor, plotIndexAt, zoneAt, groundAt } from '../src/render/scene';
import { at, NY, setFarmLevel } from './helpers';

const CREATED = at(NY, 2026, 1, 7, 10);
const SUMMER = at(NY, 2026, 1, 13, 12);

function farm(): GameState {
  return createInitialState(CREATED, NY, 1);
}
function ctxAt(s: GameState, t = CREATED, events: GameEvent[] = []) {
  return makeContext(s, GAME_DATA, buildCalendar(t, s.calendar, NY), events);
}

describe('gold', () => {
  it('earn adds gold, counts lifetime and today, and reports goldEarned', () => {
    const s = farm();
    const events: GameEvent[] = [];
    earn(s, { events }, 40, 'sale');
    earn(s, { events }, 0, 'other');
    expect(s.gold).toBe(100);
    expect(s.stats).toMatchObject({ lifetimeGold: 40, goldToday: 40 });
    expect(events).toEqual([{ type: 'goldEarned', amount: 40, source: 'sale' }]);
  });

  it('spend refuses to overspend and changes nothing', () => {
    const s = farm();
    expect(canAfford(s, 60)).toBe(true);
    expect(canAfford(s, 61)).toBe(false);
    expect(spend(s, 61)).toBe(false);
    expect(s.gold).toBe(60);
    expect(spend(s, 60)).toBe(true);
    expect(s.gold).toBe(0);
    expect(s.stats.lifetimeGold).toBe(0); // spending never touches lifetime gold
  });

  it('gold amounts are whole and non-negative', () => {
    const s = farm();
    expect(() => earn(s, { events: [] }, 1.5, 'sale')).toThrow();
    expect(() => spend(s, -5)).toThrow();
    expect(canAfford(s, 2.5)).toBe(false);
  });

  it('roundNice keeps small numbers and rounds big ones to 2 significant figures', () => {
    expect(roundNice(7.64)).toBe(8);
    expect(roundNice(99.4)).toBe(99);
    expect(roundNice(1480)).toBe(1500);
    expect(roundNice(5476)).toBe(5500);
    expect(roundNice(20261)).toBe(20000);
  });
});

describe('seed prices (BALANCE.md §2, phase 03 formula)', () => {
  it('are roundNice(0.35 · gross), or 1.7 · grossPerHarvest for regrowers', () => {
    const u: Record<string, number> = {
      garlic: 1,
      strawberry: 1,
      blueberry: 1,
      kale: 1,
      leek: 1,
      cauliflower: 2,
      corn: 2,
      cranberry: 2,
      melon: 3,
      pumpkin: 3,
    };
    const profitRate = (m: number, tier: number) => 6 * (1 + 0.25 * Math.log2(m / 2)) * (1 + 0.2 * tier);
    for (const c of Object.values(GAME_DATA.crops)) {
      const tier = u[c.id] ?? 0;
      const expected =
        c.regrowSec === null
          ? roundNice((0.35 * profitRate(c.growSec / 60, tier) * (c.growSec / 60)) / 0.55)
          : roundNice(1.7 * profitRate(c.regrowSec / 60, tier) * (c.regrowSec / 60) * 0.85);
      expect(c.seedPrice, c.id).toBe(expected);
    }
  });
});

describe('provisional farm level (BALANCE.md §9)', () => {
  it('follows 1 + floor(log2(1 + lifetimeGold / 300))', () => {
    const pairs: [number, number][] = [
      [0, 1],
      [299, 1],
      [300, 2],
      [900, 3],
      [2100, 4],
      [4500, 5],
      [9300, 6],
      [18900, 7],
      [38100, 8],
    ];
    for (const [gold, level] of pairs) expect(provisionalFarmLevel(gold), String(gold)).toBe(level);
    for (let l = 1; l <= 8; l++) expect(provisionalFarmLevel(300 * (2 ** (l - 1) - 1))).toBe(l);
  });

  it('no longer follows gold: earning does not raise the Farm Level, skills and milestones do (phase 07)', () => {
    const s = farm();
    earn(s, { events: [] }, 900, 'sale');
    expect(farmLevel(s)).toBe(1);
    spend(s, 900);
    expect(farmLevel(s)).toBe(1);
  });

  it('unlocks seeds and explains the locked ones', () => {
    const s = farm();
    const garlic = GAME_DATA.crops.garlic.unlock;
    expect(isUnlocked(s, garlic)).toBe(false);
    expect(unlockHint(s, GAME_DATA, garlic)).toBe('Reach Farm Level 2 (2 more farm points).');
    setFarmLevel(s, 2);
    expect(isUnlocked(s, garlic)).toBe(true);
    expect(unlockHint(s, GAME_DATA, garlic)).toBeNull();
    expect(unlockHint(s, GAME_DATA, EXPANSIONS.farm_2.requires)).toBe('Needs “Clear the Weeds” first.');
  });
});

describe('seed shop', () => {
  it("stocks this season's seeds and locks the ones that need progression", () => {
    const s = farm();
    const spring = seedStock(s, GAME_DATA, 'spring');
    expect(spring.map((x) => x.crop)).toEqual(['turnip', 'potato', 'garlic', 'strawberry', 'cauliflower']);
    expect(spring.filter((x) => x.unlocked).map((x) => x.crop)).toEqual(['turnip', 'potato']);
    expect(spring.find((x) => x.crop === 'cauliflower')?.hint).toBe(
      'Reach Farm Level 4 (8 more farm points).',
    );
    // The stock changes with the season.
    expect(seedStock(s, GAME_DATA, 'summer').map((x) => x.crop)).toEqual([
      'wheat',
      'tomato',
      'blueberry',
      'corn',
      'melon',
    ]);
  });

  it('buys N seeds, or as many as gold and space allow', () => {
    const s = farm();
    const ctx = ctxAt(s);
    expect(maxAffordableSeeds(s, GAME_DATA, 'turnip')).toBe(7);
    expect(buySeeds(s, ctx, 'turnip', 7).ok).toBe(true);
    expect(s.gold).toBe(4);
    expect(countItem(s.inventory, 'seed_turnip')).toBe(13);
    expect(maxAffordableSeeds(s, GAME_DATA, 'turnip')).toBe(0);
    expect(buySeeds(s, ctx, 'turnip', 1)).toEqual({ ok: false, reason: 'You need 8g for that.' });
  });

  it('sells summer seeds only in summer', () => {
    const s = farm();
    expect(buySeeds(s, ctxAt(s), 'wheat', 1).ok).toBe(false);
    const summer = createInitialState(CREATED, NY, 1);
    expect(buySeeds(summer, ctxAt(summer, SUMMER), 'wheat', 1).ok).toBe(true);
  });
});

describe('farm expansion', () => {
  it('has four steps from 4 × 2 to 8 × 6 on a geometric price curve', () => {
    expect(FARM_EXPANSIONS.map((id) => EXPANSIONS[id].price)).toEqual([400, 1500, 5500, 20000]);
    expect(FARM_EXPANSIONS.map((id) => EXPANSIONS[id].grid)).toEqual([
      { cols: 4, rows: 3 },
      { cols: 5, rows: 4 },
      { cols: 6, rows: 5 },
      { cols: 8, rows: 6 },
    ]);
  });

  it('refuses to overspend, and refuses steps out of order', () => {
    const s = farm();
    const ctx = ctxAt(s);
    expect(buyExpansion(s, ctx, 'farm_1')).toEqual({ ok: false, reason: 'You need 400g for that.' });
    s.gold = 10_000;
    expect(buyExpansion(s, ctx, 'farm_2')).toEqual({ ok: false, reason: 'Needs “Clear the Weeds” first.' });
    expect(buyExpansion(s, ctx, 'river').ok).toBe(false); // fishing locations arrive in phase 05
    expect(s.gold).toBe(10_000);
    expect(s.farm.grid).toEqual({ cols: 4, rows: 2 });
  });

  it('grows the plot grid, keeping every plot at its (col, row)', () => {
    const s = farm();
    s.gold = 2000;
    s.farm.plots[3] = { state: 'planted', crop: 'turnip', growthMs: 5000, harvests: 0, waterMsLeft: 100 };
    s.farm.plots[7] = { state: 'dead', crop: null, growthMs: 0, harvests: 0, waterMsLeft: 0 };
    const events: GameEvent[] = [];
    const ctx = ctxAt(s, CREATED, events);
    expect(buyExpansion(s, ctx, 'farm_1').ok).toBe(true);
    expect(s.gold).toBe(1600);
    expect(s.farm.grid).toEqual({ cols: 4, rows: 3 });
    expect(s.farm.plots).toHaveLength(12);
    expect(s.farm.plots[3]!.crop).toBe('turnip');
    expect(s.farm.plots.slice(8).every((p) => p.state === 'untilled')).toBe(true);
    expect(events).toEqual([{ type: 'purchased', what: 'farm_1', gold: 400 }]);
    expect(buyExpansion(s, ctx, 'farm_1').ok).toBe(false);

    // farm_2 adds a column: the turnip at (3, 0) and the dead crop at (3, 1) move to new indexes.
    expect(buyExpansion(s, ctx, 'farm_2').ok).toBe(true);
    expect(s.farm.grid).toEqual({ cols: 5, rows: 4 });
    expect(s.farm.plots).toHaveLength(20);
    expect(s.farm.plots[plotIndexAt(s.farm.grid, 6 + 3, 2)]!.crop).toBe('turnip');
    expect(s.farm.plots[remapPlotIndex(7, { cols: 4 }, { cols: 5 })]!.state).toBe('dead');
    expect(s.farm.plots[4]!.state).toBe('untilled'); // the new column
    expect(s.expansions).toEqual(['farm_1', 'farm_2']);
    expect(nextFarmExpansion(s)).toBe('farm_3');
  });

  it('later steps need farm levels', () => {
    const s = farm();
    s.gold = 100_000;
    const ctx = ctxAt(s);
    buyExpansion(s, ctx, 'farm_1');
    buyExpansion(s, ctx, 'farm_2');
    expect(buyExpansion(s, ctx, 'farm_3').ok).toBe(false);
    setFarmLevel(s, 3);
    expect(buyExpansion(s, ctx, 'farm_3').ok).toBe(true);
    expect(buyExpansion(s, ctx, 'farm_4').ok).toBe(false);
    setFarmLevel(s, 6);
    expect(buyExpansion(s, ctx, 'farm_4').ok).toBe(true);
    expect(s.farm.grid).toEqual({ cols: 8, rows: 6 });
    expect(s.farm.plots).toHaveLength(48);
    expect(nextFarmExpansion(s)).toBeNull();
  });

  it('resizePlots keeps a plot at the same tile', () => {
    const plots = Array.from({ length: 8 }, (_, i) => ({
      state: 'tilled' as const,
      crop: null,
      growthMs: i,
      harvests: 0,
      waterMsLeft: 0,
    }));
    const out = resizePlots(plots, { cols: 4, rows: 2 }, { cols: 5, rows: 4 });
    for (let i = 0; i < 8; i++) expect(out[remapPlotIndex(i, { cols: 4 }, { cols: 5 })]!.growthMs).toBe(i);
  });

  it('changes the scene: the fence moves, weeds go, trees are cleared, stones and a scarecrow appear', () => {
    // The home region only (parcels and the town have their own scenery).
    const sprites = (ex: Parameters<typeof sceneryFor>[0]) =>
      sceneryFor(ex)
        .filter((d) => d.col < 20 && d.row >= 0 && d.row < 12)
        .map((d) => d.sprite);
    expect(sprites([])).toContain('obj_weeds');
    expect(sprites(['farm_1'])).not.toContain('obj_weeds');
    expect(sprites(['farm_1'])).not.toContain('obj_stones');
    expect(sprites(['farm_1', 'farm_2'])).toContain('obj_stones');
    expect(sprites(['farm_1', 'farm_2']).filter((s) => s === 'obj_tree')).toHaveLength(2);
    expect(sprites(['farm_1', 'farm_2', 'farm_3'])).not.toContain('obj_tree');
    expect(sprites(['farm_1', 'farm_2', 'farm_3', 'farm_4'])).toContain('obj_scarecrow_post');
    // The fence wraps the grown field; the plot zone grows with it.
    const big = { cols: 8, rows: 6 };
    const layout = buildLayout(big, ['farm_1', 'farm_2', 'farm_3', 'farm_4']);
    expect(groundAt(layout.ground, 13, 7)).toBe('tile_soil_dry');
    expect(layout.objects.some((o) => o.sprite === 'obj_fence_h' && o.y === 8 * 16)).toBe(true);
    expect(zoneAt(buildZones(big), 13, 7)?.id).toBe('plots');
    expect(zoneAt(buildZones(big), 18, 7)?.id).toBe('bin');
  });
});

describe('backpack', () => {
  it('adds slots for gold, six a level, up to 42', () => {
    const s = farm();
    const def = GAME_DATA.upgrades.backpack!;
    expect([0, 1, 2, 3, 4].map((l) => upgradeCost(def, l))).toEqual([200, 440, 970, 2100, 4700]);
    const ctx = ctxAt(s);
    expect(buyUpgrade(s, ctx, 'backpack')).toEqual({ ok: false, reason: 'You need 200g for that.' });
    s.gold = 10_000;
    addItem(s.inventory, 'turnip', 5);
    for (const slots of [18, 24, 30, 36, 42]) {
      expect(buyUpgrade(s, ctx, 'backpack').ok).toBe(true);
      expect(s.inventory.slots).toHaveLength(slots);
    }
    expect(s.gold).toBe(10_000 - 200 - 440 - 970 - 2100 - 4700);
    expect(countItem(s.inventory, 'turnip')).toBe(5); // nothing is lost
    expect(buyUpgrade(s, ctx, 'backpack')).toEqual({ ok: false, reason: 'Backpack is fully upgraded.' });
  });
});
