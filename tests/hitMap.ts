// Builds the hit map of a save: for every tile of the v2 world (rows 0 … 21), what a click or a placement finds there.
import { GAME_DATA } from '../src/data';
import { parseSave } from '../src/core/save';
import {
  buildZones,
  forSaleSignAt,
  plotIndexAt,
  townSiteAt,
  zoneAt,
  PLOT_ORIGIN,
  trapTile,
} from '../src/render/scene';
import { decorAt, tileProblem } from '../src/systems/decor';
import { treeAtTile } from '../src/systems/orchard';
import { objectAt } from '../src/systems/placement';
import { fixedBlockReason, regionAt } from '../src/data/world';

export function hitMap(text: string): string[] {
  const s = parseSave(text).state;
  const zones = buildZones(s.farm.grid);
  const out: string[] = [];
  for (let row = 0; row < 22; row++)
    for (let col = 0; col < 36; col++) {
      const plot = plotIndexAt(s.farm.grid, col, row, s.farm.greenhouse.length);
      const obj = objectAt(s, col - PLOT_ORIGIN.col, row - PLOT_ORIGIN.row);
      const traps = s.fishing.traps
        .filter((t) => {
          const a = trapTile(t.location, t.slot);
          return a.col === col && a.row === row;
        })
        .map((t) => t.id);
      out.push(
        [
          `${col},${row}`,
          zoneAt(zones, col, row)?.id ?? '-',
          plot,
          obj ? `${obj.kind}#${obj.id}` : '-',
          townSiteAt(col, row) ?? '-',
          forSaleSignAt(s.land.parcels, col, row) ?? '-',
          decorAt(s, GAME_DATA, col, row)?.id ?? '-',
          treeAtTile(s, col, row)?.id ?? '-',
          traps.join('+') || '-',
          regionAt(col, row),
          fixedBlockReason(col, row) ?? '-',
          tileProblem(s, GAME_DATA, col, row) ?? '-',
        ].join('|'),
      );
    }
  return out;
}
