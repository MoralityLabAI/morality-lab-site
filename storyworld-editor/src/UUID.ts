/**
 * A UUID generator.
 * Ported from Godot/GDScript.
 */
export class UUID {

    private static getRandomInt(): number {
        // Godot's randomize() is not needed in JS/TS
        return Math.floor(Math.random() * 256);
    }

    private static uuidbin(): number[] {
        // 16 random bytes with the bytes on index 6 and 8 modified
        return [
            this.getRandomInt(), this.getRandomInt(), this.getRandomInt(), this.getRandomInt(),
            this.getRandomInt(), this.getRandomInt(), ((this.getRandomInt()) & 0x0f) | 0x40, this.getRandomInt(),
            ((this.getRandomInt()) & 0x3f) | 0x80, this.getRandomInt(), this.getRandomInt(), this.getRandomInt(),
            this.getRandomInt(), this.getRandomInt(), this.getRandomInt(), this.getRandomInt(),
        ];
    }

    /**
     * Returns a v4 UUID.
     */
    public static v4(): string {
        const b = this.uuidbin();

        const hex = (byte: number) => byte.toString(16).toUpperCase().padStart(2, '0');

        return `${hex(b[0])}${hex(b[1])}${hex(b[2])}${hex(b[3])}-` +
               `${hex(b[4])}${hex(b[5])}-` +
               `${hex(b[6])}${hex(b[7])}-` +
               `${hex(b[8])}${hex(b[9])}-` +
               `${hex(b[10])}${hex(b[11])}${hex(b[12])}${hex(b[13])}${hex(b[14])}${hex(b[15])}`;
    }
}
