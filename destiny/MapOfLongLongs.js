import { meta } from "@carbonenginejs/runtime/schema";

// Source: destiny/src/MapOfLongLongs.h
/** Native signed-int64 map with replacement insertion and non-inserting zero reads. */
@meta.define({ className: "MapOfLongLongs", modelledOn: "MapOfLongLongs" })
export class MapOfLongLongs extends Map
{
    /**
     * Inserts or replaces an already-normalized signed-int64 entry.
     * Adaptation: BigInt keys/values and Map storage replace the native typed map.
     * @param {bigint} key Signed-int64 key.
     * @param {bigint} value Signed-int64 value.
     * @returns {void} Replaces an existing value without adding a second entry.
     */
    @meta.adapted
    insert(key, value) { super.set(key, value); }

    /**
     * Reads an entry without inserting a missing key.
     * Adaptation: get represents native operator[]; zero uses signed-int64 BigInt.
     * @param {bigint} key Signed-int64 key.
     * @returns {bigint} Stored value or zero when absent.
     */
    @meta.adapted
    get(key) { return super.has(key) ? super.get(key) : 0n; }
}
