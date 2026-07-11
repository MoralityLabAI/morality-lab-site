import { SWOperator } from './SWOperator';
import { sw_script_data_types } from './SWScriptElement';

/**
 * An operator that performs a linear interpolation between two values.
 * Ported from Godot/GDScript.
 */
export class BlendOperator extends SWOperator {

    constructor(in_operand_0: any, in_operand_1: any, in_weight: any) {
        super();
        this.operator_type = "Blend";
        this.input_type = sw_script_data_types.BNUMBER;
        this.output_type = sw_script_data_types.BNUMBER;
        this.add_operand(in_operand_0);
        this.add_operand(in_operand_1);
        this.add_operand(in_weight);
    }

    /**
     * Calculates the blended value.
     * @param leaf The historybook leaf.
     * @returns The result of the interpolation.
     */
    public override get_value(): number {
        const value_0 = this.evaluate_operand_at_index(0);
        const value_1 = this.evaluate_operand_at_index(1);
        const value_weight = this.evaluate_operand_at_index(2);

        // The weight is normalized from a [-1, 1] range to a [0, 1] range.
        const normalized_weight = (value_weight + 1) / 2;

        const result = (value_0 * (1 - normalized_weight)) + (value_1 * normalized_weight);
        return result;
    }

    public override data_to_string(): string {
        let result = "Blend of ";
        result += this.stringify_operand_at_index(0) + " and ";
        result += this.stringify_operand_at_index(1) + " with weight ";
        result += this.stringify_operand_at_index(2);
        return result;
    }
}
