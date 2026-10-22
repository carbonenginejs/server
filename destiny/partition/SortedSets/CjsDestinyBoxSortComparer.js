// Source: destiny/src/SortedSets.h:12-17; destiny/src/Box.cpp:278-282
/** Native box ordering by the complete partition key. */
/**
 * Modelled on: BoxSortComparer (destiny/src/SortedSets.h:12-16)
 */
export class CjsDestinyBoxSortComparer
{
    /**
     * Adaptation: Call replaces the C++ function-call operator unavailable in JS.
     *
     * @param {CjsDestinyBox} x First box.
     * @param {CjsDestinyBox} y Second box.
     * @returns {boolean} Whether x precedes y.
     */
    Call(x, y)
    {
        return x.mKey.LessThan(y.mKey);
    }
}
