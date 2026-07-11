import { el, clear } from '../dom';
import { Storyworld } from '../../Storyworld';
import { Effect } from '../../Effect';
import { createDefaultScriptNode, createDefaultBoolNode } from '../../scriptAst';
import { openScriptModal } from './ScriptModal';

interface EffectModalOptions {
  storyworld: Storyworld;
  initialEffect?: Effect | null;
  onConfirm: (effect: Effect) => void;
}

const effectTypes: Effect['type'][] = ['SetBNumberProperty', 'SetSpoolStatus', 'NextPage'];

function createDefaultEffect(storyworld: Storyworld, type: Effect['type']): Effect {
  if (type === 'SetBNumberProperty') {
    const character = storyworld.characters[0];
    const property = storyworld.authored_properties[0];
    return {
      type,
      characterId: character?.id ?? '',
      propertyId: property?.id ?? '',
      value: createDefaultScriptNode(),
    };
  }
  if (type === 'SetSpoolStatus') {
    const spool = storyworld.spools[0];
    return {
      type,
      spoolId: spool?.id ?? '',
      value: createDefaultBoolNode(),
    };
  }
  const encounter = storyworld.encounters[0];
  return { type, encounterId: encounter?.id ?? '' };
}

export function openEffectModal(options: EffectModalOptions): void {
  const { storyworld, initialEffect } = options;
  let effect: Effect = initialEffect
    ? JSON.parse(JSON.stringify(initialEffect))
    : createDefaultEffect(storyworld, 'SetBNumberProperty');

  const overlay = el('div', { className: 'sw-modal-overlay' });
  const modal = el('div', { className: 'sw-modal' });
  const header = el('div', { className: 'sw-modal-header', text: 'Edit Effect' });
  const body = el('div', { className: 'sw-modal-body' });
  const content = el('div', { className: 'sw-modal-pane' });
  const footer = el('div', { className: 'sw-modal-footer' });
  const okButton = el('button', { text: 'OK' });
  const cancelButton = el('button', { text: 'Cancel' });
  footer.append(okButton, cancelButton);

  const render = () => {
    clear(content);
    const typeRow = el('div', { className: 'sw-row' });
    const typeSelect = el('select') as HTMLSelectElement;
    effectTypes.forEach((type) => {
      const opt = el('option', { text: type, attrs: { value: type } }) as HTMLOptionElement;
      if (type === effect.type) opt.selected = true;
      typeSelect.appendChild(opt);
    });
    typeSelect.addEventListener('change', () => {
      effect = createDefaultEffect(storyworld, typeSelect.value as Effect['type']);
      render();
    });
    typeRow.append(el('label', { text: 'Effect Type' }), typeSelect);
    content.appendChild(typeRow);

    if (effect.type === 'SetBNumberProperty') {
      const characterSelect = el('select') as HTMLSelectElement;
      storyworld.characters.forEach((character) => {
        const opt = el('option', { text: character.char_name || character.id, attrs: { value: character.id } }) as HTMLOptionElement;
        if (character.id === effect.characterId) opt.selected = true;
        characterSelect.appendChild(opt);
      });
      const propertySelect = el('select') as HTMLSelectElement;
      storyworld.authored_properties.forEach((prop) => {
        const opt = el('option', { text: prop.property_name || prop.id, attrs: { value: prop.id } }) as HTMLOptionElement;
        if (prop.id === effect.propertyId) opt.selected = true;
        propertySelect.appendChild(opt);
      });
      const valueSummary = el('div', { className: 'sw-section-header', text: 'Value Script' });
      const editValueButton = el('button', { text: 'Edit Value…' });
      editValueButton.addEventListener('click', () => {
        openScriptModal({
          storyworld,
          mode: 'script',
          initialAst: effect.value,
          onConfirm: (_script, ast) => {
            effect = { ...effect, value: ast };
            render();
          },
        });
      });
      characterSelect.addEventListener('change', () => {
        effect = { ...effect, characterId: characterSelect.value };
      });
      propertySelect.addEventListener('change', () => {
        effect = { ...effect, propertyId: propertySelect.value };
      });
      content.append(
        el('label', { text: 'Character' }),
        characterSelect,
        el('label', { text: 'Property' }),
        propertySelect,
        valueSummary,
        editValueButton
      );
    }

    if (effect.type === 'SetSpoolStatus') {
      const spoolSelect = el('select') as HTMLSelectElement;
      storyworld.spools.forEach((spool) => {
        const opt = el('option', { text: spool.name || spool.id, attrs: { value: spool.id } }) as HTMLOptionElement;
        if (spool.id === effect.spoolId) opt.selected = true;
        spoolSelect.appendChild(opt);
      });
      const editValueButton = el('button', { text: 'Edit Value…' });
      editValueButton.addEventListener('click', () => {
        openScriptModal({
          storyworld,
          mode: 'bool',
          initialBoolAst: effect.value,
          onConfirmBool: (ast) => {
            effect = { ...effect, value: ast };
            render();
          },
        });
      });
      spoolSelect.addEventListener('change', () => {
        effect = { ...effect, spoolId: spoolSelect.value };
      });
      content.append(
        el('label', { text: 'Spool' }),
        spoolSelect,
        el('div', { className: 'sw-section-header', text: 'Value' }),
        editValueButton
      );
    }

    if (effect.type === 'NextPage') {
      const encounterSelect = el('select') as HTMLSelectElement;
      storyworld.encounters.forEach((encounter) => {
        const opt = el('option', { text: encounter.title || encounter.id, attrs: { value: encounter.id } }) as HTMLOptionElement;
        if (encounter.id === effect.encounterId) opt.selected = true;
        encounterSelect.appendChild(opt);
      });
      encounterSelect.addEventListener('change', () => {
        effect = { ...effect, encounterId: encounterSelect.value };
      });
      content.append(el('label', { text: 'Encounter' }), encounterSelect);
    }
  };

  okButton.addEventListener('click', () => {
    options.onConfirm(effect);
    document.body.removeChild(overlay);
  });
  cancelButton.addEventListener('click', () => {
    document.body.removeChild(overlay);
  });

  body.appendChild(content);
  modal.append(header, body, footer);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  render();
}
