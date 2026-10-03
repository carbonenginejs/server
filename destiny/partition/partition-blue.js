import { CjsDestinyPartition } from "./Partition/CjsDestinyPartition.js";

// Source: destiny/src/Partition_Blue.cpp:7-34
/**
 * Returns the native module-level partition-centered coordinate.
 * Adaptation: JS arguments/array replace PyArg_ParseTuple/PyTuple. Numbers,
 * BigInts and booleans cover Python numeric primitives; strings and nonnumeric
 * values are rejected before native arithmetic. Illegal levels raise TypeError.
 *
 * @param {number|bigint|boolean} level Partition level.
 * @param {number|bigint|boolean} x World X coordinate.
 * @param {number|bigint|boolean} y World Y coordinate.
 * @param {number|bigint|boolean} z World Z coordinate.
 * @returns {number[]} Native center coordinates.
 */
export function GetBoxCenter(level, x, y, z)
{
    const partition = new CjsDestinyPartition();
    if (typeof level === "bigint" || typeof level === "boolean") level = Number(level);
    if (!Number.isInteger(level) || level < 0 || level >= partition.mNumberOfLevels)
        throw new TypeError("Illegal level");
    const pos = [x, y, z];
    for (let i = 0; i < 3; ++i)
    {
        if (typeof pos[i] === "bigint" || typeof pos[i] === "boolean") pos[i] = Number(pos[i]);
        else if (typeof pos[i] !== "number") throw new TypeError("Coordinates must be numeric primitives");
    }
    partition.GetBoxCenter(level, pos);
    return pos;
}
