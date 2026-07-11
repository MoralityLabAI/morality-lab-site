import { UUID } from './UUID';

/**
 * Generates an IFID (Interactive Fiction ID).
 * Ported from Godot/GDScript.
 */
export class IFIDGenerator {

    // Lightweight, browser-safe hash for seeding the IFID prefix (FNV-1a 32-bit).
    private static fnv1a32(input: string): number {
        let hash = 0x811c9dc5;
        for (let i = 0; i < input.length; i++) {
            hash ^= input.charCodeAt(i);
            // Multiply by FNV prime (2^24 + 2^8 + 0x93) in 32-bit space
            hash = (hash >>> 0) * 0x01000193;
        }
        return hash >>> 0;
    }

    /**
     * Creates an IFID based on a creation time.
     * @param creation_time - A value (usually a timestamp or string) to seed the ID.
     */
    public static IFID_from_creation_time(creation_time: string | number): string {
        const time_str = String(creation_time);
        const h = this.fnv1a32(time_str).toString(16).toUpperCase().padStart(8, '0');
        const hash_part = h.substring(0, 4);
        
        let id = "SW-";
        id += hash_part + "-";
        id += UUID.v4();
        return id;
    }
}
