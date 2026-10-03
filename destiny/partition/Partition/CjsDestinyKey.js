import { meta } from "@carbonenginejs/runtime/schema";
import { CjsDestinyBall } from "../../CjsDestinyBall.js";

// Source: destiny/src/Partition.h:66-102
/** Carbon partition key with exact signed-int64 coordinates and native clamping. */
@meta.define({ className: "CjsDestinyKey", modelledOn: "Key" })
export class CjsDestinyKey
{
    ix = 0n;
    iy = 0n;
    iz = 0n;
    n = 0n;

    /**
     * Copies and clamps the four-argument key, or retains the unclamped default.
     * Adaptation: BigInts carry int64 values; the existing checked primitive
     * binding accepts safe Number conveniences without schema conversion.
     *
     * @param {bigint|number} [i] X coordinate.
     * @param {bigint|number} [j] Y coordinate.
     * @param {bigint|number} [k] Z coordinate.
     * @param {bigint|number} [n] Grid divisions.
     * @returns {CjsDestinyKey} Independent key value.
     */
    constructor(i, j, k, n)
    {
        if (i === undefined) return;
        this.ix = CjsDestinyBall._toInt64(i);
        this.iy = CjsDestinyBall._toInt64(j);
        this.iz = CjsDestinyBall._toInt64(k);
        this.n = CjsDestinyBall._toInt64(n);
        this.Clamp();
    }

    /**
     * Tests native equality; a method replaces the unavailable JS operator overload.
     *
     * @param {CjsDestinyKey} key Other key.
     * @returns {boolean} Whether all four members are equal.
     */
    @meta.adapted
    Equals(key)
    {
        return this.ix === key.ix && this.iy === key.iy && this.iz === key.iz && this.n === key.n;
    }

    /**
     * Tests native lexicographic order; JS cannot overload the less-than operator.
     *
     * @param {CjsDestinyKey} key Other key.
     * @returns {boolean} Whether this key precedes the other key.
     */
    @meta.adapted
    LessThan(key)
    {
        if (this.ix < key.ix) return true;
        if (this.ix > key.ix) return false;
        if (this.iy < key.iy) return true;
        if (this.iy > key.iy) return false;
        if (this.iz < key.iz) return true;
        if (this.iz > key.iz) return false;
        return this.n < key.n;
    }

    /**
     * Retains native lower-first clamping, including the zero-grid edge case.
     * Adaptation: a reached n-1 overflow throws instead of native signed overflow.
     *
     * @returns {void} Updates the three coordinates in place.
     */
    @meta.adapted
    Clamp()
    {
        if (this.ix < 0n) this.ix = 0n;
        else if (this.ix >= this.n) this.ix = CjsDestinyBall._toInt64(this.n - 1n);
        if (this.iy < 0n) this.iy = 0n;
        else if (this.iy >= this.n) this.iy = CjsDestinyBall._toInt64(this.n - 1n);
        if (this.iz < 0n) this.iz = 0n;
        else if (this.iz >= this.n) this.iz = CjsDestinyBall._toInt64(this.n - 1n);
    }
}
