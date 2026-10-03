import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { CjsBallparkController as Park, CjsDestinyBall as Ball, settings } from "@carbonenginejs/server";
import { vec3 } from "@carbonenginejs/runtime/math/vec3";
import { vec3d } from "../dist/destiny/math/vec3d.js";

const Mode = Ball.DSTBALLMODE;
afterEach(() => settings.Reset());
const near = (a, b, tolerance = 1e-9) => assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b}`);
const args = id => [id, 1e6, 1, 128, true, false, false, false, false, 0, 0, 0, 0, 0, 0, 1, 1];
function proper(park, id = 1)
{
    const ball = park.AddBall(...args(id));
    ball.mMode = Mode.DSTBALL_WARP; ball.mOwnerId = 1000n;
    ball.mEffectStamp = 0; ball.mLastCollision = 255;
    vec3.set(ball.mGoto, 255, 0, 0);
    return ball;
}
function warmPool()
{
    const values = Array.from({ length: 12 }, () => vec3d.alloc());
    for (const value of values) { value.fill(NaN); vec3d.unalloc(value); }
}

test("warp integration stages locals across nested callbacks and advances drag from the exit", () =>
{
    // Source: destiny/src/Ballpark.cpp:474-520.
    const park = new Park(), ball = proper(park), nested = new Park();
    const other = nested.AddBall(...args(2)); other.vx = 3;
    park.currentTime = 7;
    vec3.set(ball.mOldPos, -1, -2, -3); vec3.set(ball.mOldVel, -4, -5, -6);
    const expectedVelocity = 64 * Math.exp(-(7 - Math.log(64)) / 3);
    const expectedPosition = 256 - 3 * expectedVelocity;
    let callbacks = 0;
    park._pyOS = {
        PostEvent(owner, event)
        {
            if (event !== "Destiny::OnDeactivatingWarp") return true;
            callbacks++;
            assert.deepEqual(Array.from(ball.mOldPos), [-1, -2, -3]);
            assert.deepEqual(Array.from(ball.mNewPos), [0, 0, 0]);
            nested.Evolve();
            vec3.set(ball.mNewPos, 999, 888, 777);
            return true;
        },
        SendEvent() { return true; }
    };
    warmPool(); const available = vec3d._pool.length, create = vec3d.create;
    vec3d.create = () => { throw Error("unexpected warmed vector allocation"); };
    try { park.Evolve(); }
    finally { vec3d.create = create; }
    assert.equal(callbacks, 1); assert.equal(vec3d._pool.length, available);
    assert.equal(ball.mode, Mode.DSTBALL_STOP); assert.equal(park.currentTime, 8);
    near(ball.mOldPos[0], expectedPosition); near(ball.mOldVel[0], expectedVelocity);
    near(ball.x, expectedPosition + expectedVelocity * (1 - Math.exp(-1)));
    near(ball.vx, expectedVelocity * Math.exp(-1));
    assert.ok(other.x > 0);
});

test("warp callback throws return borrowed vectors and release inEvolve", () =>
{
    const park = new Park(), ball = proper(park); park.currentTime = 7;
    warmPool(); const available = vec3d._pool.length;
    park._pyOS = { PostEvent() { throw Error("callback failed"); } };
    assert.throws(() => park.Evolve(), /callback failed/);
    assert.equal(vec3d._pool.length, available); assert.equal(park.inEvolve, false);
    assert.equal(park.currentTime, 7); assert.ok(ball.IsWarping());
    assert.deepEqual(Array.from(ball.mNewPos), [0, 0, 0]);
    const p = vec3d.create(), v = vec3d.create();
    park.SetupWarpConstants = () => { throw Error("constants failed"); };
    const constantsAvailable = Park.warpConstants.length;
    assert.throws(() => park.WarpDistance(ball, p, v, 7, true), /constants failed/);
    assert.equal(Park.warpConstants.length, constantsAvailable);
});

test("short WarpTo balances its borrowed destination when a mode callback throws", () =>
{
    const park = new Park(), ball = proper(park);
    warmPool(); const available = vec3d._pool.length;
    park._pyOS = { PostEvent() { throw Error("exit failed"); } };
    assert.throws(() => park.WarpTo(ball.id, 1, 2, 3), /exit failed/);
    assert.equal(vec3d._pool.length, available);
});

test("warp ending at zero velocity forces spatial insertion before the ordinary commit", () =>
{
    const park = new Park(), ball = proper(park);
    park.currentTime = 100;
    const insert = park.InsertBallInBoxes, observed = [];
    park.InsertBallInBoxes = value =>
    {
        observed.push([value.x, value.vx, value._oldX]);
        return insert.call(park, value);
    };
    const error = console.error; console.error = () => {};
    try { park.Evolve(); }
    finally { console.error = error; }
    assert.ok(observed.some(([x, vx]) => x === 255 && vx === 0));
    assert.equal(ball.x, 255); assert.equal(ball.vx, 0); assert.ok(ball.mSensor.active);
});

test("client proper warp keeps cached p/v and samples the shared Number clock with dt", () =>
{
    // Source: destiny/src/Ball.cpp:1275-1292.
    const park = new Park(), ball = proper(park), out = vec3d.create();
    park.currentTime = 1; park.dt = 2;
    ball.mOldTime = 0n; ball.mNewTime = 10000000n;
    ball.mLastTick = 1; ball.mCenterDist = 1;
    vec3.set(ball.mOldPos, 100, 0, 0); vec3.set(ball.mOldVel, 0, 0, 0);
    vec3.set(ball.mLastPos, 0, 0, 0); vec3.set(ball.mLastVel, 10, 0, 0);
    assert.equal(ball.InterpolatedPosition(25000000, out), out);
    near(out[0], Math.exp(1)); near(ball.mLastVel[0], 10);
    const saved = out[0];
    ball.InterpolatedPosition(24000000, out); assert.equal(out[0], saved);
    ball.InterpolatedPosition(26000000, out); near(out[0], Math.exp(1.2));
    assert.ok(ball.IsWarping()); assert.equal(ball.mSensor.active, false);
    ball.mEffectStamp = -1;
    ball.InterpolatedPosition(27000000, out);
    assert.equal(out[0], 100, "alignment uses the ordinary old-sample integrator");
});

test("dynamic warp steers to goto while proper-warp legacy snap keeps native zero direction", () =>
{
    const park = new Park(), ball = proper(park);
    ball.vx = 10; ball.CalculateYawPitchRoll(true);
    assert.equal(ball.mNewYaw, 0, "Ball.cpp:381-397 leaves direction zero in proper warp");
    const config = settings.Get(); config.useDynamicalOrientation = true; settings.Apply(config);
    let direction = null;
    park.GotoTorqueBreaks = (out, value, input) =>
    {
        direction = Array.from(input); return vec3.set(out, 1, 2, 3);
    };
    park.GotoRollBreaks = () => 4;
    park.EvolveBehaviorForBall(ball);
    assert.deepEqual(direction, [255, 0, 0]);
    assert.deepEqual(Array.from(ball.mTorque), [1, 2, 3]); assert.equal(ball.mRoll, 4);
});

test("Python creation wrappers keep exact arity and refuse evolution before allocating IDs", () =>
{
    // Source: destiny/src/Thunkers.cpp:51-159.
    const park = new Park(); park.inEvolve = true;
    assert.throws(() => park.PyAddOldStyleOrientedBall(...args(-1)), /Can not add ball/);
    assert.throws(() => park.PyAddDynamicallyOrientedBall(...args(-1), 2, 3), /Can not add ball/);
    assert.throws(() => park.PyAddOldStyleOrientedBall(1), TypeError);
    assert.equal(park.mLocalHiCnt, -1073741824n);
    park.inEvolve = false;
    const ball = park.PyAddBall(...args(-1));
    assert.equal(ball.id, -1073741825n);
    const config = settings.Get(); config.useDynamicalOrientation = true; settings.Apply(config);
    assert.throws(() => park.PyAddBall(...args(2)), TypeError);
    const dynamic = park.PyAddBall(...args(2), 2, 3);
    assert.equal(dynamic.mMaxAngVel, 2); assert.equal(dynamic.mRotAgility, 3);
    assert.deepEqual(Array.from(dynamic.mNewAngVel), [0, 0, 0]);
    park.inEvolve = true;
    assert.equal(park.AddBall(...args(3)).id, 3n, "native core has no Python semaphore guard");
});

test("explicit dynamic Python wrapper rearranges native arguments and snaps fixed balls", () =>
{
    const park = new Park(), input = args(1); input[4] = false;
    let received = null, snapped = 0;
    const result = { SnapOrientation() { snapped++; } };
    park.AddDynamicallyOrientedBall = (...values) => { received = values; return result; };
    assert.equal(park.PyAddDynamicallyOrientedBall(...input, 2, 3), result);
    assert.equal(received.length, 26); assert.equal(received[4], 2); assert.equal(received[5], false);
    assert.deepEqual(received.slice(16, 23), [0, 0, 0, 1, 0, 0, 0]);
    assert.deepEqual(received.slice(23), [1, 3, 1]); assert.equal(snapped, 1);
});

test("donor warp-exit callback cannot add via the Python entry point", () =>
{
    // Source: destiny/python/destiny/test/ballpark/evolve/test_add.py:8-31.
    const park = new Park(); park.isMaster = true;
    const ball = park.PyAddBall(...args(1));
    let attempted = false, added = null, failures = 0;
    park._pyOS = {
        PostEvent() { return true; },
        SendEvent(owner, event, name, flags, format, oldMode, newMode)
        {
            if (oldMode !== Mode.DSTBALL_WARP || newMode !== Mode.DSTBALL_STOP) return true;
            attempted = true;
            try { added = park.PyAddBall(...args(-1)); }
            catch (error) { assert.match(error.message, /Can not add ball/); return false; }
            return true;
        },
        PyError() { failures++; }
    };
    park.WarpTo(ball.id, 100000, 200000, 300000);
    for (let tick = 0; tick < 2000 && !attempted; ++tick) park.Evolve();
    assert.ok(attempted); assert.equal(added, null); assert.equal(failures, 1);
    assert.equal(ball.mode, Mode.DSTBALL_STOP); assert.equal(park.inEvolve, false);
});
