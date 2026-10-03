import { meta } from "@carbonenginejs/runtime/schema";
import { vec3 } from "@carbonenginejs/runtime/math/vec3";
import { CjsDestinyTriangle } from "../CjsDestinyTriangle.js";
import { IntersectSphereTriangle } from "../Collision.js";

// Source: destiny/src/BoxShape.h:31-43; destiny/src/BoxShape.cpp:8-32
/** Carbon rectangle face with double-precision vertices and swept-sphere queries. */
@meta.define({ className: "CjsDestinyRectangleShape", modelledOn: "RectangleShape" })
export class CjsDestinyRectangleShape
{
    m_a = [0, 0, 0];
    m_b = [0, 0, 0];
    m_c = [0, 0, 0];
    m_d = [0, 0, 0];
    m_normal = [0, 0, 0];

    static scratch = {
        vec3_0: [0, 0, 0], vec3_1: [0, 0, 0], vec3_2: [0, 0, 0],
        triangle: new CjsDestinyTriangle([0, 0, 0], [0, 0, 0], [0, 0, 0])
    };

    /**
     * Copies native value members, or leaves Vector3d's zero defaults.
     * Adaptation: optional arguments represent the two C++ constructors;
     * Number arrays retain Vector3d precision without f32 allocations.
     *
     * @param {number[]|Float64Array} [a] First vertex.
     * @param {number[]|Float64Array} [b] Second vertex.
     * @param {number[]|Float64Array} [c] Third vertex.
     * @param {number[]|Float64Array} [d] Fourth vertex.
     * @returns {CjsDestinyRectangleShape} New rectangle with independent value members.
     */
    constructor(a, b, c, d)
    {
        if (a === undefined) return;
        vec3.copy(this.m_a, a);
        vec3.copy(this.m_b, b);
        vec3.copy(this.m_c, c);
        vec3.copy(this.m_d, d);
        const { vec3_0, vec3_1 } = CjsDestinyRectangleShape.scratch;
        vec3.subtract(vec3_0, b, a);
        vec3.subtract(vec3_1, c, a);
        vec3.cross(this.m_normal, vec3_0, vec3_1);
        const length = Math.sqrt(vec3.dot(this.m_normal, this.m_normal));
        if (length !== 0) vec3.scale(this.m_normal, this.m_normal, 1 / length);
    }

    /**
     * Tests the one triangle chosen by Carbon's velocity-side predicate.
     * Adaptation: a caller-owned record replaces C++ output references;
     * the triangle helper preserves by-value inputs and failed-call writes.
     *
     * @param {number[]|Float64Array} spherePosition Sphere center.
     * @param {number} sphereRadius Sphere radius.
     * @param {number[]|Float64Array} sphereVelocity Displacement over the tested interval.
     * @param {{collisionPoint: number[]|Float64Array, collisionTime: number, normal: number[]|Float64Array}} out Native reference outputs.
     * @returns {boolean} Whether the selected triangle is hit.
     */
    @meta.adapted
    CollideWithSphere(spherePosition, sphereRadius, sphereVelocity, out)
    {
        const { vec3_0, vec3_1, vec3_2, triangle } = CjsDestinyRectangleShape.scratch;
        vec3.subtract(vec3_0, this.m_a, spherePosition);
        vec3.subtract(vec3_1, this.m_c, spherePosition);
        vec3.cross(vec3_2, vec3_1, vec3_0);
        const v = vec3.dot(sphereVelocity, vec3_2);
        vec3.copy(triangle.a, this.m_a);
        vec3.copy(triangle.b, v <= 0 ? this.m_b : this.m_c);
        vec3.copy(triangle.c, v <= 0 ? this.m_c : this.m_d);
        return IntersectSphereTriangle(spherePosition, sphereRadius, sphereVelocity, triangle, out);
    }
}
