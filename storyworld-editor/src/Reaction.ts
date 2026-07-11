import { Encounter } from "./Encounter";
import { SWScriptElement } from "./SWScriptElement";
import { Option } from "./Option";
import { Prerequisite } from "./Prerequisite";
import { ScriptManager } from "./ScriptManager";
import { Effect, serializeEffect } from "./Effect";
import { ScriptNode, serializeScript } from "./scriptAst";

export class Reaction {
    public id: string = '';
    public text: string = '';
    public label: string | null = null;
    public occurrences: number = 0;
    public consequence: Encounter | null = null;
    public consequence_id: string | null = null;
    public after_effects: SWScriptElement[] = [];
    public prerequisites: Prerequisite[] = [];
    public weight: number = 1;
    public parent_option: Option | null = null;
    public stored_index: number | null = null;
    public desirability_script: ScriptManager = new ScriptManager();
    public inclination_script: ScriptNode | null = { type: 'Constant', value: 0.5 };
    public effects: Effect[] = [];

    constructor(text: string = '', id: string = '') {
        this.text = text;
        this.id = id;
    }

    public get_index(): number {
        if (this.parent_option) {
            return this.parent_option.reactions.indexOf(this);
        }
        return this.stored_index ?? -1;
    }

    public calculate_desirability(): number {
        console.warn("STUB: Reaction.calculate_desirability called");
        return 0; // Placeholder
    }

    public compile(): any {
        return {
            id: this.id,
            text_script: {
                script_element_type: 'Pointer',
                pointer_type: 'String Constant',
                value: this.text,
            },
            label: this.label,
            consequence_id: this.consequence ? this.consequence.id : this.consequence_id,
            weight: this.weight,
            desirability_script: this.desirability_script.compile(),
            desirability_ast: (this.desirability_script as any).ast_json ?? null,
            inclination_ast: this.inclination_script
                ? serializeScript(this.inclination_script)
                : (this.desirability_script as any).ast_json ?? null,
            effects: this.effects.map((effect) => serializeEffect(effect)),
            after_effects: this.after_effects.map((effect) => effect.compile()),
        };
    }
}
