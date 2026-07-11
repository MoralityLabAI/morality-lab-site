import { Actor } from './Actor';
import { BNumberBlueprint } from './BNumberBlueprint';
import { Encounter } from './Encounter';
import { Spool } from './Spool';
import { Option } from './Option';
import { Reaction } from './Reaction';
import { Prerequisite } from './Prerequisite';
import { ScriptManager } from './ScriptManager';
import { deserializeBool, deserializeScript } from './scriptAst';
import { deserializeEffect } from './Effect';

export interface UniqueIdSeeds {
    character: number;
    encounter: number;
    option: number;
    reaction: number;
    spool: number;
    authored_property: number;
}

export class Storyworld {
    public character_directory: Map<string, Actor> = new Map();
    public spool_directory: Map<string, Spool> = new Map();
    public encounter_directory: Map<string, Encounter> = new Map();
    public characters: Actor[] = [];
    public authored_properties: BNumberBlueprint[] = [];
    public encounters: Encounter[] = [];
    public spools: Spool[] = [];
    public unique_id_seeds: UniqueIdSeeds = {
        character: 0,
        encounter: 0,
        option: 0,
        reaction: 0,
        spool: 0,
        authored_property: 0
    };
    public storyworld_title: string = "";
    public storyworld_author: string = "";
    public storyworld_debug_mode_on: boolean = false;
    public storyworld_display_mode: string | number = "";
    public sweepweave_version_number: string = "";
    public css_theme: string = "";
    public font_size: string = "";
    public language: string = "";
    public rating: string = "";
    public about_text: string = "";
    public meta_description: string = "";
    public creation_time: number = 0;
    public modified_time: number = 0;
    public ifid: string = "";
    public multiplayer: number = 1;
    public turns: string[] = [];
    public multiplayer_is_explicit: boolean = false;

    public clear(): void {
        this.character_directory.clear();
        this.spool_directory.clear();
        this.encounter_directory.clear();
        this.characters = [];
        this.authored_properties = [];
        this.encounters = [];
        this.spools = [];
        this.unique_id_seeds = {
            character: 0,
            encounter: 0,
            option: 0,
            reaction: 0,
            spool: 0,
            authored_property: 0
        };
        this.storyworld_title = "";
        this.storyworld_author = "";
        this.storyworld_debug_mode_on = false;
        this.storyworld_display_mode = "";
        this.sweepweave_version_number = "";
        this.css_theme = "";
        this.font_size = "";
        this.language = "";
        this.rating = "";
        this.about_text = "";
        this.meta_description = "";
        this.creation_time = 0;
        this.modified_time = 0;
        this.ifid = "";
        this.multiplayer = 1;
        this.turns = [];
        this.multiplayer_is_explicit = false;
    }

    public set_as_copy_of(original: Storyworld): void {
        this.clear();
        this.storyworld_title = original.storyworld_title;
        this.storyworld_author = original.storyworld_author;
        this.storyworld_debug_mode_on = original.storyworld_debug_mode_on;
        this.storyworld_display_mode = original.storyworld_display_mode;
        this.sweepweave_version_number = original.sweepweave_version_number;
        this.css_theme = original.css_theme;
        this.font_size = original.font_size;
        this.language = original.language;
        this.rating = original.rating;
        this.about_text = original.about_text;
        this.meta_description = original.meta_description;
        this.creation_time = original.creation_time;
        this.modified_time = original.modified_time;
        this.ifid = original.ifid;
        this.multiplayer = original.multiplayer;
        this.turns = [...original.turns];
        this.multiplayer_is_explicit = original.multiplayer_is_explicit;
        this.unique_id_seeds = { ...original.unique_id_seeds };

        for (const character of original.characters) {
            const new_character = new Actor();
            new_character.set_as_copy_of(character);
            this.characters.push(new_character);
            this.character_directory.set(new_character.id, new_character);
        }

        for (const authored_property of original.authored_properties) {
            const new_authored_property = new BNumberBlueprint(this, authored_property.property_name, authored_property.id, authored_property.depth, authored_property.default_value);
            new_authored_property.set_as_copy_of(authored_property);
            this.authored_properties.push(new_authored_property);
        }

        for (const original_encounter of original.encounters) {
            const new_encounter = new Encounter();
            new_encounter.set_as_copy_of(original_encounter);
            this.encounters.push(new_encounter);
            this.encounter_directory.set(new_encounter.id, new_encounter);
        }

        for (const spool of original.spools) {
            const new_spool = new Spool();
            new_spool.set_as_copy_of(spool);
            this.spools.push(new_spool);
            this.spool_directory.set(new_spool.id, new_spool);
        }
    }

    public load_from_dict_v0_0_07_through_v0_0_15(): void {
        // Implement this method
    }

    public load_from_dict_v0_0_21(data: any): void {
        this.storyworld_title = data.storyworld_title || "";
        this.storyworld_author = data.storyworld_author || "";
        this.sweepweave_version_number = data.sweepweave_version ?? this.sweepweave_version_number ?? "";
        this.ifid = data.IFID || "";
        this.storyworld_debug_mode_on = Boolean(data.debug_mode);
        this.storyworld_display_mode = data.display_mode ?? "";
        this.creation_time = data.creation_time ?? 0;
        this.modified_time = data.modified_time ?? 0;
        this.css_theme = data.css_theme ?? "";
        this.font_size = data.font_size ?? "";
        this.language = data.language ?? "";
        this.rating = data.rating ?? "";
        this.meta_description = data.meta_description ?? "";
        this.multiplayer_is_explicit = Object.prototype.hasOwnProperty.call(data, "multiplayer");
        this.multiplayer = Number.isInteger(data.multiplayer) && data.multiplayer >= 1 ? data.multiplayer : 1;
        this.turns = Array.isArray(data.turns) ? data.turns.filter((entry: unknown) => typeof entry === "string") : [];
        if (data.about_text && typeof data.about_text === "object" && data.about_text.value) {
            this.about_text = String(data.about_text.value);
        } else {
            this.about_text = data.about_text ?? "";
        }
        if (data.unique_id_seeds) {
            this.unique_id_seeds = { ...data.unique_id_seeds };
        }

        this.characters = [];
        this.character_directory.clear();
        if (Array.isArray(data.characters)) {
            for (const charData of data.characters) {
                const actor = new Actor(charData.id ?? "", charData.name ?? "", charData.pronoun ?? "");
                actor.storyworld = this;
                if (charData.bnumber_properties && typeof charData.bnumber_properties === "object") {
                    for (const [key, value] of Object.entries(charData.bnumber_properties)) {
                        if (typeof value === "number") {
                            actor.bnumber_properties.set(key, value);
                        } else if (value && typeof value === "object") {
                            actor.bnumber_properties.set(key, JSON.parse(JSON.stringify(value)));
                        }
                    }
                }
                this.characters.push(actor);
                this.character_directory.set(actor.id, actor);
            }
        }

        this.authored_properties = [];
        if (Array.isArray(data.authored_properties)) {
            for (const propData of data.authored_properties) {
                const blueprint = new BNumberBlueprint(
                    this,
                    propData.property_name ?? "",
                    propData.id ?? null,
                    propData.depth ?? 0,
                    propData.default_value ?? 0
                );
                if (propData.attribution_target === "storyworld") {
                    blueprint.attribution_target = 0;
                } else if (propData.attribution_target === "some cast members") {
                    blueprint.attribution_target = 1;
                } else {
                    blueprint.attribution_target = 2;
                }
                blueprint.affected_characters = Array.isArray(propData.affected_characters)
                    ? propData.affected_characters
                          .map((id: string) => this.character_directory.get(id))
                          .filter(Boolean) as Actor[]
                    : [];
                blueprint.creation_index = propData.creation_index ?? 0;
                blueprint.creation_time = propData.creation_time ?? 0;
                blueprint.modified_time = propData.modified_time ?? 0;
                this.authored_properties.push(blueprint);
            }
        }

        for (const actor of this.characters) {
            actor.authored_property_directory.clear();
            for (const blueprint of this.authored_properties) {
                actor.authored_property_directory.set(blueprint.id, blueprint);
            }
        }

        this.encounters = [];
        this.encounter_directory.clear();
        if (Array.isArray(data.encounters)) {
            for (const encounterData of data.encounters) {
                const encounter = new Encounter(encounterData.id ?? "", encounterData.title ?? "");
                encounter.creation_time = encounterData.creation_time ?? 0;
                encounter.modified_time = encounterData.modified_time ?? 0;
                encounter.earliest_turn = encounterData.earliest_turn ?? 0;
                encounter.latest_turn = encounterData.latest_turn ?? 0;
                encounter.connected_spool_ids = Array.isArray(encounterData.connected_spools)
                    ? [...encounterData.connected_spools]
                    : [];
                if (encounterData.text_script && typeof encounterData.text_script === "object") {
                    encounter.main_text = encounterData.text_script.value ?? "";
                } else {
                    encounter.main_text = encounterData.main_text ?? "";
                }
                if (encounterData.availability_ast) {
                    encounter.availability_script = deserializeBool(encounterData.availability_ast);
                }
                if (encounterData.desirability_ast) {
                    encounter.desirability_ast = deserializeScript(encounterData.desirability_ast);
                }
                if (Array.isArray(encounterData.prerequisites)) {
                    encounter.prerequisites = this.load_prerequisites(encounterData.prerequisites);
                }
                if (encounterData.desirability_script) {
                    encounter.desirability_script = new ScriptManager();
                    encounter.desirability_script.load_from_json_v0_0_21(encounterData.desirability_script, this);
                }
                if (encounterData.acceptability_script) {
                    encounter.acceptability_script = new ScriptManager();
                    encounter.acceptability_script.load_from_json_v0_0_21(encounterData.acceptability_script, this);
                }

                encounter.options = [];
                if (Array.isArray(encounterData.options)) {
                    for (const optionData of encounterData.options) {
                        const option = new Option(optionData.text ?? "", optionData.id ?? "");
                        option.parent_encounter = encounter;
                        if (optionData.text_script && typeof optionData.text_script === "object") {
                            option.text = optionData.text_script.value ?? option.text;
                        }
                        if (optionData.label) {
                            option.label = optionData.label;
                        }
                        if (optionData.visibility_ast) {
                            option.visibility_ast = deserializeBool(optionData.visibility_ast);
                        }
                        if (Array.isArray(optionData.prerequisites)) {
                            option.prerequisites = this.load_prerequisites(optionData.prerequisites);
                        }
                        if (optionData.visibility_script) {
                            option.visibility_script = new ScriptManager();
                            option.visibility_script.load_from_json_v0_0_21(optionData.visibility_script, this);
                        }
                        if (optionData.performability_script) {
                            option.performability_script = new ScriptManager();
                            option.performability_script.load_from_json_v0_0_21(optionData.performability_script, this);
                        }

                        option.reactions = [];
                        if (Array.isArray(optionData.reactions)) {
                            for (const reactionData of optionData.reactions) {
                                const reaction = new Reaction(reactionData.text ?? "", reactionData.id ?? "");
                                reaction.parent_option = option;
                                if (reactionData.text_script && typeof reactionData.text_script === "object") {
                                    reaction.text = reactionData.text_script.value ?? reaction.text;
                                }
                                if (reactionData.label) {
                                    reaction.label = reactionData.label;
                                }
                                reaction.consequence_id = reactionData.consequence_id ?? reactionData.consequence ?? null;
                                reaction.weight = typeof reactionData.weight === "number"
                                    ? reactionData.weight
                                    : (typeof reactionData.probability === "number" ? reactionData.probability : 1);
                                if (reactionData.inclination_ast) {
                                    reaction.inclination_script = deserializeScript(reactionData.inclination_ast);
                                }
                                if (Array.isArray(reactionData.effects)) {
                                    reaction.effects = reactionData.effects.map((effect: any) => deserializeEffect(effect));
                                }
                                if (Array.isArray(reactionData.after_effects)) {
                                    const effects_manager = new ScriptManager();
                                    effects_manager.load_from_json_v0_0_21(reactionData.after_effects, this);
                                    reaction.after_effects = effects_manager.script_elements;
                                    if (reaction.effects.length === 0) {
                                        // Populate placeholder effects for UI visibility when only legacy after_effects exist.
                                        reaction.effects = reactionData.after_effects
                                            .map((entry: any) => {
                                                if (entry?.effect_type === "Bounded Number Effect" && entry.Set?.keyring?.length) {
                                                    return {
                                                        type: "SetBNumberProperty",
                                                        characterId: entry.Set.character ?? "",
                                                        propertyId: entry.Set.keyring[entry.Set.keyring.length - 1] ?? "",
                                                        value: { type: "Constant", value: 0 },
                                                    };
                                                }
                                                if (entry?.effect_type === "Spool Effect" && typeof entry.Set === "string") {
                                                    return { type: "SetSpoolStatus", spoolId: entry.Set, value: { type: "Constant", value: true } };
                                                }
                                                return { type: "NextPage", encounterId: "" };
                                            })
                                            .filter((effect: any) => effect.type !== "NextPage" || effect.encounterId !== "");
                                    }
                                }
                                if (reactionData.desirability_script) {
                                    reaction.desirability_script = new ScriptManager();
                                    reaction.desirability_script.load_from_json_v0_0_21(reactionData.desirability_script, this);
                                }
                                if (reactionData.desirability_ast) {
                                    (reaction.desirability_script as any).ast_json = reactionData.desirability_ast;
                                    reaction.inclination_script = deserializeScript(reactionData.desirability_ast);
                                }
                                if (reactionData.inclination_ast) {
                                    (reaction.desirability_script as any).ast_json = reactionData.inclination_ast;
                                    reaction.inclination_script = deserializeScript(reactionData.inclination_ast);
                                }
                                if (Array.isArray(reactionData.prerequisites)) {
                                    reaction.prerequisites = this.load_prerequisites(reactionData.prerequisites);
                                }
                                option.reactions.push(reaction);
                            }
                        }
                        encounter.options.push(option);
                    }
                }

                this.encounters.push(encounter);
                this.encounter_directory.set(encounter.id, encounter);
            }
        }

        this.spools = [];
        this.spool_directory.clear();
        if (Array.isArray(data.spools)) {
            for (const spoolData of data.spools) {
                const spoolName = spoolData.spool_name ?? spoolData.spool_type ?? spoolData.name ?? "";
                const spool = new Spool(spoolData.id ?? "", spoolName);
                spool.active_at_start = Boolean(spoolData.active_at_start);
                spool.creation_index = spoolData.creation_index ?? 0;
                spool.creation_time = spoolData.creation_time ?? 0;
                spool.modified_time = spoolData.modified_time ?? 0;
                spool.encounter_ids = Array.isArray(spoolData.encounters) ? [...spoolData.encounters] : [];
                spool.spool_name = spoolName;
                spool.name = spoolName;
                this.spools.push(spool);
                this.spool_directory.set(spool.id, spool);
            }
        }

        for (const encounter of this.encounters) {
            for (const spool_id of encounter.connected_spool_ids) {
                const spool = this.spool_directory.get(spool_id);
                if (spool && !spool.encounter_ids.includes(encounter.id)) {
                    spool.encounter_ids.push(encounter.id);
                }
            }
        }

        for (const encounter of this.encounters) {
            for (const option of encounter.options) {
                for (const reaction of option.reactions) {
                    if (reaction.consequence_id && this.encounter_directory.has(reaction.consequence_id)) {
                        reaction.consequence = this.encounter_directory.get(reaction.consequence_id)!;
                    }
                }
            }
        }

        for (const prereq of this.collect_prerequisites()) {
            prereq.remap(this);
        }
    }

    private load_prerequisites(data: any[]): Prerequisite[] {
        const results: Prerequisite[] = [];
        for (const entry of data) {
            const prereq = new Prerequisite(entry.prereq_type ?? 0, Boolean(entry.negated));
            if (entry.encounter) {
                prereq.encounter = this.encounter_directory.get(entry.encounter) ?? new Encounter(entry.encounter);
            }
            if (typeof entry.option === "number") {
                const option = new Option();
                option.stored_index = entry.option;
                prereq.option = option;
            }
            if (typeof entry.reaction === "number") {
                const reaction = new Reaction();
                reaction.stored_index = entry.reaction;
                prereq.reaction = reaction;
            }
            prereq.encounter_scene = entry.encounter_scene ?? "";
            prereq.who1 = entry.who1 ? this.character_directory.get(entry.who1) ?? null : null;
            prereq.pValue1 = entry.pValue1 ?? null;
            prereq.operator = entry.operator ?? ">=";
            prereq.constant = entry.constant ?? 0;
            prereq.who2 = entry.who2 ? this.character_directory.get(entry.who2) ?? null : null;
            prereq.pValue2 = entry.pValue2 ?? null;
            results.push(prereq);
        }
        return results;
    }

    private collect_prerequisites(): Prerequisite[] {
        const results: Prerequisite[] = [];
        for (const encounter of this.encounters) {
            results.push(...encounter.prerequisites);
            for (const option of encounter.options) {
                results.push(...option.prerequisites);
                for (const reaction of option.reactions) {
                    results.push(...reaction.prerequisites);
                }
            }
        }
        return results;
    }
}
