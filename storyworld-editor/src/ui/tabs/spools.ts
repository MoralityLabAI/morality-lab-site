import { el } from '../dom';
import { Store, touchStoryworld, getSelectedSpool } from '../store';
import { Spool } from '../../Spool';
import { UUID } from '../../UUID';

export function renderSpoolsTab(store: Store): HTMLElement {
  const state = store.getState();
  const storyworld = state.storyworld;
  const selectedSpool = getSelectedSpool(state);

  const container = el('div', { className: 'sw-spools' });
  const leftCol = el('div', { className: 'sw-panel sw-col' });
  const centerCol = el('div', { className: 'sw-panel sw-col sw-col-wide' });
  const rightCol = el('div', { className: 'sw-panel sw-col' });

  const spoolHeader = el('div', { className: 'sw-section-header' }, el('span', { text: 'Spools:' }));
  const spoolButtons = el('div', { className: 'sw-button-row' });
  const addSpoolBtn = el('button', { text: '+' });
  const removeSpoolBtn = el('button', { text: '-' });
  spoolButtons.append(addSpoolBtn, removeSpoolBtn);

  const spoolList = el('select', { attrs: { size: '12' }, className: 'sw-listbox' }) as HTMLSelectElement;
  for (const spool of storyworld.spools) {
    const label = spool.spool_name || spool.name || spool.id;
    const opt = el('option', { text: label, attrs: { value: spool.id } }) as HTMLOptionElement;
    if (spool.id === state.selections.spoolId) opt.selected = true;
    spoolList.appendChild(opt);
  }
  spoolList.addEventListener('change', () => store.selectSpool(spoolList.value || null));

  addSpoolBtn.addEventListener('click', () => {
    const spool = new Spool(`spool_${UUID.v4()}`, 'New Spool');
    storyworld.spools.push(spool);
    storyworld.spool_directory.set(spool.id, spool);
    touchStoryworld(storyworld);
    store.selectSpool(spool.id);
  });
  removeSpoolBtn.addEventListener('click', () => {
    const spool = getSelectedSpool(store.getState());
    if (!spool) return;
    storyworld.spools = storyworld.spools.filter((entry) => entry !== spool);
    storyworld.spool_directory.delete(spool.id);
    touchStoryworld(storyworld);
    store.selectSpool(null);
  });

  leftCol.append(spoolHeader, spoolButtons, spoolList);

  const topRow = el('div', { className: 'sw-row' });
  const nameInput = el('input', {
    attrs: { type: 'text', value: selectedSpool?.spool_name ?? selectedSpool?.name ?? '' },
    className: 'sw-title-input',
  }) as HTMLInputElement;
  const activeToggle = el('label', { className: 'sw-toggle' },
    el('input', { attrs: { type: 'checkbox' } }) as HTMLInputElement,
    el('span', { text: 'Active at start of play' })
  );
  const activeCheckbox = activeToggle.querySelector('input') as HTMLInputElement;
  activeCheckbox.checked = Boolean(selectedSpool?.active_at_start);
  topRow.append(el('label', { text: 'Spool Name' }), nameInput, activeToggle);

  nameInput.addEventListener('input', () => {
    const spool = getSelectedSpool(store.getState());
    if (!spool) return;
    spool.spool_name = nameInput.value;
    spool.name = nameInput.value;
    touchStoryworld(storyworld);
  });
  activeCheckbox.addEventListener('change', () => {
    const spool = getSelectedSpool(store.getState());
    if (!spool) return;
    spool.active_at_start = activeCheckbox.checked;
    touchStoryworld(storyworld);
  });
  const spoolEncountersSection = el('div', { className: 'sw-spool-body' });
  const spoolEncountersHeader = el('div', { className: 'sw-section-header', text: 'Encounters in this spool' });
  const spoolEncountersList = el('select', { attrs: { size: '10' }, className: 'sw-listbox' }) as HTMLSelectElement;
  const addEncounterBtn = el('button', { text: 'Add encounter' });
  const removeEncounterBtn = el('button', { text: 'Remove encounter' });

  if (selectedSpool) {
    const encounterIds = [...selectedSpool.encounter_ids];
    for (const encId of encounterIds) {
      const encounter = storyworld.encounter_directory.get(encId);
      if (!encounter) continue;
      spoolEncountersList.appendChild(
        el('option', { text: encounter.title || encounter.id, attrs: { value: encounter.id } }) as HTMLOptionElement
      );
    }
  }

  const searchRow = el('div', { className: 'sw-row' });
  const searchLabel = el('label', { text: 'Search Encounter:' });
  const searchInput = el('input', { attrs: { type: 'text', placeholder: 'Search' } }) as HTMLInputElement;
  searchRow.append(searchLabel, searchInput);

  const sortRow = el('div', { className: 'sw-row' });
  const sortSelect = el('select');
  sortSelect.append(el('option', { text: 'Alphabetical', attrs: { value: 'alphabetical' } }));
  const sortDirBtn = el('button', { text: 'A/Z' });
  const sortMoreBtn = el('button', { text: '...' });
  sortRow.append(el('label', { text: 'Sort by:' }), sortSelect, sortDirBtn, sortMoreBtn);

  let sortAsc = true;
  sortDirBtn.addEventListener('click', () => {
    sortAsc = !sortAsc;
    sortDirBtn.textContent = sortAsc ? 'A/Z' : 'Z/A';
    renderAllEncounters();
  });
  sortSelect.addEventListener('change', () => renderAllEncounters());
  searchInput.addEventListener('input', () => renderAllEncounters());

  const allEncountersList = el('select', { attrs: { size: '12' }, className: 'sw-listbox' }) as HTMLSelectElement;
  const renderAllEncounters = () => {
    allEncountersList.innerHTML = '';
    const term = searchInput.value.trim().toLowerCase();
    let encounters = [...storyworld.encounters];
    if (sortSelect.value === 'alphabetical') {
      encounters.sort((a, b) => a.title.localeCompare(b.title));
    }
    if (!sortAsc) encounters.reverse();
    for (const encounter of encounters) {
      const text = encounter.title || encounter.id;
      if (term && !text.toLowerCase().includes(term)) continue;
      const option = el('option', { text, attrs: { value: encounter.id } }) as HTMLOptionElement;
      allEncountersList.appendChild(option);
    }
  };
  renderAllEncounters();

  addEncounterBtn.addEventListener('click', () => {
    const spool = getSelectedSpool(store.getState());
    if (!spool) return;
    const selectedId = allEncountersList.value;
    if (!selectedId) return;
    if (!spool.encounter_ids.includes(selectedId)) {
      spool.encounter_ids.push(selectedId);
      touchStoryworld(storyworld);
      store.setState({ storyworld });
    }
  });
  removeEncounterBtn.addEventListener('click', () => {
    const spool = getSelectedSpool(store.getState());
    if (!spool) return;
    const selectedId = spoolEncountersList.value;
    if (!selectedId) return;
    spool.encounter_ids = spool.encounter_ids.filter((id) => id !== selectedId);
    touchStoryworld(storyworld);
    store.setState({ storyworld });
  });

  spoolEncountersSection.append(
    el('div', { className: 'sw-row' }, addEncounterBtn, removeEncounterBtn),
    spoolEncountersList
  );

  centerCol.append(topRow, spoolEncountersHeader, spoolEncountersSection);
  rightCol.append(
    el('div', { className: 'sw-section-header', text: 'All encounters' }),
    searchRow,
    sortRow,
    allEncountersList
  );

  container.append(leftCol, centerCol, rightCol);
  return container;
}
