// Panel definitions. Phase 01 ships every panel as a "Coming soon" stub except Settings.
// Each later phase replaces its stub's `build` with the real content.

import type { PanelId } from '../data/ids';
import { h } from './dom';
import type { PanelDef } from './panel';

function stub(id: PanelId, title: string, icon: string, blurb: string): PanelDef {
  return {
    id,
    title,
    icon,
    build(body) {
      body.append(
        h('p', { class: 'coming-soon', text: 'Coming soon' }),
        h('p', { class: 'muted', text: blurb }),
      );
    },
  };
}

export const STUB_PANELS: readonly PanelDef[] = [
  stub('inventory', 'Inventory', '🎒', 'Your harvest, catches and dishes will be kept here.'),
  stub('shop', 'Shop', '🛒', 'Seeds and recipe cards will be sold here.'),
  stub('market', 'Market', '⚖', 'Sell crops, fish and dishes at the day’s prices.'),
  stub('kitchen', 'Kitchen', '🍲', 'Cook what you grow and catch into dishes with gentle buffs.'),
  stub('fishing', 'Fishing', '🎣', 'Cast a line in the pond, and later the river and the sea.'),
  stub('upgrades', 'Upgrades', '⚙', 'Sprinklers, a farmhand and better tools will live here.'),
  stub('goals', 'Goals', '★', 'Milestones and the Community Board will point the way.'),
];

export interface SettingsHooks {
  getVolume(): number;
  setVolume(v: number): void;
  exportSave(): string;
  /** Returns an error message, or null when the save was imported. */
  importSave(text: string): string | null;
  hardReset(): void;
}

export function settingsPanel(hooks: SettingsHooks): PanelDef {
  return {
    id: 'settings',
    title: 'Settings',
    icon: '⚙',
    toolbar: false,
    build(body) {
      // Volume (stub until phase 08 adds audio).
      const vol = h('input', { type: 'range', min: 0, max: 100, step: 1, id: 'set-volume' });
      const volOut = h('output', { for: 'set-volume' });
      vol.addEventListener('input', () => {
        hooks.setVolume(Number(vol.value) / 100);
        volOut.textContent = `${vol.value}%`;
      });

      // Export.
      const exportBox = h('textarea', {
        class: 'save-text',
        readonly: true,
        rows: 3,
        'aria-label': 'Exported save',
      });
      const exportBtn = h('button', { type: 'button', class: 'btn', text: 'Export save' });
      const copyBtn = h('button', { type: 'button', class: 'btn', text: 'Copy', hidden: true });
      exportBtn.addEventListener('click', () => {
        exportBox.value = hooks.exportSave();
        exportBox.hidden = false;
        copyBtn.hidden = false;
        exportBox.select();
      });
      copyBtn.addEventListener('click', () => {
        void navigator.clipboard?.writeText(exportBox.value).then(
          () => (copyBtn.textContent = 'Copied!'),
          () => (copyBtn.textContent = 'Select and copy'),
        );
      });
      exportBox.hidden = true;

      // Import.
      const importBox = h('textarea', {
        class: 'save-text',
        rows: 3,
        placeholder: 'Paste an exported save here',
        'aria-label': 'Save to import',
      });
      const importBtn = h('button', { type: 'button', class: 'btn', text: 'Import save' });
      const importMsg = h('p', { class: 'form-msg', role: 'status' });
      importBtn.addEventListener('click', () => {
        const err = hooks.importSave(importBox.value);
        importMsg.textContent = err ?? 'Save imported. Welcome back!';
        importMsg.className = err ? 'form-msg form-error' : 'form-msg form-ok';
        if (!err) importBox.value = '';
      });

      // Hard reset with a confirmation step.
      const resetBtn = h('button', { type: 'button', class: 'btn btn-danger', text: 'Hard reset…' });
      const confirmRow = h(
        'div',
        { class: 'confirm-row', hidden: true },
        h('p', {
          class: 'form-error',
          text: 'This erases your farm for good. Export first if you might want it back.',
        }),
      );
      const yes = h('button', { type: 'button', class: 'btn btn-danger', text: 'Yes, erase my farm' });
      const no = h('button', { type: 'button', class: 'btn', text: 'Cancel' });
      confirmRow.append(h('div', { class: 'btn-row' }, yes, no));
      resetBtn.addEventListener('click', () => {
        confirmRow.hidden = false;
        resetBtn.hidden = true;
        no.focus();
      });
      no.addEventListener('click', () => {
        confirmRow.hidden = true;
        resetBtn.hidden = false;
        resetBtn.focus();
      });
      yes.addEventListener('click', () => {
        confirmRow.hidden = true;
        resetBtn.hidden = false;
        hooks.hardReset();
      });

      body.append(
        h('h3', { text: 'Sound' }),
        h('label', { class: 'field', for: 'set-volume' }, 'Volume ', vol, volOut),
        h('p', { class: 'muted', text: 'Sounds arrive in a later update.' }),
        h('h3', { text: 'Your save' }),
        h('div', { class: 'btn-row' }, exportBtn, copyBtn),
        exportBox,
        importBox,
        h('div', { class: 'btn-row' }, importBtn),
        importMsg,
        h('h3', { text: 'Start over' }),
        h('div', { class: 'btn-row' }, resetBtn),
        confirmRow,
      );

      return {
        refresh() {
          const v = Math.round(hooks.getVolume() * 100);
          vol.value = String(v);
          volOut.textContent = `${v}%`;
          exportBox.hidden = true;
          copyBtn.hidden = true;
          copyBtn.textContent = 'Copy';
          importMsg.textContent = '';
          confirmRow.hidden = true;
          resetBtn.hidden = false;
        },
      };
    },
  };
}
