export class InclinationSorter {
    static sort_ascending(a: [any, number, number], b: [any, number, number]): number {
        if (a[1] < b[1]) {
            return -1;
        } else if (a[1] === b[1]) {
            if (a[2] > b[2]) {
                return -1;
            } else {
                return 1;
            }
        } else {
            return 1;
        }
    }

    static sort_descending(a: [any, number, number], b: [any, number, number]): number {
        if (a[1] < b[1]) {
            return 1;
        } else if (a[1] === b[1]) {
            if (a[2] > b[2]) {
                return 1;
            } else {
                return -1;
            }
        } else {
            return -1;
        }
    }
}
