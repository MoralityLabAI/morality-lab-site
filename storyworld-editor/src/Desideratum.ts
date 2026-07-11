import { SWOperator } from './SWOperator';
import { SWScriptElement, sw_script_data_types } from './SWScriptElement';

/**
 * Clamps a number between a minimum and maximum value.
 * (Duplicated for now, could be a shared utility later)
 * @param value The number to clamp.
 * @param min The minimum value.
 * @param max The maximum value.
 * @returns The clamped number.
 */
function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(value, max));
}

/**
 * An operator that measures the "closeness" (desideratum) between two numerical operands.
 * Ported from Godot/GDScript.
 */
export class Desideratum extends SWOperator {

    constructor(in_operand_0: any = null, in_operand_1: any = null) {
        super();
        this.operator_type = "Desideratum";
        this.input_type = sw_script_data_types.BNUMBER;
        this.output_type = sw_script_data_types.BNUMBER;
        this.add_operand(in_operand_0);
        this.add_operand(in_operand_1);
    }

    private get_distance_between_operands(): number {
        const value_0 = this.evaluate_operand_at_index(0);
        const value_1 = this.evaluate_operand_at_index(1);
        
        if (typeof value_0 === 'number' && typeof value_1 === 'number') {
            return Math.abs(value_0 - value_1);
        } else {
            console.error("Error evaluating desideratum: Operands are not numerical.");
            return 1.98; // Original GDScript returns 1.98 on error
        }
    }

    /**
     * Calculates the desideratum (closeness) value.
     * @param leaf The historybook leaf.
     * @returns The desideratum value, clamped between -0.99 and 0.99.
     */
    public override get_value(): number {
        const result = 0.99 - this.get_distance_between_operands();
        return clamp(result, -0.99, 0.99);
    }

    public override data_to_string(): string {
        if (this.operands.length !== 2) {
            return "Invalid Proximity-to operator.";
        }
        let result = "How close is ";
        if (this.operands[0] instanceof SWScriptElement) {
            result += this.operands[0].data_to_string();
        } else {
            result += String(this.operands[0]);
        }
        result += " to ";
        if (this.operands[1] instanceof SWScriptElement) {
            result += this.operands[1].data_to_string();
        } else {
            result += String(this.operands[1]);
        }
        result += "?";
        return result;
    }
}
