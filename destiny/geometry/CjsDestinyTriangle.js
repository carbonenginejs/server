import { meta } from "@carbonenginejs/runtime/schema";
import { vec3 } from "@carbonenginejs/runtime/math/vec3";
import { vec3d } from "../math/vec3d.js";
import { CjsDestinyPlaned } from "./CjsDestinyPlaned.js";

// Source: destiny/src/Triangle.h; destiny/src/Triangle.cpp
/** Carbon triangle queries with float64 storage preserving Vector3d precision. */
@meta.define({ className: "CjsDestinyTriangle", modelledOn: "Triangle" })
export class CjsDestinyTriangle
{
    a = vec3d.create();

    b = vec3d.create();

    c = vec3d.create();

    /**
     * Copies vertices as native value members rather than retaining aliases.
     *
     * @param {number[]|Float64Array} a Triangle vertex a, copied by value.
     * @param {number[]|Float64Array} b Triangle vertex b, copied by value.
     * @param {number[]|Float64Array} c Triangle vertex c, copied by value.
     * @returns {CjsDestinyTriangle} New instance with its own native value fields.
     */
    constructor(a, b, c)
    {
        vec3.copy(this.a, a);
        vec3.copy(this.b, b);
        vec3.copy(this.c, c);
    }

    /**
     * Adaptation: caller-owned output replaces the native return-by-value.
     *
     * @param {number[]|Float64Array} out Caller-owned double-precision vector to receive the result.
     * @returns {number[]|Float64Array} The supplied output vector.
     */
    @meta.adapted
    GetNormal(out)
    {
        const { vec3d_0, vec3d_1 } = CjsDestinyTriangle.scratch;
        vec3.subtract(vec3d_0, this.b, this.a);
        vec3.subtract(vec3d_1, this.c, this.a);
        vec3.cross(vec3d_0, vec3d_0, vec3d_1);
        // Vector3d.Normalize uses reciprocal length, not reciprocal squared length.
        const length = Math.sqrt(vec3.dot(vec3d_0, vec3d_0));
        if (length !== 0) vec3.scale(vec3d_0, vec3d_0, 1 / length);
        return vec3.copy(out, vec3d_0);
    }

    /**
     * Adaptation: writes the native closest point into an explicit output vector.
     *
     * @param {number[]|Float64Array} out Caller-owned double-precision vector to receive the result.
     * @param {number[]|Float64Array} p Query point.
     * @returns {number[]|Float64Array} The supplied output vector.
     */
    @meta.adapted
    GetClosestPoint(out, p)
    {
        const { vec3d_0, vec3d_1, vec3d_2, vec3d_3, vec3d_4 } = CjsDestinyTriangle.scratch;
        vec3.subtract(vec3d_0, this.b, this.a);
        vec3.subtract(vec3d_1, this.c, this.a);
        vec3.subtract(vec3d_2, p, this.a);
        const d1 = vec3.dot(vec3d_0, vec3d_2);
        const d2 = vec3.dot(vec3d_1, vec3d_2);
        if (d1 <= 0 && d2 <= 0) return vec3.copy(out, this.a);
        vec3.subtract(vec3d_3, p, this.b);
        const d3 = vec3.dot(vec3d_0, vec3d_3);
        const d4 = vec3.dot(vec3d_1, vec3d_3);
        if (d3 >= 0 && d4 <= d3) return vec3.copy(out, this.b);
        const vc = d1 * d4 - d3 * d2;
        if (vc <= 0 && d1 >= 0 && d3 <= 0)
        {
            return vec3.scaleAndAdd(out, this.a, vec3d_0, d1 / (d1 - d3));
        }
        vec3.subtract(vec3d_4, p, this.c);
        const d5 = vec3.dot(vec3d_0, vec3d_4);
        const d6 = vec3.dot(vec3d_1, vec3d_4);
        if (d6 > 0 && d5 <= d6) return vec3.copy(out, this.c);
        const vb = d5 * d2 - d1 * d6;
        if (vb <= 0 && d2 >= 0 && d6 <= 0)
        {
            return vec3.scaleAndAdd(out, this.a, vec3d_1, d2 / (d2 - d6));
        }
        const va = d3 * d6 - d5 * d4;
        if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0)
        {
            const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
            vec3.subtract(vec3d_4, this.c, this.b);
            return vec3.scaleAndAdd(out, this.b, vec3d_4, w);
        }
        const denom = 1 / (va + vb + vc);
        const v = vb * denom;
        const w = vc * denom;
        // Compute before writing out so aliases cannot alter the operands.
        const x = this.a[0] + vec3d_0[0] * v + vec3d_1[0] * w;
        const y = this.a[1] + vec3d_0[1] * v + vec3d_1[1] * w;
        const z = this.a[2] + vec3d_0[2] * v + vec3d_1[2] * w;
        return vec3.set(out, x, y, z);
    }

    /**
     * Preserves native strict u+v<1 and its absence of a coplanarity check.
     *
     * @param {number[]|Float64Array} p Query point.
     * @returns {boolean} Native barycentric containment result.
     */
    @meta.implemented
    ContainsPoint(p)
    {
        const { vec3d_0, vec3d_1, vec3d_2 } = CjsDestinyTriangle.scratch;
        vec3.subtract(vec3d_0, this.c, this.a);
        vec3.subtract(vec3d_1, this.b, this.a);
        vec3.subtract(vec3d_2, p, this.a);
        const dot00 = vec3.dot(vec3d_0, vec3d_0);
        const dot01 = vec3.dot(vec3d_0, vec3d_1);
        const dot02 = vec3.dot(vec3d_0, vec3d_2);
        const dot11 = vec3.dot(vec3d_1, vec3d_1);
        const dot12 = vec3.dot(vec3d_1, vec3d_2);
        const invDenom = 1 / (dot00 * dot11 - dot01 * dot01);
        const u = (dot11 * dot02 - dot01 * dot12) * invDenom;
        const v = (dot00 * dot12 - dot01 * dot02) * invDenom;
        return u >= 0 && v >= 0 && u + v < 1;
    }

    /**
     * Borrows independent native value storage for a sphere/triangle call.
     * Adaptation: retained frames replace C++ stack values without allocating on
     * each query; nested calls own distinct frames until their finally block.
     *
     * @param {CjsDestinyTriangle} triangle Initial vertices when the pool grows.
     * @returns {Object} Dirty frame to return with _unallocCollisionFrame.
     */
    @meta.ours
    static _allocCollisionFrame(triangle)
    {
        return CjsDestinyTriangle._collisionFrames.pop() || {
            triangle: new CjsDestinyTriangle(triangle.a, triangle.b, triangle.c),
            plane: new CjsDestinyPlaned(triangle.a, triangle.b),
            vec3d_0: vec3d.create(),
            vec3d_1: vec3d.create(),
            vec3d_2: vec3d.create(),
            vec3d_3: vec3d.create(),
            vec3d_4: vec3d.create(),
            impact: { collisionPoint: vec3d.create(), collisionTime: 0 }
        };
    }

    /**
     * Returns the frame and its retained vectors after their last use.
     * Adaptation: the frame owns its buffers, so they are not separately returned
     * to the vector pool and cannot be borrowed while this frame is live.
     *
     * @param {Object} frame Frame obtained from _allocCollisionFrame.
     * @returns {void} The caller relinquishes the frame.
     */
    @meta.ours
    static _unallocCollisionFrame(frame)
    {
        CjsDestinyTriangle._collisionFrames.push(frame);
    }

    static scratch = {
        vec3d_0: vec3d.create(), vec3d_1: vec3d.create(), vec3d_2: vec3d.create(),
        vec3d_3: vec3d.create(), vec3d_4: vec3d.create()
    };

    static _collisionFrames = [];

}
