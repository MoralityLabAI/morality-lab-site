import { el, clear } from '../dom';
import { Store } from '../store';
import { Rehearsal } from '../../Rehearsal';
import { HB_Record } from '../../HB_Record';
import { Encounter } from '../../Encounter';

type RehearsalTab = 'events' | 'cast' | 'outcomes';

interface RehearsalUIState {
  rehearsal: Rehearsal | null;
  intervalId: number | null;
  speedMs: number;
  activeTab: RehearsalTab;
  expanded: boolean;
}

const uiState: RehearsalUIState = {
  rehearsal: null,
  intervalId: null,
  speedMs: 1000,
  activeTab: 'events',
  expanded: false,
};

const formatEncounter = (encounter: Encounter | null): string => {
  if (!encounter) return '[None]';
  return encounter.title || encounter.id || '[Untitled Encounter]';
};

const collectPaths = (root: any): { path: HB_Record[] }[] => {
  const results: { path: HB_Record[] }[] = [];
  if (!root) return results;

  const dfs = (node: any, path: HB_Record[]) => {
    const record: HB_Record = node.get_metadata(0);
    const nextPath = [...path, record];
    const children = node.get_children();
    if (!children || children.length === 0) {
      results.push({ path: nextPath });
      return;
    }
    for (const child of children) {
      dfs(child, nextPath);
    }
  };

  dfs(root, []);
  return results;
};

const summarizePath = (records: HB_Record[]): string => {
  const events = records
    .map((record) => record.encounter)
    .filter((encounter): encounter is Encounter => Boolean(encounter))
    .map((encounter) => encounter.title || encounter.id || '[Encounter]');
  if (!events.length) return 'Start';
  return events.join(' -> ');
};

const computeEventIndex = (rehearsal: Rehearsal) => {
  const encounterMap = new Map<string, Encounter>();
  rehearsal.storyworld.encounters.forEach((encounter) => {
    encounterMap.set(encounter.id, encounter);
  });

  const pathCounts = new Map<string, number>();
  const reachable = new Map<string, boolean>();
  const pathSamples = new Map<string, string[]>();

  const paths = collectPaths(rehearsal.history.root);
  for (const { path } of paths) {
    const unique = new Set<string>();
    path.forEach((record) => {
      const encounter = record.encounter;
      if (!encounter) return;
      reachable.set(encounter.id, true);
      unique.add(encounter.id);
    });
    unique.forEach((id) => {
      pathCounts.set(id, (pathCounts.get(id) ?? 0) + 1);
      const list = pathSamples.get(id) ?? [];
      if (list.length < 3) {
        list.push(summarizePath(path));
      }
      pathSamples.set(id, list);
    });
  }

  return { encounterMap, pathCounts, reachable, pathSamples };
};

const computeCastIndex = (rehearsal: Rehearsal) => {
  const stats: {
    characterId: string;
    characterName: string;
    propertyId: string;
    propertyName: string;
    min: number;
    max: number;
    avg: number;
  }[] = [];
  const storyworld = rehearsal.storyworld;
  const records = rehearsal.hb_record_list;
  for (const character of storyworld.characters) {
    for (const prop of storyworld.authored_properties) {
      const values: number[] = [];
      for (const record of records) {
        const map = record.relationship_values[character.id];
        if (map && map instanceof Map && map.has(prop.id)) {
          values.push(map.get(prop.id));
        }
      }
      const fallback = prop.default_value ?? 0;
      const min = values.length ? Math.min(...values) : fallback;
      const max = values.length ? Math.max(...values) : fallback;
      const avg = values.length ? values.reduce((a, b) => a + b, 0) / values.length : fallback;
      stats.push({
        characterId: character.id,
        characterName: character.name || character.id,
        propertyId: prop.id,
        propertyName: prop.property_name || prop.id,
        min,
        max,
        avg,
      });
    }
  }
  return stats;
};

const computeOutcomeIndex = (rehearsal: Rehearsal) => {
  const outcomes: {
    encounter: Encounter | null;
    path: string;
    length: number;
    optionCount: number;
    reactionCount: number;
  }[] = [];
  const paths = collectPaths(rehearsal.history.root);
  for (const { path } of paths) {
    const last = path[path.length - 1];
    if (!last || !last.is_an_ending_leaf) continue;
    const optionCount = path.filter((record) => Boolean(record.player_choice)).length;
    const reactionCount = path.filter((record) => Boolean(record.antagonist_choice)).length;
    outcomes.push({
      encounter: last.encounter,
      path: summarizePath(path),
      length: path.length,
      optionCount,
      reactionCount,
    });
  }
  return outcomes;
};

const stopInterval = () => {
  if (uiState.intervalId !== null) {
    window.clearInterval(uiState.intervalId);
    uiState.intervalId = null;
  }
};

export function renderRehearsalTab(store: Store): HTMLElement {
  stopInterval();
  const storyworld = store.getState().storyworld;
  const container = el('div', { className: 'sw-panel sw-rehearsal' });

  const controls = el('div', { className: 'sw-row sw-rehearsal-toolbar' });
  const playBtn = el('button', { text: 'Play' });
  const resetBtn = el('button', { text: 'Reset' });
  const refreshBtn = el('button', { text: 'Refresh' });
  const speedInput = el('input', {
    attrs: { type: 'number', value: String(uiState.speedMs), min: '100', step: '100' },
  }) as HTMLInputElement;
  const saveBtn = el('button', { text: 'Save Report' });
  controls.append(playBtn, resetBtn, refreshBtn, el('label', { text: 'Speed' }), speedInput, saveBtn);

  const tabRow = el('div', { className: 'sw-subtabs sw-rehearsal-tabs' });
  const eventTab = el('button', { text: 'Event Index' });
  const castTab = el('button', { text: 'Cast Properties Index' });
  const outcomeTab = el('button', { text: 'Notable Outcome Index' });
  tabRow.append(eventTab, castTab, outcomeTab);

  const treeControls = el('div', { className: 'sw-row sw-rehearsal-tree-controls' });
  const collapseBtn = el('button', { text: 'Collapse All' });
  const expandBtn = el('button', { text: 'Expand All' });
  treeControls.append(collapseBtn, expandBtn);

  const panelEvents = el('div', { className: 'sw-rehearsal-panel' });
  const panelCast = el('div', { className: 'sw-rehearsal-panel' });
  const panelOutcomes = el('div', { className: 'sw-rehearsal-panel' });

  const table = el('table', { className: 'sw-table sw-rehearsal-table' });
  const thead = el('thead', {},
    el('tr', {},
      el('th', { text: 'Event' }),
      el('th', { text: 'Reachable' }),
      el('th', { text: 'Yielding Paths' })
    )
  );
  const tbody = el('tbody');
  table.append(thead, tbody);
  panelEvents.append(table);

  const castTable = el('table', { className: 'sw-table sw-rehearsal-table' });
  castTable.append(
    el('thead', {},
      el('tr', {},
        el('th', { text: 'Character' }),
        el('th', { text: 'Property' }),
        el('th', { text: 'Min' }),
        el('th', { text: 'Max' }),
        el('th', { text: 'Avg' })
      )
    ),
    el('tbody')
  );
  panelCast.append(castTable);

  const outcomeTable = el('table', { className: 'sw-table sw-rehearsal-table' });
  outcomeTable.append(
    el('thead', {},
      el('tr', {},
        el('th', { text: 'Outcome' }),
        el('th', { text: 'Path Length' }),
        el('th', { text: 'Options' }),
        el('th', { text: 'Reactions' }),
        el('th', { text: 'Sample Path' })
      )
    ),
    el('tbody')
  );
  panelOutcomes.append(outcomeTable);

  container.append(controls, tabRow, treeControls, panelEvents, panelCast, panelOutcomes);

  const setActiveTab = (tab: RehearsalTab) => {
    uiState.activeTab = tab;
    eventTab.className = tab === 'events' ? 'active' : '';
    castTab.className = tab === 'cast' ? 'active' : '';
    outcomeTab.className = tab === 'outcomes' ? 'active' : '';
    panelEvents.style.display = tab === 'events' ? 'block' : 'none';
    panelCast.style.display = tab === 'cast' ? 'block' : 'none';
    panelOutcomes.style.display = tab === 'outcomes' ? 'block' : 'none';
  };

  const renderEventIndex = () => {
    clear(tbody);
    if (!uiState.rehearsal) return;
    const report = computeEventIndex(uiState.rehearsal);
    storyworld.encounters.forEach((encounter) => {
      const reachable = report.reachable.get(encounter.id) ? 'Yes' : 'No';
      const pathCount = report.pathCounts.get(encounter.id) ?? 0;
      const row = el('tr', {},
        el('td', { text: formatEncounter(encounter) }),
        el('td', { text: reachable }),
        el('td', { text: String(pathCount) })
      );
      tbody.appendChild(row);
      if (uiState.expanded) {
        const details = report.pathSamples.get(encounter.id) ?? [];
        const detailText = details.length ? details.join(' | ') : 'No paths.';
        const detailRow = el('tr', { className: 'sw-rehearsal-detail' },
          el('td', { attrs: { colSpan: '3' }, text: detailText })
        );
        tbody.appendChild(detailRow);
      }
    });
  };

  const renderCastIndex = () => {
    const castBody = castTable.querySelector('tbody') as HTMLTableSectionElement;
    clear(castBody);
    if (!uiState.rehearsal) return;
    const stats = computeCastIndex(uiState.rehearsal);
    stats.forEach((row) => {
      castBody.append(
        el('tr', {},
          el('td', { text: row.characterName }),
          el('td', { text: row.propertyName }),
          el('td', { text: row.min.toFixed(2) }),
          el('td', { text: row.max.toFixed(2) }),
          el('td', { text: row.avg.toFixed(2) })
        )
      );
    });
  };

  const renderOutcomeIndex = () => {
    const outcomeBody = outcomeTable.querySelector('tbody') as HTMLTableSectionElement;
    clear(outcomeBody);
    if (!uiState.rehearsal) return;
    const outcomes = computeOutcomeIndex(uiState.rehearsal);
    outcomes.forEach((row) => {
      outcomeBody.append(
        el('tr', {},
          el('td', { text: formatEncounter(row.encounter) }),
          el('td', { text: String(row.length) }),
          el('td', { text: String(row.optionCount) }),
          el('td', { text: String(row.reactionCount) }),
          el('td', { text: row.path })
        )
      );
    });
  };

  const ensureRehearsal = () => {
    uiState.rehearsal = new Rehearsal(storyworld);
    uiState.rehearsal.begin_playthrough();
  };

  const refreshReport = () => {
    ensureRehearsal();
    renderEventIndex();
    renderCastIndex();
    renderOutcomeIndex();
  };

  const tick = () => {
    if (!uiState.rehearsal) {
      ensureRehearsal();
    }
    const done = uiState.rehearsal!.rehearse_depth_first();
    renderEventIndex();
    renderCastIndex();
    renderOutcomeIndex();
    if (done) {
      stopInterval();
    }
  };

  playBtn.addEventListener('click', () => {
    if (uiState.intervalId) {
      stopInterval();
      playBtn.textContent = 'Play';
      return;
    }
    playBtn.textContent = 'Pause';
    uiState.intervalId = window.setInterval(tick, uiState.speedMs);
  });

  resetBtn.addEventListener('click', () => {
    stopInterval();
    playBtn.textContent = 'Play';
    if (uiState.rehearsal) {
      uiState.rehearsal.clear_history();
      uiState.rehearsal.begin_playthrough();
    }
    renderEventIndex();
  });

  refreshBtn.addEventListener('click', () => {
    stopInterval();
    playBtn.textContent = 'Play';
    ensureRehearsal();
    let guard = 0;
    while (guard < 5000 && uiState.rehearsal && !uiState.rehearsal.rehearse_depth_first()) {
      guard += 1;
    }
    renderEventIndex();
    renderCastIndex();
    renderOutcomeIndex();
  });

  speedInput.addEventListener('change', () => {
    const value = Number(speedInput.value || 1000);
    uiState.speedMs = Math.max(100, value);
    if (uiState.intervalId) {
      stopInterval();
      uiState.intervalId = window.setInterval(tick, uiState.speedMs);
    }
  });

  const serializeTree = (node: any): any => {
    const record: HB_Record = node.get_metadata(0);
    return {
      encounter: record.encounter ? { id: record.encounter.id, title: record.encounter.title } : null,
      option: record.player_choice ? { id: record.player_choice.id, text: record.player_choice.text } : null,
      reaction: record.antagonist_choice ? { id: record.antagonist_choice.id, text: record.antagonist_choice.text } : null,
      turn: record.turn,
      ending: record.is_an_ending_leaf,
      children: node.get_children().map((child: any) => serializeTree(child)),
    };
  };

  saveBtn.addEventListener('click', () => {
    if (!uiState.rehearsal) return;
    const report = computeEventIndex(uiState.rehearsal);
    const cast = computeCastIndex(uiState.rehearsal);
    const outcomes = computeOutcomeIndex(uiState.rehearsal);
    const data = {
      events: storyworld.encounters.map((encounter) => ({
        id: encounter.id,
        title: encounter.title,
        reachable: report.reachable.get(encounter.id) ?? false,
        yielding_paths: report.pathCounts.get(encounter.id) ?? 0,
        sample_paths: report.pathSamples.get(encounter.id) ?? [],
      })),
      cast,
      outcomes,
      tree: uiState.rehearsal.history.root ? serializeTree(uiState.rehearsal.history.root) : null,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'rehearsal-report.json';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  });

  collapseBtn.addEventListener('click', () => {
    uiState.expanded = false;
    renderEventIndex();
  });

  expandBtn.addEventListener('click', () => {
    uiState.expanded = true;
    renderEventIndex();
  });

  eventTab.addEventListener('click', () => setActiveTab('events'));
  castTab.addEventListener('click', () => setActiveTab('cast'));
  outcomeTab.addEventListener('click', () => setActiveTab('outcomes'));

  setActiveTab(uiState.activeTab);
  refreshReport();

  return container;
}
