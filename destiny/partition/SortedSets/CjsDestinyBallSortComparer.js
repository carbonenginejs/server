import { meta } from "@carbonenginejs/runtime/schema";

// Source: destiny/src/SortedSets.h:19-24; destiny/src/Ball.cpp:2528-2549
/** Native ball ordering with parent identity for pairs of local mini-balls. */
@meta.define({ className: "CjsDestinyBallSortComparer", modelledOn: "BallSortComparer" })
export class CjsDestinyBallSortComparer
{
    /**
     * Adaptation: Call replaces the C++ function-call operator unavailable in JS.
     *
     * @param {Object} x Ball with native mId/mOwnerId state.
     * @param {Object} y Ball with native mId/mOwnerId state.
     * @returns {boolean} Whether x precedes y.
     */
    @meta.adapted
    Call(x, y)
    {
        if (x.mId < 0n && y.mId < 0n)
        {
            if (x.mOwnerId < y.mOwnerId) return true;
            if (x.mOwnerId > y.mOwnerId) return false;
        }
        return x.mId < y.mId;
    }
}
