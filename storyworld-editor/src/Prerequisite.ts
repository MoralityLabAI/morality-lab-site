import { Encounter } from "./Encounter";
import { Option } from "./Option";
import { Reaction } from "./Reaction";
import { Storyworld } from "./Storyworld";
import { Actor } from "./Actor";

export class Prerequisite {
    prereq_type: number = 0;
    negated: boolean = false;
    encounter: Encounter | null = null;
    option: Option | null = null;
    reaction: Reaction | null = null;
    encounter_scene: string = "";
    who1: Actor | null = null;
    pValue1: string | null = null;
    operator: string = ">=";
    constant: number = 0;
    who2: Actor | null = null;
    pValue2: string | null = null;

    constructor(prereq_type: number, negated: boolean) {
        this.prereq_type = prereq_type;
        this.negated = negated;
    }

    summarize(): string {
        let output = "";
        if (this.prereq_type === 0) {
            if (this.negated === false) {
                output = "Event has occurred: ";
            } else {
                output = "Event has not occurred: ";
            }
            output += this.encounter!.title;
            if (this.option !== null) {
                output += " / " + this.option.text.substring(0, 20);
                if (this.reaction !== null) {
                    output += " / " + this.reaction.text.substring(0, 20);
                }
            }
            output += ".";
        }
        return output;
    }

    compile(): any {
        const output: any = {};
        output["prereq_type"] = this.prereq_type;
        output["negated"] = this.negated;
        output["encounter"] = this.encounter!.id;
        if (this.option === null) {
            output["option"] = -1;
        } else {
            output["option"] = this.option.get_index();
        }
        if (this.reaction === null) {
            output["reaction"] = -1;
        } else {
            output["reaction"] = this.reaction.get_index();
        }
        return output;
    }

    set_as_copy_of(original: Prerequisite): void {
        this.prereq_type = original.prereq_type;
        this.negated = original.negated;
        this.encounter = original.encounter;
        this.option = original.option;
        this.reaction = original.reaction;
        this.encounter_scene = original.encounter_scene;
        this.who1 = original.who1;
        this.pValue1 = original.pValue1;
        this.operator = original.operator;
        this.constant = original.constant;
        this.who2 = original.who2;
        this.pValue2 = original.pValue2;
    }

    remap(storyworld: Storyworld): boolean {
        if (this.encounter !== null) {
            if (storyworld.encounter_directory.has(this.encounter.id)) {
                this.encounter = storyworld.encounter_directory.get(this.encounter.id)!;
                if (this.option !== null) {
                    this.option = this.encounter.options[this.option.get_index()];
                    if (this.reaction !== null) {
                        this.reaction = this.option.reactions[this.reaction.get_index()];
                    }
                } else {
                    this.reaction = null;
                }
            } else {
                return false;
            }
        } else {
            this.option = null;
            this.reaction = null;
        }
        return true;
    }
}
