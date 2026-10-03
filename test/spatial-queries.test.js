import assert from "node:assert/strict";
import test from "node:test";
import { CjsBallparkController as Park } from "@carbonenginejs/server";
import { vec3d } from "../dist/destiny/math/vec3d.js";

// Source: destiny/python/destiny/test/ballpark/test_boxes_and_bubbles.py:25-321.
// Source: destiny/python/destiny/test/ballpark/test_visibility.py:85-114.
// Source: destiny/python/destiny/test/ballpark/test_getters_and_setters.py:282-321.
function add(park, id, x = 0, y = 0, z = 0, radius = 0)
{
    return park.AddBall(id, 1e6, radius, 0, false, false, false, false, false,
        x, y, z, 0, 0, 0, 1, 1);
}
function scene(points = [], initialize = true)
{
    const park = new Park(), source = add(park, 1);
    const balls = points.map((point, i) => add(park, i + 2, ...point));
    if (initialize) park.InitializeBubbles();
    return { park, source, balls };
}

for (const withDistance of [false, true])
for (const kind of ["same", "edge", "outside", "coordinates"])
test(`donor range fixture: distances=${withDistance}, ${kind}`, () =>
{
    const x = kind === "edge" ? 100 : kind === "outside" ? 100.1 : 0;
    const { park, source, balls: [other] } = scene([[x, 0, 0]]);
    const method = withDistance ? "GetBallIdsAndDistInRange" : "GetBallIdsInRange";
    const args = kind === "coordinates" ? [0, 0, 0, 100] : [source.id, 100];
    const ids = kind === "outside" ? [] : kind === "coordinates" ? [source.id, other.id] : [other.id];
    const expected = withDistance ? ids.map(id => [x * x, id]) : ids;
    assert.deepEqual(park[method](...args), expected);
});

test("donor range-with-distance reports squared center separation", () =>
{
    const { park, source } = scene([[2, 0, 0]]);
    assert.deepEqual(park.GetBallIdsAndDistInRange(source.id, 100), [[4, 2n]]);
});

for (const [kind, points, expected] of [
    ["empty", [], []], ["inside", [[5, 5, 0, 1]], [2n]],
    ["outside", [[10, 10, 0, 1]], []], ["edge", [[16, 0, 0, 1]], [2n]],
    ["multiple", [[5, 0, 0, 1], [0, 5, 0, 1]], [2n, 3n]]
])
test(`donor triangle fixture: ${kind}`, () =>
{
    const { park, source } = scene(points);
    assert.deepEqual(park.GetBallIdsInRangeOfTriangle(source.id, 10, 0, 0, 0, 10, 0, 5), expected);
});
test("donor triangle fixture: missing source", () =>
{
    const { park } = scene();
    assert.throws(() => park.GetBallIdsInRangeOfTriangle(12345, 10, 0, 0, 0, 10, 0, 5), /not in park/);
});

for (const [kind, points, expected] of [
    ["empty", [], []], ["inside", [[0, 0, 5, 1]], [2n]],
    ["side edge", [[6, 0, 5, 1]], [2n]], ["beyond side", [[7, 0, 5, 1]], []],
    ["outside", [[10, 10, 0, 1]], []], ["end edge", [[0, 0, 16, 1]], [2n]],
    ["multiple", [[0, 0, 0, 1], [0, 0, 10, 1]], [2n, 3n]]
])
test(`donor capsule fixture: ${kind}`, () =>
{
    const { park, source } = scene(points);
    assert.deepEqual(park.GetBallIdsInCapsule(source.id, 0, 0, 10, 5), expected);
});
test("donor capsule fixture: missing source", () =>
{
    const { park } = scene();
    assert.throws(() => park.GetBallIdsInCapsule(12345, 0, 0, 10, 5), /not in park/);
});

for (const [kind, points, expected, initialize] of [
    ["empty", [], [], false], ["inside", [[0, 0, 5, 1]], [2n], true],
    ["distant", [[0, 0, 12, 1]], [], false], ["front edge", [[0, 0, 11, 1]], [2n], true],
    ["side overlap", [[6, 0, 5, 1]], [2n], true], ["side outside", [[7, 0, 5, 1]], [], false],
    ["distant initialized", [[0, 0, 12, 1]], [], true], ["side outside initialized", [[7, 0, 5, 1]], [], true]
])
test(`donor cone fixture: ${kind}`, () =>
{
    const { park, source } = scene(points, initialize);
    assert.deepEqual(park.GetBallIdsInCone(source.id, 0, 0, 10, Math.PI / 4), expected);
});
test("donor cone fixture: missing source", () =>
{
    const { park } = scene();
    assert.throws(() => park.GetBallIdsInCone(12345, 0, 0, 10, Math.PI / 4), /not in park/);
});

for (const [kind, points, expected] of [
    ["empty", [], []], ["inside", [[50, 0, 0]], [2n]],
    ["other directions", [[-50, 0, 0], [0, 50, 0], [0, -50, 0], [0, 0, 50], [0, 0, -50]], []]
])
test(`donor ScanCone fixture: ${kind}`, () =>
{
    const { park, source } = scene(points, false);
    assert.deepEqual(park.ScanCone(source.id, Math.PI / 2, 100, 1, 0, 0), expected);
});

for (const [kind, point, firstRadius, surface, center] of [
    ["coincident", [0, 0, 0], 0, 0, 0], ["separated", [100, 0, 0], 0, 100, 100],
    ["radii", [100, 0, 0, 5], 10, 85, 100], ["euclidean", [1, 2, 3], 0, Math.sqrt(14), Math.sqrt(14)]
])
test(`donor center/surface distance fixture: ${kind}`, () =>
{
    const { park, source, balls: [other] } = scene([point], false);
    source.radius = firstRadius;
    assert.equal(park.GetSurfaceDist(source.id, other.id), surface);
    assert.equal(park.GetCenterDist(source.id, other.id), center);
});

test("bubble queries preserve tombstones, candidate radius, negative IDs and native cloak differences", () =>
{
    const { park, source, balls: [other] } = scene([[5, 0, 0, 1]]);
    const negative = add(park, -5, 1, 0, 0, 0), bubble = park.GetActiveBubbleForBall(source);
    const dead = add(park, 7, 0); dead.isMoribund = true;
    bubble.clear(); bubble.set(other.id, -1); bubble.set(999n, 1); bubble.set("bad", 1);
    bubble.set(negative.id, 0); bubble.set(source.id, 1); bubble.set(dead.id, 1);
    other.mNewBubble = source.mNewBubble + 1; other.isCloaked = true;
    source.radius = 100;
    assert.deepEqual(park.GetBallIdsInRange(source.id, 4), [negative.id]);
    assert.deepEqual(park.GetBallIdsInRange(source.id, 4, true), [other.id, negative.id]);
    assert.deepEqual(park.GetBallIdsInRange(source.id, 3, 255), [negative.id], "source radius is excluded");
    assert.deepEqual(park.GetBallIdsAndDistInRange(source.id, 4, true), [[25, other.id], [1, negative.id]]);
    assert.deepEqual(park.GetBallIdsInCapsule(source.id, 10, 0, 0, 0), [other.id, negative.id]);
    assert.deepEqual(park.GetBallIdsInRangeOfTriangle(source.id, 10, 0, 0, 0, 10, 0, 0), [other.id, negative.id]);
    assert.deepEqual(park.GetBallIdsInCone(source.id, 10, 0, 0, Math.PI / 4), [other.id, negative.id]);
});

test("bubble helper output references retain partial writes and tolerate malformed keys", () =>
{
    const { park, source, balls: [other] } = scene([[1, 0, 0]]);
    const out = { ball: source }, iterator = new Map([["bad", 99], [source.id, 7], [other.id, -1]]).entries();
    assert.equal(park.BallIsValidForIteration("bad", out, null), false); assert.equal(out.ball, source);
    assert.equal(park.GetNextValidBallInBubble(iterator, out, source), 1);
    assert.deepEqual(out, { key: other.id, value: -1, ball: other });
    assert.equal(park.GetNextValidBallInBubble(iterator, out, source), 0); assert.equal(out.ball, other);
    assert.equal(park.BallIsValidForIteration(999, out, null), false); assert.equal(out.ball, null);
    // Exercise the lookup helper directly: AddBall treats -1 as an allocation sentinel.
    park._balls.set(-1n, other);
    assert.equal(park.BallIsValidForIteration(-1, out, null), true); assert.equal(out.ball, other);
});

test("bubble lookup sentinel and absent storage differ; coordinate lookup never creates cells", () =>
{
    const { park, source } = scene([], false);
    const empty = park.GetActiveBubbleForBall(source);
    assert.equal(empty.size, 0); assert.notEqual(empty, park.GetActiveBubbleForBall(source));
    assert.deepEqual(park.GetBallIdsInRange(source.id, 100), []);
    assert.deepEqual(park.GetBallIdsInRange(1e10, 0, 0, 100), []);
    const probe = vec3d.fromValues(1e10, 0, 0);
    assert.equal(park.mPartition.GetExistingTopBox(probe), null);
    source.mNewBubble = 999; assert.equal(park.GetActiveBubbleForBall(source), null);
    assert.deepEqual(park.GetBallIdsInCone(source.id, 0, 0, 1, 1), []);
    park.bubbles = null;
    assert.throws(() => park.GetActiveBubbleForBall(source), /not initialized/);
    assert.throws(() => park.GetBallIdsInRange(source.id, 1), /not initialized/);
    assert.throws(() => park.GetActiveBubbleForBall(null), /NULL/);
});

test("negative inflated ranges, zero segments and float32 cone radius square are preserved", () =>
{
    const { park, source, balls: [other] } = scene([[1, 0, 0]]);
    assert.deepEqual(park.GetBallIdsInRange(source.id, -1), [other.id]);
    assert.deepEqual(park.GetBallIdsInCapsule(source.id, 0, 0, 0, -1), [other.id]);
    assert.deepEqual(park.GetBallIdsInCone(source.id, 0, 0, 0, 1), []);
    other.x = 0; other.z = -Math.sqrt(16785408.5); other.radius = 4097;
    assert.deepEqual(park.GetBallIdsInCone(source.id, 0, 0, 10000, Math.PI / 4), []);
    other.z = -Math.sqrt(16785408);
    assert.deepEqual(park.GetBallIdsInCone(source.id, 0, 0, 10000, Math.PI / 4), [other.id]);
});

test("ScanCone uses centers across bubbles and the strict two-pi sphere shortcut", () =>
{
    const { park, source, balls: [front, back, side] } = scene([[10, 0, 0], [-10, 0, 0], [0, 10, 0]], false);
    front.isMoribund = true; front.mNewBubble = 999;
    const cloak = add(park, 8, 1); cloak.isCloaked = 1;
    add(park, -9, 1); add(park, 10, 11, 0, 0, 1000);
    assert.deepEqual(park.ScanCone(source.id, Math.PI * 2, 10, 1, 0, 0), [front.id]);
    assert.deepEqual(park.ScanCone(source.id, Math.PI * 2 + 0.001, 10, 1, 0, 0), [front.id, back.id, side.id]);
    assert.equal(park.ScanCone(source.id, 1, 0, 1, 0, 0), null);
    assert.equal(park.ScanCone(source.id, 1, 10, 0, 0, 0), null);
    assert.equal(park.ScanCone(999, 1, 10, 1, 0, 0), null);
});

test("capsule and range match an independent axis-aligned small-scene inclusion oracle", () =>
{
    const { park, source } = scene();
    const expectedCapsule = [], expectedRange = [];
    let id = 2;
    for (let x = -3; x <= 3; ++x) for (let y = -3; y <= 3; ++y) for (let z = -2; z <= 6; ++z)
    {
        const ball = add(park, id++, x, y, z, 0.25);
        const dz = z < 0 ? z : z > 4 ? z - 4 : 0;
        if (x * x + y * y + dz * dz <= 2.25 * 2.25) expectedCapsule.push(ball.id);
        if (x * x + y * y + z * z <= 2.25 * 2.25) expectedRange.push(ball.id);
    }
    park.InitializeBubbles();
    assert.deepEqual(park.GetBallIdsInCapsule(source.id, 0, 0, 4, 2), expectedCapsule);
    assert.deepEqual(park.GetBallIdsInRange(source.id, 2), expectedRange);
});

test("spatial bindings reject wrong arity and preserve missing-distance/null and overlap", () =>
{
    const { park, source, balls: [other] } = scene([[1, 0, 0, 2]]);
    assert.equal(park.GetSurfaceDist(source.id, other.id), -1);
    assert.equal(park.GetCenterDist(source.id, 999), null);
    assert.equal(park.GetSurfaceDist(999, other.id), null);
    assert.throws(() => park.GetCenterDist(1, 2, 3), TypeError);
    assert.throws(() => park.GetSurfaceDist(1, 2, 3), TypeError);
    assert.throws(() => park.ScanCone(1, 2), TypeError);
    assert.throws(() => park.GetBallIdsInRange(1), TypeError);
    assert.throws(() => park.GetBallIdsInRange(1, 2, 256), RangeError);
    assert.throws(() => park.GetBallIdsInRange(1, 2, null), RangeError);
    assert.throws(() => park.GetBallIdsInRange(999, 2), /not in park/);
    assert.throws(() => park.GetBallIdsInRangeOfTriangle(1, 2), TypeError);
    assert.throws(() => park.GetBallIdsInCapsule(1, 2), TypeError);
    assert.throws(() => park.GetBallIdsInCone(1, 2), TypeError);
});

test("GetIntersection preserves root order, partial writes, optional outputs and aliases", () =>
{
    const park = new Park(), origin = vec3d.create(), ray = vec3d.fromValues(1, 0, 0), sphere = vec3d.fromValues(5, 0, 0);
    const first = { value: 91 }, second = { value: 92 };
    assert.equal(park.GetIntersection(origin, ray, sphere, 1, first, second), 2);
    assert.deepEqual([first.value, second.value], [4, 6]);
    sphere[1] = 1;
    assert.equal(park.GetIntersection(origin, ray, sphere, 1, first, second), 1);
    assert.deepEqual([first.value, second.value], [5, 6]);
    sphere[1] = 2;
    assert.equal(park.GetIntersection(origin, ray, sphere, 1, first, second), 0);
    assert.deepEqual([first.value, second.value], [5, 6]);
    sphere.fill(0);
    assert.equal(park.GetIntersection(origin, ray, sphere, 1, first, second), 2);
    assert.deepEqual([first.value, second.value], [1, -1]);
    assert.equal(park.GetIntersection(origin, ray, sphere, 1, first, first), 2);
    assert.equal(first.value, 1, "inside branch writes first last");
    sphere[0] = 5;
    park.GetIntersection(origin, ray, sphere, 1, first, first); assert.equal(first.value, 6);
    assert.equal(park.GetIntersection(origin, ray, sphere, 1), 2);
    ray[0] = 2;
    park.GetIntersection(origin, ray, sphere, 1, first, second);
    assert.equal(first.value, (20 - Math.sqrt(304)) * 0.5, "nonunit ray is not normalized");
});
