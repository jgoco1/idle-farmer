// "While you were away…" (GDD §4). Stubbed in phase 01: it reports the time away and the calendar
// changes. Later phases add their lines from report.events (crops harvested, items shipped, …).

import type { OfflineReport } from '../core/offline';
import { capitalize, formatDuration } from '../core/time';
import { GAME_DATA } from '../data';
import type { CropId, FruitId, RecipeId, SkillId, TreeId } from '../data/ids';
import { fruitOfTree } from '../data/ids';
import { SKILL_ICONS, SKILL_NAMES } from '../data/skills';
import { spriteDataUrl } from '../render/spriteCache';
import { h } from './dom';
import { showModal } from './modal';

/** What the automation did while the player was away, read from the offline events. */
export interface AwayTotals {
  harvested: Partial<Record<CropId, number>>;
  harvestedTotal: number;
  shipped: number;
  gold: number;
  withered: number;
  /** Catches the fish traps made while away (fish and junk). */
  trapCatches: number;
  /** Dishes that finished cooking, by recipe (hearty ones counted separately). */
  cooked: Partial<Record<RecipeId, number>>;
  cookedTotal: number;
  heartyTotal: number;
  /** Buffs that ran out while away. */
  buffsExpired: number;
  /** Skill levels reached, goals and milestones finished while away (phase 07). */
  levelUps: { skill: string; level: number }[];
  goalsDone: number;
  milestonesDone: number;
  /** Trees that turned mature while away, and fruit that grew on the trees (orchard, v2 phase 03). */
  treesMatured: TreeId[];
  fruitGrown: Partial<Record<FruitId, number>>;
  fruitGrownTotal: number;
}

export function awayTotals(report: OfflineReport): AwayTotals {
  const t: AwayTotals = {
    harvested: {},
    harvestedTotal: 0,
    shipped: 0,
    gold: 0,
    withered: 0,
    trapCatches: 0,
    cooked: {},
    cookedTotal: 0,
    heartyTotal: 0,
    buffsExpired: 0,
    levelUps: [],
    goalsDone: 0,
    milestonesDone: 0,
    treesMatured: [],
    fruitGrown: {},
    fruitGrownTotal: 0,
  };
  for (const e of report.events) {
    if (e.type === 'harvested') {
      t.harvested[e.crop] = (t.harvested[e.crop] ?? 0) + e.qty;
      t.harvestedTotal += e.qty;
    } else if (e.type === 'binCollected') {
      t.shipped += e.items;
    } else if (e.type === 'goldEarned') {
      t.gold += e.amount;
    } else if (e.type === 'seasonChanged') {
      t.withered += e.withered;
    } else if (e.type === 'caught' && e.viaTrap) {
      t.trapCatches += 1;
    } else if (e.type === 'cooked') {
      t.cooked[e.recipe] = (t.cooked[e.recipe] ?? 0) + 1;
      t.cookedTotal += 1;
      if (e.hearty) t.heartyTotal += 1;
    } else if (e.type === 'buffExpired') {
      t.buffsExpired += 1;
    } else if (e.type === 'levelUp') {
      t.levelUps.push({ skill: e.skill, level: e.level });
    } else if (e.type === 'treeMatured') {
      t.treesMatured.push(e.tree);
    } else if (e.type === 'fruitGrown') {
      t.fruitGrown[e.fruit] = (t.fruitGrown[e.fruit] ?? 0) + e.qty;
      t.fruitGrownTotal += e.qty;
    } else if (e.type === 'questDone') {
      if (e.kind === 'goal') t.goalsDone += 1;
      else t.milestonesDone += 1;
    }
  }
  return t;
}

/** Facts about the farm now that the events cannot tell: crops waiting, and plots left dry. */
export interface AwayFarm {
  readyPlots: number;
  dryPlots: number;
}

/** One row of the summary with a small icon. */
export interface AwayRow {
  icon: string; // sprite id
  text: string;
}

/**
 * The summary as rows with icons. Collapsed (no rows) when nothing happened: the farm only rested.
 */
export function awayRows(report: OfflineReport, farm: AwayFarm): AwayRow[] {
  const t = awayTotals(report);
  const rows: AwayRow[] = [];
  const crops = Object.entries(t.harvested) as [CropId, number][];
  if (t.harvestedTotal > 0) {
    const top = crops.sort((a, b) => b[1] - a[1]);
    const first = top[0]!;
    const rest = top.length > 1 ? ` and ${top.length - 1} other kind${top.length > 2 ? 's' : ''}` : '';
    rows.push({
      icon: `item_${first[0]}`,
      text: `${t.harvestedTotal} crop${t.harvestedTotal === 1 ? '' : 's'} harvested (${first[1]} ${GAME_DATA.crops[first[0]].name}${rest}).`,
    });
  }
  if (t.cookedTotal > 0) {
    const [first] = (Object.entries(t.cooked) as [RecipeId, number][]).sort((a, b) => b[1] - a[1]);
    const hearty = t.heartyTotal > 0 ? ` (${t.heartyTotal} hearty)` : '';
    rows.push({
      icon: `item_${first![0]}`,
      text: `${t.cookedTotal} dish${t.cookedTotal === 1 ? '' : 'es'} finished cooking${hearty}.`,
    });
  }
  for (const tree of t.treesMatured) {
    const def = GAME_DATA.trees[tree];
    rows.push({
      icon: `item_${fruitOfTree(tree)}`,
      text: `Your ${def.name.toLowerCase()} tree is ready to bear.`,
    });
  }
  if (t.fruitGrownTotal > 0) {
    const grown = (Object.entries(t.fruitGrown) as [FruitId, number][]).sort((a, b) => b[1] - a[1]);
    const first = grown[0]!;
    const rest = grown.length > 1 ? ` and ${grown.length - 1} other kind${grown.length > 2 ? 's' : ''}` : '';
    rows.push({
      icon: `item_${first[0]}`,
      text: `+${t.fruitGrownTotal} fruit grew on the trees (${first[1]} ${GAME_DATA.items[first[0]]!.name}${rest}).`,
    });
  }
  if (t.buffsExpired > 0) {
    rows.push({
      icon: 'buff_growth',
      text: `${t.buffsExpired} food buff${t.buffsExpired === 1 ? '' : 's'} wore off while you were away.`,
    });
  }
  if (t.trapCatches > 0) {
    rows.push({
      icon: 'obj_fish_trap_full',
      text: `Your traps caught ${t.trapCatches} thing${t.trapCatches === 1 ? '' : 's'} from the water.`,
    });
  }
  if (t.shipped > 0) {
    rows.push({
      icon: 'obj_shipping_bin',
      text: `${t.shipped} item${t.shipped === 1 ? '' : 's'} shipped.`,
    });
  }
  if (t.levelUps.length > 0) {
    const best = new Map<string, number>();
    for (const l of t.levelUps) best.set(l.skill, Math.max(best.get(l.skill) ?? 0, l.level));
    const text = [...best]
      .map(([skill, level]) => `${SKILL_NAMES[skill as SkillId]} level ${level}`)
      .join(', ');
    rows.push({
      icon: SKILL_ICONS[[...best.keys()][0] as SkillId],
      text: `Skills grew while you were away: ${text}.`,
    });
  }
  if (t.goalsDone + t.milestonesDone > 0) {
    const parts = [
      t.goalsDone > 0 ? `${t.goalsDone} goal${t.goalsDone === 1 ? '' : 's'}` : '',
      t.milestonesDone > 0 ? `${t.milestonesDone} milestone${t.milestonesDone === 1 ? '' : 's'}` : '',
    ].filter(Boolean);
    rows.push({ icon: 'ui_gold', text: `You finished ${parts.join(' and ')}. See the Goals panel.` });
  }
  if (t.gold > 0) rows.push({ icon: 'ui_gold', text: `${t.gold.toLocaleString('en-US')}g earned.` });
  if (t.withered > 0) {
    rows.push({
      icon: 'crop_dead',
      text: `${t.withered} crop${t.withered === 1 ? '' : 's'} withered at the change of season.`,
    });
  }
  if (farm.dryPlots > 0) {
    rows.push({
      icon: 'tile_soil_dry',
      text: `${farm.dryPlots} plot${farm.dryPlots === 1 ? ' is' : 's are'} dry and growing slowly.`,
    });
  }
  if (farm.readyPlots > 0) {
    rows.push({
      icon: 'ui_tool_hand',
      text: `${farm.readyPlots} crop${farm.readyPlots === 1 ? ' is' : 's are'} ready to harvest.`,
    });
  }
  return rows;
}

export function awaySummaryLines(report: OfflineReport): string[] {
  const lines = [`You were away for ${formatDuration(report.awayMs)}.`];
  lines.push(
    report.simulatedMs > 0
      ? `The farm kept busy for ${formatDuration(report.simulatedMs)}.`
      : 'The farm rested while you were gone.',
  );
  if (report.awayMs > report.simulatedMs) {
    lines.push('(Time away counts fully for 8 hours, then at a quarter pace up to a day.)');
  }
  for (const e of report.events) {
    if (e.type === 'seasonChanged') lines.push(`${capitalize(e.season)} arrived.`);
  }
  if (report.dayStarts > 0)
    lines.push('A new morning dawned over the farm, with new specials at the market.');
  return lines;
}

export function showAwaySummary(
  report: OfflineReport,
  farm: AwayFarm = { readyPlots: 0, dryPlots: 0 },
): void {
  const lines = awaySummaryLines(report);
  const rows = awayRows(report, farm);
  // Collapsed when nothing happened: one calm line instead of a list.
  const shown = rows.length === 0 ? lines.slice(0, 2) : lines;
  const body = h(
    'div',
    { class: 'away' },
    ...shown.map((t) => h('p', { text: t })),
    rows.length > 0
      ? h(
          'ul',
          { class: 'away-rows' },
          ...rows.map((r) =>
            h(
              'li',
              { class: 'away-row' },
              h('img', { class: 'pixel', alt: '', width: 24, height: 24, src: spriteDataUrl(r.icon) }),
              h('span', { text: r.text }),
            ),
          ),
        )
      : null,
  );
  showModal({ title: 'While you were away…', body, buttons: [{ label: 'Back to the farm', primary: true }] });
}
