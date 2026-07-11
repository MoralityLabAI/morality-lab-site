import { SWOperator } from './SWOperator';
import { sw_script_data_types } from './SWScriptElement';

/**
 * An operator that calculates the arithmetic mean of its operands.
 * Ported from Godot/GDScript.
 */
export class ArithmeticMeanOperator extends SWOperator {

    constructor(in_operands: any[] = []) {
        super();
        this.operator_type = "Arithmetic Mean";
        this.input_type = sw_script_data_types.BNUMBER;
        this.output_type = sw_script_data_types.BNUMBER;
        this.can_add_operands = true;
        for (const operand of in_operands) {
            this.add_operand(operand);
        }
    }

    /**
     * Calculates the mean of all numerical operands.
     * @param leaf The historybook leaf.
     * @returns The mean, or 0 if no valid operands, or null if no operands exist.
     */
    public override get_value(): number | null {
        if (this.operands.length === 0) {
            console.warn("Warning: Arithmetic mean operator has no operands.");
            return null;
        }

        let sum = 0;
        let count = 0;

        for (const operand of this.operands) {
            const operand_value = this.evaluate_operand(operand);
            if (operand_value !== null && typeof operand_value === 'number') {
                sum += operand_value;
                count += 1;
            }
        }

        if (count === 0) {
            return 0;
        }
        return sum / count;
    }
}
