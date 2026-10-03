import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { CjsBallparkController as Park, CjsDestinyBall as Ball } from "@carbonenginejs/server";

// Source: destiny/python/destiny/test/ballpark/evolve/test_simple_collision.py:11-476
// Fixtures copied literally from donor Python AST; no expected value uses the JS implementation.
const fixtures = JSON.parse(readFileSync(new URL("fixtures/carbon-simple-collisions.json", import.meta.url)));
const add = (park, id, value = {}) => park.AddBall(id, 13000000, 2, 10, true, false, true, false, false,
    value.x ?? 0, value.y ?? 0, value.z ?? 0, value.vx ?? 0, value.vy ?? 0, value.vz ?? 0, 0.9, 0.95);
const close = (a, b, tolerance = 1e-10) => assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`);
// Trajectories use an absolute 5e-5 bound, rather than comparing two rounded decimals
// as the native Python helper does; this avoids dependence on Python's rounding mode.

for (const fixture of fixtures) test(`donor ${fixture.class}.${fixture.name}`, () =>
{
    const park = new Park();
    // Actual native Mini ownership for the donor's fixed, nonmassive parent.
    if (fixture.class === "TestSimpleCapsuleCollision" || fixture.class === "TestSimpleBoxCollision")
    {
        const owner = park.AddBall(99n, 0, 500, 0, false, false, false, false, false,
            0, 0, 0, 0, 0, 0, 0, 0);
        if (fixture.class === "TestSimpleCapsuleCollision") owner.PyAddMiniCapsule(100, 100, 0, 200, 100, 0, 1);
        if (fixture.class === "TestSimpleBoxCollision") owner.PyAddMiniBox(0, 0, 0, 100, 0, 0, 0, 100, 0, 0, 0, 100);
    }
    const balls = {}, keys = Object.keys(fixture.balls);
    keys.forEach((key, i) => { balls[key] = add(park, i + 1, fixture.balls[key]); });
    for (const [key, target] of Object.entries(fixture.goto)) park.GotoPoint(balls[key].id, ...target);
    const expected = fixture.expected;
    const length = Object.values(expected)[0].length;
    for (let tick = 0; tick < length; ++tick)
    {
        park.Evolve();
        for (const key of keys)
        {
            const points = expected[key === "ball" ? "expected_coordinates" : key === "ball_a" ? "expected_a_coordinates" : "expected_b_coordinates"];
            const ball = balls[key];
            [ball.x, ball.y, ball.z].forEach((value, axis) => close(value, points[tick][axis], 5e-5));
        }
    }
});

const pair = () =>
{
    const park = new Park(); park.mFriction = 1;
    const a = park.AddBall(1n, 1, 1, 1, true, false, true, false, false, 0, 0, 0, 0, 0, 0, 1, 1);
    const b = park.AddBall(2n, 1, 1, 1, true, false, true, false, false, 0, 0, 0, 0, 0, 0, 1, 1);
    return { park, a, b };
};

test("Potential coincident overlap restores both positions and chooses signed-ID ejection", () =>
{
    const { park, a, b } = pair();
    park.Potential(a, b);
    close(a.mLastC[0], 2.55); assert.deepEqual(Array.from(a.mNewPos), [0, 0, 0]); assert.deepEqual(Array.from(b.mNewPos), [0, 0, 0]);
    assert.deepEqual(a.mCollisions, [2n]); assert.equal(a.mLastCollision, 0);
    park.Potential(b, a); close(b.mLastC[0], -2.55);
});

test("Potential separating overlap can recurse without recording any contact", () =>
{
    const { park, a, b } = pair(); a.mNewVel[0] = 1; b.mNewVel[0] = -1;
    park.Potential(a, b);
    assert.deepEqual(Array.from(a.mNewPos), [0, 0, 0]); assert.deepEqual(Array.from(b.mNewPos), [0, 0, 0]);
    assert.deepEqual(a.mCollisions, []); assert.deepEqual(Array.from(a.mLastC), [0, 0, 0]);
});

test("Potential rejects earlier force and missile-target force but still records contact", () =>
{
    const { park, a, b } = pair(); b.isFree = false;
    a.mLastCollision = 0.5; a.mLastC = [9, 8, 7];
    park.Potential(a, b); assert.deepEqual(Array.from(a.mLastC), [9, 8, 7]); assert.deepEqual(a.mCollisions, [2n]);
    a.mLastCollision = -1; a.mMode = Ball.DSTBALLMODE.DSTBALL_MISSILE; a.mFollowId = b.id;
    park.Potential(a, b); assert.deepEqual(Array.from(a.mLastC), [9, 8, 7]); assert.equal(a.mLastCollision, -1);
    assert.deepEqual(a.mCollisions, [2n, 2n]);
});

test("Gradient preserves ball-before-static order, native junk filter and scratch cleanup", () =>
{
    const { park, a, b } = pair(), calls = [];
    const junk = new Ball(); junk.isSpaceJunk = true;
    park.mPartition.GetCollisionCandidates = (ball, balls, shapes) =>
    {
        balls.push(junk, b); shapes.push({ CollideWithBall() { calls.push("shape"); } });
    };
    park.Potential = (me, other) => { calls.push(other); };
    park.Gradient(a); assert.deepEqual(calls, [b, "shape"]);
    park.Potential = () => { throw new Error("synthetic response failure"); };
    assert.throws(() => park.Gradient(a), /synthetic response/);
    assert.deepEqual(Park.scratch.gradientBalls, []); assert.deepEqual(Park.scratch.gradientStatics, []);
});

test("Evolve evaluates all behavior before collision and retains nonmassive last-collision time", () =>
{
    const { park, a, b } = pair(), calls = [];
    b.isMassive = false; b.mLastCollision = 0.75; b.mLastC[0] = 99; b.mCollisions.push(123n);
    const behavior = park.EvolveBehaviorForBall;
    park.EvolveBehaviorForBall = function(ball) { calls.push(`behavior${ball.id}`); behavior.call(this, ball); };
    park.Gradient = ball => { calls.push(`collision${ball.id}`); assert.equal(ball.mLastCollision, -1); ball.mLastC[0] = 1; };
    park.Evolve();
    assert.deepEqual(calls, ["behavior1", "behavior2", "collision1"]);
    assert.ok(a.x > 0); assert.equal(b.x, 0); assert.equal(b.mLastCollision, 0.75);
    assert.deepEqual(Array.from(b.mLastC), [0, 0, 0]); assert.deepEqual(b.mCollisions, []);
});
