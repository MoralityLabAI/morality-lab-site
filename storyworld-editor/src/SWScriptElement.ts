export enum sw_script_data_types {
    BNUMBER,
    BOOLEAN,
    STRING,
    VOID,
    VARIANT,
}

/**
 * STUB
 */
export class SWScriptElement {
    public output_type: sw_script_data_types;
    public element_type: string = "Abstract";
    public id: string = "";
    public parent_operator: any | null = null;
    public script_index: number = -1;

    constructor() {
        this.output_type = sw_script_data_types.VOID;
    }

    public clear(): void {
        // to be overridden
    }

    /**
     * Copies fields from another instance.
     *
     * Many of the ported GDScript classes expect an explicit `original` parameter
     * (e.g. `set_as_copy_of(original)`), while a few call it with no args.
     * Keep the signature permissive to allow both styles.
     */
    public set_as_copy_of(_original?: unknown): void {
        // to be overridden
    }

    public remap(): boolean {
        return true;
    }

    public get_value(): any {
        return null;
    }

    public data_to_string(): string {
        return "";
    }

    public compile(): Record<string, any> {
        return {
            "script_element_type": this.element_type,
        };
    }
}
