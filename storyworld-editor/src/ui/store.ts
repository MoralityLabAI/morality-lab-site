import { Storyworld } from '../Storyworld';
import { Encounter } from '../Encounter';
import { Option } from '../Option';
import { Reaction } from '../Reaction';
import { Spool } from '../Spool';
import { Actor } from '../Actor';
import { BNumberBlueprint } from '../BNumberBlueprint';

export type TabKey =
  | 'Overview'
  | 'Encounters'
  | 'Spools'
  | 'Characters'
  | 'Personality Model'
  | 'Settings'
  | 'Documentation'
  | 'Graph View'
  | 'Play'
  | 'Rehearsal'
  | 'AI Console';

export interface SelectionState {
  encounterId: string | null;
  optionId: string | null;
  reactionId: string | null;
  spoolId: string | null;
  characterId: string | null;
  propertyId: string | null;
}

export interface StoreState {
  storyworld: Storyworld;
  activeTab: TabKey;
  selections: SelectionState;
}

type Listener = (state: StoreState) => void;

export interface Store {
  getState(): StoreState;
  setState(partial: Partial<StoreState>): void;
  subscribe(listener: Listener): () => void;
  ensureSelections(): void;
  selectEncounter(encounterId: string | null): void;
  selectOption(optionId: string | null): void;
  selectReaction(reactionId: string | null): void;
  selectSpool(spoolId: string | null): void;
  selectCharacter(characterId: string | null): void;
  selectProperty(propertyId: string | null): void;
}

export function touchStoryworld(storyworld: Storyworld): void {
  storyworld.modified_time = Date.now();
}

export function createStore(initial: StoreState): Store {
  let state: StoreState = initial;
  const listeners = new Set<Listener>();

  const notify = () => {
    for (const listener of listeners) {
      listener(state);
    }
  };

  const ensureSelections = () => {
    const { storyworld } = state;
    const selections = { ...state.selections };
    if (!selections.encounterId && storyworld.encounters.length > 0) {
      selections.encounterId = storyworld.encounters[0].id;
    }
    const selectedEncounter = storyworld.encounter_directory.get(selections.encounterId ?? '');
    if (selectedEncounter) {
      if (!selections.optionId && selectedEncounter.options.length > 0) {
        selections.optionId = selectedEncounter.options[0].id;
      }
      const selectedOption = selectedEncounter.options.find((opt) => opt.id === selections.optionId);
      if (selectedOption) {
        if (!selections.reactionId && selectedOption.reactions.length > 0) {
          selections.reactionId = selectedOption.reactions[0].id;
        }
      } else {
        selections.reactionId = null;
      }
    } else {
      selections.optionId = null;
      selections.reactionId = null;
    }

    if (!selections.spoolId && storyworld.spools.length > 0) {
      selections.spoolId = storyworld.spools[0].id;
    }
    if (!selections.characterId && storyworld.characters.length > 0) {
      selections.characterId = storyworld.characters[0].id;
    }
    if (!selections.propertyId && storyworld.authored_properties.length > 0) {
      selections.propertyId = storyworld.authored_properties[0].id;
    }

    state = { ...state, selections };
  };

  return {
    getState: () => state,
    setState: (partial) => {
      state = { ...state, ...partial };
      ensureSelections();
      notify();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    ensureSelections,
    selectEncounter: (encounterId) => {
      state = { ...state, selections: { ...state.selections, encounterId, optionId: null, reactionId: null } };
      ensureSelections();
      notify();
    },
    selectOption: (optionId) => {
      state = { ...state, selections: { ...state.selections, optionId, reactionId: null } };
      ensureSelections();
      notify();
    },
    selectReaction: (reactionId) => {
      state = { ...state, selections: { ...state.selections, reactionId } };
      notify();
    },
    selectSpool: (spoolId) => {
      state = { ...state, selections: { ...state.selections, spoolId } };
      notify();
    },
    selectCharacter: (characterId) => {
      state = { ...state, selections: { ...state.selections, characterId } };
      notify();
    },
    selectProperty: (propertyId) => {
      state = { ...state, selections: { ...state.selections, propertyId } };
      notify();
    },
  };
}

export function getSelectedEncounter(state: StoreState): Encounter | null {
  return state.storyworld.encounter_directory.get(state.selections.encounterId ?? '') ?? null;
}

export function getSelectedOption(state: StoreState): Option | null {
  const encounter = getSelectedEncounter(state);
  if (!encounter) return null;
  return encounter.options.find((opt) => opt.id === state.selections.optionId) ?? null;
}

export function getSelectedReaction(state: StoreState): Reaction | null {
  const option = getSelectedOption(state);
  if (!option) return null;
  return option.reactions.find((rxn) => rxn.id === state.selections.reactionId) ?? null;
}

export function getSelectedSpool(state: StoreState): Spool | null {
  return state.storyworld.spool_directory.get(state.selections.spoolId ?? '') ?? null;
}

export function getSelectedCharacter(state: StoreState): Actor | null {
  return state.storyworld.character_directory.get(state.selections.characterId ?? '') ?? null;
}

export function getSelectedProperty(state: StoreState): BNumberBlueprint | null {
  return state.storyworld.authored_properties.find((prop) => prop.id === state.selections.propertyId) ?? null;
}
