import { Option } from "./Option";
import { Reaction } from "./Reaction";
import { Encounter } from "./Encounter";
import { Storyworld } from "./Storyworld";

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

    get_children(): TreeItem[] {
        return this.children;
    }
}

export class HB_Record {
    tree_node: TreeItem | null = null;
    player_choice: Option | null = null;
    antagonist_choice: Reaction | null = null;
    encounter: Encounter | null = null;
    is_an_ending_leaf: boolean = false;
    turn: number = 0;
    fully_explored: boolean = false;
    relationship_values: { [character_id: string]: any } = {};

    constructor() { }

    set_pValues(storyworld: Storyworld): void {
        this.relationship_values = {};
        for (const character of storyworld.characters) {
            this.relationship_values[character.id] = new Map(character.bnumber_properties);
        }
    }

    record_occurrences(): void {
        if (this.player_choice !== null) {
            this.player_choice.occurrences += 1;
        }
        if (this.antagonist_choice !== null) {
            this.antagonist_choice.occurrences += 1;
        }
        if (this.encounter !== null) {
            this.encounter.occurrences += 1;
        }
    }

    get_tree_node_children(): TreeItem[] {
        if (this.tree_node === null) {
            return [];
        } else {
            return this.tree_node.get_children();
        }
    }

    get_fully_explored(): boolean {
        if (this.fully_explored) {
            return true;
        } else if (this.is_an_ending_leaf) {
            return true;
        }
        const children = this.get_tree_node_children();
        if (children.length > 0) {
            for (const each of children) {
                if (each.get_metadata(0).fully_explored === false) {
                    return false;
                }
            }
            return true;
        }
        return false;
    }

    data_to_string(cutoff: number = 20): string {
        let result = "";
        if (this.player_choice === null && this.antagonist_choice === null) {
            result += "Start.";
        } else {
            result = "O: ";
            if (this.player_choice === null) {
                result += "null";
            } else {
                result += this.player_choice.text.substring(0, cutoff);
            }
            result += " R: ";
            if (this.antagonist_choice === null) {
                result += "null";
            } else {
                result += this.antagonist_choice.text.substring(0, cutoff);
            }
        }
        result += " E: ";
        if (this.encounter === null) {
            result += "null";
        } else {
            result += this.encounter.title.substring(0, cutoff);
        }
        if (this.is_an_ending_leaf) {
            result += "(end)";
        }
        result += ".";
        return result;
    }
}
