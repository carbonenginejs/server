import assert from "node:assert/strict";
import test from "node:test";
import {
    CjsDestinyAABB, CjsDestinyPlaned, CjsDestinyTriangle,
    IntersectSegmentPlane, IntersectSegmentSphere, IntersectSphereTriangle,
    Quadratic, CollideTwoSpheres
} from "@carbonenginejs/server/destiny/geometry";

test("native false-return paths preserve partial output writes", () =>
{
    // Source: destiny/src/Collision.cpp:11-65.
    const out = { collisionPoint: [9, 8, 7], collisionTime: 42, normal: [6, 5, 4] };
    const plane = new CjsDestinyPlaned([0, 0, 0], [0, 1, 0]);
    assert.equal(IntersectSegmentPlane([0, 1, 0], [1, 1, 0], plane, out), false);
    assert.equal(out.collisionTime, 42, "parallel path does not assign time");
    assert.equal(IntersectSegmentPlane([0, 3, 0], [0, 2, 0], plane, out), false);
    assert.equal(out.collisionTime, 3, "out-of-segment path keeps the calculated time");
    assert.deepEqual(out.collisionPoint, [9, 8, 7]);
    assert.equal(IntersectSegmentSphere([3, 0, 0], [2, 0, 0], [0, 0, 0], 1, out), false);
    assert.equal(out.collisionTime, 2);
    assert.deepEqual(out.collisionPoint, [9, 8, 7]);
});

test("native triangle value arguments survive output/input aliases", () =>
{
    // Source: Collision.h:12 passes sphere/velocity/triangle by value. Numerical
    // expectation: native TestCollision.cpp SphereGrazesTriangleEdge fixture.
    for (const alias of ["position", "normal", "velocity", "vertex"])
    {
        const position = [0, -1, 2];
        const velocity = [0, 0, -2];
        const triangle = new CjsDestinyTriangle([0, 0, 0], [2, 0, 0], [1, 2, 0]);
        const out = { collisionPoint: [0, 0, 0], collisionTime: -1, normal: [0, 0, 0] };
        if (alias === "position") out.collisionPoint = position;
        if (alias === "normal") out.normal = position;
        if (alias === "velocity") out.collisionPoint = velocity;
        if (alias === "vertex") out.collisionPoint = triangle.a;
        assert.equal(IntersectSphereTriangle(position, 1, velocity, triangle, out), true, alias);
        assert.equal(out.collisionTime, 1, alias);
        assert.deepEqual(out.collisionPoint, [0, 0, 0], alias);
        assert.deepEqual(out.normal, [0, -1, 0], alias);
    }
});

test("native stationary sphere-segment surface quirk remains observable", () =>
{
    // Source: Collision.cpp:29-65 divides zero contact distance by zero length.
    const out = { collisionPoint: [0, 0, 0], collisionTime: 0 };
    assert.equal(IntersectSegmentSphere([1, 0, 0], [1, 0, 0], [0, 0, 0], 1, out), true);
    assert.ok(Number.isNaN(out.collisionTime));
    assert.ok(out.collisionPoint.every(Number.isNaN));
    assert.equal(IntersectSegmentSphere([0, 0, 0], [0, 0, 0], [0, 0, 0], 1, out), true);
    assert.equal(out.collisionTime, 0);
    assert.equal(IntersectSegmentSphere([2, 0, 0], [2, 0, 0], [0, 0, 0], 1, out), false);
});

test("native quadratic roots and linear fall-through bug are retained", () =>
{
    // Source: Collision.cpp:137-164. Independent roots of x*x-3*x+2 are 1,2.
    const roots = { v1: 8, v2: 9 };
    assert.equal(Quadratic(roots, 1, -3, 2), true);
    assert.deepEqual(roots, { v1: 2, v2: 1 });
    assert.equal(Quadratic(roots, 1, 0, 1), false);
    assert.deepEqual(roots, { v1: 2, v2: 1 });
    assert.equal(Quadratic(roots, 0, 0, 1), false);
    assert.equal(Quadratic(roots, 0, 2, -4), true);
    assert.ok(Number.isNaN(roots.v1));
    assert.equal(roots.v2, -Infinity);
});

test("swept spheres handle crossing, grazing, endpoints, stationary misses and overlap", () =>
{
    // Source: Collision.cpp:108-135; independently calculated contact fractions.
    assert.equal(CollideTwoSpheres([0, 0, 0], [10, 0, 0], [10, 0, 0], [0, 0, 0], 2), 0.4);
    assert.equal(CollideTwoSpheres([-2, 1, 0], [2, 1, 0], [0, 0, 0], [0, 0, 0], 1), 0.5);
    assert.equal(CollideTwoSpheres([0, 0, 0], [1, 0, 0], [2, 0, 0], [2, 0, 0], 1), 1);
    assert.equal(CollideTwoSpheres([0, 0, 0], [0, 0, 0], [2, 0, 0], [2, 0, 0], 1), -1);
    assert.equal(CollideTwoSpheres([0, 0, 0], [0, 0, 0], [1, 0, 0], [1, 0, 0], 1), 0);
});

test("geometry retains small separations at large coordinates and constructor value copies", () =>
{
    const a = [1e12, 1e12, 1e12], b = [1e12 + 2, 1e12, 1e12], c = [1e12, 1e12 + 2, 1e12];
    const triangle = new CjsDestinyTriangle(a, b, c);
    a[0] = 0;
    assert.equal(triangle.a[0], 1e12);
    assert.deepEqual(triangle.GetNormal([0, 0, 0]), [0, 0, 1]);
    assert.deepEqual(triangle.GetClosestPoint([0, 0, 0], [1e12 + 0.5, 1e12 + 0.5, 1e12 + 1]),
        [1e12 + 0.5, 1e12 + 0.5, 1e12]);
    const bounds = new CjsDestinyAABB([1e12, 0, 0], [1e12 + 1, 1, 1]);
    assert.equal(bounds.GetLongestWidth(), 1);
});

test("native triangle excluded edge and absent coplanarity check remain explicit", () =>
{
    // Source: Triangle.cpp:80-101 uses u+v<1 and does not compare plane distance.
    const triangle = new CjsDestinyTriangle([0, 0, 0], [2, 0, 0], [0, 2, 0]);
    assert.equal(triangle.ContainsPoint([1, 1, 0]), false);
    assert.equal(triangle.ContainsPoint([0.5, 0.5, 100]), true);
    const degenerate = new CjsDestinyTriangle([0, 0, 0], [0, 0, 0], [0, 0, 0]);
    assert.deepEqual(degenerate.GetNormal([1, 2, 3]), [0, 0, 0]);
    assert.equal(degenerate.ContainsPoint([0, 0, 0]), false);
});
