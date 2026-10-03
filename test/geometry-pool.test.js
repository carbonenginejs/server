import assert from "node:assert/strict";
import test from "node:test";
import { CjsDestinyTriangle, IntersectSphereTriangle } from "@carbonenginejs/server/destiny/geometry";
import { vec3d } from "../dist/destiny/math/vec3d.js";

test("triangle collision reuses dirty float64 frames and returns them on every exit", () =>
{
    // Source: destiny/src/Collision.cpp:67-106; edge expectation from
    // destiny/tests/TestCollision.cpp SphereGrazesTriangleEdge.
    const triangle = new CjsDestinyTriangle([0, 0, 0], [2, 0, 0], [1, 2, 0]);
    const frame = CjsDestinyTriangle._allocCollisionFrame(triangle);
    CjsDestinyTriangle._unallocCollisionFrame(frame);
    const available = CjsDestinyTriangle._collisionFrames.length;
    const owned = [frame.triangle.a, frame.triangle.b, frame.triangle.c, frame.plane.normal,
        frame.vec3d_0, frame.vec3d_1, frame.vec3d_2, frame.vec3d_3, frame.vec3d_4,
        frame.impact.collisionPoint];
    const create = vec3d.create;
    vec3d.create = () => { throw new Error("unexpected warmed query allocation"); };
    try
    {
        for (const [position, velocity, hit, time] of [
            [[0, -1, 2], [0, 0, -2], true, 1],
            [[1, 0.5, 2], [0, 0, -2], true, 0.5],
            [[0, -1, 2], [1, 0, 0], false, 42],
            [[0, -1, 4], [0, 0, -1], false, 3],
            [[0, -3, 2], [0, 0, -2], false, 0.5]
        ])
        {
            for (const value of owned) value.fill(NaN);
            for (const value of Object.values(CjsDestinyTriangle.scratch)) value.fill(NaN);
            frame.plane.d = frame.impact.collisionTime = NaN;
            const out = { collisionPoint: [9, 8, 7], collisionTime: 42, normal: [6, 5, 4] };
            assert.equal(IntersectSphereTriangle(position, 1, velocity, triangle, out), hit);
            assert.equal(out.collisionTime, time);
            assert.equal(CjsDestinyTriangle._collisionFrames.length, available);
            assert.equal(CjsDestinyTriangle._collisionFrames.at(-1), frame);
            if (position[1] === -1 && hit)
            {
                assert.deepEqual(out.collisionPoint, [0, 0, 0]);
                assert.deepEqual(out.normal, [0, -1, 0]);
            }
        }
        const out = { collisionPoint: [0, 0, 0], normal: [0, 0, 0],
            set collisionTime(value) { throw new Error("output failed"); } };
        assert.throws(() => IntersectSphereTriangle([0, -1, 2], 1, [0, 0, -2], triangle, out), /output failed/);
        assert.equal(CjsDestinyTriangle._collisionFrames.length, available);
        const original = frame.triangle.GetNormal;
        frame.triangle.GetNormal = () => { throw new Error("query failed"); };
        try
        {
            assert.throws(() => IntersectSphereTriangle([0, -1, 2], 1, [0, 0, -2], triangle, out), /query failed/);
        }
        finally { frame.triangle.GetNormal = original; }
        assert.equal(CjsDestinyTriangle._collisionFrames.length, available);
    }
    finally { vec3d.create = create; }
    assert.ok(owned.every(value => value instanceof Float64Array && value.length === 3));
});

test("nested collision output callbacks cannot overwrite the outer value arguments", () =>
{
    // Source: destiny/src/Collision.h:12 by-value arguments; this callback is
    // JS-specific pressure on the adapted lifetime of those native locals.
    const triangle = new CjsDestinyTriangle([0, 0, 0], [2, 0, 0], [1, 2, 0]);
    const first = CjsDestinyTriangle._allocCollisionFrame(triangle);
    const second = CjsDestinyTriangle._allocCollisionFrame(triangle);
    assert.notEqual(first, second);
    CjsDestinyTriangle._unallocCollisionFrame(first);
    CjsDestinyTriangle._unallocCollisionFrame(second);
    const available = CjsDestinyTriangle._collisionFrames.length;
    const inner = { collisionPoint: [0, 0, 0], normal: [0, 0, 0], collisionTime: -1 };
    let time = -1, callbacks = 0;
    const out = {
        collisionPoint: [0, 0, 0], normal: [0, 0, 0],
        get collisionTime() { return time; },
        set collisionTime(value)
        {
            time = value;
            callbacks++;
            assert.equal(CjsDestinyTriangle._collisionFrames.length, available - 1);
            assert.equal(IntersectSphereTriangle([1, 0.5, 2], 1, [0, 0, -2], triangle, inner), true);
            assert.equal(inner.collisionTime, 0.5);
        }
    };
    const create = vec3d.create;
    vec3d.create = () => { throw new Error("unexpected nested allocation"); };
    try
    {
        assert.equal(IntersectSphereTriangle([0, -1, 2], 1, [0, 0, -2], triangle, out), true);
        assert.equal(time, 1);
        assert.equal(callbacks, 2);
        assert.deepEqual(out.collisionPoint, [0, 0, 0]);
        assert.deepEqual(out.normal, [0, -1, 0]);
        assert.equal(CjsDestinyTriangle._collisionFrames.length, available);
    }
    finally { vec3d.create = create; }
});
