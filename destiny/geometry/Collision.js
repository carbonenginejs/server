import { vec3 } from "@carbonenginejs/runtime/math/vec3";
import { CjsDestinyPlaned } from "./CjsDestinyPlaned.js";
import { CjsDestinyTriangle } from "./CjsDestinyTriangle.js";

// Source: destiny/src/Collision.h; destiny/src/Collision.cpp
// Adaptation: Number arrays carry native Vector3d values. A caller-owned record
// replaces scalar output references: collisionPoint/collisionTime/normal or v1/v2.
// Boolean returns and native partial writes are retained, including on misses.

/**
 * Writes the nearest sphere point in the opposite direction of the plane normal.
 * Adaptation: an explicit output vector replaces the C++ value return.
 *
 * @param {number[]|Float64Array} out Caller-owned double-precision vector to receive the result.
 * @param {number[]|Float64Array} ballPos Sphere center.
 * @param {number} ballRadius Sphere radius in meters.
 * @param {number[]|Float64Array} planeNormal Plane normal.
 * @returns {number[]|Float64Array} The supplied output vector.
 */
export function GetPointOnBallThatFirstIntersectsPlane(out, ballPos, ballRadius, planeNormal)
{
    return vec3.set(out, ballPos[0] - planeNormal[0] * ballRadius,
        ballPos[1] - planeNormal[1] * ballRadius, ballPos[2] - planeNormal[2] * ballRadius);
}

/**
 * Intersects a segment with a plane, including both endpoint times.
 * Adaptation: a caller-owned output record replaces C++ reference arguments; partial writes remain observable.
 *
 * @param {number[]|Float64Array} p0 First segment or trajectory endpoint.
 * @param {number[]|Float64Array} p1 Second segment or trajectory endpoint.
 * @param {CjsDestinyPlaned} plane Plane with native normal and dot offset.
 * @param {Object} out Mutable record with collisionPoint, collisionTime and, for triangles, normal.
 * @returns {boolean} Whether the native segment/plane test accepts contact.
 */
export function IntersectSegmentPlane(p0, p1, plane, out)
{
    const x = p1[0] - p0[0], y = p1[1] - p0[1], z = p1[2] - p0[2];
    const planeNormalDotAB = plane.normal[0] * x + plane.normal[1] * y + plane.normal[2] * z;
    if (planeNormalDotAB === 0) return false;
    out.collisionTime = (plane.d - vec3.dot(p0, plane.normal)) / planeNormalDotAB;
    if (out.collisionTime >= 0 && out.collisionTime <= 1)
    {
        vec3.set(out.collisionPoint, p0[0] + x * out.collisionTime,
            p0[1] + y * out.collisionTime, p0[2] + z * out.collisionTime);
        return true;
    }
    return false;
}

/**
 * Preserves Carbon's segment/sphere output ordering, including its stationary quirk.
 * Adaptation: a caller-owned output record replaces C++ reference arguments; partial writes remain observable.
 *
 * @param {number[]|Float64Array} p0 First segment or trajectory endpoint.
 * @param {number[]|Float64Array} p1 Second segment or trajectory endpoint.
 * @param {number[]|Float64Array} spherePos Sphere center.
 * @param {number} sphereRad Sphere radius in meters.
 * @param {Object} out Mutable record with collisionPoint, collisionTime and, for triangles, normal.
 * @returns {boolean} Whether the native segment/sphere test accepts contact.
 */
export function IntersectSegmentSphere(p0, p1, spherePos, sphereRad, out)
{
    const dx = p1[0] - p0[0], dy = p1[1] - p0[1], dz = p1[2] - p0[2];
    const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const inverseLength = length === 0 ? 1 : 1 / length;
    const mx = p0[0] - spherePos[0], my = p0[1] - spherePos[1], mz = p0[2] - spherePos[2];
    const b = mx * (dx * inverseLength) + my * (dy * inverseLength) + mz * (dz * inverseLength);
    const c = mx * mx + my * my + mz * mz - sphereRad * sphereRad;
    if (c > 0 && b > 0) return false;
    const discriminant = b * b - c;
    if (discriminant < 0) return false;
    out.collisionTime = -b - Math.sqrt(discriminant);
    if (out.collisionTime < 0) out.collisionTime = 0;
    else out.collisionTime /= length;
    // Native quirk: a stationary segment on the surface gives 0/0; NaN does not
    // satisfy the rejection below, and the point is also NaN. Do not sanitize it.
    if (out.collisionTime > 1) return false;
    vec3.set(out.collisionPoint, p0[0] + dx * out.collisionTime,
        p0[1] + dy * out.collisionTime, p0[2] + dz * out.collisionTime);
    return true;
}

/**
 * Sweeps a sphere against the native oriented triangle test and edge fallback.
 * Adaptation: Number arrays and an output record replace native vector values and reference arguments.
 *
 * @param {number[]|Float64Array} spherePosition Sphere start position.
 * @param {number} sphereRadius Sphere radius in meters.
 * @param {number[]|Float64Array} sphereVelocity Sphere displacement over the tested interval, as in the donor.
 * @param {CjsDestinyTriangle} triangle Triangle whose winding is preserved.
 * @param {Object} out Mutable record with collisionPoint, collisionTime and, for triangles, normal.
 * @returns {boolean} Whether the native sphere/triangle test accepts contact.
 */
export function IntersectSphereTriangle(spherePosition, sphereRadius, sphereVelocity, triangle, out)
{
    // Native locals have value semantics. Plain Number arrays avoid the f32
    // allocation default of vec3.create/clone without introducing a vector class.
    // Carbon receives these arguments by value. Snapshot before any output write,
    // including when caller output storage aliases a vertex, center or velocity.
    spherePosition = vec3.copy([0, 0, 0], spherePosition);
    sphereVelocity = vec3.copy([0, 0, 0], sphereVelocity);
    triangle = new CjsDestinyTriangle(triangle.a, triangle.b, triangle.c);
    const triangleNormal = triangle.GetNormal([0, 0, 0]);
    let p0 = GetPointOnBallThatFirstIntersectsPlane([0, 0, 0], spherePosition, sphereRadius, triangleNormal);
    let p1 = vec3.add([0, 0, 0], p0, sphereVelocity);
    const plane = new CjsDestinyPlaned(triangle.a, triangleNormal);
    if (!IntersectSegmentPlane(p0, p1, plane, out)) return false;
    if (triangle.ContainsPoint(out.collisionPoint))
    {
        vec3.copy(out.normal, triangleNormal);
        return true;
    }
    triangle.GetClosestPoint(out.collisionPoint, out.collisionPoint);
    p0 = vec3.copy(p0, out.collisionPoint);
    p1 = vec3.subtract(p1, out.collisionPoint, sphereVelocity);
    vec3.negate(out.normal, sphereVelocity);
    const impact = { collisionPoint: [0, 0, 0], collisionTime: out.collisionTime };
    const intersects = IntersectSegmentSphere(p0, p1, spherePosition, sphereRadius, impact);
    out.collisionTime = impact.collisionTime;
    if (!intersects) return false;
    vec3.subtract(out.normal, spherePosition, impact.collisionPoint);
    const length = Math.sqrt(vec3.dot(out.normal, out.normal));
    if (length !== 0) vec3.scale(out.normal, out.normal, 1 / length);
    return true;
}

/**
 * Returns both native quadratic roots, retaining the donor's linear fall-through bug.
 * Adaptation: out.v1/out.v2 replace the two scalar reference parameters.
 *
 * @param {Object} out Mutable root record with v1 and v2 fields.
 * @param {number} a Coefficient a in a*x*x + b*x + c = 0.
 * @param {number} b Coefficient b in a*x*x + b*x + c = 0.
 * @param {number} c Coefficient c in a*x*x + b*x + c = 0.
 * @returns {boolean} Whether the donor reports roots; see the preserved linear-case bug.
 */
export function Quadratic(out, a, b, c)
{
    if (a === 0)
    {
        if (b === 0) return false;
        out.v1 = out.v2 = -c / b;
        // Source bug, Collision.cpp:137-159: no return here in Carbon. Keep the
        // resulting nonfinite roots; a corrected solver would be a separate decision.
    }
    let det = b * b - 4 * a * c;
    if (det < 0) return false;
    det = Math.sqrt(det);
    out.v1 = (-b + det) * 0.5 / a;
    out.v2 = (-b - det) * 0.5 / a;
    return true;
}

/**
 * Returns swept-sphere contact time in [0,1], or native -1 for a miss.
 * Adaptation: Number-array endpoints replace native Vector3d values without float32 conversion.
 *
 * @param {number[]|Float64Array} p0 First segment or trajectory endpoint.
 * @param {number[]|Float64Array} p1 Second segment or trajectory endpoint.
 * @param {number[]|Float64Array} q0 Second sphere start position.
 * @param {number[]|Float64Array} q1 Second sphere end position.
 * @param {number} collRadius Combined sphere radii.
 * @returns {number} Contact fraction in [0,1], or -1 for a miss.
 */
export function CollideTwoSpheres(p0, p1, q0, q1, collRadius)
{
    const x = p0[0] - q0[0], y = p0[1] - q0[1], z = p0[2] - q0[2];
    const distance2 = x * x + y * y + z * z;
    if (distance2 <= collRadius * collRadius) return 0;
    const dx = (p1[0] - p0[0]) - (q1[0] - q0[0]);
    const dy = (p1[1] - p0[1]) - (q1[1] - q0[1]);
    const dz = (p1[2] - p0[2]) - (q1[2] - q0[2]);
    const roots = { v1: 0, v2: -1 };
    if (Quadratic(roots, dx * dx + dy * dy + dz * dz,
        2 * (x * dx + y * dy + z * dz), distance2 - collRadius * collRadius))
    {
        if (roots.v2 >= 0 && roots.v2 <= 1) return roots.v2;
    }
    return -1;
}
