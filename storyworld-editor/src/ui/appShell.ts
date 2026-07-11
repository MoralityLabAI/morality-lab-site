import { el, clear } from './dom';
import { Store, TabKey } from './store';
import { renderOverviewTab } from './tabs/overview';
import { renderEncountersTab } from './tabs/encounters';
import { renderSpoolsTab } from './tabs/spools';
import { renderCharactersTab } from './tabs/characters';
import { renderPersonalityTab } from './tabs/personality';
import { renderPlayTab } from './tabs/play';
import { renderAIConsoleTab } from './tabs/aiConsole';
import { renderGraphViewTab } from './tabs/graphView';
import { renderRehearsalTab } from './tabs/rehearsal';
import { StoryworldIO } from '../StoryworldIO';
import { StoryworldSerializer } from '../StoryworldSerializer';
import { attachManifoldListener, sendStoryworldToManifold } from './manifoldBridge';

const tabs: TabKey[] = [
  'Overview',
  'Encounters',
  'Spools',
  'Characters',
  'Personality Model',
  'Settings',
  'Documentation',
  'Graph View',
  'Play',
  'Rehearsal',
  'AI Console',
];

const formatNumber = (value: number) => value.toFixed(2).replace(/\.00$/, '');

const computeMetrics = (store: Store) => {
  const storyworld = store.getState().storyworld;
  const encounters = storyworld.encounters.length;
  let optionCount = 0;
  let reactionCount = 0;
  let effectCount = 0;
  let endings = 0;
  for (const encounter of storyworld.encounters) {
    optionCount += encounter.options.length;
    if (encounter.options.length === 0) {
      endings += 1;
    }
    for (const option of encounter.options) {
      reactionCount += option.reactions.length;
      for (const reaction of option.reactions) {
        const afterCount = reaction.after_effects?.length ?? 0;
        const effectCountForReaction = afterCount || (reaction.effects?.length ?? 0);
        effectCount += effectCountForReaction;
      }
    }
  }
  return {
    encounters,
    avgOptions: encounters ? optionCount / encounters : 0,
    avgReactions: optionCount ? reactionCount / optionCount : 0,
    avgEffects: reactionCount ? effectCount / reactionCount : 0,
    endings,
  };
};

function renderTabContent(store: Store): HTMLElement {
  const state = store.getState();
  switch (state.activeTab) {
    case 'Overview':
      return renderOverviewTab(store);
    case 'Encounters':
      return renderEncountersTab(store);
    case 'Spools':
      return renderSpoolsTab(store);
    case 'Characters':
      return renderCharactersTab(store);
    case 'Personality Model':
      return renderPersonalityTab(store);
    case 'Play':
      return renderPlayTab(store);
    case 'AI Console':
      return renderAIConsoleTab(store);
    case 'Graph View':
      return renderGraphViewTab(store);
    case 'Rehearsal':
      return renderRehearsalTab(store);
    default:
      return el('div', { className: 'sw-placeholder', text: `${state.activeTab} coming soon.` });
  }
}

export function createAppShell(store: Store): HTMLElement {
  const root = el('div', { className: 'sw-app' });
  const menuRow = el('div', { className: 'sw-menu-row' });
  const menuGroup = el('div', { className: 'sw-menu-group' });

  const fileButton = el('button', { className: 'sw-menu-button', text: 'File' });
  const viewButton = el('button', { className: 'sw-menu-button', text: 'View' });
  const helpButton = el('button', { className: 'sw-menu-button', text: 'Help' });
  const aiButton = el('button', { className: 'sw-menu-button', text: 'AI' });

  const fileMenu = el('div', { className: 'sw-menu-dropdown' });
  const loadButton = el('button', { className: 'sw-menu-item', text: 'Load JSON' });
  const saveButton = el('button', { className: 'sw-menu-item', text: 'Save JSON' });
  fileMenu.append(loadButton, saveButton);

  const aiMenu = el('div', { className: 'sw-menu-dropdown' });
  const aiConsoleButton = el('button', { className: 'sw-menu-item', text: 'AI Console' });
  aiMenu.append(aiConsoleButton);

  const fileInput = el('input', {
    attrs: { type: 'file', accept: '.json,.js' },
  }) as HTMLInputElement;
  fileInput.className = 'sw-hidden';

  fileButton.addEventListener('click', () => {
    fileMenu.classList.toggle('open');
    aiMenu.classList.remove('open');
  });

  aiButton.addEventListener('click', () => {
    aiMenu.classList.toggle('open');
    fileMenu.classList.remove('open');
  });

  aiConsoleButton.addEventListener('click', () => {
    aiMenu.classList.remove('open');
    store.setState({ activeTab: 'AI Console' });
  });

  loadButton.addEventListener('click', () => {
    fileMenu.classList.remove('open');
    fileInput.value = '';
    fileInput.click();
  });

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    const text = await file.text();
    const storyworld = store.getState().storyworld;
    const ok = StoryworldIO.load_into_storyworld(storyworld, text);
    if (ok) {
      store.setState({
        storyworld,
        selections: {
          encounterId: null,
          optionId: null,
          reactionId: null,
          spoolId: null,
          characterId: null,
          propertyId: null,
        },
      });
    }
  });

  saveButton.addEventListener('click', () => {
    fileMenu.classList.remove('open');
    const storyworld = store.getState().storyworld;
    const data = StoryworldSerializer.to_project_dict(storyworld);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${storyworld.storyworld_title || 'storyworld'}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  });

  menuGroup.append(fileButton, viewButton, helpButton, aiButton);
  menuRow.append(menuGroup, fileMenu, aiMenu, fileInput);

  const tabRow = el('div', { className: 'sw-tab-row' });
  const metricsRow = el('div', { className: 'sw-metrics-row' });
  const content = el('div', { className: 'sw-content' });

  const renderTabs = () => {
    clear(tabRow);
    const state = store.getState();
    for (const tab of tabs) {
      const tabButton = el('button', {
        className: tab === state.activeTab ? 'sw-tab active' : 'sw-tab',
        text: tab,
      });
      tabButton.addEventListener('click', () => store.setState({ activeTab: tab }));
      tabRow.appendChild(tabButton);
    }
  };

  let lastMetrics = computeMetrics(store);
  const renderMetrics = () => {
    const next = computeMetrics(store);
    metricsRow.innerHTML = '';
    const makeMetric = (label: keyof typeof next, title: string) => {
      const item = el('div', { className: 'sw-metric' });
      const valueEl = el('div', { className: 'sw-metric-value', text: formatNumber(next[label]) });
      if (next[label] !== (lastMetrics as any)[label]) {
        valueEl.classList.add('roll');
        setTimeout(() => valueEl.classList.remove('roll'), 400);
      }
      item.append(el('div', { className: 'sw-metric-label', text: title }), valueEl);
      return item;
    };
    metricsRow.append(
      makeMetric('encounters', 'Encounters'),
      makeMetric('avgOptions', 'Avg Options'),
      makeMetric('avgReactions', 'Avg Reactions'),
      makeMetric('avgEffects', 'Avg Effects'),
      makeMetric('endings', 'Endings')
    );
    lastMetrics = next;
  };

  const renderContent = () => {
    clear(content);
    content.appendChild(renderTabContent(store));
  };

  let manifoldListenerAttached = false;
  store.subscribe(() => {
    renderTabs();
    renderMetrics();
    renderContent();
    sendStoryworldToManifold(store.getState().storyworld);
    if (!manifoldListenerAttached) {
      manifoldListenerAttached = true;
      attachManifoldListener((id) => store.selectEncounter(id), () => store.getState().storyworld);
    }
  });

  renderTabs();
  renderMetrics();
  renderContent();

  root.append(menuRow, tabRow, metricsRow, content);
  return root;
}
