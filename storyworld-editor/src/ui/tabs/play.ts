import { el } from '../dom';
import { Store, getSelectedEncounter } from '../store';
import { evaluateBool } from '../../scriptAst';

export function renderPlayTab(store: Store): HTMLElement {
  const state = store.getState();
  const storyworld = state.storyworld;
  const encounter = getSelectedEncounter(state);
  const container = el('div', { className: 'sw-panel sw-play' });
  const controls = el('div', { className: 'sw-row' });
  const pauseBtn = el('button', { text: 'Pause' });
  const resetBtn = el('button', { text: 'Reset' });
  const refreshBtn = el('button', { text: 'Refresh' });
  const speedInput = el('input', { attrs: { type: 'number', value: '1', min: '0', step: '0.1' } }) as HTMLInputElement;
  const saveBtn = el('button', { text: 'Save Report' });
  controls.append(pauseBtn, resetBtn, refreshBtn, el('label', { text: 'Speed' }), speedInput, saveBtn);

  const tabRow = el('div', { className: 'sw-subtabs' },
    el('button', { text: 'Encounter Log' }),
    el('button', { text: 'Antagonist' }),
    el('button', { text: 'Storyworld' })
  );

  const table = el('table', { className: 'sw-table' });
  table.append(
    el('thead', {},
      el('tr', {},
        el('th', { text: 'Event' }),
        el('th', { text: 'Reachable' }),
        el('th', { text: 'Yielding Paths' })
      )
    ),
    el('tbody', {}, el('tr', {}, el('td', { text: '—' }), el('td', { text: '—' }), el('td', { text: '—' })))
  );

  container.append(controls, tabRow, table);
  if (encounter) {
    const preview = el('div', { className: 'sw-panel', text: `Preview: ${encounter.title}` });
    const list = el('ul');
    const visibleOptions = encounter.options.filter((option) => {
      if (!option.visibility_ast) return true;
      return evaluateBool(option.visibility_ast, { storyworld });
    });
    if (visibleOptions.length === 0) {
      list.appendChild(el('li', { text: 'No visible options.' }));
    } else {
      visibleOptions.forEach((option) => {
        list.appendChild(el('li', { text: option.text || '(Option)' }));
      });
    }
    preview.appendChild(list);
    container.appendChild(preview);
  }
  return container;
}
