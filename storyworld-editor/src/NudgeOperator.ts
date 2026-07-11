import { SWOperator } from './SWOperator';
import { sw_script_data_types } from './SWScriptElement';

/**
 * An operator that "nudges" a value towards 1 or -1 based on a second "nudge" value.
 * Ported from Godot/GDScript.
 */
export class NudgeOperator extends SWOperator {

    constructor(in_operand_0: any = null, in_operand_1: any = null) {
        super();
        this.operator_type = "Nudge";
        this.input_type = sw_script_data_types.BNUMBER;
        this.output_type = sw_script_data_types.BNUMBER;
        this.add_operand(in_operand_0);
        this.add_operand(in_operand_1);
    }

    /**
     * Calculates the nudged value.
     * @param leaf The historybook leaf.
     * @returns The nudged value.
     */
    public override get_value(): number {
        const value_0 = this.evaluate_operand_at_index(0);
        const value_1 = this.evaluate_operand_at_index(1);
        const result = (value_0 * (1 - Math.abs(value_1))) + value_1;
        return result;
    }

    public override data_to_string(): string {
        let result = "Nudge (";
        result += this.stringify_operand_at_index(0) + ",";
        result += this.stringify_operand_at_index(1) + ")";
        return result;
    }
}
