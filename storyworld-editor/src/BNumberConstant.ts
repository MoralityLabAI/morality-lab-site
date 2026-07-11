import { SWPointer } from './SWPointer';
import { sw_script_data_types } from './SWScriptElement';

/**
 * Clamps a number between a minimum and maximum value.
 * @param value The number to clamp.
 * @param min The minimum value.
 * @param max The maximum value.
 * @returns The clamped number.
 */
function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(value, max));
}

/**
 * A pointer that holds a constant, bounded numerical value.
 * Ported from Godot/GDScript.
 */
export class BNumberConstant extends SWPointer {

    public value: number | null = 0;
    public lower_boundary: number = -0.99;
    public upper_boundary: number = 0.99;

    constructor(in_value: any) {
        super();
        this.pointer_type = "Bounded Number Constant";
        this.output_type = sw_script_data_types.BNUMBER;
        this.set_value(in_value);
    }

    public override get_value(): number {
        if (this.value === null) {
            // Returning 0 to avoid breaking consumers expecting a number.
            // Original code could result in null being passed to clamp, which is undesirable.
            return 0;
        }
        return clamp(this.value, this.lower_boundary, this.upper_boundary);
    }

    public set_value(in_value: any): void {
        if (typeof in_value === 'number') {
            this.value = clamp(in_value, this.lower_boundary, this.upper_boundary);
        } else {
            console.error("Cannot set a bounded number constant to a non-numerical value.");
            this.value = null;
        }
    }

    public override compile(): Record<string, any> {
        const output: Record<string, any> = {};
        output["script_element_type"] = "Pointer";
        output["pointer_type"] = this.pointer_type;
        output["value"] = this.get_value();
        return output;
    }

    public override data_to_string(): string {
        return String(this.value);
    }
}
