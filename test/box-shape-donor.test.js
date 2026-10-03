import assert from "node:assert/strict";
import test from "node:test";
import { CjsDestinyBoxShape as BoxShape, CjsDestinyRectangleShape as RectangleShape, BoxCorner }
    from "@carbonenginejs/server/destiny/geometry";

// Source: destiny/tests/TestBoxShape.cpp
// All 25 native fixtures transcribed at 114e89fa584f0e1a81eb0a679aabf41af8870072.
// Expected values come from the donor, never from the implementation. See NOTICE.
const cube = (size) => new BoxShape([0, 0, 0], [size, 0, 0], [0, size, 0], [0, 0, size]);
const rectangle = () => new RectangleShape([0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 10, 0]);
const output = () => ({ collisionPoint: [0, 0, 0], collisionTime: -1, normal: [0, 0, 0] });
// Native Vector3d equality treats +0 and -0 as equal.
const equalVector = (actual, expected) => expected.forEach((value, i) => assert.ok(actual[i] === value,
    `component ${i}: ${actual[i]} !== ${value}`));

test("TestBoxShape.cpp: UnitCube.CanCreate", () =>
{
    const box = cube(1);
    assert.deepEqual(box.m_localX, [1, 0, 0]);
    assert.deepEqual(box.m_localY, [0, 1, 0]);
    assert.deepEqual(box.m_localZ, [0, 0, 1]);
    assert.deepEqual(box.m_corners, [
        [0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1],
        [1, 1, 0], [0, 1, 1], [1, 0, 1], [1, 1, 1]
    ]);
});
test("TestBoxShape.cpp: UnitCube.GetClosestCornerToPointTopRightBack", () =>
    assert.equal(cube(1).GetClosestCornerToPoint([2, 2, 0]), BoxCorner.CORNER_E));
test("TestBoxShape.cpp: UnitCube.GetClosestCornerToPointTopRightFront", () =>
    assert.equal(cube(1).GetClosestCornerToPoint([2, 2, 2]), BoxCorner.CORNER_H));
test("TestBoxShape.cpp: UnitCube.GetCenter", () =>
    assert.deepEqual(cube(1).GetCenter([0, 0, 0]), [0.5, 0.5, 0.5]));
test("TestBoxShape.cpp: UnitCube.GetBoundingRadius", () =>
    assert.equal(cube(1).GetBoundingRadius(), Math.sqrt(3) / 2));

test("TestBoxShape.cpp: RectangleSphereCollision.CanCreate", () =>
{
    const side = rectangle();
    assert.deepEqual(side.m_a, [0, 0, 0]);
    assert.deepEqual(side.m_b, [10, 0, 0]);
    assert.deepEqual(side.m_c, [10, 10, 0]);
    assert.deepEqual(side.m_d, [0, 10, 0]);
    equalVector(side.m_normal, [0, 0, 1]);
});
for (const [name, position, point, normal] of [
    ["CenterOfRectangle", [5, 5, 6], [5, 5, 0], [0, 0, 1]],
    ["GrazeLeftSide", [-1, 5, 5], [0, 5, 0], [-1, 0, 0]],
    ["GrazeRightSide", [11, 5, 5], [10, 5, 0], [1, 0, 0]],
    ["GrazeTopSide", [5, 11, 5], [5, 10, 0], [0, 1, 0]],
    ["GrazeBottomSide", [5, -1, 5], [5, 0, 0], [0, -1, 0]]
]) test(`TestBoxShape.cpp: RectangleSphereCollision.${name}`, () =>
{
    const out = output();
    assert.equal(rectangle().CollideWithSphere(position, 1, [0, 0, -10], out), true);
    assert.equal(out.collisionTime, 0.5);
    equalVector(out.collisionPoint, point);
    equalVector(out.normal, normal);
});

for (const [name, position, velocity, point, normal] of [
    ["FrontCenter", [5, 5, 16], [0, 0, -10], [5, 5, 10], [0, 0, 1]],
    ["BackCenter", [5, 5, -6], [0, 0, 10], [5, 5, 0], [0, 0, -1]],
    ["LeftCenter", [-6, 5, 5], [10, 0, 0], [0, 5, 5], [-1, 0, 0]],
    ["RightCenter", [16, 5, 5], [-10, 0, 0], [10, 5, 5], [1, 0, 0]],
    ["TopCenter", [5, 16, 5], [0, -10, 0], [5, 10, 5], [0, 1, 0]],
    ["BottomCenter", [5, -6, 5], [0, 10, 0], [5, 0, 5], [0, -1, 0]]
]) test(`TestBoxShape.cpp: CubeCollision.${name}`, () =>
{
    const out = output();
    assert.equal(cube(10).CollideWithSphere(position, 1, velocity, out), true);
    assert.equal(out.collisionTime, 0.5);
    equalVector(out.collisionPoint, point);
    equalVector(out.normal, normal);
});

for (const [name, point, expected] of [
    ["CenterOfBox", [5, 5, 5], [5, 5, 5]],
    ["TopFrontRightCorner", [11, 11, 11], [10, 10, 10]],
    ["Left", [-1, 5, 5], [0, 5, 5]],
    ["Right", [11, 5, 5], [10, 5, 5]],
    ["Top", [5, 11, 5], [5, 10, 5]],
    ["Bottom", [5, -1, 5], [5, 0, 5]],
    ["Back", [5, 5, -1], [5, 5, 0]],
    ["Front", [5, 5, 11], [5, 5, 10]]
]) test(`TestBoxShape.cpp: GetClosestPointOnBox.${name}`, () =>
    equalVector(cube(10).GetClosestPointOnBox([0, 0, 0], point), expected));
