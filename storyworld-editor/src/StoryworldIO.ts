import { Storyworld } from "./Storyworld";

export class StoryworldIO {
    static normalize_input_text(text: string): string {
        return text.replace("var storyworld_data = ", "");
    }

    static parse_storyworld_dict(text: string): any {
        try {
            return JSON.parse(text);
        } catch (e: any) {
            console.error("Error parsing JSON:", e);
            return {};
        }
    }

    static load_into_storyworld(storyworld: Storyworld, text: string): boolean {
        const normalized_text = this.normalize_input_text(text);
        const data_to_load = this.parse_storyworld_dict(normalized_text);
        
        if (Object.keys(data_to_load).length === 0) {
            console.error("Cannot load project file: Parsed data is empty.");
            return false;
        }

        storyworld.clear();

        if (data_to_load.hasOwnProperty("sweepweave_version")) {
            storyworld.sweepweave_version_number = data_to_load.sweepweave_version;
            const version = storyworld.sweepweave_version_number.split(".");
            
            if (version.length === 3) {
                const major = parseInt(version[0]);
                const minor = parseInt(version[1]);
                const patch = parseInt(version[2]);

                // Revised logic: Assume versions >= 0.1.0 or >= 0.0.21 should use the newer loader
                if (major === 0 && minor >= 1 || (major === 0 && minor === 0 && patch >= 21)) {
                    storyworld.load_from_dict_v0_0_21(data_to_load);
                } else if (major === 0 && minor === 0 && patch >= 7 && patch <= 15) {
                    storyworld.load_from_dict_v0_0_07_through_v0_0_15(); // Keep this as is for now
                } else {
                    console.error(`Cannot load project file: Unsupported version ${storyworld.sweepweave_version_number}.`);
                    return false;
                }
            } else {
                console.error(`Cannot load project file: Invalid version format ${storyworld.sweepweave_version_number}.`);
                return false;
            }
        } else {
            // Be permissive for legacy files: assume v0.0.21 schema.
            storyworld.sweepweave_version_number = "0.0.21";
            storyworld.load_from_dict_v0_0_21(data_to_load);
        }
        return true;
    }
}
