import { SWScriptElement, sw_script_data_types } from './SWScriptElement';

/**
 * A script operator that performs an operation on its operands.
 * Ported from Godot/GDScript.
 */
export class SWOperator extends SWScriptElement {
    public input_type: sw_script_data_types = sw_script_data_types.VARIANT;
    public operator_type: string = "Generic Operation";
    public operands: any[] = [];

    /**
     * If "can_add_operands" is true, this operator can employ an arbitrarily long list of operands, 
     * though it will require at least one operand to work as intended.
     * If "can_add_operands" is false, this operator has a set number of operands.
     */
    public can_add_operands: boolean = false;

    constructor() {
        super();
    }

    public add_operand(operand: any): void {
        this.operands.push(operand);
        if (operand instanceof SWScriptElement) {
            operand.parent_operator = this;
            operand.script_index = this.operands.length - 1;
        }
    }

    public override remap(): boolean {
        let result = true;
        for (const operand of this.operands) {
            if (operand instanceof SWScriptElement) {
                const check = operand.remap();
                result = result && check;
            }
        }
        return result;
    }

    public evaluate_operand(operand: any): any {
        let result = null;
        const operand_type = typeof operand;

        if (operand === null) {
            result = null;
        } else if (operand_type === 'boolean' || operand_type === 'number') {
            result = operand;
        } else if (operand instanceof SWScriptElement) {
            result = operand.get_value();
        }

        if (result === null) {
            console.warn("Warning: Invalid operand.");
        }
        return result;
    }

    public evaluate_operand_at_index(operand_index: number): any {
        if (operand_index === null || operand_index >= this.operands.length) {
            // Operator does not contain an operand at the index specified.
            return null;
        }
        const operand = this.operands[operand_index];
        return this.evaluate_operand(operand);
    }

    public override clear(): void {
        for (const operand of this.operands) {
            if (operand instanceof SWScriptElement) {
                operand.clear();
                // In Godot, this was operand.call_deferred("free").
                // In JS, garbage collection is automatic. By clearing the array below,
                // we remove the reference from this parent, allowing the child to be collected
                // if no other references exist.
            }
        }
        this.operands = [];
    }

    public stringify_input_type(): string {
        // This is used for compiling storyworlds, so the strings are javascript data types.
        if (sw_script_data_types.BOOLEAN === this.input_type) {
            return "boolean";
        } else if (sw_script_data_types.BNUMBER === this.input_type) {
            return "number";
        } else {
            return "";
        }
    }

    public override compile(): Record<string, any> {
        const output: Record<string, any> = {};
        output["script_element_type"] = "Operator";
        output["operator_type"] = this.operator_type;
        output["input_type"] = this.stringify_input_type();
        output["operands"] = [];
        for (const operand of this.operands) {
            const operand_type = typeof operand;
            if (operand === null) {
                output["operands"].push(null);
            } else if (operand_type === 'boolean' || operand_type === 'number') {
                output["operands"].push(operand);
            } else if (operand instanceof SWScriptElement) {
                output["operands"].push(operand.compile());
            }
        }
        return output;
    }

    public stringify_operand_at_index(operand_index: number): string {
        if (operand_index === null || operand_index >= this.operands.length) {
            return "null";
        }
        const operand = this.operands[operand_index];
        let result = "null";
        const operand_type = typeof operand;

        if (operand === null) {
            // pass
        } else if (operand_type === 'boolean' || operand_type === 'number') {
            result = String(operand);
        } else if (operand_type === 'string') {
            result = `"${operand}"`;
        } else if (operand instanceof SWScriptElement) {
            result = operand.data_to_string();
        }
        return result;
    }

    public override data_to_string(): string {
        return "SweepWeave Script Operator";
    }
}
