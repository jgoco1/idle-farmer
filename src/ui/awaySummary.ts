// "While you were away…" (GDD §4). Stubbed in phase 01: it reports the time away and the calendar
// changes. Later phases add their lines from report.events (crops harvested, items shipped, …).

import type { OfflineReport } from '../core/offline';
import { capitalize, formatDuration } from '../core/time';
import { h } from './dom';
import { showModal } from './modal';

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
  for (const s of report.seasonChanges) lines.push(`${capitalize(s)} arrived.`);
  if (report.dayStarts > 0) lines.push('A new morning dawned over the farm.');
  return lines;
}

export function showAwaySummary(report: OfflineReport): void {
  const body = h('div', { class: 'away' }, ...awaySummaryLines(report).map((t) => h('p', { text: t })));
  showModal({ title: 'While you were away…', body, buttons: [{ label: 'Back to the farm', primary: true }] });
}
