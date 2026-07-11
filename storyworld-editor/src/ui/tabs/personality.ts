import { el } from '../dom';
import { Store, touchStoryworld, getSelectedProperty } from '../store';
import { openNewPropertyModal } from '../modals/NewPropertyModal';
import { normalizePerceptionValue } from '../../perception';
import { possible_attribution_targets } from '../../BNumberBlueprint';

export function renderPersonalityTab(store: Store): HTMLElement {
  const state = store.getState();
  const storyworld = state.storyworld;
  const selectedProperty = getSelectedProperty(state);

  const container = el('div', { className: 'sw-personality' });
  const leftCol = el('div', { className: 'sw-panel sw-col' });
  const rightCol = el('div', { className: 'sw-panel sw-col sw-col-wide' });

  const header = el('div', { className: 'sw-section-header' }, el('span', { text: 'Authored properties:' }));
  const buttons = el('div', { className: 'sw-button-row' });
  const addBtn = el('button', { text: '+' });
  const removeBtn = el('button', { text: '-' });
  buttons.append(addBtn, removeBtn);

  const list = el('select', { attrs: { size: '12' }, className: 'sw-listbox' }) as HTMLSelectElement;
  for (const prop of storyworld.authored_properties) {
    const option = el('option', { text: prop.property_name || prop.id, attrs: { value: prop.id } }) as HTMLOptionElement;
    if (prop.id === state.selections.propertyId) option.selected = true;
    list.appendChild(option);
  }
  list.addEventListener('change', () => store.selectProperty(list.value || null));

  addBtn.addEventListener('click', () => {
    openNewPropertyModal({
      storyworld,
      onCreate: (prop) => {
        touchStoryworld(storyworld);
        store.selectProperty(prop.id);
      },
    });
  });
  removeBtn.addEventListener('click', () => {
    const prop = getSelectedProperty(store.getState());
    if (!prop) return;
    storyworld.authored_properties = storyworld.authored_properties.filter((entry) => entry !== prop);
    for (const actor of storyworld.characters) {
      actor.authored_property_directory.delete(prop.id);
      actor.bnumber_properties.delete(prop.id);
    }
    touchStoryworld(storyworld);
    store.selectProperty(null);
  });

  leftCol.append(header, buttons, list);

  const nameInput = el('input', {
    attrs: { type: 'text', value: selectedProperty?.property_name ?? '' },
    className: 'sw-title-input',
  }) as HTMLInputElement;
  const depthInput = el('input', {
    attrs: { type: 'number', value: String(selectedProperty?.depth ?? 0) },
    className: 'sw-title-input',
  }) as HTMLInputElement;
  const defaultInput = el('input', {
    attrs: { type: 'number', value: String(selectedProperty?.default_value ?? 0) },
    className: 'sw-title-input',
  }) as HTMLInputElement;

  const applyPerceptionDepth = (nextDepth: number) => {
    const prop = getSelectedProperty(store.getState());
    if (!prop) return;
    const castIds = storyworld.characters.map((c) => c.id);
    const targets =
      prop.attribution_target === possible_attribution_targets.ENTIRE_CAST
        ? storyworld.characters
        : prop.affected_characters;
    for (const actor of storyworld.characters) {
      if (!targets.includes(actor)) {
        actor.bnumber_properties.delete(prop.id);
        continue;
      }
      const current = actor.bnumber_properties.get(prop.id) ?? prop.default_value;
      const nextValue = normalizePerceptionValue(current, nextDepth, castIds, prop.default_value, actor.id);
      actor.bnumber_properties.set(prop.id, nextValue);
    }
    prop.depth = nextDepth;
    touchStoryworld(storyworld);
  };

  nameInput.addEventListener('input', () => {
    const prop = getSelectedProperty(store.getState());
    if (!prop) return;
    prop.property_name = nameInput.value;
    touchStoryworld(storyworld);
  });
  depthInput.addEventListener('input', () => {
    const prop = getSelectedProperty(store.getState());
    if (!prop) return;
    const nextDepth = Math.max(0, Math.floor(Number(depthInput.value) || 0));
    depthInput.value = String(nextDepth);
    applyPerceptionDepth(nextDepth);
    syncPerceptionUI();
  });
  defaultInput.addEventListener('input', () => {
    const prop = getSelectedProperty(store.getState());
    if (!prop) return;
    prop.default_value = Number(defaultInput.value);
    touchStoryworld(storyworld);
  });

  const perceptionLabel = el('label', { text: 'Perception' });
  const pValuesStatus = el('div', { className: 'sw-help-text' });
  const p2Status = el('div', { className: 'sw-help-text' });
  const pToggleRow = el('div', { className: 'sw-row' });
  const pValuesToggle = el('button', { text: 'Enable pValues' }) as HTMLButtonElement;
  const p2Toggle = el('button', { text: 'Enable p2' }) as HTMLButtonElement;
  pToggleRow.append(pValuesToggle, p2Toggle);

  const syncPerceptionUI = () => {
    const prop = getSelectedProperty(store.getState());
    const depth = prop?.depth ?? 0;
    pValuesStatus.textContent = `pValues: ${depth >= 1 ? 'On' : 'Off'}`;
    p2Status.textContent = `p2: ${depth >= 2 ? 'On' : 'Off'}`;
    if (!prop) {
      pValuesToggle.disabled = true;
      p2Toggle.disabled = true;
      pValuesToggle.textContent = 'Enable pValues';
      p2Toggle.textContent = 'Enable p2';
      return;
    }
    pValuesToggle.disabled = false;
    p2Toggle.disabled = false;
    pValuesToggle.textContent = depth >= 1 ? 'Clear pValues' : 'Enable pValues';
    p2Toggle.textContent = depth >= 2 ? 'Clear p2' : 'Enable p2';
  };

  pValuesToggle.addEventListener('click', () => {
    const prop = getSelectedProperty(store.getState());
    if (!prop) return;
    const nextDepth = prop.depth >= 1 ? 0 : 1;
    applyPerceptionDepth(nextDepth);
    depthInput.value = String(nextDepth);
    syncPerceptionUI();
  });

  p2Toggle.addEventListener('click', () => {
    const prop = getSelectedProperty(store.getState());
    if (!prop) return;
    const nextDepth = prop.depth >= 2 ? 1 : 2;
    applyPerceptionDepth(nextDepth);
    depthInput.value = String(nextDepth);
    syncPerceptionUI();
  });

  rightCol.append(
    el('label', { text: 'Property Name' }),
    nameInput,
    el('label', { text: 'Depth' }),
    depthInput,
    el('label', { text: 'Default Value' }),
    defaultInput,
    perceptionLabel,
    pValuesStatus,
    p2Status,
    pToggleRow
  );

  syncPerceptionUI();

  container.append(leftCol, rightCol);
  return container;
}
