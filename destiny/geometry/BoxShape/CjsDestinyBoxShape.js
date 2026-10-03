import { meta } from "@carbonenginejs/runtime/schema";
import { vec3 } from "@carbonenginejs/runtime/math/vec3";
import { GetPointOnBallThatFirstIntersectsPlane } from "../Collision.js";
import { CjsDestinyRectangleShape } from "./CjsDestinyRectangleShape.js";
import { BoxCorner, BoxSide } from "./consts.js";

// Source: destiny/src/BoxShape.h:45-67; destiny/src/BoxShape.cpp:34-306
const { CORNER_A, CORNER_B, CORNER_C, CORNER_D, CORNER_E, CORNER_F, CORNER_G, CORNER_H } = BoxCorner;
const { SIDE_FRONT, SIDE_BACK, SIDE_LEFT, SIDE_RIGHT, SIDE_TOP, SIDE_BOTTOM } = BoxSide;

// Source: destiny/src/BoxShape.cpp:189-198
const CONNECTED_SIDES = [
    [SIDE_BACK, SIDE_LEFT, SIDE_BOTTOM], [SIDE_BACK, SIDE_RIGHT, SIDE_BOTTOM],
    [SIDE_BACK, SIDE_LEFT, SIDE_TOP], [SIDE_FRONT, SIDE_LEFT, SIDE_BOTTOM],
    [SIDE_BACK, SIDE_RIGHT, SIDE_TOP], [SIDE_FRONT, SIDE_LEFT, SIDE_TOP],
    [SIDE_FRONT, SIDE_RIGHT, SIDE_BOTTOM], [SIDE_FRONT, SIDE_RIGHT, SIDE_TOP]
];
const sideMapping = [[SIDE_LEFT, SIDE_RIGHT], [SIDE_BOTTOM, SIDE_TOP], [SIDE_BACK, SIDE_FRONT]];

/** Carbon box corners, faces, line intersections and swept-sphere collision queries. */
@meta.define({ className: "CjsDestinyBoxShape", modelledOn: "BoxShape" })
export class CjsDestinyBoxShape
{
    m_corners = Array.from({ length: BoxCorner.CORNER_COUNT }, () => [0, 0, 0]);
    m_sides = Array.from({ length: BoxSide.SIDE_COUNT }, () => new CjsDestinyRectangleShape());
    m_localX = [0, 0, 0];
    m_localY = [0, 0, 0];
    m_localZ = [0, 0, 0];

    // Queries use slots 0-2; collision input snapshots and locals use 3-7 so
    // GetClosestPointOnBox/RayIntersect cannot overwrite their caller's values.
    // RectangleShape has separate scratch and neither class recursively visits boxes.
    static scratch = {
        vec3_0: [0, 0, 0], vec3_1: [0, 0, 0], vec3_2: [0, 0, 0],
        vec3_3: [0, 0, 0], vec3_4: [0, 0, 0], vec3_5: [0, 0, 0],
        vec3_6: [0, 0, 0], vec3_7: [0, 0, 0],
        tmin: [0, 0, 0], tmax: [0, 0, 0], revert: [0, 0, 0],
        hit: { side1: 0, d1: 0, side2: 0, d2: 0 }
    };

    /**
     * Builds native corners and independently copied rectangle faces.
     * Adaptation: optional arguments express C++ overloads and Number arrays
     * preserve Vector3d storage precision. No arguments retain native zero defaults.
     *
     * @param {number[]|Float64Array} [corner] Corner A.
     * @param {number[]|Float64Array} [localX] Full local X edge.
     * @param {number[]|Float64Array} [localY] Full local Y edge.
     * @param {number[]|Float64Array} [localZ] Full local Z edge.
     * @returns {CjsDestinyBoxShape} New box with native corner and face order.
     */
    constructor(corner, localX, localY, localZ)
    {
        if (corner === undefined) return;
        const c = this.m_corners;
        vec3.copy(c[CORNER_A], corner);
        vec3.add(c[CORNER_B], corner, localX);
        vec3.add(c[CORNER_C], corner, localY);
        vec3.add(c[CORNER_D], corner, localZ);
        vec3.add(c[CORNER_E], c[CORNER_B], localY);
        vec3.add(c[CORNER_F], c[CORNER_C], localZ);
        vec3.add(c[CORNER_G], c[CORNER_B], localZ);
        vec3.add(c[CORNER_H], c[CORNER_E], localZ);
        this.m_sides[SIDE_FRONT] = new CjsDestinyRectangleShape(c[CORNER_H], c[CORNER_F], c[CORNER_D], c[CORNER_G]);
        this.m_sides[SIDE_BACK] = new CjsDestinyRectangleShape(c[CORNER_C], c[CORNER_E], c[CORNER_B], c[CORNER_A]);
        this.m_sides[SIDE_LEFT] = new CjsDestinyRectangleShape(c[CORNER_F], c[CORNER_C], c[CORNER_A], c[CORNER_D]);
        this.m_sides[SIDE_RIGHT] = new CjsDestinyRectangleShape(c[CORNER_E], c[CORNER_H], c[CORNER_G], c[CORNER_B]);
        this.m_sides[SIDE_TOP] = new CjsDestinyRectangleShape(c[CORNER_C], c[CORNER_F], c[CORNER_H], c[CORNER_E]);
        this.m_sides[SIDE_BOTTOM] = new CjsDestinyRectangleShape(c[CORNER_B], c[CORNER_G], c[CORNER_D], c[CORNER_A]);
        vec3.copy(this.m_localX, localX);
        vec3.copy(this.m_localY, localY);
        vec3.copy(this.m_localZ, localZ);
    }

    /**
     * Finds the closest corner, keeping the first native index on equal distances.
     *
     * @param {number[]|Float64Array} p Query point.
     * @returns {number} Native BoxCorner value.
     */
    @meta.implemented
    GetClosestCornerToPoint(p)
    {
        let closestCorner = CORNER_A;
        let minDistSq = vec3.squaredDistance(this.m_corners[CORNER_A], p);
        for (let i = CORNER_B; i < BoxCorner.CORNER_COUNT; ++i)
        {
            const distSq = vec3.squaredDistance(this.m_corners[i], p);
            if (distSq < minDistSq)
            {
                minDistSq = distSq;
                closestCorner = i;
            }
        }
        return closestCorner;
    }

    /**
     * Projects onto the three native axes and clamps each half-length.
     * Adaptation: caller storage replaces return-by-value; writes occur after
     * computing the result so aliases cannot alter the value inputs or axes.
     *
     * @param {number[]|Float64Array} out Destination vector.
     * @param {number[]|Float64Array} p Query point.
     * @returns {number[]|Float64Array} Supplied destination.
     */
    @meta.adapted
    GetClosestPointOnBox(out, p)
    {
        const { vec3_0, vec3_1, vec3_2 } = CjsDestinyBoxShape.scratch;
        this.GetCenter(vec3_0);
        vec3.subtract(vec3_1, p, vec3_0);
        for (let i = 0; i < 3; ++i)
        {
            const axis = i === 0 ? this.m_localX : i === 1 ? this.m_localY : this.m_localZ;
            const length = Math.sqrt(vec3.dot(axis, axis));
            const halfLength = length / 2;
            vec3.copy(vec3_2, axis);
            if (length !== 0) vec3.scale(vec3_2, vec3_2, 1 / length);
            let dist = vec3.dot(vec3_1, vec3_2);
            if (dist > halfLength) dist = halfLength;
            else if (dist < -halfLength) dist = -halfLength;
            vec3.scaleAndAdd(vec3_0, vec3_0, vec3_2, dist);
        }
        return vec3.copy(out, vec3_0);
    }

    /**
     * Intersects an infinite line using origin and direction, as the implementation does.
     * Adaptation: a record replaces the four C++ output references. Distances
     * change even on failure; sides change only on success. Native parallel-slab
     * and exit-side bugs are retained (BoxShape.cpp:166-183).
     *
     * @param {number[]|Float64Array} origin Line origin.
     * @param {number[]|Float64Array} ray Line direction, not an endpoint.
     * @param {{side1: number, d1: number, side2: number, d2: number}} out Native reference outputs.
     * @returns {boolean} Whether the strict slab interval has positive length.
     */
    @meta.adapted
    RayIntersect(origin, ray, out)
    {
        const { vec3_0, tmin, tmax, revert } = CjsDestinyBoxShape.scratch;
        this.GetCenter(vec3_0);
        vec3.subtract(vec3_0, origin, vec3_0);
        for (let i = 0; i < 3; ++i)
        {
            revert[i] = 0;
            const axis = i === 0 ? this.m_localX : i === 1 ? this.m_localY : this.m_localZ;
            const armLengthSq = vec3.dot(axis, axis);
            const armOrigin = vec3.dot(axis, vec3_0);
            const armRay = vec3.dot(axis, ray);
            if (armRay < 0)
            {
                revert[i] = 1;
                tmin[i] = (0.5 * armLengthSq - armOrigin) / armRay;
                tmax[i] = (-0.5 * armLengthSq - armOrigin) / armRay;
            }
            else if (armRay > 0)
            {
                tmin[i] = (-0.5 * armLengthSq - armOrigin) / armRay;
                tmax[i] = (0.5 * armLengthSq - armOrigin) / armRay;
            }
            else
            {
                // Native bug: parallel slabs never reject an outside origin.
                tmin[i] = -Number.MAX_VALUE;
                tmax[i] = Number.MAX_VALUE;
            }
        }
        let indexMin = 0, indexMax = 0;
        for (let i = 1; i < 3; ++i)
        {
            if (tmin[indexMin] < tmin[i]) indexMin = i;
            if (tmax[i] < tmax[indexMax]) indexMax = i;
        }
        out.d1 = tmin[indexMin];
        out.d2 = tmax[indexMax];
        if (out.d1 < out.d2)
        {
            out.side1 = sideMapping[indexMin][revert[indexMin]];
            // Native bug, BoxShape.cpp:183: indexMin is also used for the exit side.
            out.side2 = sideMapping[indexMin][1 - revert[indexMin]];
            return true;
        }
        return false;
    }

    /**
     * Resolves an existing overlap or the first colliding connected face.
     * Adaptation: a record replaces C++ reference outputs; position and velocity
     * are copied before any write to preserve native by-value input semantics.
     * Overlap returns time zero and an extrication vector in normal, leaving
     * collisionPoint untouched. Failed face tests may still change outputs.
     *
     * @param {number[]|Float64Array} spherePosition Sphere center.
     * @param {number} sphereRadius Sphere radius.
     * @param {number[]|Float64Array} sphereVelocity Displacement over the tested interval.
     * @param {{collisionPoint: number[]|Float64Array, collisionTime: number, normal: number[]|Float64Array}} out Native reference outputs.
     * @returns {boolean} Whether Carbon reports an overlap or a face collision.
     */
    @meta.adapted
    CollideWithSphere(spherePosition, sphereRadius, sphereVelocity, out)
    {
        const { vec3_3, vec3_4, vec3_5, vec3_6, vec3_7, hit } = CjsDestinyBoxShape.scratch;
        spherePosition = vec3.copy(vec3_3, spherePosition);
        sphereVelocity = vec3.copy(vec3_4, sphereVelocity);
        const closestCorner = this.GetClosestCornerToPoint(spherePosition);
        let couldAlreadyBeInCollision = true, shortestDistance = -1, closestHalfspace;
        for (const collisionSide of CONNECTED_SIDES[closestCorner])
        {
            const side = this.m_sides[collisionSide];
            GetPointOnBallThatFirstIntersectsPlane(vec3_5, spherePosition, sphereRadius, side.m_normal);
            vec3.subtract(vec3_6, side.m_a, vec3_5);
            const halfspaceDistance = vec3.dot(side.m_normal, vec3_6);
            if (halfspaceDistance >= 0)
            {
                if (halfspaceDistance < shortestDistance || shortestDistance === -1)
                {
                    shortestDistance = halfspaceDistance;
                    closestHalfspace = collisionSide;
                }
            }
            else
            {
                couldAlreadyBeInCollision = false;
                break;
            }
        }
        if (couldAlreadyBeInCollision)
        {
            this.GetClosestPointOnBox(vec3_7, spherePosition);
            vec3.subtract(out.normal, spherePosition, vec3_7);
            const normalLen = Math.sqrt(vec3.dot(out.normal, out.normal));
            if (normalLen < sphereRadius)
            {
                if (normalLen < 1e-10)
                {
                    const sphereSpeed = Math.sqrt(vec3.dot(sphereVelocity, sphereVelocity));
                    if (sphereSpeed < 1e-10)
                    {
                        vec3.scale(out.normal, this.m_sides[closestHalfspace].m_normal,
                            shortestDistance < 1e-5 ? 1e-5 : shortestDistance);
                    }
                    else
                    {
                        if (this.RayIntersect(spherePosition, sphereVelocity, hit))
                        {
                            const entry = Math.abs(hit.d1) < Math.abs(hit.d2);
                            const side = entry ? hit.side1 : hit.side2;
                            const distance = Math.abs(entry ? hit.d1 : hit.d2) * sphereSpeed;
                            vec3.scale(out.normal, this.m_sides[side].m_normal, distance < 1e-5 ? 1e-5 : distance);
                        }
                        else vec3.scale(out.normal, this.m_sides[closestHalfspace].m_normal, shortestDistance);
                    }
                }
                else
                {
                    const extricationDistance = Math.abs(sphereRadius - normalLen);
                    vec3.scale(out.normal, out.normal, 1 / normalLen);
                    vec3.scale(out.normal, out.normal, extricationDistance);
                }
                out.collisionTime = 0;
                return true;
            }
        }
        for (const collisionSide of CONNECTED_SIDES[closestCorner])
        {
            if (this.m_sides[collisionSide].CollideWithSphere(spherePosition, sphereRadius, sphereVelocity, out)) return true;
        }
        return false;
    }

    /**
     * Computes A + (H - A) / 2 in native operation order.
     * Adaptation: explicit caller storage replaces native return-by-value.
     *
     * @param {number[]|Float64Array} out Destination vector.
     * @returns {number[]|Float64Array} Supplied destination.
     */
    @meta.adapted
    GetCenter(out)
    {
        const a = this.m_corners[CORNER_A], h = this.m_corners[CORNER_H];
        return vec3.set(out, a[0] + (h[0] - a[0]) * 0.5,
            a[1] + (h[1] - a[1]) * 0.5, a[2] + (h[2] - a[2]) * 0.5);
    }

    /**
     * Measures half the A-to-H diagonal length.
     *
     * @returns {number} Native bounding-sphere radius.
     */
    @meta.implemented
    GetBoundingRadius()
    {
        return Math.sqrt(vec3.squaredDistance(this.m_corners[CORNER_H], this.m_corners[CORNER_A])) / 2;
    }
}
