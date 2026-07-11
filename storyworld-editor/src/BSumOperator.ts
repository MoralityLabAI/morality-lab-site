import { SWOperator } from './SWOperator';
import { sw_script_data_types } from './SWScriptElement';

/**
 * An operator that performs a "bounded sum" operation on its numerical operands.
 * It converts bounded numbers to a normal scale, sums them, and then converts the total back to a bounded scale.
 * Ported from Godot/GDScript.
 */
export class BSumOperator extends SWOperator {

    constructor(in_operands: any[] = []) {
        super();
        this.operator_type = "Bounded Sum";
        this.input_type = sw_script_data_types.BNUMBER;
        this.output_type = sw_script_data_types.BNUMBER;
        this.can_add_operands = true;
        for (const operand of in_operands) {
            this.add_operand(operand);
        }
    }

    private convert_bounded_to_normal(x: number): number {
        if (x === 0) {
            return 0;
        } else if (x > 0) {
            // Equivalent to (1 / (1 - x)) - 1
            return (1 / (1 - x)) - 1;
        } else { // x < 0
            // Equivalent to (1 / (-1 - x)) + 1
            return (1 / (-1 - x)) + 1;
        }
    }

    private convert_normal_to_bounded(x: number): number {
        if (x === 0) {
            return 0;
        } else if (x > 0) {
            // Equivalent to 1 - (1 / (x + 1))
            return 1 - (1 / (x + 1));
        } else { // x < 0
            // Equivalent to -1 - (1 / (x - 1))
            return -1 - (1 / (x - 1));
        }
    }

    /**
     * Calculates the bounded sum of all numerical operands.
     * @param leaf The historybook leaf.
     * @returns The bounded sum.
     */
    public override get_value(): number {
        let result = 0;
        for (const operand of this.operands) {
            const operand_value = this.evaluate_operand(operand);
            if (operand_value !== null && typeof operand_value === 'number') {
                result += this.convert_bounded_to_normal(operand_value);
            }
        }
        return this.convert_normal_to_bounded(result);
    }
}
