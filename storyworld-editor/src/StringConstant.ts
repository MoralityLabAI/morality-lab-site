import { SWPointer } from './SWPointer';
import { sw_script_data_types } from './SWScriptElement';

/**
 * A pointer that holds a constant string value.
 */
export class StringConstant extends SWPointer {
    public value: string = '';

    constructor(in_value: any = '') {
        super();
        this.pointer_type = 'String Constant';
        this.output_type = sw_script_data_types.STRING;
        this.set_value(in_value);
    }

    public override get_value(): string {
        return this.value;
    }

    public set_value(in_value: any): void {
        if (typeof in_value === 'string') {
            this.value = in_value;
        } else if (in_value === null || in_value === undefined) {
            this.value = '';
        } else {
            this.value = String(in_value);
        }
    }

    public override compile(): Record<string, any> {
        return {
            script_element_type: 'Pointer',
            pointer_type: this.pointer_type,
            value: this.value,
        };
    }

    public override data_to_string(): string {
        return `"${this.value}"`;
    }
}
