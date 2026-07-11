import { SWOperator } from './SWOperator';
import { sw_script_data_types } from './SWScriptElement';

/**
 * Maximum of two bounded numbers.
 */
export class MaximumOperator extends SWOperator {
    constructor(in_left: any = 0, in_right: any = 0) {
        super();
        this.operator_type = "Maximum";
        this.input_type = sw_script_data_types.BNUMBER;
        this.output_type = sw_script_data_types.BNUMBER;
        this.add_operand(in_left);
        this.add_operand(in_right);
    }

    public override get_value(): number {
        const left = this.evaluate_operand_at_index(0);
        const right = this.evaluate_operand_at_index(1);
        if (typeof left === "number" && typeof right === "number") {
            return Math.max(left, right);
        }
        return 0;
    }

    public override data_to_string(): string {
        return `Max(${this.stringify_operand_at_index(0)}, ${this.stringify_operand_at_index(1)})`;
    }
}
