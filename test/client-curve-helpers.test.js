import assert from "node:assert/strict";
import test from "node:test";
import { CjsDestinyClientBall as ClientBall, CjsBallparkController as Park } from "@carbonenginejs/server";
import { vec3 } from "@carbonenginejs/runtime/math/vec3";
import { quat } from "@carbonenginejs/runtime/math/quat";
import { vec3d } from "../dist/destiny/math/vec3d.js";

const add = (park, id, x, y = 0, radius = 1, free = false) => park.AddBall(id,
    1e6, radius, 10, free, false, false, false, false, x, y, 0, 0, 0, 0, 1, 1);

test("native delta keeps stale cached values and curve-set UpdateValue is a no-op", () =>
{
    const park = new Park(), ego = add(park, 1, 0), ball = add(park, 2, 5);
    park.ego = 1;
    vec3.set(ego.mDeltaPos, 1.123456789, 2, 3);
    vec3.set(ball.mDeltaPos, 4, 5, 6);
    const out = vec3.create();
    assert.equal(ego.GetDelta(30000000, out), out);
    assert.deepEqual(Array.from(out), [Math.fround(1.123456789), 2, 3]);
    ball.GetDelta(30000000, out);
    assert.deepEqual(Array.from(out), [4, 5, 6]);
    const cache = ball.mPosUpdateTime;
    assert.equal(ball.UpdateValue(99.5), undefined);
    assert.equal(ball.mPosUpdateTime, cache);
});

test("reference delegation preserves detached output and acceleration skips interpolation", () =>
{
    const detached = new ClientBall(), reference = vec3d.fromValues(1, 2, 3);
    assert.equal(detached.GetReferencePoint(123, reference), reference);
    assert.deepEqual(Array.from(reference), [1, 2, 3]);
    const park = new Park(), ego = add(park, 1, 100), ball = add(park, 2, 105);
    park.ego = 1;
    assert.equal(ball.GetReferencePoint(30000000, reference), reference);
    assert.deepEqual(Array.from(reference), [100, 0, 0]);
    park.dt = 2;
    vec3.set(ball.mOldVel, 1, 3, 5); vec3.set(ball.mNewVel, 5, 7, 9);
    const out = vec3.create(), rotation = quat.fromValues(1, 2, 3, 4), cache = ball.mPosUpdateTime;
    ball.GetValueDoubleDotAtTicks(50000000, out);
    assert.deepEqual(Array.from(out), [2, 2, 2]);
    assert.equal(ball.mPosUpdateTime, cache);
    ball.GetValueDoubleDotAtTicks(50000000, rotation);
    assert.deepEqual(Array.from(rotation), [1, 2, 3, 4]);
    assert.equal(ego.mCenterDist, -1);
});

test("distance getters retain native cache, ego sign and detached asymmetry", () =>
{
    const park = new Park(), ego = add(park, 1, 0, 0, 2), ball = add(park, 2, 3, 4);
    park.ego = 1;
    assert.equal(ball.centerDist, 5);
    assert.equal(ball.surfaceDist, 2);
    assert.equal(ball.mCenterDist, -1, "fallback distance is not cached");
    ball.mCenterDist = 9;
    assert.equal(ball.surfaceDist, 6);
    assert.equal(ego.surfaceDist, 0);
    add(park, -20, 0, 0, 2);
    park.ego = -20;
    ball.mCenterDist = -1;
    assert.equal(ball.centerDist, 5);
    assert.equal(ball.surfaceDist, 0);
    const detached = new ClientBall();
    assert.equal(detached.surfaceDist, 0);
    assert.throws(() => detached.GetCenterDistance(), TypeError);
    detached.mCenterDist = 7;
    assert.equal(detached.centerDist, 7);
});

test("partition debug queries return owned flags while events reuse native sampled state", () =>
{
    const events = [];
    let errors = 0;
    const bridge = { SendEvent(...args) { events.push(args); return false; }, PyError() { ++errors; } };
    const park = new Park(null, bridge), ball = add(park, 1, 240, 240, 1, true);
    park.ego = 1;
    const query = ball.GetPartitionBoxes();
    assert.equal(query.length, 8);
    assert.equal(query[7].length, 27);
    query[7][0] = 99;
    assert.notEqual(ball.GetPartitionBoxes()[7][0], 99);
    ball.mOldTime = 10000000n; ball.mNewTime = 20000000n;
    vec3.copy(ball.mOldPos, ball.mNewPos);
    ball.showBoxes = true;
    const out = vec3d.create();
    ball.InterpolatedPosition(35000000, out);
    const event = events.at(-1);
    assert.deepEqual(event.slice(0, 5), [ball, "Destiny::Ball::DoPartition", "DoPartition", null, "fffffffO"]);
    assert.equal(event.at(-1), ball.mBoxList);
    assert.equal(event[5], ball.mMyBox.lo[0] - ball.mLastPos[0]);
    assert.ok(errors > 0);
    const reused = event.at(-1);
    ball.InterpolatedPosition(36000000, out);
    assert.equal(events.at(-1).at(-1), reused);
});

test("a nested partition callback cannot overwrite the outer curve reference", () =>
{
    const nested = vec3.create();
    let other, callbacks = 0;
    const bridge = {
        SendEvent(target, event)
        {
            if (event === "Destiny::Ball::DoPartition")
            {
                ++callbacks;
                other.GetValueAtTicks(37500000, nested);
            }
            return true;
        },
        PyError() { assert.fail("unexpected event error"); }
    };
    const park = new Park(null, bridge);
    const ego = add(park, 1, 100, 0, 1, true), ball = add(park, 2, 110, 0, 1, true);
    other = add(park, 3, 120, 0, 1, true);
    park.ego = 1;
    for (const value of [ego, ball, other])
    {
        value.mOldTime = 10000000n; value.mNewTime = 20000000n;
        vec3.copy(value.mOldPos, value.mNewPos);
    }
    vec3.set(ego.mOldVel, 10, 0, 0);
    const reference = vec3d.create(), out = vec3.create();
    park.GetReferencePoint(35000000, reference);
    const expected = Math.fround(110 - reference[0]);
    ball.showBoxes = true;
    ball.GetValueAtTicks(35000000, out);
    assert.equal(callbacks, 1);
    assert.equal(out[0], expected);
    assert.notEqual(park.mLastReference[0], reference[0], "nested sample advanced the shared park reference");
});
