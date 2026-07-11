import { SWScriptElement } from "./SWScriptElement";

/**
 * STUB
 */
export class SWPointer extends SWScriptElement {
    public pointer_type: string = "Abstract";

    /**
     * STUB
     * @returns A dictionary of the pointer's data.
     */
    public override compile(): Record<string, any> {
        return {
            "script_element_type": "Pointer",
            "pointer_type": this.pointer_type,
        };
    }
}
