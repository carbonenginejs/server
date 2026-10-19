import { meta } from "@carbonenginejs/runtime/schema";
import { CjsDestinyBall } from "../../CjsDestinyBall.js";
import { CjsDestinyKey } from "./CjsDestinyKey.js";
import { CjsDestinyKeyHash } from "./CjsDestinyKeyHash.js";
import { CjsDestinyBoxAllocator } from "./CjsDestinyBoxAllocator.js";
import { CjsDestinyNearbyCriteria } from "./CjsDestinyNearbyCriteria.js";

// Source: destiny/src/Partition.h; destiny/src/Partition.cpp
const collisionCase1 = new CjsDestinyNearbyCriteria(1);
const collisionCase3 = new CjsDestinyNearbyCriteria(3);
const keyHash = new CjsDestinyKeyHash();
const { DSTBALL_MISSILE, DSTBALL_FIELD } = CjsDestinyBall.DSTBALLMODE;

/** Carbon sparse multilevel spatial partition and native candidate enumeration. */
@meta.define({ className: "CjsDestinyPartition", modelledOn: "Partition" })
export class CjsDestinyPartition
{
    static NearbyCriteria = CjsDestinyNearbyCriteria;
    static scratch = { boxes: [] };
    mLevels = [];
    mLevelWidth = [];
    mLevelGrid = [];
    mNumberOfLevels = 8;
    mGridUnit = 480;
    mBoxAllocator = new CjsDestinyBoxAllocator();

    /**
     * Builds the eight native levels from coarse to fine.
     * Adaptation: Map uses hash-prefixed value keys because JS Map compares objects
     * by identity; its iteration order does not reproduce native unordered_map order.
     *
     * @returns {CjsDestinyPartition} Empty partition with exact BigInt cell counts.
     */
    constructor()
    {
        const bigbox = (1 << (2 * this.mNumberOfLevels)) * this.mGridUnit * 0.25;
        for (let i = 0; i < this.mNumberOfLevels; ++i)
        {
            this.mLevels.push(new Map());
            this.mLevelWidth.push(bigbox / (1 << (2 * i)));
            this.mLevelGrid.push(1n << BigInt(2 * i - 2 * this.mNumberOfLevels + 39));
        }
    }

    /**
     * Converts a position to unclamped native cell coordinates.
     * Adaptation: one record replaces three int64 references; noninteger levels
     * are invalid, and out-of-domain float-to-int64 conversions throw instead of C++ UB.
     *
     * @param {number[]|Float64Array} pos World position.
     * @param {number} level Grid level.
     * @param {{ix: bigint, iy: bigint, iz: bigint}} out Destination key coordinates.
     * @returns {void} Invalid levels write zeros.
     */
    @meta.adapted
    GetBoxKey(pos, level, out)
    {
        if (!Number.isInteger(level) || level < 0 || level >= this.mNumberOfLevels)
        {
            out.ix = out.iy = out.iz = 0n;
            return;
        }
        const width = this.mLevelWidth[level], fac = 1 / width, n = Number(this.mLevelGrid[level]);
        out.ix = CjsDestinyPartition._coordinate((pos[0] + 0.5 * width * n) * fac);
        out.iy = CjsDestinyPartition._coordinate((pos[1] + 0.5 * width * n) * fac);
        out.iz = CjsDestinyPartition._coordinate((pos[2] + 0.5 * width * n) * fac);
    }

    /**
     * Gets/creates a cell by indices or radius and position, matching both overloads.
     * Adaptation: argument count selects the C++ overload; native value-key lookup
     * uses a collision-safe string key and checked BigInt coordinates.
     *
     * @param {bigint|number} i X index or radius.
     * @param {bigint|number|number[]|Float64Array} j Y index or position.
     * @param {bigint|number|boolean} [k=true] Z index or create flag.
     * @param {number} [level] Grid level for the index overload.
     * @returns {CjsDestinyBox|null} Box or native null sentinel.
     */
    @meta.adapted
    GetBox(i, j, k = true, level)
    {
        if (arguments.length < 4)
        {
            const radius = i, pos = j, create = k;
            let selected = 0;
            for (let index = 0; index < this.mNumberOfLevels; ++index)
            {
                if (3 * radius > this.mLevelWidth[index]) break;
                selected = index;
            }
            const coords = { ix: 0n, iy: 0n, iz: 0n };
            this.GetBoxKey(pos, selected, coords);
            return create ? this.GetBox(coords.ix, coords.iy, coords.iz, selected)
                : this.CheckBox(coords.ix, coords.iy, coords.iz, selected);
        }
        if (!Number.isInteger(level) || level < 0 || level >= this.mNumberOfLevels) return null;
        const key = new CjsDestinyKey(i, j, k, this.mLevelGrid[level]);
        const mapKey = this._mapKey(key);
        let box = this.mLevels[level].get(mapKey);
        if (!box)
        {
            // Native operator[] inserts a null entry before constructing ancestors.
            this.mLevels[level].set(mapKey, null);
            box = this.mBoxAllocator.GetNewBox(i, j, k, level, this);
        }
        return box;
    }

    /**
     * Looks up a clamped key without allocating cells or ancestors.
     * Adaptation: exact-value Map keys replace native unordered_map keys.
     *
     * @param {bigint|number} ix X index.
     * @param {bigint|number} iy Y index.
     * @param {bigint|number} iz Z index.
     * @param {number} level Grid level.
     * @returns {CjsDestinyBox|null} Existing box or null for missing/invalid levels.
     */
    @meta.adapted
    CheckBox(ix, iy, iz, level)
    {
        if (!Number.isInteger(level) || level < 0 || level >= this.mNumberOfLevels) return null;
        const key = new CjsDestinyKey(ix, iy, iz, this.mLevelGrid[level]);
        return this.mLevels[level].get(this._mapKey(key)) ?? null;
    }

    /**
     * Finds the existing topmost cell using the native radius selector.
     *
     * @param {number[]|Float64Array} pos World position.
     * @returns {CjsDestinyBox|null} Existing top-level cell.
     */
    @meta.implemented
    GetExistingTopBox(pos)
    {
        return this.GetBox(10000000, pos, false);
    }

    /**
     * Replaces a position with its unclamped cell center.
     * Adaptation: invalid levels and undefined float-to-int64 casts throw; valid
     * calculations keep the native truncation and arithmetic order.
     *
     * @param {number} level Grid level.
     * @param {number[]|Float64Array} pos Input position and output center.
     * @returns {void} Mutates the supplied vector.
     */
    @meta.adapted
    GetBoxCenter(level, pos)
    {
        if (!Number.isInteger(level) || level < 0 || level >= this.mNumberOfLevels)
            throw new RangeError("GetBoxCenter requires a valid partition level");
        const width = this.mLevelWidth[level], fac = 1 / width, n = Number(this.mLevelGrid[level]);
        for (let i = 0; i < 3; ++i)
        {
            const index = CjsDestinyPartition._coordinate((pos[i] + 0.5 * width * n) * fac);
            pos[i] = Number(index) * width + width * 0.5 - width * n * 0.5;
        }
    }

    /**
     * Counts all allocated boxes, including empty ancestors.
     *
     * @returns {number} Native signed-int count.
     */
    @meta.implemented
    GetSize()
    {
        let sum = 0;
        for (const level of this.mLevels) sum += level.size;
        return sum | 0;
    }

    /**
     * Follows a cell's parent chain to the root.
     *
     * @param {CjsDestinyBox|null} box Starting cell.
     * @returns {CjsDestinyBox|null} Root cell or null.
     */
    @meta.implemented
    GetTopmost(box)
    {
        if (!box) return null;
        while (box.mParent) box = box.mParent;
        return box;
    }

    /**
     * Gets or creates an offset cell, retaining native edge clamping.
     * Adaptation: checked BigInt offsets retain int64 arithmetic; overflow is rejected.
     *
     * @param {CjsDestinyBox|null} box Base cell.
     * @param {bigint|number} i X offset.
     * @param {bigint|number} j Y offset.
     * @param {bigint|number} k Z offset.
     * @returns {CjsDestinyBox|null} Offset cell or null for null input.
     */
    @meta.adapted
    GetOffsetBox(box, i, j, k)
    {
        if (!box) return null;
        return this.GetBox(box.mKey.ix + CjsDestinyBall._toInt64(i),
            box.mKey.iy + CjsDestinyBall._toInt64(j), box.mKey.iz + CjsDestinyBall._toInt64(k), box.mLevel);
    }

    /**
     * Finds an offset cell without allocation, retaining native edge clamping.
     * Adaptation: checked BigInt offsets retain int64 arithmetic; overflow is rejected.
     *
     * @param {CjsDestinyBox|null} box Base cell.
     * @param {bigint|number} i X offset.
     * @param {bigint|number} j Y offset.
     * @param {bigint|number} k Z offset.
     * @returns {CjsDestinyBox|null} Existing offset cell.
     */
    @meta.adapted
    CheckOffsetBox(box, i, j, k)
    {
        if (!box) return null;
        return this.CheckBox(box.mKey.ix + CjsDestinyBall._toInt64(i),
            box.mKey.iy + CjsDestinyBall._toInt64(j), box.mKey.iz + CjsDestinyBall._toInt64(k), box.mLevel);
    }

    /**
     * Clears bubble traversal flags only on level zero, as in Carbon.
     *
     * @returns {void} No return value.
     */
    @meta.implemented
    ClearTraversalFlag()
    {
        for (const box of this.mLevels[0].values()) box.mBubble = -1;
    }

    /**
     * Logs all allocated cells for diagnostics.
     * Adaptation: console replaces CCP's log channel; JS Map insertion order
     * replaces unspecified native unordered-map iteration order.
     *
     * @returns {void} No return value.
     */
    @meta.adapted
    DumpPartition()
    {
        for (let level = 0; level < this.mNumberOfLevels; ++level)
            for (const box of this.mLevels[level].values())
                console.debug(`Level ${level}: ${box.balls.length} balls and ${box.mChildren.length} children in Box [${box.mKey.ix},${box.mKey.iy},${box.mKey.iz}]`);
    }

    /**
     * Appends occupied descendant boxes in the native sorted postorder.
     * Adaptation: an array replaces the C++ back-insert iterator.
     *
     * @param {CjsDestinyBox[]} children Sorted child set.
     * @param {CjsDestinyBox[]} out Destination vector.
     * @returns {void} Appends without clearing existing entries.
     */
    @meta.adapted
    ExplodeChildren(children, out)
    {
        for (const box of children)
        {
            this.ExplodeChildren(box.mChildren, out);
            if (box.balls.length || box.mStaticCollidables.length) out.push(box);
        }
    }

    /**
     * Applies the native proximity-specific filter and delegates enumeration.
     *
     * @param {Object} ball Native-shaped sensor ball.
     * @param {Object[]} uni Ball candidates to append.
     * @param {Object[]} uniStat Static candidates to append.
     * @param {boolean} isMaster Whether master bubble filtering applies.
     * @returns {void} Appends candidates.
     */
    @meta.implemented
    GetProximityCandidates(ball, uni, uniStat, isMaster)
    {
        const filter = new CjsDestinyNearbyCriteria();
        filter.EXCLUDE_HARMONICS_TEST = 1;
        if (!ball.isCloaked) filter.EXCLUDE_FIXED_BALLS = 1;
        if (ball.mSensor.onlyInteractives) filter.EXCLUDE_INERT_BALLS = 1;
        this.GetNearbyBalls(ball, uni, uniStat, isMaster, filter);
    }

    /**
     * Selects normal, defender-missile or direct-target collision candidates.
     *
     * @param {Object} ball Native-shaped moving ball.
     * @param {Object[]} uni Ball candidates to append.
     * @param {Object[]} uniStat Static candidates to append.
     * @param {boolean} isMaster Whether master bubble filtering applies.
     * @returns {void} Appends candidates without a final sort.
     */
    @meta.implemented
    GetCollisionCandidates(ball, uni, uniStat, isMaster)
    {
        if (ball.mMode === DSTBALL_MISSILE)
        {
            if (ball.mOwnerId < 0n) this.GetNearbyBalls(ball, uni, uniStat, isMaster, collisionCase3);
            else if (ball.mNewBubble === ball.mFollowPtr.mNewBubble) uni.push(ball.mFollowPtr);
        }
        else this.GetNearbyBalls(ball, uni, uniStat, isMaster, collisionCase1);
    }

    /**
     * Enumerates ancestors, descendants and occupied memberships with native filters.
     * Adaptation: sorted arrays replace std::set and caller arrays replace vectors.
     * Discovery order, append behavior and handled-flag cleanup follow the code;
     * the native comment's claimed final sort does not exist in its implementation.
     *
     * @param {Object|null} ball Native-shaped ball with ordered mBoxes membership.
     * @param {Object[]} uni Ball output vector, possibly already populated.
     * @param {Object[]} uniStat Static output vector, possibly already populated.
     * @param {boolean} isMaster Whether cross-bubble checks apply.
     * @param {CjsDestinyNearbyCriteria} filter Native filter flags.
     * @returns {void} Appends each newly accepted object once.
     */
    @meta.adapted
    GetNearbyBalls(ball, uni, uniStat, isMaster, filter)
    {
        if (!ball) return;
        if (filter.EXCLUDE_INERT_BALLS && ball.mPark.GetInteractiveCnt(ball) === 0) return;
        const { boxes } = CjsDestinyPartition.scratch;
        try
        {
            for (const save of ball.mBoxes)
            {
                let box = save;
                if (box.mHandled) continue;
                while (box.mParent)
                {
                    box = box.mParent;
                    if (box.mHandled) break;
                    if (box.balls.length || box.mStaticCollidables.length)
                    {
                        boxes.push(box);
                        box.mHandled = true;
                    }
                }
                box = save;
                this.ExplodeChildren(box.mChildren, boxes);
                if (box.balls.length > 1 || box.mStaticCollidables.length)
                {
                    boxes.push(box);
                    box.mHandled = true;
                }
            }
            for (const box of boxes)
            {
                box.mHandled = false;
                for (const other of box.balls)
                {
                    if (other.mHandled || other === ball || other.isMoribund) continue;
                    if (filter.EXCLUDE_CLOAKED && (other.isCloaked || !other.isMassive)) continue;
                    if (filter.EXCLUDE_INERT_BALLS)
                    {
                        if (!other.isInteractive) continue;
                    }
                    else
                    {
                        if (isMaster && other.mNewBubble !== ball.mNewBubble && !other.isGlobal) continue;
                        if (filter.EXCLUDE_FIXED_BALLS && !other.isFree) continue;
                        if (other.mMode === DSTBALL_FIELD && !filter.EXCLUDE_HARMONICS_TEST)
                        {
                            if (ball.mHarmonic === -2n) continue;
                            if (other.mHarmonic !== -1n && other.mHarmonic === ball.mHarmonic) continue;
                            if (other.mCorporationID !== -1 && other.mCorporationID === ball.mCorporationID) continue;
                            if (other.mAllianceID !== -1 && other.mAllianceID === ball.mAllianceID) continue;
                        }
                        if (filter.EXCLUDE_MISSILES && other.mMode === DSTBALL_MISSILE) continue;
                    }
                    other.mHandled = true;
                    uni.push(other);
                }
                if (!filter.EXCLUDE_FIXED_BALLS)
                    for (const other of box.mStaticCollidables)
                    {
                        if (other.mHandled) continue;
                        if (isMaster && other.mNewBubble !== ball.mNewBubble) continue;
                        other.mHandled = true;
                        uniStat.push(other);
                    }
            }
            for (let i = uni.length - 1; i >= 0; --i) uni[i].mHandled = false;
            for (let i = uniStat.length - 1; i >= 0; --i) uniStat[i].mHandled = false;
        }
        finally
        {
            boxes.length = 0;
        }
    }

    /**
     * Returns level width and allocated box lower corners, or native null.
     * Adaptation: arrays replace Python tuples/lists. Coordinates remain doubles;
     * Py_BuildValue's f format consumes doubles. Unordered native map order is
     * represented by JS Map insertion order and is not a compatibility promise.
     *
     * @param {number} level Grid level.
     * @returns {Array|null} [width, lowerCornerVectors], or null for invalid/empty levels.
     */
    @meta.adapted
    GetActiveBoxes(level)
    {
        if (!Number.isInteger(level) || level < 0 || level >= this.mNumberOfLevels) return null;
        if (!this.mLevels[level].size) return null;
        const boxes = [];
        for (const box of this.mLevels[level].values()) boxes.push([box.lo[0], box.lo[1], box.lo[2]]);
        return [this.mLevelWidth[level], boxes];
    }

    /**
     * Supplies native value-key identity because JS Map cannot overload equality.
     * The current donor hash is included, and the full tuple prevents hash
     * collisions from merging unequal keys. This is internal storage, not a wire format.
     *
     * @param {CjsDestinyKey} key Native key value.
     * @returns {string} Collision-safe Map key.
     */
    _mapKey(key)
    {
        return `${keyHash.Call(key)}:${key.ix},${key.iy},${key.iz},${key.n}`;
    }

    /**
     * Replaces a native double-to-int64 cast with exact truncation and a UB guard.
     * Unlike external Number ID inputs, the native double may already be above
     * 2^53; BigInt records that represented integer without further rounding.
     *
     * @param {number} value Computed native coordinate.
     * @returns {bigint} Truncated signed-int64 coordinate.
     * @throws {RangeError} For nonfinite or out-of-int64 native-undefined conversions.
     */
    static _coordinate(value)
    {
        if (!Number.isFinite(value)) throw new RangeError("Partition coordinate must be finite");
        return CjsDestinyBall._toInt64(BigInt(Math.trunc(value)));
    }
}
