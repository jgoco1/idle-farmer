// "While you were away…" (GDD §4). Stubbed in phase 01: it reports the time away and the calendar
// changes. Later phases add their lines from report.events (crops harvested, items shipped, …).

import type { OfflineReport } from '../core/offline';
import { capitalize, formatDuration } from '../core/time';
import { h } from './dom';
import { showModal } from './modal';

export function awaySummaryLines(report: OfflineReport, readyPlots = 0): string[] {
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
    if (e.type !== 'seasonChanged') continue;
    lines.push(`${capitalize(e.season)} arrived.`);
    if (e.withered > 0) {
      lines.push(`${e.withered} crop${e.withered === 1 ? '' : 's'} withered at the change of season.`);
    }
  }
  let binGold = 0;
  let binItems = 0;
  for (const e of report.events) {
    if (e.type !== 'binCollected') continue;
    binGold += e.gold;
    binItems += e.items;
  }
  if (binItems > 0) {
    lines.push(`The Shipping Bin was collected: ${binItems} item${binItems === 1 ? '' : 's'} sold for ${binGold}g.`);
  }
  if (report.dayStarts > 0) lines.push("A new morning dawned over the farm, with new specials at the market.");
  if (readyPlots > 0) {
    lines.push(`${readyPlots} crop${readyPlots === 1 ? ' is' : 's are'} ready to harvest.`);
  }
  return lines;
}

export function showAwaySummary(report: OfflineReport, readyPlots = 0): void {
  const lines = awaySummaryLines(report, readyPlots);
  const body = h('div', { class: 'away' }, ...lines.map((t) => h('p', { text: t })));
  showModal({ title: 'While you were away…', body, buttons: [{ label: 'Back to the farm', primary: true }] });
}
