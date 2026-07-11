import { SWOperator } from './SWOperator';
import { SWScriptElement, sw_script_data_types } from './SWScriptElement';

export enum operator_subtypes {
    NOT,
    AND,
    OR,
    XOR,
    EQUALS
}

/**
 * Takes boolean values or operators as inputs and outputs true, false, or null.
 * Ported from Godot/GDScript.
 */
export class BooleanOperator extends SWOperator {
    public operator_subtype: operator_subtypes | null = operator_subtypes.NOT;

    constructor(in_operator_subtype: string = "NOT", in_operands: any[] = [true]) {
        super();
        this.operator_type = "Boolean Comparator";
        this.input_type = sw_script_data_types.BOOLEAN;
        this.output_type = sw_script_data_types.BOOLEAN;
        this.set_operator_subtype(in_operator_subtype);
        for (const operand of in_operands) {
            this.add_operand(operand);
        }
    }

    public operator_subtype_to_string(): string {
        switch (this.operator_subtype) {
            case operator_subtypes.NOT: return "NOT";
            case operator_subtypes.AND: return "AND";
            case operator_subtypes.OR: return "OR";
            case operator_subtypes.XOR: return "XOR";
            case operator_subtypes.EQUALS: return "EQUALS";
            default: return "NULL";
        }
    }
    
    public set_operator_subtype(in_operator_subtype: string): void {
        const subtype = in_operator_subtype.toUpperCase();
        if (subtype === "NOT") {
            this.can_add_operands = false;
            this.operator_subtype = operator_subtypes.NOT;
        } else if (subtype === "AND") {
            this.can_add_operands = true;
            this.operator_subtype = operator_subtypes.AND;
        } else if (subtype === "OR") {
            this.can_add_operands = true;
            this.operator_subtype = operator_subtypes.OR;
        } else if (subtype === "XOR") {
            this.can_add_operands = false;
            this.operator_subtype = operator_subtypes.XOR;
        } else if (subtype === "EQUALS") {
            this.can_add_operands = true;
            this.operator_subtype = operator_subtypes.EQUALS;
        } else {
            this.operator_subtype = null;
        }
    }

    private test_operand(operand: any): boolean | null {
        if (operand === null || this.operator_subtype === null) {
            console.error("Cannot evaluate boolean operator.");
            return null;
        }

        let result: any = null;
        if (operand instanceof SWScriptElement) {
            result = operand.get_value();
        } else {
            result = operand;
        }
        
        const result_type = typeof result;
        if (result_type === 'boolean') {
            return result;
        }
        if (result_type === 'number') {
            return Boolean(result); // In JS, 0 is false, non-zero is true.
        }
        
        return null;
    }

    public override get_value(): boolean | null {
        switch (this.operator_subtype) {
            case operator_subtypes.NOT: {
                if (this.operands.length >= 1) {
                    const value_0 = this.test_operand(this.operands[0]);
                    return value_0 === null ? null : !value_0;
                }
                return null;
            }
            case operator_subtypes.AND: {
                for (const operand of this.operands) {
                    const value = this.test_operand(operand);
                    if (value === null) continue;
                    if (!value) return false;
                }
                return true;
            }
            case operator_subtypes.OR: {
                for (const operand of this.operands) {
                    const value = this.test_operand(operand);
                    if (value === null) continue;
                    if (value) return true;
                }
                return false;
            }
            case operator_subtypes.XOR: {
                if (this.operands.length >= 2) {
                    const value_0 = this.test_operand(this.operands[0]);
                    const value_1 = this.test_operand(this.operands[1]);
                    if (value_0 === null || value_1 === null) return null;
                    return value_0 !== value_1;
                }
                return null;
            }
            case operator_subtypes.EQUALS: {
                if (this.operands.length === 0) return null;
                if (this.operands.length === 1) return true;
                
                let first_value: boolean | null = null;
                for(const operand of this.operands) {
                    const current_value = this.test_operand(operand);
                    if (current_value === null) continue;

                    if (first_value === null) {
                        first_value = current_value; // Set the first non-null value for comparison
                    } else {
                        if (first_value !== current_value) {
                            return false; // If any two non-null values are not equal, return false.
                        }
                    }
                }
                // If all non-null values are equal, return true. If all were null, first_value is still null.
                return first_value !== null;
            }
            default:
                return null;
        }
    }

    public override compile(): Record<string, any> {
        const output = super.compile();
        output["operator_subtype"] = this.operator_subtype_to_string();
        
        // Override operand compilation to coerce numbers to booleans
        output["operands"] = [];
        for (const operand of this.operands) {
            if (operand === null) {
                output["operands"].push(null);
            } else if (typeof operand === 'boolean') {
                output["operands"].push(operand);
            } else if (typeof operand === 'number') {
                output["operands"].push(Boolean(operand));
            } else if (operand instanceof SWScriptElement) {
                output["operands"].push(operand.compile());
            }
        }
        return output;
    }
}
