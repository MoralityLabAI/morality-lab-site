import { BNumberPointer } from "./BNumberPointer";
import { ScriptManager } from "./ScriptManager";
import { SWScriptElement } from "./SWScriptElement";
import { Storyworld } from "./Storyworld";
import { SWOperator } from "./SWOperator";

/**
 * An object used to set variables, such as bounded number properties.
 * Corresponds to an assignment statement.
 * Ported from Godot/GDScript.
 */
export class AssignmentOperator extends SWOperator {
    // Variable to set: operand_0 (Should be a BNumberPointer.)
    public operand_0: BNumberPointer | null = null;
    // What to set it to: operand_1 (Should be a ScriptManager, primitive, etc.)
    public operand_1: ScriptManager | any | null = null;

    constructor(in_operand_0: any = null, in_operand_1: any = null) {
        super();
        if (in_operand_0 instanceof BNumberPointer) {
            this.operand_0 = in_operand_0;
            this.operand_0.parent_operator = this;
        }
        if (in_operand_1 instanceof ScriptManager) {
            this.operand_1 = in_operand_1;
            // In Godot, ScriptManager doesn't have parent_operator, so we don't set it.
        }
    }

    public override get_value(): any {
        // This will return the value of the second operand, but will not change the value of the first operand.
        if (this.operand_1 === null) {
            return null;
        }
        let value: any = 0;
        const op1_type = typeof this.operand_1;

        if (this.operand_1 instanceof ScriptManager || this.operand_1 instanceof SWScriptElement) {
            value = this.operand_1.get_value();
        } else if (op1_type === 'number') {
            value = this.operand_1;
        } else {
            return null;
        }
        return value;
    }

    public enact(): boolean {
        if (this.operand_0 instanceof BNumberPointer) {
            const result = this.get_value();
            if (result !== null) {
                this.operand_0.set_value();
                return true;
            }
        }
        return false; // An error occurred.
    }

    public override set_as_copy_of(original?: AssignmentOperator): boolean {
        if (!(original instanceof AssignmentOperator)) return false;
        let success = true;
        if (this.operand_0 instanceof BNumberPointer && original.operand_0 instanceof BNumberPointer) {
            this.operand_0.set_as_copy_of(original.operand_0);
        } else if (this.operand_0 === null && original.operand_0 instanceof BNumberPointer) {
            this.operand_0 = new BNumberPointer();
            this.operand_0.set_as_copy_of(original.operand_0);
        }
        else {
            success = false;
        }

        if (this.operand_1 instanceof ScriptManager && original.operand_1 instanceof ScriptManager) {
            this.operand_1.set_as_copy_of();
        } else if (this.operand_1 === null && original.operand_1 instanceof ScriptManager) {
            this.operand_1 = new ScriptManager();
            this.operand_1.set_as_copy_of();
        }
        else {
            success = false;
        }
        return success;
    }

    public override remap(): boolean {
        let result = true;
        if (this.operand_0 instanceof SWScriptElement) {
            result = this.operand_0.remap() && result;
        }
        if (this.operand_1 instanceof ScriptManager) {
            result = this.operand_1.remap() && result;
        }
        return result;
    }

    public override clear(): void {
        if (this.operand_0 instanceof SWScriptElement) {
            this.operand_0.clear();
        }
        this.operand_0 = null;
        if (this.operand_1 instanceof ScriptManager) {
            this.operand_1.clear();
        }
        this.operand_1 = null;
    }

    public override data_to_string(): string {
        let result = "Set ";
        if (this.operand_0 instanceof BNumberPointer) {
            result += this.operand_0.data_to_string();
        } else {
            result += "[invalid operand]";
        }
        result += " to ";
        if (this.operand_1 instanceof ScriptManager) {
            result += this.operand_1.data_to_string();
        } else {
            result += "[invalid script]";
        }
        result += ".";
        return result;
    }

    public override compile(): Record<string, any> {
        // Always return an object for serialization. Invalid operands compile to null.
        const result: Record<string, any> = {};
        result["Set"] = this.operand_0 instanceof BNumberPointer ? this.operand_0.compile() : null;
        result["to"] = this.operand_1 instanceof ScriptManager ? this.operand_1.compile() : null;
        return result;
    }
    
    public load_from_json_v0_0_21(storyworld: Storyworld, data_to_load: any): boolean {
        this.clear();
        if (data_to_load && "Set" in data_to_load && "to" in data_to_load) {
            const setData = data_to_load["Set"];
            if (setData && 
                setData["pointer_type"] === "Bounded Number Pointer" &&
                "character" in setData && "coefficient" in setData && "keyring" in setData &&
                typeof setData["character"] === 'string' &&
                storyworld.character_directory.has(setData["character"])) {

                const character = storyworld.character_directory.get(setData["character"])!;
                const script_element = new BNumberPointer(character, setData["keyring"]);
                script_element.coefficient = setData["coefficient"];
                script_element.parent_operator = this;
                this.operand_0 = script_element;
            }

            const toData = data_to_load["to"];
            if (toData) {
                const script = new ScriptManager();
                script.load_from_json_v0_0_21(toData, storyworld);
                this.operand_1 = script;
            }
        }

        return this.operand_0 instanceof BNumberPointer && this.operand_1 instanceof ScriptManager;
    }
}
