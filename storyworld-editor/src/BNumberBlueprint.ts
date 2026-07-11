import { Storyworld } from "./Storyworld";
import { Actor } from "./Actor";
import { UUID } from "./UUID";

export enum possible_attribution_targets {
    STORYWORLD,
    CAST_MEMBERS,
    ENTIRE_CAST
}

export class BNumberBlueprint {
    storyworld: Storyworld | null = null;
    id: string;
    property_name: string = "";
    depth: number = 0;
    default_value: number = 0;
    attribution_target: possible_attribution_targets = possible_attribution_targets.ENTIRE_CAST;
    affected_characters: Actor[] = [];
    creation_index: number = 0;
    creation_time: number = Date.now();
    modified_time: number = Date.now();

    constructor(storyworld: Storyworld, property_name: string, id: string | null = null, depth: number = 0, default_value: number = 0) {
        this.storyworld = storyworld;
        this.id = id || UUID.v4();
        this.property_name = property_name;
        this.depth = depth;
        this.default_value = default_value;
        this.creation_time = Date.now();
        this.modified_time = Date.now();
    }

    get_property_name(): string {
        if (this.property_name !== "") {
            return this.property_name;
        } else {
            return "[Unnamed Property]";
        }
    }

    log_update(): void {
        this.modified_time = Date.now();
    }

    set_as_copy_of(original: BNumberBlueprint): void {
        this.id = original.id;
        this.property_name = original.property_name;
        this.depth = original.depth;
        this.default_value = original.default_value;
        this.attribution_target = original.attribution_target;
        this.affected_characters = [];
        for (const character of original.affected_characters) {
            this.affected_characters.push(character);
        }
        this.modified_time = Date.now();
    }

    remap(to_storyworld: Storyworld): void {
        this.storyworld = to_storyworld;
        const old_affected_characters = [...this.affected_characters];
        this.affected_characters = [];
        for (const character of old_affected_characters) {
            if (this.storyworld.character_directory.has(character.id)) {
                this.affected_characters.push(this.storyworld.character_directory.get(character.id)!);
            }
        }
    }

    compile(include_editor_only_variables: boolean = false): any {
        const output: any = {};
        output["property_type"] = "bounded number";
        output["id"] = this.id;
        output["property_name"] = this.property_name;
        output["depth"] = this.depth;
        output["default_value"] = this.default_value;
        if (this.attribution_target === possible_attribution_targets.STORYWORLD) {
            output["attribution_target"] = "storyworld";
        } else if (this.attribution_target === possible_attribution_targets.CAST_MEMBERS) {
            output["attribution_target"] = "some cast members";
        } else if (this.attribution_target === possible_attribution_targets.ENTIRE_CAST) {
            output["attribution_target"] = "all cast members";
        }
        output["affected_characters"] = [];
        for (const character of this.affected_characters) {
            output["affected_characters"].push(character.id);
        }
        if (include_editor_only_variables) {
            output["creation_index"] = this.creation_index;
            output["creation_time"] = this.creation_time;
            output["modified_time"] = this.modified_time;
        }
        return output;
    }
}
