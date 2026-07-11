/**
 * STUB
 * This is a placeholder for the Spool class.
 * It will be replaced with a full implementation when Spool.gd is ported.
 */
export class Spool {
    public id: string = '';
    public spool_name: string = '';
    public name: string = '';
    public active_at_start: boolean = false;
    public encounter_ids: string[] = [];
    public creation_index: number = 0;
    public creation_time: number = 0;
    public modified_time: number = 0;

    constructor(id: string = '', name: string = '') {
        this.id = id;
        this.spool_name = name;
        this.name = name;
    }

    public set_as_copy_of(original: this): void {
        this.id = original.id;
        this.spool_name = original.spool_name;
        this.name = original.name;
        this.active_at_start = original.active_at_start;
        this.encounter_ids = [...original.encounter_ids];
        this.creation_index = original.creation_index;
        this.creation_time = original.creation_time;
        this.modified_time = original.modified_time;
    }

    public compile(): any {
        return {
            id: this.id,
            spool_name: this.spool_name || this.name,
            spool_type: this.spool_name || this.name,
            active_at_start: this.active_at_start,
            encounters: [...this.encounter_ids],
            creation_index: this.creation_index,
            creation_time: this.creation_time,
            modified_time: this.modified_time,
        }
    }
}
