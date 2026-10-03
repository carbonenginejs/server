import assert from "node:assert/strict";
import test from "node:test";
import { CjsDestinyBoxShape as BoxShape, CjsDestinyRectangleShape as RectangleShape, BoxCorner, BoxSide }
    from "@carbonenginejs/server/destiny/geometry";

// Source: destiny/src/BoxShape.cpp; destiny/src/BoxShape.h; destiny/src/Vector3d.h
// Independent/source-derived cases at 114e89fa584f0e1a81eb0a679aabf41af8870072.
// These are not native-executable oracle results.
const cube = () => new BoxShape([0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]);
const output = () => ({ collisionPoint: [91, 92, 93], collisionTime: 94, normal: [95, 96, 97] });
const rayOutput = () => ({ side1: 91, d1: 92, side2: 93, d2: 94 });
const nearVector = (actual, expected) => expected.forEach((value, i) => assert.ok(Math.abs(actual[i] - value) < 1e-12,
    `component ${i}: ${actual[i]} != ${value}`));

test("Box defaults contain distinct zero value members and native enum values", () =>
{
    const box = new BoxShape();
    assert.deepEqual(Object.values(BoxCorner), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
    assert.deepEqual(Object.values(BoxSide), [0, 1, 2, 3, 4, 5, 6]);
    const vectors = [box.m_localX, box.m_localY, box.m_localZ, ...box.m_corners];
    for (const side of box.m_sides) vectors.push(side.m_a, side.m_b, side.m_c, side.m_d, side.m_normal);
    assert.equal(new Set(vectors).size, 41);
    for (const vector of vectors) assert.deepEqual(vector, [0, 0, 0]);
    assert.deepEqual(box.GetCenter([9, 9, 9]), [0, 0, 0]);
    assert.equal(box.GetBoundingRadius(), 0);
});

test("Box constructor copies axes, corners and face vertices independently", () =>
{
    const corner = [1e12 + 0.25, 2, 3], x = [2, 0, 0];
    const box = new BoxShape(corner, x, [0, 4, 0], [0, 0, 6]);
    corner[0] = 0;
    x[0] = 99;
    assert.equal(box.m_corners[0][0], 1e12 + 0.25);
    assert.equal(box.m_localX[0], 2);
    assert.equal(box.GetCenter([0, 0, 0])[0], 1e12 + 1.25);
    box.m_corners[0][1] = 100;
    assert.equal(box.m_sides[BoxSide.SIDE_BACK].m_d[1], 2);
    assert.equal(box.m_sides[BoxSide.SIDE_LEFT].m_c[1], 2);
});

test("Closest corner ties retain A and center uses subtraction before addition", () =>
{
    assert.equal(cube().GetClosestCornerToPoint([0.5, 0.5, 0.5]), BoxCorner.CORNER_A);
    const box = new BoxShape([1e308, 0, 0], [0, 0, 0], [0, 1, 0], [0, 0, 1]);
    assert.equal(box.GetCenter([0, 0, 0])[0], 1e308);
});

test("Closest point handles rotated unequal axes and aliased point output", () =>
{
    // Quarter-turn basis: x spans +Y, y spans -X, z spans +Z.
    const box = new BoxShape([10, 20, 30], [0, 2, 0], [-4, 0, 0], [0, 0, 6]);
    const p = new Float64Array([5, 21, 40]);
    assert.equal(box.GetClosestPointOnBox(p, p), p);
    assert.deepEqual(Array.from(p), [6, 21, 36]);
    assert.deepEqual(box.GetCenter([0, 0, 0]), [8, 21, 33]);
    assert.equal(box.GetBoundingRadius(), Math.sqrt(56) / 2);
});

test("Ray preserves donor exit-side index bug", () =>
{
    const out = rayOutput();
    assert.equal(cube().RayIntersect([-1, 0.25, 0.5], [2, 1, 0], out), true);
    assert.deepEqual(out, { side1: BoxSide.SIDE_LEFT, d1: 0.5, side2: BoxSide.SIDE_RIGHT, d2: 0.75 });
});

test("Ray preserves parallel-outside-slab and zero-direction bugs", () =>
{
    const out = rayOutput();
    assert.equal(cube().RayIntersect([2, 0.5, -1], [0, 0, 1], out), true);
    assert.deepEqual(out, { side1: BoxSide.SIDE_BACK, d1: 1, side2: BoxSide.SIDE_FRONT, d2: 2 });
    assert.equal(cube().RayIntersect([10, 20, 30], [0, 0, 0], out), true);
    assert.deepEqual(out, { side1: BoxSide.SIDE_LEFT, d1: -Number.MAX_VALUE,
        side2: BoxSide.SIDE_RIGHT, d2: Number.MAX_VALUE });
});

test("Ray rejects a tangent while writing distances and preserving side outputs", () =>
{
    const out = rayOutput();
    assert.equal(cube().RayIntersect([-1, 0, 0.5], [1, 1, 0], out), false);
    assert.deepEqual(out, { side1: 91, d1: 1, side2: 93, d2: 1 });
});

test("Ray direction reverses faces and permits entirely negative intervals", () =>
{
    const out = rayOutput();
    assert.equal(cube().RayIntersect([2, 0.5, 0.5], [-2, 0, 0], out), true);
    assert.deepEqual(out, { side1: BoxSide.SIDE_RIGHT, d1: 0.5, side2: BoxSide.SIDE_LEFT, d2: 1 });
    assert.equal(cube().RayIntersect([2, 0.5, 0.5], [2, 0, 0], out), true);
    assert.deepEqual(out, { side1: BoxSide.SIDE_LEFT, d1: -1, side2: BoxSide.SIDE_RIGHT, d2: -0.5 });
});

test("Stationary internal overlap returns displacement and leaves collisionPoint", () =>
{
    const out = output();
    assert.equal(cube().CollideWithSphere([0.5, 0.5, 0.5], 0.1, [0, 0, 0], out), true);
    assert.equal(out.collisionTime, 0);
    assert.deepEqual(out.collisionPoint, [91, 92, 93]);
    nearVector(out.normal, [0, 0, -0.6]);
});

test("Moving internal overlap chooses exit on equal line distances", () =>
{
    const out = output();
    assert.equal(cube().CollideWithSphere([0.5, 0.5, 0.5], 0.1, [1, 0, 0], out), true);
    nearVector(out.normal, [0.5, 0, 0]);
    assert.equal(out.collisionTime, 0);
    assert.deepEqual(out.collisionPoint, [91, 92, 93]);
});

test("Moving overlap chooses the nearer entry face and floors displacement", () =>
{
    const out = output();
    assert.equal(cube().CollideWithSphere([0.2, 0.5, 0.5], 0.1, [1, 0, 0], out), true);
    nearVector(out.normal, [-0.2, 0, 0]);
    assert.equal(out.collisionTime, 0);
    assert.equal(cube().CollideWithSphere([0, 0.5, 0.5], 0.1, [1, 0, 0], out), true);
    nearVector(out.normal, [-1e-5, 0, 0]);
    assert.deepEqual(out.collisionPoint, [91, 92, 93]);
});

test("Rotated unequal box sphere sweep preserves face winding and local axes", () =>
{
    const box = new BoxShape([10, 20, 30], [0, 2, 0], [-4, 0, 0], [0, 0, 6]);
    const out = output();
    assert.equal(box.CollideWithSphere([8, 24, 33], 1, [0, -4, 0], out), true);
    assert.equal(out.collisionTime, 0.25);
    nearVector(out.collisionPoint, [8, 22, 33]);
    nearVector(out.normal, [0, 1, 0]);
});

test("Overlap output aliasing a face retains native live-member mutation", () =>
{
    const box = cube(), out = output();
    out.normal = box.m_sides[BoxSide.SIDE_BACK].m_normal;
    assert.equal(box.CollideWithSphere([0.5, 0.5, 0.5], 0.1, [0, 0, 0], out), true);
    nearVector(out.normal, [0, 0, 0]);
    assert.equal(out.collisionTime, 0);
    assert.deepEqual(out.collisionPoint, [91, 92, 93]);
});

test("Internal overlap snapshots velocity before an aliased normal write", () =>
{
    const velocity = [1, 0, 0], position = [0.5, 0.5, 0.5];
    const out = { collisionPoint: position, collisionTime: 94, normal: velocity };
    assert.equal(cube().CollideWithSphere(position, 0.1, velocity, out), true);
    nearVector(velocity, [0.5, 0, 0]);
    assert.deepEqual(position, [0.5, 0.5, 0.5]);
});

test("Partial overlap uses penetration depth and snapshots aliased position", () =>
{
    const position = [-0.05, 0.5, 0.5];
    const out = { collisionPoint: [91, 92, 93], collisionTime: 94, normal: position };
    assert.equal(cube().CollideWithSphere(position, 0.1, [0, 0, 0], out), true);
    nearVector(out.normal, [-0.05, 0, 0]);
    assert.equal(out.collisionTime, 0);
    assert.deepEqual(out.collisionPoint, [91, 92, 93]);
});

test("Stationary miss after halfspace overlap retains the tentative normal write", () =>
{
    const out = output();
    assert.equal(cube().CollideWithSphere([-0.09, -0.09, 0.5], 0.1, [0, 0, 0], out), false);
    nearVector(out.normal, [-0.09, -0.09, 0]);
    assert.equal(out.collisionTime, 94);
    assert.deepEqual(out.collisionPoint, [91, 92, 93]);
});

test("Rectangle hit preserves by-value inputs when outputs alias position and velocity", () =>
{
    const side = new RectangleShape([0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 10, 0]);
    const position = [5, 5, 6], velocity = [0, 0, -10];
    const out = { collisionPoint: position, collisionTime: 94, normal: velocity };
    assert.equal(side.CollideWithSphere(position, 1, velocity, out), true);
    assert.equal(out.collisionTime, 0.5);
    nearVector(position, [5, 5, 0]);
    nearVector(velocity, [0, 0, 1]);
});

test("Rectangle miss preserves the plane test's out-of-interval time write", () =>
{
    const side = new RectangleShape([0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 10, 0]);
    const out = output();
    assert.equal(side.CollideWithSphere([5, 5, 6], 1, [0, 0, 1], out), false);
    assert.equal(out.collisionTime, -5);
    assert.deepEqual(out.collisionPoint, [91, 92, 93]);
    assert.deepEqual(out.normal, [95, 96, 97]);
});
