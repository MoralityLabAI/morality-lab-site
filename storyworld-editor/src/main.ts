import './style.css';
import { Storyworld } from './Storyworld';
import { Encounter } from './Encounter';
import { Option } from './Option';
import { Reaction } from './Reaction';
import { UUID } from './UUID';
import { createStore } from './ui/store';
import { createAppShell } from './ui/appShell';

const storyworld = new Storyworld();
storyworld.storyworld_title = 'Untitled Storyworld';

const encounter = new Encounter(`enc_${UUID.v4()}`, 'First Encounter');
const option = new Option('New option', `opt_${UUID.v4()}`);
const reaction = new Reaction('New reaction', `rxn_${UUID.v4()}`);

option.parent_encounter = encounter;
reaction.parent_option = option;
option.reactions.push(reaction);
encounter.options.push(option);
storyworld.encounters.push(encounter);
storyworld.encounter_directory.set(encounter.id, encounter);

const store = createStore({
  storyworld,
  activeTab: 'Encounters',
  selections: {
    encounterId: encounter.id,
    optionId: option.id,
    reactionId: reaction.id,
    spoolId: null,
    characterId: null,
    propertyId: null,
  },
});

const app = createAppShell(store);
const root = document.getElementById('app');
if (root) {
  root.innerHTML = '';
  root.appendChild(app);
}
