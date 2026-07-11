import { SWOperator } from './SWOperator';
import { sw_script_data_types } from './SWScriptElement';

/**
 * If-Then operator that chooses between two bounded number expressions.
 * The condition is evaluated by a lightweight boolean descriptor.
 */
export class IfThenOperator extends SWOperator {
    public condition: any | null = null;
    public then_script: any | null = null;
    public else_script: any | null = null;

    constructor(condition: any = null, then_script: any = null, else_script: any = null) {
        super();
        this.operator_type = "If Then";
        this.input_type = sw_script_data_types.BOOLEAN;
        this.output_type = sw_script_data_types.BNUMBER;
        this.condition = condition;
        this.then_script = then_script;
        this.else_script = else_script;
    }

    private evaluate_condition(): boolean {
        if (this.condition?.type === 'Constant') {
            return Boolean(this.condition.value);
        }
        if (this.condition?.type === 'SpoolActive') {
            const storyworld = this.condition.storyworld;
            if (!storyworld) return false;
            const spool = storyworld.spool_directory.get(this.condition.spoolId);
            return Boolean(spool?.active_at_start);
        }
        return false;
    }

    public override get_value(): number {
        const chooseThen = this.evaluate_condition();
        const selected = chooseThen ? this.then_script : this.else_script;
        if (selected && typeof selected.get_value === 'function') {
            return selected.get_value();
        }
        return 0;
    }

    public override compile(): Record<string, any> {
        return {
            script_element_type: "Operator",
            operator_type: this.operator_type,
            condition: this.condition ?? null,
            then_script: this.then_script?.compile?.() ?? null,
            else_script: this.else_script?.compile?.() ?? null,
        };
    }

    public override data_to_string(): string {
        return "If Then";
    }
}
