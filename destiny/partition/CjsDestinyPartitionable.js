import { meta, type } from "@carbonenginejs/runtime/schema";

// Source: destiny/src/Partitionable.h; destiny/src/Partitionable.cpp
/** Native shared spatial state and abstract membership obligations. */
@meta.define({ className: "CjsDestinyPartitionable", modelledOn: "Partitionable" })
export class CjsDestinyPartitionable
{
    mId = 0n;
    mHandled = false;
    mNewPos = [0, 0, 0];
    mOldPos = [0, 0, 0];
    mNewBubble = -1;
    mOldBubble = -1;
    @type.boolean
    isInteractive = false;
    mBoxes = [];
    mMyBox = null;
    mPark = null;
    mEffectStamp = 0;
    @type.boolean
    isMoribund = false;

    /**
     * Requires the native pure virtual membership-link clearing operation.
     * Adaptation: JS cannot enforce abstract methods at compile time, so it throws.
     *
     * @returns {void} Implemented by the concrete native owner.
     */
    @meta.adapted
    ClearBoxes()
    {
        throw new Error("Partitionable.ClearBoxes is abstract");
    }

    /**
     * Requires the native pure virtual membership removal operation.
     * Adaptation: JS cannot enforce abstract methods at compile time, so it throws.
     *
     * @returns {void} Implemented by the concrete native owner.
     */
    @meta.adapted
    DeleteFromBoxes()
    {
        throw new Error("Partitionable.DeleteFromBoxes is abstract");
    }

    /**
     * Requires the native pure virtual single-cell insertion operation.
     * Adaptation: JS cannot enforce abstract methods at compile time, so it throws.
     *
     * @param {CjsDestinyBox|null} box Destination cell.
     * @returns {void} Implemented by the concrete native owner.
     */
    @meta.adapted
    InsertInBox(box)
    {
        throw new Error("Partitionable.InsertInBox is abstract");
    }

    /**
     * Requires the native pure virtual bounding-radius query.
     * Adaptation: JS cannot enforce abstract methods at compile time, so it throws.
     *
     * @returns {number} Concrete owner's native float radius.
     */
    @meta.adapted
    GetBoundingRadius()
    {
        throw new Error("Partitionable.GetBoundingRadius is abstract");
    }

    /**
     * Requires the native pure virtual swept-radius query.
     * Adaptation: JS cannot enforce abstract methods at compile time, so it throws.
     *
     * @param {number} dt Interval to bound.
     * @returns {number} Concrete owner's inflated radius.
     */
    @meta.adapted
    GetInflatedRadius(dt)
    {
        throw new Error("Partitionable.GetInflatedRadius is abstract");
    }

    /**
     * Requires the native pure virtual cell-activity operation.
     * Adaptation: JS cannot enforce abstract methods at compile time, so it throws.
     *
     * @param {number} boxId Neighbor index.
     * @param {boolean} isActive Activity state.
     * @returns {void} Implemented by the concrete native owner.
     */
    @meta.adapted
    SetBoxActive(boxId, isActive)
    {
        throw new Error("Partitionable.SetBoxActive is abstract");
    }

    /**
     * Requires the native pure virtual multi-cell insertion operation.
     * Adaptation: JS cannot enforce abstract methods at compile time, so it throws.
     *
     * @param {CjsDestinyBox} box1 Base cell.
     * @param {CjsDestinyBox} top Top ancestor.
     * @param {number} newBubbleId Bubble to retain across reinsertion.
     * @returns {void} Implemented by the concrete native owner.
     */
    @meta.adapted
    InsertInBoxes(box1, top, newBubbleId)
    {
        throw new Error("Partitionable.InsertInBoxes is abstract");
    }
}
