export class ContentSelectionQueue {
    private items: any[] = [];

    constructor() {
    }

    public add_item(item: any): void {
        this.items.push(item);
    }

    public get_num_items(): number {
        return this.items.length;
    }

    public is_empty(): boolean {
        return this.items.length === 0;
    }

    public get_item(index: number): any {
        if (index >= 0 && index < this.items.length) {
            return this.items[index];
        }
        return undefined; // Or throw an error, depending on desired behavior
    }

    public remove_item(index: number): void {
        if (index >= 0 && index < this.items.length) {
            this.items.splice(index, 1);
        }
    }

    public clear(): void {
        this.items = [];
    }
}