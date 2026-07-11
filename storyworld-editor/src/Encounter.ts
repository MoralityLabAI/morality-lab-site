import { Option } from './Option';
import { Actor } from './Actor';
import { ScriptManager } from './ScriptManager';
import { Prerequisite } from './Prerequisite';
import { BoolNode, ScriptNode, serializeBool, serializeScript } from './scriptAst';

export class Encounter {
    public id: string = '';
    public title: string = '';
    public main_text: string = '';
    public options: Option[] = [];
    public prerequisites: Prerequisite[] = [];
    public connected_spool_ids: string[] = [];
    public creation_time: number = 0;
    public modified_time: number = 0;
    public earliest_turn: number = 0;
    public latest_turn: number = 0;
    public antagonist: Actor | null = null;
    public word_count: number = 0;
    public desirability_script: ScriptManager = new ScriptManager();
    public acceptability_script: ScriptManager = new ScriptManager();
    public occurrences: number = 0;
    public availability_script: BoolNode | null = { type: 'Constant', value: true };
    public desirability_ast: ScriptNode | null = { type: 'Constant', value: 0.5 };

    constructor(id: string = '', title: string = '') {
        this.id = id;
        this.title = title;
    }

    public compile(): any {
        return {
            id: this.id,
            title: this.title,
            connected_spools: [...this.connected_spool_ids],
            earliest_turn: this.earliest_turn,
            latest_turn: this.latest_turn,
            text_script: {
                script_element_type: 'Pointer',
                pointer_type: 'String Constant',
                value: this.main_text,
            },
            options: this.options.map((option) => option.compile()),
            availability_ast: this.availability_script ? serializeBool(this.availability_script) : null,
            desirability_ast: this.desirability_ast ? serializeScript(this.desirability_ast) : null,
        }
    }

    public set_as_copy_of(original: Encounter): void {
        this.id = original.id;
        this.title = original.title;
        this.main_text = original.main_text;
        this.options = original.options;
        this.prerequisites = original.prerequisites;
        this.connected_spool_ids = [...original.connected_spool_ids];
        this.creation_time = original.creation_time;
        this.modified_time = original.modified_time;
        this.earliest_turn = original.earliest_turn;
        this.latest_turn = original.latest_turn;
        this.antagonist = original.antagonist;
        this.word_count = original.word_count;
        this.desirability_script = original.desirability_script;
        this.acceptability_script = original.acceptability_script;
        this.occurrences = original.occurrences;
        this.availability_script = original.availability_script ? { ...original.availability_script } : null;
        this.desirability_ast = original.desirability_ast ? { ...original.desirability_ast } : null;
    }
}
