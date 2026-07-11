import { SWScriptElement } from "./SWScriptElement";
import { BNumberConstant } from "./BNumberConstant";
import { BNumberPointer } from "./BNumberPointer";
import { BooleanConstant } from "./BooleanConstant";
import { BooleanOperator } from "./BooleanOperator";
import { BSumOperator } from "./BSumOperator";
import { ArithmeticMeanOperator } from "./ArithmeticMeanOperator";
import { BlendOperator } from "./BlendOperator";
import { NudgeOperator } from "./NudgeOperator";
import { EventPointer } from "./EventPointer";
import { AssignmentOperator } from "./AssignmentOperator";
import { StringConstant } from "./StringConstant";
import { Storyworld } from "./Storyworld";
import { ArithmeticNegationOperator } from "./ArithmeticNegationOperator";
import { ProximityToOperator } from "./ProximityToOperator";
import { ProximityOperator } from "./ProximityOperator";
import { AverageOperator } from "./AverageOperator";
import { MaximumOperator } from "./MaximumOperator";
import { MinimumOperator } from "./MinimumOperator";
import { IfThenOperator } from "./IfThenOperator";

export class ScriptManager {
    public script_elements: SWScriptElement[] = [];

    constructor() {
    }

    public get_value(): any {
        let last_output: any = null;
        for (const element of this.script_elements) {
            last_output = element.get_value();
        }
        return last_output;
    }

    public add_script_element(element: SWScriptElement): void {
        this.script_elements.push(element);
    }

    public remove_script_element(element: SWScriptElement): void {
        const index = this.script_elements.indexOf(element);
        if (index > -1) {
            this.script_elements.splice(index, 1);
        }
    }

    public set_as_copy_of(): void {
    }

    public remap(): boolean {
        let result = true;
        for (const element of this.script_elements) {
            result = element.remap() && result;
        }
        return result;
    }

    public to_string(): string {
        let output = "";
        for (const element of this.script_elements) {
            output += element.data_to_string() + "\n";
        }
        return output;
    }

    public compile(): any {
        const output: any[] = [];
        for (const element of this.script_elements) {
            output.push(element.compile());
        }
        return output;
    }

    private static parse_script_element(data: any, storyworld?: Storyworld): SWScriptElement | null {
        if (!data || typeof data !== 'object') {
            return null;
        }

        if ("Set" in data && "to" in data) {
            const assignment = new AssignmentOperator();
            if (storyworld) {
                assignment.load_from_json_v0_0_21(storyworld, data);
                return assignment;
            }
            return assignment;
        }

        const element_type = data["script_element_type"];
        if (element_type === "Pointer") {
            const pointer_type = data["pointer_type"];
            if (pointer_type === "String Constant") {
                return new StringConstant(data["value"]);
            }
            if (pointer_type === "Bounded Number Constant") {
                return new BNumberConstant(data["value"]);
            }
            if (pointer_type === "Boolean Constant") {
                return new BooleanConstant(data["value"]);
            }
            if (pointer_type === "Bounded Number Pointer") {
                const character_id = data["character"];
                const character = storyworld?.character_directory.get(character_id) ?? null;
                const pointer = new BNumberPointer(character, data["keyring"] ?? []);
                pointer.coefficient = typeof data["coefficient"] === "number" ? data["coefficient"] : 1;
                return pointer;
            }
            if (pointer_type === "Event Pointer") {
                const encounter_id = data["encounter"];
                const encounter = storyworld?.encounter_directory.get(encounter_id ?? "") ?? null;
                const option_index = typeof data["option"] === "number" ? data["option"] : -1;
                const reaction_index = typeof data["reaction"] === "number" ? data["reaction"] : -1;
                const option = encounter && option_index >= 0 ? encounter.options[option_index] ?? null : null;
                const reaction = option && reaction_index >= 0 ? option.reactions[reaction_index] ?? null : null;
                const eventPointer = new EventPointer(encounter, option, reaction);
                eventPointer.negated = Boolean(data["negated"]);
                const spool_id = data["spool"];
                if (spool_id && storyworld?.spool_directory.has(spool_id)) {
                    eventPointer.spool = storyworld.spool_directory.get(spool_id) ?? null;
                }
                return eventPointer;
            }
        }

        if (element_type === "Operator") {
            const operator_type = data["operator_type"];
            const operands_raw = Array.isArray(data["operands"]) ? data["operands"] : [];
            const operands = operands_raw.map((operand) => {
                if (operand && typeof operand === "object") {
                    return this.parse_script_element(operand, storyworld);
                }
                return operand;
            });

            if (operator_type === "Bounded Sum") {
                return new BSumOperator(operands);
            }
            if (operator_type === "Arithmetic Mean") {
                return new ArithmeticMeanOperator(operands);
            }
            if (operator_type === "Average") {
                return new AverageOperator(operands[0], operands[1]);
            }
            if (operator_type === "Arithmetic Negation") {
                return new ArithmeticNegationOperator(operands[0]);
            }
            if (operator_type === "Blend") {
                return new BlendOperator(operands[0], operands[1], operands[2]);
            }
            if (operator_type === "Nudge") {
                return new NudgeOperator(operands[0], operands[1]);
            }
            if (operator_type === "Maximum") {
                return new MaximumOperator(operands[0], operands[1]);
            }
            if (operator_type === "Minimum") {
                return new MinimumOperator(operands[0], operands[1]);
            }
            if (operator_type === "Proximity") {
                return new ProximityOperator(operands[0], operands[1]);
            }
            if (operator_type === "Proximity To") {
                return new ProximityToOperator(operands[0], operands[1]);
            }
            if (operator_type === "If Then") {
                const condition = data["condition"];
                const thenScript = data["then_script"];
                const elseScript = data["else_script"];
                const thenNode = thenScript ? this.parse_script_element(thenScript, storyworld) : null;
                const elseNode = elseScript ? this.parse_script_element(elseScript, storyworld) : null;
                return new IfThenOperator(condition, thenNode, elseNode);
            }
            if (operator_type === "Boolean Comparator") {
                const subtype = data["operator_subtype"] ?? "NOT";
                return new BooleanOperator(subtype, operands);
            }
        }

        return null;
    }

    public load_from_json_v0_0_21(data_to_load?: any, storyworld?: Storyworld): boolean {
        this.clear();
        if (data_to_load === null || data_to_load === undefined) {
            return true;
        }

        const elements = Array.isArray(data_to_load) ? data_to_load : [data_to_load];
        for (const element of elements) {
            const parsed = ScriptManager.parse_script_element(element, storyworld);
            if (parsed) {
                this.add_script_element(parsed);
            }
        }
        return true;
    }

    public clear(): void {
        this.script_elements = [];
    }

    public data_to_string(): string {
        return this.to_string();
    }
}
