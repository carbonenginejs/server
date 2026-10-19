import { meta } from "@carbonenginejs/runtime/schema";
import { CjsDestinyKey } from "./Partition/CjsDestinyKey.js";
import { CjsDestinyBoxSortComparer, CjsDestinyBallSortComparer, CjsDestinyStaticCollidableSortComparer }
    from "./SortedSets/index.js";

// Source: destiny/src/Box.h; destiny/src/Box.cpp
const boxComparer = new CjsDestinyBoxSortComparer();
const ballComparer = new CjsDestinyBallSortComparer();
const staticComparer = new CjsDestinyStaticCollidableSortComparer();

/** Carbon partition cell with sorted occupants, parent ownership and bubble traversal. */
@meta.define({ className: "CjsDestinyBox", modelledOn: "Box" })
export class CjsDestinyBox
{
    lo = [0, 0, 0];
    hi = [0, 0, 0];
    mKey = new CjsDestinyKey();
    balls = [];
    mStaticCollidables = [];
    mChildren = [];
    mParent = null;
    mObject = null;
    mPartition = null;
    mLevel = 0;
    mBubble = -1;
    mHandled = false;

    /**
     * Computes bounds, links ancestors, then registers the native cell.
     * Adaptation: sorted arrays represent std::set, preserving comparator
     * equivalence and iteration order; Number arrays retain Vector3d precision.
     *
     * @param {bigint|number} i X cell index.
     * @param {bigint|number} j Y cell index.
     * @param {bigint|number} k Z cell index.
     * @param {number} level Grid level.
     * @param {CjsDestinyPartition} partition Owning partition.
     * @returns {CjsDestinyBox} Registered box.
     */
    constructor(i, j, k, level, partition)
    {
        this.mLevel = level;
        this.mPartition = partition;
        const n = partition.mLevelGrid[level];
        this.mKey = new CjsDestinyKey(i, j, k, n);
        const width = partition.mLevelWidth[level];
        const center = width * Number(n) * 0.5;
        const key = this.mKey;
        this.lo[0] = Number(key.ix) * width - center;
        this.lo[1] = Number(key.iy) * width - center;
        this.lo[2] = Number(key.iz) * width - center;
        this.hi[0] = Number(key.ix + 1n) * width - center;
        this.hi[1] = Number(key.iy + 1n) * width - center;
        this.hi[2] = Number(key.iz + 1n) * width - center;
        this.SetParent();
        partition.mLevels[level].set(partition._mapKey(key), this);
    }

    /**
     * Runs the native destructor, including recursive empty-ancestor removal.
     * Adaptation: JS has no deterministic destructor, so allocator release calls
     * this explicitly; dropping mObject replaces CPython reference release.
     *
     * @returns {void} The released box is no longer valid for use.
     */
    @meta.adapted
    Dispose()
    {
        if (this.mParent) this.mParent.RemoveChildren(this);
        this.mPartition.mLevels[this.mLevel].delete(this.mPartition._mapKey(this.mKey));
        this.mChildren.length = 0;
        this.balls.length = 0;
        this.mStaticCollidables.length = 0;
        this.mObject = null;
        this.mHandled = false;
    }

    /**
     * Returns the box to its owning allocator.
     *
     * @returns {void} No return value.
     */
    @meta.implemented
    ReleaseBox()
    {
        this.mPartition.mBoxAllocator.ReleaseBox(this);
    }

    /**
     * Tests native key equality; JS needs a method instead of operator overloads.
     *
     * @param {CjsDestinyBox} box Other cell.
     * @returns {boolean} Whether the keys match.
     */
    @meta.adapted
    Equals(box)
    {
        return this.mKey.Equals(box.mKey);
    }

    /**
     * Retains an arbitrary host object, including false-valued primitives.
     * Adaptation: JS references replace Python INCREF/DECREF; null denotes no object.
     *
     * @param {*} object Stored host object or null.
     * @returns {void} No return value.
     */
    @meta.adapted
    SetObject(object)
    {
        if (object === this.mObject) return;
        this.mObject = object;
    }

    /**
     * Creates and links the cell containing this box on the next coarser level.
     *
     * @returns {void} Top-level boxes retain a null parent.
     */
    @meta.implemented
    SetParent()
    {
        if (this.mLevel === 0) return;
        this.mParent = this.mPartition.GetBox(this.mKey.ix >> 2n, this.mKey.iy >> 2n,
            this.mKey.iz >> 2n, this.mLevel - 1);
        this.mParent.AddChildren(this);
    }

    /**
     * Inserts a child using native set equivalence rather than pointer identity.
     * Adaptation: a sorted array stands in for std::set.
     *
     * @param {CjsDestinyBox|null} box Child to insert.
     * @returns {void} Null and equivalent existing entries are ignored.
     */
    @meta.adapted
    AddChildren(box)
    {
        if (box) CjsDestinyBox._insert(this.mChildren, box, boxComparer);
    }

    /**
     * Inserts a ball with the donor's local-parent ordering.
     * Adaptation: a sorted array stands in for std::set.
     *
     * @param {Object|null} ball Native-shaped ball.
     * @returns {void} Null and equivalent existing entries are ignored.
     */
    @meta.adapted
    AddBall(ball)
    {
        if (ball) CjsDestinyBox._insert(this.balls, ball, ballComparer);
    }

    /**
     * Inserts a static shape by parent ID then local ID.
     * Adaptation: a sorted array stands in for std::set.
     *
     * @param {Object|null} collidable Native-shaped static object.
     * @returns {void} Null and equivalent existing entries are ignored.
     */
    @meta.adapted
    AddStaticCollidable(collidable)
    {
        if (collidable) CjsDestinyBox._insert(this.mStaticCollidables, collidable, staticComparer);
    }

    /**
     * Removes an equivalent child and releases this box if empty, even on a miss.
     * Adaptation: sorted-array lookup replaces std::set; console supplies native diagnostics.
     *
     * @param {CjsDestinyBox} box Child key to remove.
     * @returns {void} No return value.
     */
    @meta.adapted
    RemoveChildren(box)
    {
        if (!CjsDestinyBox._erase(this.mChildren, box, boxComparer)) console.error("Box::RemoveChildren failure", box.mKey);
        if (!this.mChildren.length && !this.balls.length && !this.mStaticCollidables.length) this.ReleaseBox();
    }

    /**
     * Removes an equivalent ball and releases this box when empty, even on a miss.
     * Adaptation: sorted-array lookup replaces std::set; console supplies native diagnostics.
     *
     * @param {Object} ball Native-shaped ball key to remove.
     * @returns {void} No return value.
     */
    @meta.adapted
    RemoveBall(ball)
    {
        if (!CjsDestinyBox._erase(this.balls, ball, ballComparer)) console.error("Box::RemoveBall failure", ball.mId);
        if (!this.mChildren.length && !this.balls.length && !this.mStaticCollidables.length) this.ReleaseBox();
    }

    /**
     * Removes an equivalent static object and releases an empty box even on a miss.
     * Adaptation: sorted-array lookup replaces std::set; console supplies native diagnostics.
     *
     * @param {Object} collidable Native-shaped static key to remove.
     * @returns {void} No return value.
     */
    @meta.adapted
    RemoveStaticCollidable(collidable)
    {
        if (!CjsDestinyBox._erase(this.mStaticCollidables, collidable, staticComparer))
            console.error("Box::RemoveStaticCollidable failure", collidable.mId);
        if (!this.mChildren.length && !this.balls.length && !this.mStaticCollidables.length) this.ReleaseBox();
    }

    /**
     * Flood-fills existing neighbors, preserving native x/y/z discovery order.
     * Adaptation: explicit frames avoid the smaller JavaScript recursion limit.
     *
     * @param {number} seed Bubble identifier.
     * @returns {void} Marks all reachable unmarked boxes on this level.
     */
    @meta.adapted
    Traverse(seed)
    {
        if (this.mBubble !== -1) return;
        this.mBubble = seed;
        const stack = [{ box: this, next: 0 }];
        while (stack.length)
        {
            const frame = stack[stack.length - 1];
            if (frame.next === 27) { stack.pop(); continue; }
            const index = frame.next++;
            if (index === 13) continue;
            const x = Math.floor(index / 9) - 1;
            const y = Math.floor(index / 3) % 3 - 1;
            const z = index % 3 - 1;
            const box = this.mPartition.CheckOffsetBox(frame.box, BigInt(x), BigInt(y), BigInt(z));
            if (box && box.mBubble === -1)
            {
                box.mBubble = seed;
                stack.push({ box, next: 0 });
            }
        }
    }

    /**
     * Finds the first marked neighbor in native x/y/z order.
     *
     * @returns {number} Neighbor bubble or -1, including edge-clamped self aliases.
     */
    @meta.implemented
    NearbyBubbles()
    {
        for (let i = -1n; i < 2n; ++i)
            for (let j = -1n; j < 2n; ++j)
                for (let k = -1n; k < 2n; ++k)
                {
                    if (i === 0n && j === 0n && k === 0n) continue;
                    const box = this.mPartition.CheckOffsetBox(this, i, j, k);
                    if (box && box.mBubble !== -1) return box.mBubble;
                }
        return -1;
    }

    /**
     * Supplies std::set insertion because JS Set cannot accept a comparator.
     * Keeps the existing representative when both native less-than tests are false.
     *
     * @param {Object[]} values Sorted membership array.
     * @param {Object} value Candidate member.
     * @param {Object} comparer Native Call(x,y) less-than comparer.
     * @returns {void} Mutates membership in place.
     */
    static _insert(values, value, comparer)
    {
        let low = 0, high = values.length;
        while (low < high)
        {
            const middle = Math.floor((low + high) / 2);
            if (comparer.Call(values[middle], value)) low = middle + 1;
            else high = middle;
        }
        if (low === values.length || comparer.Call(value, values[low])) values.splice(low, 0, value);
    }

    /**
     * Supplies std::set erase-by-equivalence, absent from JavaScript's identity Set.
     *
     * @param {Object[]} values Sorted membership array.
     * @param {Object} value Equivalent key to erase.
     * @param {Object} comparer Native Call(x,y) less-than comparer.
     * @returns {boolean} Whether an equivalent member was removed.
     */
    static _erase(values, value, comparer)
    {
        let low = 0, high = values.length;
        while (low < high)
        {
            const middle = Math.floor((low + high) / 2);
            if (comparer.Call(values[middle], value)) low = middle + 1;
            else high = middle;
        }
        if (low === values.length || comparer.Call(value, values[low])) return false;
        values.splice(low, 1);
        return true;
    }
}
