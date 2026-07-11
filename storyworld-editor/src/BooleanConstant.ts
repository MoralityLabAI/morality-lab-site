import { SWPointer } from './SWPointer';
import { sw_script_data_types } from './SWScriptElement';

/**
 * A pointer that holds a constant boolean value.  
 * Ported from Godot/GDScript.
 */
export class BooleanConstant extends SWPointer {

    public value: boolean | null = null;

    constructor(in_value: any) {
        super();
        this.pointer_type = "Boolean Constant";
        this.output_type = sw_script_data_types.BOOLEAN;
        this.set_value(in_value);
    }

    public override get_value(): boolean | null {
        return this.value;
    }

    public set_value(in_value: any): void {
        if (typeof in_value === 'boolean') {
            this.value = in_value;
        } else {
            console.error("Cannot set a boolean constant to a non-boolean value.");
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
}
