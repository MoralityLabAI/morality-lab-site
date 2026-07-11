import { SWPointer } from './SWPointer';
import { sw_script_data_types } from './SWScriptElement';
import { Spool } from './Spool';
import { Encounter } from './Encounter';
import { Option } from './Option';
import { Reaction } from './Reaction';

/**
 * This pointer tests whether or not an event has occurred in the story history.
 * Ported from Godot/GDScript.
 */
export class EventPointer extends SWPointer {
    public negated: boolean = false; // Do we negate the result of the evaluation?
    public spool: Spool | null = null;
    public encounter: Encounter | null = null; // Only for historybook lookups. Translated into a string for interpreter.
    public option: Option | null = null; // Only for historybook lookups. Translated into a numerical index for interpreter.
    public reaction: Reaction | null = null; // Only for historybook lookups. Translated into a numerical index for interpreter.

    constructor(in_encounter: Encounter | null = null, in_option: Option | null = null, in_reaction: Reaction | null = null) {
        super();
        this.pointer_type = "Event Pointer";
        this.output_type = sw_script_data_types.BOOLEAN;
        this.encounter = in_encounter;
        this.option = in_option;
        this.reaction = in_reaction;
    }

    public override clear(): void {
        this.negated = false;
        this.spool = null;
        this.encounter = null;
        this.option = null;
        this.reaction = null;
    }

    /**
     * Checks whether an event (encounter, option, reaction) has occurred on the current branch.
     * This is a stub implementation as the full "historybook" (leaf) is not yet ported.
     * @param leaf The current node in the historybook (stubbed).
     */
    public has_occurred_on_branch(): boolean | null {
        // --- STUB IMPLEMENTATION ---
        // The original GDScript traversed a Node tree (historybook) here.
        // For now, we return false, but the structure for checking specific encounters/options/reactions
        // would be based on the logic below once 'leaf' is a proper HistorybookNode.
        
        // Original GDScript logic:
        // if (null == encounter) return null;
        // else if (null == leaf) return false; // Playthrough has only just begun.

        // var node = leaf;
        // while (null != node) {
        //     if (null != node.get_metadata(0).encounter && node.get_metadata(0).encounter == encounter) {
        //         if (option == null && reaction == null) return true;
        //         if (option == node.get_metadata(0).player_choice && reaction == null) return true;
        //         if (option == null && reaction == node.get_metadata(0).antagonist_choice) return true;
        //         if (option == node.get_metadata(0).player_choice && reaction == node.get_metadata(0).antagonist_choice) return true;
        //     }
        //     node = node.get_parent(); // Traverse up the history tree
        // }
        
        // For the stub, we just assume it hasn't occurred.
        if (this.encounter === null) return null; // Can't check for a null encounter
        return false;
    }

    public override get_value(): boolean | null {
        const has_occurred = this.has_occurred_on_branch();
        if (this.negated === null || has_occurred === null) {
            return null;
        } else if (this.negated !== has_occurred) {
            return true;
        } else {
            return false;
        }
    }

    public override data_to_string(): string {
        return this.summarize();
    }

    public summarize(): string {
        let output = "";
        if (!this.negated) {
            output += "Event has occurred: ";
        } else {
            output += "Event has not occurred: ";
        }

        if (this.encounter) {
            output += this.encounter.title;
        } else {
            output += "Null Encounter";
        }

        if (this.option) {
            output += ` / ${this.option.text.substring(0, 25)}`;
        } else {
            output += " / Null Option";
        }

        if (this.reaction) {
            output += ` / ${this.reaction.text.substring(0, 25)}`;
        } else {
            output += " / Null Reaction";
        }
        output += ".";
        return output;
    }

    public override compile(): Record<string, any> {
        const output: Record<string, any> = {};
        output["script_element_type"] = "Pointer";
        output["pointer_type"] = this.pointer_type;
        output["negated"] = this.negated;
        
        output["spool"] = this.spool ? this.spool.id : null;
        output["encounter"] = this.encounter ? this.encounter.id : null;
        output["option"] = this.option ? this.option.get_index() : -1;
        output["reaction"] = this.reaction ? this.reaction.get_index() : -1;
        
        return output;
    }

    public override set_as_copy_of(original?: this): void {
        if (!(original instanceof EventPointer)) return;
        this.negated = original.negated;
        this.spool = original.spool;
        this.encounter = original.encounter;
        this.option = original.option;
        this.reaction = original.reaction;
    }

    public override remap(): boolean {
        // This method should be implemented when the Storyworld class is fully ported.
        return true;
    }
}
