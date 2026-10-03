import { meta } from "@carbonenginejs/runtime/schema";

// Source: destiny/src/Partition.h:195-209
/** Carbon Partition::NearbyCriteria flags and its two native preset cases. */
@meta.define({ className: "CjsDestinyNearbyCriteria", modelledOn: "Partition::NearbyCriteria" })
export class CjsDestinyNearbyCriteria
{
    _flags = 0;

    /**
     * Reads the native EXCLUDE_FIXED_BALLS one-bit flag.
     * Adaptation: a backing bitmask replaces C++ bitfield storage.
     *
     * @returns {number} Zero or one.
     */
    @meta.adapted
    get EXCLUDE_FIXED_BALLS()
    {
        return (this._flags >>> 0) & 1;
    }

    /**
     * Writes the low bit as native unsigned one-bit assignment does.
     * Adaptation: JS bit operations replace C++ bitfield truncation.
     *
     * @param {number|bigint|boolean} value Integer flag value.
     * @returns {void} Updates only this native flag.
     */
    @meta.adapted
    set EXCLUDE_FIXED_BALLS(value)
    {
        const bit = typeof value === "bigint" ? Number(value & 1n) : Number(value) & 1;
        this._flags = (this._flags & ~1) | (bit << 0);
    }

    /**
     * Reads the native EXCLUDE_INERT_BALLS one-bit flag.
     * Adaptation: a backing bitmask replaces C++ bitfield storage.
     *
     * @returns {number} Zero or one.
     */
    @meta.adapted
    get EXCLUDE_INERT_BALLS()
    {
        return (this._flags >>> 1) & 1;
    }

    /**
     * Writes the low bit as native unsigned one-bit assignment does.
     * Adaptation: JS bit operations replace C++ bitfield truncation.
     *
     * @param {number|bigint|boolean} value Integer flag value.
     * @returns {void} Updates only this native flag.
     */
    @meta.adapted
    set EXCLUDE_INERT_BALLS(value)
    {
        const bit = typeof value === "bigint" ? Number(value & 1n) : Number(value) & 1;
        this._flags = (this._flags & ~2) | (bit << 1);
    }

    /**
     * Reads the native EXCLUDE_MISSILES one-bit flag.
     * Adaptation: a backing bitmask replaces C++ bitfield storage.
     *
     * @returns {number} Zero or one.
     */
    @meta.adapted
    get EXCLUDE_MISSILES()
    {
        return (this._flags >>> 2) & 1;
    }

    /**
     * Writes the low bit as native unsigned one-bit assignment does.
     * Adaptation: JS bit operations replace C++ bitfield truncation.
     *
     * @param {number|bigint|boolean} value Integer flag value.
     * @returns {void} Updates only this native flag.
     */
    @meta.adapted
    set EXCLUDE_MISSILES(value)
    {
        const bit = typeof value === "bigint" ? Number(value & 1n) : Number(value) & 1;
        this._flags = (this._flags & ~4) | (bit << 2);
    }

    /**
     * Reads the native EXCLUDE_CLOAKED one-bit flag.
     * Adaptation: a backing bitmask replaces C++ bitfield storage.
     *
     * @returns {number} Zero or one.
     */
    @meta.adapted
    get EXCLUDE_CLOAKED()
    {
        return (this._flags >>> 3) & 1;
    }

    /**
     * Writes the low bit as native unsigned one-bit assignment does.
     * Adaptation: JS bit operations replace C++ bitfield truncation.
     *
     * @param {number|bigint|boolean} value Integer flag value.
     * @returns {void} Updates only this native flag.
     */
    @meta.adapted
    set EXCLUDE_CLOAKED(value)
    {
        const bit = typeof value === "bigint" ? Number(value & 1n) : Number(value) & 1;
        this._flags = (this._flags & ~8) | (bit << 3);
    }

    /**
     * Reads the native EXCLUDE_HARMONICS_TEST one-bit flag.
     * Adaptation: a backing bitmask replaces C++ bitfield storage.
     *
     * @returns {number} Zero or one.
     */
    @meta.adapted
    get EXCLUDE_HARMONICS_TEST()
    {
        return (this._flags >>> 4) & 1;
    }

    /**
     * Writes the low bit as native unsigned one-bit assignment does.
     * Adaptation: JS bit operations replace C++ bitfield truncation.
     *
     * @param {number|bigint|boolean} value Integer flag value.
     * @returns {void} Updates only this native flag.
     */
    @meta.adapted
    set EXCLUDE_HARMONICS_TEST(value)
    {
        const bit = typeof value === "bigint" ? Number(value & 1n) : Number(value) & 1;
        this._flags = (this._flags & ~16) | (bit << 4);
    }

    /**
     * Selects native filter defaults without relying on the reversed cpp comment.
     *
     * @param {number} [casenum=0] Case 1 excludes missiles/cloaked; case 3 excludes cloaked.
     * @returns {CjsDestinyNearbyCriteria} Independent filter flags.
     */
    constructor(casenum = 0)
    {
        if (casenum === 1) this.EXCLUDE_MISSILES = this.EXCLUDE_CLOAKED = 1;
        else if (casenum === 3) this.EXCLUDE_CLOAKED = 1;
    }
}
