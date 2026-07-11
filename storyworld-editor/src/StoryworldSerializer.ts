import { Storyworld } from "./Storyworld";
import { EncounterSorter } from "./EncounterSorter";

export class StoryworldSerializer {
    static to_project_dict(storyworld: Storyworld): any {
        const file_data: any = {};
        file_data["characters"] = [];
        for (const entry of storyworld.characters) {
            file_data["characters"].push(entry.compile());
        }
        file_data["authored_properties"] = [];
        for (const entry of storyworld.authored_properties) {
            file_data["authored_properties"].push(entry.compile());
        }
        const sorted_encounters = [...storyworld.encounters];
        sorted_encounters.sort(EncounterSorter.sort_created);
        file_data["encounters"] = [];
        for (const entry of sorted_encounters) {
            file_data["encounters"].push(entry.compile());
        }
        file_data["spools"] = [];
        for (const entry of storyworld.spools) {
            file_data["spools"].push(entry.compile());
        }
        // FIX: Change [...] to {...} because unique_id_seeds is now an object
        file_data["unique_id_seeds"] = { ...storyworld.unique_id_seeds };
        file_data["storyworld_title"] = storyworld.storyworld_title;
        file_data["storyworld_author"] = storyworld.storyworld_author;
        file_data["debug_mode"] = storyworld.storyworld_debug_mode_on;
        file_data["display_mode"] = storyworld.storyworld_display_mode;
        file_data["sweepweave_version"] = storyworld.sweepweave_version_number;
        file_data["css_theme"] = storyworld.css_theme;
        file_data["font_size"] = storyworld.font_size;
        file_data["language"] = storyworld.language;
        file_data["rating"] = storyworld.rating;
        file_data["about_text"] = {
            script_element_type: "Pointer",
            pointer_type: "String Constant",
            value: storyworld.about_text,
        };
        file_data["meta_description"] = storyworld.meta_description;
        file_data["creation_time"] = storyworld.creation_time;
        file_data["modified_time"] = storyworld.modified_time;
        file_data["IFID"] = storyworld.ifid;
        if (storyworld.multiplayer_is_explicit || storyworld.multiplayer !== 1 || storyworld.turns.length > 0) {
            file_data["multiplayer"] = storyworld.multiplayer;
            file_data["turns"] = [...storyworld.turns];
        }
        return file_data;
    }
}
