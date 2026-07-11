import { SWOperator } from './SWOperator';
import { sw_script_data_types } from './SWScriptElement';

/**
 * Negates a numerical operand.
 */
export class ArithmeticNegationOperator extends SWOperator {
    constructor(in_operand: any = 0) {
        super();
        this.operator_type = "Arithmetic Negation";
        this.input_type = sw_script_data_types.BNUMBER;
        this.output_type = sw_script_data_types.BNUMBER;
        this.add_operand(in_operand);
    }

    public override get_value(): number {
        const value = this.evaluate_operand_at_index(0);
        if (typeof value === "number") {
            return 1 - value;
        }
        return 0;
    }

    public override data_to_string(): string {
        return `-(${this.stringify_operand_at_index(0)})`;
    }
}
