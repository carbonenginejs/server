import { CjsDestinyBox } from "../CjsDestinyBox.js";

// Source: destiny/src/Partition.h:50-64; destiny/src/Partition.cpp:520-554
/** Carbon box allocation boundary with synchronous teardown and JavaScript memory ownership. */
/**
 * Modelled on: BoxAllocator (destiny/src/Partition.h:50-64)
 */
export class CjsDestinyBoxAllocator
{
    /**
     * Constructs a native-shaped box and its ancestor chain.
     * Adaptation: JS owns object memory; native placement-new and the raw-memory
     * free list have no observable valid-object behavior to reproduce.
     *
     * @param {bigint} i X cell index.
     * @param {bigint} j Y cell index.
     * @param {bigint} k Z cell index.
     * @param {number} level Grid level.
     * @param {CjsDestinyPartition} partition Owning partition.
     * @returns {CjsDestinyBox} Allocated and registered box.
     */
    GetNewBox(i, j, k, level, partition)
    {
        return new CjsDestinyBox(i, j, k, level, partition);
    }

    /**
     * Runs native membership destruction synchronously.
     * Adaptation: garbage collection replaces the allocator's 256-entry raw
     * memory cache; released objects must not be reused by callers.
     *
     * @param {CjsDestinyBox} box Box being released.
     * @returns {void} No return value.
     */
    ReleaseBox(box)
    {
        box.Dispose();
    }
}
