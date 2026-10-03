import { meta } from "@carbonenginejs/runtime/schema";
import { CjsDestinyPartitionable } from "./CjsDestinyPartitionable.js";
import { CjsDestinyBox } from "./CjsDestinyBox.js";
import { CjsDestinyBoxSortComparer } from "./SortedSets/CjsDestinyBoxSortComparer.js";

// Source: destiny/src/StaticCollidable.h; destiny/src/StaticCollidable.cpp
const boxComparer = new CjsDestinyBoxSortComparer();

/** Native static-shape membership and abstract collision obligations. */
@meta.define({ className: "CjsDestinyStaticCollidable", modelledOn: "StaticCollidable" })
export class CjsDestinyStaticCollidable extends CjsDestinyPartitionable
{
    mParentBallId = 0n;

    /**
     * Drops membership links without removing this shape from any box.
     * Adaptation: clearing the array replaces std::set::clear.
     *
     * @returns {void} Resets mBoxes and mMyBox only.
     */
    @meta.adapted
    ClearBoxes()
    {
        this.mBoxes.length = 0;
        this.mMyBox = null;
    }

    /**
     * Removes this shape in native key order, allowing empty cells to release.
     * Adaptation: sorted arrays preserve std::set iteration and equivalence.
     *
     * @returns {void} Clears links after all box removals.
     */
    @meta.adapted
    DeleteFromBoxes()
    {
        for (const box of this.mBoxes) box.RemoveStaticCollidable(this);
        this.ClearBoxes();
    }

    /**
     * Adds both native membership links, ignoring null cells.
     * Adaptation: sorted arrays preserve std::set key equivalence.
     *
     * @param {CjsDestinyBox|null} box Destination cell.
     * @returns {void} Duplicate equivalent cells retain their existing representative.
     */
    @meta.adapted
    InsertInBox(box)
    {
        if (!box) return;
        box.AddStaticCollidable(this);
        CjsDestinyBox._insert(this.mBoxes, box, boxComparer);
    }

    /**
     * Returns the fixed bounding radius regardless of interval.
     *
     * @param {number} dt Native unused timestep.
     * @returns {number} Concrete shape's bounding radius.
     */
    @meta.implemented
    GetInflatedRadius(dt)
    {
        return this.GetBoundingRadius();
    }

    /**
     * Retains the native no-op: static shapes never activate cells.
     *
     * @param {number} boxId Unused neighbor index.
     * @param {boolean} isActive Unused activity state.
     * @returns {void} No state changes.
     */
    @meta.implemented
    SetBoxActive(boxId, isActive)
    {
    }

    /**
     * Requires the native pure virtual center query.
     * Adaptation: explicit output replaces value return; JS abstract calls throw.
     *
     * @param {number[]|Float64Array} out Destination center.
     * @returns {number[]|Float64Array} Concrete shape's center.
     */
    @meta.adapted
    GetCenter(out)
    {
        throw new Error("StaticCollidable.GetCenter is abstract");
    }

    /**
     * Requires the native pure virtual ball collision response.
     * Adaptation: JS abstract calls throw instead of a compile-time rejection.
     *
     * @param {Object} ball Native-shaped ball.
     * @returns {void} Concrete shape's response.
     */
    @meta.adapted
    CollideWithBall(ball)
    {
        throw new Error("StaticCollidable.CollideWithBall is abstract");
    }

    /**
     * Requires the native pure virtual swept collision query.
     * Adaptation: a record replaces output references; JS abstract calls throw.
     *
     * @param {number[]|Float64Array} p0 Start point.
     * @param {number[]|Float64Array} p1 End point.
     * @param {number} radius Sphere radius.
     * @param {{normal: number[]|Float64Array, timeOfImpact: number}} out Native reference outputs.
     * @returns {boolean} Concrete shape's collision result.
     */
    @meta.adapted
    CheckCollision(p0, p1, radius, out)
    {
        throw new Error("StaticCollidable.CheckCollision is abstract");
    }
}
