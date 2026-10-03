// Writes tests/fixtures/store-demo.json, the farm the store screenshots show (`npm run shots:store`):
// the Active Player bot after two weeks (fields, greenhouse, orchard, ranch, decorations).
// Run after balance or content changes:  npm run demo-save

import { writeFileSync } from 'node:fs';
import { toSaveFile } from '../src/core/save';
import { runBot } from './sim/bots';

const run = runBot('active', { seed: 1, days: 14 });
writeFileSync('tests/fixtures/store-demo.json', JSON.stringify(toSaveFile(run.game.state, run.t)) + '\n');
const s = run.game.state;
console.log(
  `store-demo.json: ${s.gold} gold, ${s.farm.plots.length} plots, ${s.orchard.trees.length} trees, ` +
    `${s.ranch.animals.length} animals, ${s.decor.placed.length} decorations`,
);
