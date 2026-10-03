import { meta } from "@carbonenginejs/runtime/schema";
import { vec3 } from "@carbonenginejs/runtime/math/vec3";

// Source: destiny/src/AABB.h; destiny/src/AABB.cpp
/** Carbon axis-aligned bounds, using Number arrays for native Vector3d values. */
@meta.define({ className: "CjsDestinyAABB", modelledOn: "AABB" })
export class CjsDestinyAABB
{
    mLowCorner = [0, 0, 0];
    mHighCorner = [0, 0, 0];

    /**
     * Copies supplied corners, or keeps the native zero-vector defaults.
     *
     * @param {number[]|Float64Array} [low] Lower corner; omit both corners for zero bounds.
     * @param {number[]|Float64Array} [high] Upper corner; required when low is supplied.
     * @returns {CjsDestinyAABB} New instance with its own native value fields.
     */
    constructor(low, high)
    {
        if (low !== undefined)
        {
            vec3.copy(this.mLowCorner, low);
            vec3.copy(this.mHighCorner, high);
        }
    }

    /**
     * Expands bounds, preserving native high-before-low branch ordering.
     *
     * @param {number[]|Float64Array} vertex Vertex in world coordinates.
     * @returns {void} No return value.
     */
    @meta.implemented
    Update(vertex)
    {
        for (let i = 0; i < 3; i++)
        {
            if (vertex[i] > this.mHighCorner[i]) this.mHighCorner[i] = vertex[i];
            else if (vertex[i] < this.mLowCorner[i]) this.mLowCorner[i] = vertex[i];
        }
    }

    /**
     * True excludes a swept sphere; false only retains a collision candidate.
     *
     * @param {number[]|Float64Array} p0 First segment or trajectory endpoint.
     * @param {number[]|Float64Array} p1 Second segment or trajectory endpoint.
     * @param {number} radius Radius in meters.
     * @returns {boolean} True only when these bounds exclude contact.
     */
    @meta.implemented
    CanExcludeCollision(p0, p1, radius)
    {
        for (let i = 0; i < 3; i++)
        {
            if ((p0[i] - radius > this.mHighCorner[i] && p1[i] - radius > this.mHighCorner[i])
                || (p0[i] + radius < this.mLowCorner[i] && p1[i] + radius < this.mLowCorner[i])) return true;
        }
        return false;
    }

    /**
     * Returns the longest signed corner extent.
     *
     * @returns {number} Largest signed axis extent.
     */
    @meta.implemented
    GetLongestWidth()
    {
        return Math.max(this.mHighCorner[0] - this.mLowCorner[0],
            Math.max(this.mHighCorner[1] - this.mLowCorner[1], this.mHighCorner[2] - this.mLowCorner[2]));
    }
}
