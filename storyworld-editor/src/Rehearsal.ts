import { Storyworld } from "./Storyworld";
import { Encounter } from "./Encounter";
import { Option } from "./Option";
import { Reaction } from "./Reaction";
import { HB_Record } from "./HB_Record";
import { AssignmentOperator } from "./AssignmentOperator";
import { EncounterSorter } from "./EncounterSorter";

class TreeItem {
    metadata: any[] = [];
    parent: TreeItem | null = null;
    children: TreeItem[] = [];

    constructor(parent: TreeItem | null = null) {
        this.parent = parent;
    }

    get_metadata(index: number): any {
        return this.metadata[index];
    }

    set_metadata(index: number, data: any): void {
        this.metadata[index] = data;
    }

    get_parent(): TreeItem | null {
        return this.parent;
    }

    get_children(): TreeItem[] {
        return this.children;
    }

    create_item(parent: TreeItem): TreeItem {
        const item = new TreeItem(parent);
        parent.children.push(item);
        return item;
    }
}

class Tree {
    root: TreeItem | null = null;

    clear(): void {
        this.root = null;
    }

    create_item(): TreeItem {
        this.root = new TreeItem(null);
        return this.root;
    }
}

export class Rehearsal {
    history: Tree = new Tree();
    starting_page: TreeItem | null = null;
    playthrough_transcript: string = "";
    turn: number = 0;
    current_page: TreeItem | null = null;
    ending_leaves: TreeItem[] = [];
    storyworld: Storyworld;
    initial_pValues: HB_Record;
    hb_record_list: HB_Record[] = [];

    constructor(storyworld: Storyworld) {
        this.storyworld = new Storyworld();
        if (storyworld !== null) {
            this.storyworld.set_as_copy_of(storyworld);
        }
        this.initial_pValues = new HB_Record();
        this.initial_pValues.set_pValues(this.storyworld);
    }

    has_occurred_on_branch(encounter: Encounter, leaf: TreeItem | null): boolean {
        if (encounter === null) {
            return false;
        } else if (leaf === null) {
            return false;
        }
        let node: TreeItem | null = leaf;
        while (node !== null) {
            if (node.get_metadata(0).encounter !== null && node.get_metadata(0).encounter === encounter) {
                return true;
            }
            if (node !== this.starting_page) {
                node = node.get_parent();
            } else {
                break;
            }
        }
        return false;
    }

    select_most_desirable_encounter(acceptableEncounters: Encounter[]): Encounter | null {
        let flag = true;
        let greatest_desirability = -1;
        let result: Encounter | null = null;
        acceptableEncounters.sort(EncounterSorter.sort_a_z);
        for (const encounter of acceptableEncounters) {
            if (flag) {
                greatest_desirability = encounter.desirability_script.get_value();
                result = encounter;
                flag = false;
            } else {
                const encounter_desirability = encounter.desirability_script.get_value();
                if (encounter_desirability > greatest_desirability) {
                    greatest_desirability = encounter_desirability;
                    result = encounter;
                }
            }
        }
        return result;
    }

    select_next_page(reaction: Reaction | null, leaf: TreeItem | null = null): Encounter | null {
        if (reaction !== null && reaction.consequence !== null) {
            return reaction.consequence;
        } else {
            let acceptable_encounters_inc: Encounter[] = [];
            let acceptable_encounters_exc: Encounter[] = [];
            let earliest_acceptable_turn = 0;
            for (const encounter of this.storyworld.encounters) {
                let acceptable = true;
                if (this.has_occurred_on_branch(encounter, leaf)) {
                    acceptable = false;
                }
                if (acceptable) {
                    if (!encounter.acceptability_script.get_value()) {
                        acceptable = false;
                    }
                }
                if (acceptable) {
                    if (this.turn <= encounter.latest_turn) {
                        if (encounter.earliest_turn <= this.turn) {
                            acceptable_encounters_inc.push(encounter);
                        } else {
                            if (acceptable_encounters_exc.length === 0) {
                                earliest_acceptable_turn = encounter.earliest_turn;
                            } else {
                                if (earliest_acceptable_turn > encounter.earliest_turn) {
                                    earliest_acceptable_turn = encounter.earliest_turn;
                                }
                            }
                            acceptable_encounters_exc.push(encounter);
                        }
                    }
                }
            }
            if (acceptable_encounters_inc.length === 0) {
                if (acceptable_encounters_exc.length === 0) {
                    return null;
                } else {
                    if (this.turn < earliest_acceptable_turn) {
                        this.turn = earliest_acceptable_turn;
                    }
                    acceptable_encounters_inc = [];
                    for (const encounter of acceptable_encounters_exc) {
                        if (encounter.earliest_turn <= this.turn) {
                            acceptable_encounters_inc.push(encounter);
                        }
                    }
                    return this.select_most_desirable_encounter(acceptable_encounters_inc);
                }
            } else {
                return this.select_most_desirable_encounter(acceptable_encounters_inc);
            }
        }
    }

    find_open_options(leaf: TreeItem): Option[] {
        if (leaf.get_metadata(0).encounter === null) {
            return [];
        }
        const all_options = leaf.get_metadata(0).encounter.options;
        const open_options: Option[] = [];
        for (const option of all_options) {
            if (option.visibility_script.get_value() && option.performability_script.get_value()) {
                open_options.push(option);
            }
        }
        return open_options;
    }

    select_reaction(option: Option): Reaction | null {
        let topInclination = -1;
        let workingChoice: Reaction | null = null;
        for (const reaction of option.reactions) {
            const latestInclination = reaction.calculate_desirability();
            if (latestInclination >= topInclination) {
                topInclination = latestInclination;
                workingChoice = reaction;
            }
        }
        return workingChoice;
    }

    reset_pValues_to(record: HB_Record): void {
        for (const character_id in record.relationship_values) {
            const character = this.storyworld.character_directory.get(character_id)!;
            character.bnumber_properties = new Map(Object.entries(record.relationship_values[character_id]));
        }
    }

    execute_reaction(reaction: Reaction): void {
        for (const change of reaction.after_effects) {
            if (change instanceof AssignmentOperator) {
                change.enact();
            }
        }
    }

    execute_option(root_page: TreeItem, option: Option, new_page: TreeItem): HB_Record {
        this.reset_pValues_to(root_page.get_metadata(0));
        this.turn = root_page.get_metadata(0).turn + 1;
        const reaction = this.select_reaction(option);
        this.execute_reaction(reaction!);
        const record = new_page.get_metadata(0);
        record.player_choice = option;
        record.antagonist_choice = reaction;
        const next_page = this.select_next_page(reaction, new_page);
        record.encounter = next_page;
        record.turn = this.turn;
        record.set_pValues(this.storyworld);
        record.record_occurrences();
        if (next_page === null) {
            record.is_an_ending_leaf = true;
            record.fully_explored = true;
        }
        return record;
    }

    clear_all_data(): void {
        this.clear_history();
        this.storyworld.clear();
    }

    clear_history(): void {
        this.reset_pValues_to(this.initial_pValues);
        this.hb_record_list = [];
        this.history.clear();
        this.starting_page = null;
        this.current_page = null;
        this.ending_leaves = [];
        this.playthrough_transcript = "";
        this.turn = 0;
        for (const encounter of this.storyworld.encounters) {
            encounter.occurrences = 0;
            for (const option of encounter.options) {
                option.occurrences = 0;
                for (const reaction of option.reactions) {
                    reaction.occurrences = 0;
                }
            }
        }
    }

    begin_playthrough(): void {
        this.clear_history();
        this.starting_page = this.history.create_item();
        const record = new HB_Record();
        this.hb_record_list.push(record);
        record.encounter = this.select_next_page(null, null);
        record.turn = this.turn;
        record.set_pValues(this.storyworld);
        record.record_occurrences();
        this.starting_page.set_metadata(0, record);
        this.current_page = this.starting_page;
    }

    step_playthrough(leaf: TreeItem): void {
        this.current_page = leaf;
        this.reset_pValues_to(leaf.get_metadata(0));
        this.turn = leaf.get_metadata(0).turn + 1;
        if (leaf.get_children().length === 0) {
            const options = this.find_open_options(leaf);
            if (options.length === 0) {
                if (this.ending_leaves.indexOf(leaf) === -1) {
                    this.ending_leaves.push(leaf);
                }
                const record = leaf.get_metadata(0);
                record.is_an_ending_leaf = true;
                record.fully_explored = true;
                leaf.set_metadata(0, record);
            } else if (options.length > 0) {
                for (const option of options) {
                    const page = this.history.root!.create_item(leaf);
                    const record = new HB_Record();
                    this.hb_record_list.push(record);
                    record.tree_node = page;
                    page.set_metadata(0, record);
                    this.execute_option(leaf, option, page);
                }
            }
            this.reset_pValues_to(leaf.get_metadata(0));
            this.turn = leaf.get_metadata(0).turn + 1;
        }
    }

    get_item_children(item: TreeItem): TreeItem[] {
        return item.get_children();
    }

    rehearse_depth_first(): boolean {
        if (this.starting_page === null || this.current_page === null) {
            console.log("Start of Rehearsal.");
            this.begin_playthrough();
        }
        this.step_playthrough(this.current_page!);
        if (this.current_page!.get_metadata(0).is_an_ending_leaf) {
            this.current_page!.get_metadata(0).fully_explored = true;
            this.current_page = this.current_page!.get_parent();
        } else {
            const branches = this.get_item_children(this.current_page!);
            const left_to_explore: TreeItem[] = [];
            for (const each of branches) {
                if (each.get_metadata(0).fully_explored === false) {
                    left_to_explore.push(each);
                }
            }
            if (left_to_explore.length > 0) {
                left_to_explore.sort((a, b) => {
                    const aRecord = a.get_metadata(0);
                    const bRecord = b.get_metadata(0);
                    const aEncounter = aRecord?.encounter;
                    const bEncounter = bRecord?.encounter;
                    const aKey = aEncounter?.title || aEncounter?.id || "";
                    const bKey = bEncounter?.title || bEncounter?.id || "";
                    return aKey.localeCompare(bKey);
                });
                this.current_page = left_to_explore[0];
            } else {
                this.current_page!.get_metadata(0).fully_explored = true;
                this.current_page = this.current_page!.get_parent();
                if (this.current_page === null) {
                    console.log("End of Rehearsal.");
                    return true;
                }
            }
        }
        return false;
    }
}
