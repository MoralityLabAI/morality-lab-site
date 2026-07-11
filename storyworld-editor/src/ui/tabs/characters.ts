import { el } from '../dom';
import { Store, touchStoryworld, getSelectedCharacter } from '../store';
import { Actor } from '../../Actor';
import { UUID } from '../../UUID';
import { getPerceptionValue, normalizePerceptionValue, setPerceptionValue } from '../../perception';

export function renderCharactersTab(store: Store): HTMLElement {
  const state = store.getState();
  const storyworld = state.storyworld;
  const selectedCharacter = getSelectedCharacter(state);

  const container = el('div', { className: 'sw-characters' });
  const leftCol = el('div', { className: 'sw-panel sw-col' });
  const rightCol = el('div', { className: 'sw-panel sw-col sw-col-wide' });

  const header = el('div', { className: 'sw-section-header' }, el('span', { text: 'Characters:' }));
  const buttons = el('div', { className: 'sw-button-row' });
  const addBtn = el('button', { text: '+' });
  const removeBtn = el('button', { text: '-' });
  buttons.append(addBtn, removeBtn);

  const list = el('select', { attrs: { size: '12' }, className: 'sw-listbox' }) as HTMLSelectElement;
  for (const character of storyworld.characters) {
    const option = el('option', { text: character.char_name || character.id, attrs: { value: character.id } }) as HTMLOptionElement;
    if (character.id === state.selections.characterId) option.selected = true;
    list.appendChild(option);
  }
  list.addEventListener('change', () => store.selectCharacter(list.value || null));

  addBtn.addEventListener('click', () => {
    const actor = new Actor(`char_${UUID.v4()}`, 'New Character', 'they');
    actor.storyworld = storyworld;
    storyworld.characters.push(actor);
    storyworld.character_directory.set(actor.id, actor);
    touchStoryworld(storyworld);
    store.selectCharacter(actor.id);
  });
  removeBtn.addEventListener('click', () => {
    const actor = getSelectedCharacter(store.getState());
    if (!actor) return;
    storyworld.characters = storyworld.characters.filter((entry) => entry !== actor);
    storyworld.character_directory.delete(actor.id);
    touchStoryworld(storyworld);
    store.selectCharacter(null);
  });

  leftCol.append(header, buttons, list);

  const nameInput = el('input', {
    attrs: { type: 'text', value: selectedCharacter?.char_name ?? '' },
    className: 'sw-title-input',
  }) as HTMLInputElement;
  const pronounInput = el('input', {
    attrs: { type: 'text', value: selectedCharacter?.pronoun ?? '' },
    className: 'sw-title-input',
  }) as HTMLInputElement;

  nameInput.addEventListener('input', () => {
    const actor = getSelectedCharacter(store.getState());
    if (!actor) return;
    actor.char_name = nameInput.value;
    touchStoryworld(storyworld);
  });
  pronounInput.addEventListener('input', () => {
    const actor = getSelectedCharacter(store.getState());
    if (!actor) return;
    actor.pronoun = pronounInput.value;
    touchStoryworld(storyworld);
  });

  const propertySection = el('div', { className: 'sw-property-list' });
  for (const property of storyworld.authored_properties) {
    const row = el('div', { className: 'sw-property-row' });
    const label = el('span', { text: property.property_name || property.id });
    const range = el('input', { attrs: { type: 'range', min: '-1', max: '1', step: '0.01' } }) as HTMLInputElement;
    const number = el('input', { attrs: { type: 'number', min: '-1', max: '1', step: '0.01' } }) as HTMLInputElement;
    const keyring = selectedCharacter ? Array.from({ length: property.depth }, () => selectedCharacter.id) : [];
    const currentValue = getPerceptionValue(
      selectedCharacter?.bnumber_properties.get(property.id),
      keyring,
      property.default_value
    );
    range.value = String(currentValue);
    number.value = String(currentValue);

    const updateValue = (value: string) => {
      const actor = getSelectedCharacter(store.getState());
      if (!actor) return;
      const numeric = Number(value);
      const castIds = storyworld.characters.map((c) => c.id);
      if (property.depth <= 0) {
        actor.bnumber_properties.set(property.id, numeric);
      } else {
        const normalized = normalizePerceptionValue(
          actor.bnumber_properties.get(property.id),
          property.depth,
          castIds,
          property.default_value,
          actor.id
        );
        setPerceptionValue(normalized, keyring, numeric);
        actor.bnumber_properties.set(property.id, normalized);
      }
      range.value = String(numeric);
      number.value = String(numeric);
      touchStoryworld(storyworld);
    };

    range.addEventListener('input', () => updateValue(range.value));
    number.addEventListener('input', () => updateValue(number.value));
    row.append(label, range, number);
    propertySection.appendChild(row);
  }

  rightCol.append(
    el('label', { text: 'Name' }),
    nameInput,
    el('label', { text: 'Pronoun' }),
    pronounInput,
    el('div', { className: 'sw-section-header', text: 'Personality Values' }),
    propertySection
  );

  container.append(leftCol, rightCol);
  return container;
}
