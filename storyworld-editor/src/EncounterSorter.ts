import { Encounter } from "./Encounter";

export class EncounterSorter {
    static sort_a_z(a: Encounter, b: Encounter): number {
        if (a.title < b.title) {
            return -1;
        }
        if (a.title > b.title) {
            return 1;
        }
        if (a.id < b.id) {
            return -1;
        }
        if (a.id > b.id) {
            return 1;
        }
        return 0;
    }

    static sort_z_a(a: Encounter, b: Encounter): number {
        if (a.title > b.title) {
            return -1;
        }
        if (a.title < b.title) {
            return 1;
        }
        return 0;
    }

    static sort_created(a: Encounter, b: Encounter): number {
        if (a.creation_time < b.creation_time) {
            return -1;
        }
        if (a.creation_time > b.creation_time) {
            return 1;
        }
        return 0;
    }

    static sort_r_created(a: Encounter, b: Encounter): number {
        if (a.creation_time > b.creation_time) {
            return -1;
        }
        if (a.creation_time < b.creation_time) {
            return 1;
        }
        return 0;
    }

    static sort_modified(a: Encounter, b: Encounter): number {
        if (a.modified_time > b.modified_time) {
            return -1;
        }
        if (a.modified_time < b.modified_time) {
            return 1;
        }
        return 0;
    }

    static sort_r_modified(a: Encounter, b: Encounter): number {
        if (a.modified_time < b.modified_time) {
            return -1;
        }
        if (a.modified_time > b.modified_time) {
            return 1;
        }
        return 0;
    }

    static sort_e_turn(a: Encounter, b: Encounter): number {
        if (a.earliest_turn < b.earliest_turn) {
            return -1;
        }
        if (a.earliest_turn > b.earliest_turn) {
            return 1;
        }
        return 0;
    }

    static sort_r_e_turn(a: Encounter, b: Encounter): number {
        if (a.earliest_turn > b.earliest_turn) {
            return -1;
        }
        if (a.earliest_turn < b.earliest_turn) {
            return 1;
        }
        return 0;
    }

    static sort_l_turn(a: Encounter, b: Encounter): number {
        if (a.latest_turn < b.latest_turn) {
            return -1;
        }
        if (a.latest_turn > b.latest_turn) {
            return 1;
        }
        return 0;
    }

    static sort_r_l_turn(a: Encounter, b: Encounter): number {
        if (a.latest_turn > b.latest_turn) {
            return -1;
        }
        if (a.latest_turn < b.latest_turn) {
            return 1;
        }
        return 0;
    }

    static sort_antagonist(a: Encounter, b: Encounter): number {
        if (a.antagonist!.char_name < b.antagonist!.char_name) {
            return -1;
        }
        if (a.antagonist!.char_name > b.antagonist!.char_name) {
            return 1;
        }
        return 0;
    }

    static sort_r_antagonist(a: Encounter, b: Encounter): number {
        if (a.antagonist!.char_name > b.antagonist!.char_name) {
            return -1;
        }
        if (a.antagonist!.char_name < b.antagonist!.char_name) {
            return 1;
        }
        return 0;
    }

    static sort_options(a: Encounter, b: Encounter): number {
        if (a.options.length < b.options.length) {
            return -1;
        }
        if (a.options.length > b.options.length) {
            return 1;
        }
        return 0;
    }

    static sort_r_options(a: Encounter, b: Encounter): number {
        if (a.options.length > b.options.length) {
            return -1;
        }
        if (a.options.length < b.options.length) {
            return 1;
        }
        return 0;
    }

    static sort_reactions(a: Encounter, b: Encounter): number {
        let a_count = 0;
        for (const option of a.options) {
            a_count += option.reactions.length;
        }
        let b_count = 0;
        for (const option of b.options) {
            b_count += option.reactions.length;
        }
        if (a_count < b_count) {
            return -1;
        }
        if (a_count > b_count) {
            return 1;
        }
        return 0;
    }

    static sort_r_reactions(a: Encounter, b: Encounter): number {
        let a_count = 0;
        for (const option of a.options) {
            a_count += option.reactions.length;
        }
        let b_count = 0;
        for (const option of b.options) {
            b_count += option.reactions.length;
        }
        if (a_count > b_count) {
            return -1;
        }
        if (a_count < b_count) {
            return 1;
        }
        return 0;
    }

    static sort_word_count(a: Encounter, b: Encounter): number {
        if (a.word_count > b.word_count) {
            return -1;
        }
        if (a.word_count < b.word_count) {
            return 1;
        }
        return 0;
    }

    static sort_r_word_count(a: Encounter, b: Encounter): number {
        if (a.word_count < b.word_count) {
            return -1;
        }
        if (a.word_count > b.word_count) {
            return 1;
        }
        return 0;
    }
}
