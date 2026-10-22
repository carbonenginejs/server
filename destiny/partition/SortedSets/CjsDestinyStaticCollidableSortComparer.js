// Source: destiny/src/SortedSets.h:26-31; destiny/src/StaticCollidable.cpp:55-63
/** Native static-shape ordering by parent identity and then local identity. */
/**
 * Modelled on: StaticCollidableSortComparer (destiny/src/SortedSets.h:26-30)
 */
export class CjsDestinyStaticCollidableSortComparer
{
    /**
     * Adaptation: Call replaces the C++ function-call operator unavailable in JS.
     *
     * @param {Object} x Static shape with mParentBallId/mId.
     * @param {Object} y Static shape with mParentBallId/mId.
     * @returns {boolean} Whether x precedes y.
     */
    Call(x, y)
    {
        if (x.mParentBallId < y.mParentBallId) return true;
        if (x.mParentBallId > y.mParentBallId) return false;
        return x.mId < y.mId;
    }
}
