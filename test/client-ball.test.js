import assert from "node:assert/strict";
import test from "node:test";
import { CjsBallparkController as Park, CjsDestinyBall as Ball, CjsDestinyClientBall as ClientBall } from "@carbonenginejs/server";
import { vec3 } from "@carbonenginejs/runtime/math/vec3";
import { quat } from "@carbonenginejs/runtime/math/quat";
import { vec3d } from "../dist/destiny/math/vec3d.js";

const add = (park, id, x, free = true, vx = 0) => park.AddBall(id, 1e6, 1, 10,
    free, false, false, false, false, x, 0, 0, vx, 0, 0, 1, 1);
const close = (a, b, epsilon = 1e-6) => assert.ok(Math.abs(a - b) <= epsilon, `${a} != ${b}`);

test("replicas create the exported ClientBall and masters retain authoritative Ball", () =>
{
    const park = new Park();
    assert.equal(add(park, 1, 0).constructor, ClientBall);
    park.isMaster = true;
    assert.equal(add(park, 2, 10).constructor, Ball);
});

test("renderer Number ticks sample delayed drag, subtract the reference in f64 and return absolute velocity", () =>
{
    const park = new Park();
    const ego = add(park, 1, 1e10, true, 2);
    const ball = add(park, 2, 1e10 + 0.25, true, 10);
    park.ego = ego.id;
    for (const value of [ego, ball])
    {
        vec3.copy(value.mOldPos, value.mNewPos);
        vec3.copy(value.mOldVel, value.mNewVel);
        value.mOldTime = 0n;
        value.mNewTime = 10000000n;
    }
    const position = vec3.create(), velocity = vec3.create(), reference = vec3d.create();
    assert.equal(ball.GetShiftedTime(25000000), 5000000n);
    assert.equal(ball.UpdateTicks(25000000, position), position);
    const egoPosition = 1e10 + 2 * (1 - Math.exp(-0.5));
    const ballPosition = 1e10 + 0.25 + 10 * (1 - Math.exp(-0.5));
    // Algebraically equivalent drag formulae differ by one f64 ulp at 1e10.
    close(position[0], Math.fround(ballPosition - egoPosition), 2e-6);
    assert.equal(ball.GetValueDotAtTicks(25000000, velocity), velocity);
    assert.equal(velocity[0], Math.fround(10 * Math.exp(-0.5)));
    assert.equal(park.GetReferencePoint(25000000, reference), reference);
    close(reference[0], egoPosition, 2e-6);
    ego.UpdateTicks(25000000, position);
    assert.deepEqual(Array.from(position), [0, 0, 0]);
    assert.equal(ego.mCenterDist, 0);
});

test("curve caches preserve zero-span velocity, backward samples and native same-time reference behavior", () =>
{
    const park = new Park(), ego = add(park, 1, 100, false), next = add(park, 2, 200, false);
    park.ego = 1;
    const reference = vec3d.create(), out = vec3.create();
    park.GetReferencePoint(30000000, reference);
    assert.equal(reference[0], 100);
    park.ego = 2;
    park.GetReferencePoint(30000000, reference);
    assert.equal(reference[0], 100);
    park.GetReferencePoint(31000000, reference);
    assert.equal(reference[0], 200);
    next.mLastVel[0] = 7;
    next.GetValueDotAtTicks(32000000, out);
    assert.equal(out[0], 7, "zero time span does not refresh last velocity");
    next.mNewPos[0] = 300;
    next.InterpolatedPosition(31000000, reference);
    assert.equal(reference[0], 200, "backward samples keep cached absolute position");
    park.RemoveBall(2);
    assert.equal(park.GetEgo(), null);
    park.GetReferencePoint(31000000, reference);
    assert.equal(reference[0], 200, "removal retains the native same-time reference cache");
    park.GetReferencePoint(33000000, reference);
    assert.equal(reference[0], 0);
    assert.equal(ego.mPark, park);
});

test("fixed and global position paths retain float32 rounding and shifted timestamps", () =>
{
    const park = new Park();
    add(park, 1, 1e10, false);
    const ball = add(park, 2, 1e10 + 123.123456, false);
    park.ego = 1;
    ball.isGlobal = true;
    park.mSomeWeirdHackToFixSomething = 3;
    const out = vec3.create();
    ball.GetValueAtTicks(30000000, out);
    assert.equal(out[0], Math.fround(Math.fround(ball.x - 1e10) / 3));
    assert.equal(ball.mPosUpdateTime, 10000000n);
    ball.GetValueAtTicks(30000000, quat.create());
    assert.deepEqual(Array.from(ball.mLastRot), [0, 0, 0, -1]);
});

test("one ball supplies legacy position and quaternion overloads with untouched quaternion derivatives", () =>
{
    const park = new Park(), ball = add(park, 1, 0);
    park.ego = 1;
    ball.mOldTime = 10000000n;
    ball.mNewTime = 20000000n;
    ball.mOldYaw = ball.mOldPitch = ball.mOldRoll = 0;
    ball.mYawDelta = 1;
    ball.mNewPitch = 2;
    ball.mNewRoll = 3;
    const out = quat.create(), expected = quat.create();
    assert.equal(ball.UpdateTicks(35000000, out), out);
    assert.ok(Number.isNaN(ball.mYawSpeed), "native first sample has zero delta time");
    ball.UpdateTicks(36000000, out);
    const yaw = 0.9 * 0.1 * 0.6 / 1.09;
    const pitch = 1.3 * 0.9 * 0.1 * 1.2 / (1 + 1.3 * 0.9 * 0.1);
    const roll = 0.9 * 0.1 * 1.8 / 1.09;
    quat.fromYawPitchRoll(expected, Math.fround(yaw), Math.fround(pitch), Math.fround(roll));
    for (let i = 0; i < 4; ++i) close(out[i], expected[i], 1e-7);
    quat.set(out, 1, 2, 3, 4);
    assert.equal(ball.GetValueDotAtTicks(37000000, out), out);
    assert.deepEqual(Array.from(out), [1, 2, 3, 4]);
    ball.UpdateTicks(35000000n, out);
    assert.deepEqual(out, expected, "backward quaternion samples return the cache");
});

test("velocity changes and evolution feed native yaw/pitch/roll", () =>
{
    const park = new Park(), ball = add(park, 1, 0);
    park.SetBallVelocity(1, 10, 0, 0);
    close(ball.mNewYaw, Math.PI / 2, 1e-14);
    close(ball.mLastRot[1], Math.SQRT1_2, 1e-7);
    ball.mGoto[0] = 0; ball.mGoto[2] = 100;
    park.Evolve(10000000);
    assert.notEqual(ball.mYawDelta, 0);
    assert.notEqual(ball.mNewRoll, 0);
    assert.equal(Ball._modulo2pi(0, Math.PI), -Math.PI, "strict native ties select the negative turn");
});

test("client sampling reuses storage and rejects invalid Number ticks", () =>
{
    const park = new Park(), ego = add(park, 1, 100, false), ball = add(park, 2, 110, true, 3);
    park.ego = ego.id;
    ball.mOldTime = 10000000n; ball.mNewTime = 20000000n;
    const position = vec3.create(), rotation = quat.create();
    const create = vec3d.create, allocate = vec3d.alloc;
    vec3d.create = vec3d.alloc = () => { throw new Error("per-sample allocation"); };
    try
    {
        for (let time = 30000000; time < 32000000; time += 100000)
        {
            ball.UpdateTicks(time, position);
            ball.UpdateTicks(time, rotation);
            ball.GetValueDotAtTicks(time, position);
        }
    }
    finally
    {
        vec3d.create = create; vec3d.alloc = allocate;
    }
    for (const time of [0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])
        assert.throws(() => ball.UpdateTicks(time, position), RangeError);
});

test("AdjustTimes shifts client caches including zero, preserving reference time and overflow atomicity", () =>
{
    const park = new Park(), ball = add(park, 1, 0, false);
    assert.deepEqual(Array.from(ball.mLastRot), [0, 0, 0, 1], "fixed creation does not snap orientation");
    park.mLastReferenceTime = 100n;
    ball.mNewTime = 10n;
    park.AdjustTimes(5);
    assert.equal(ball.mPosUpdateTime, 5n);
    assert.equal(ball.mRotUpdateTime, 5n);
    assert.equal(ball.mOldTime, 0n);
    assert.equal(ball.mNewTime, 15n);
    assert.equal(park.mLastReferenceTime, 100n);
    ball.mRotUpdateTime = 9223372036854775807n;
    assert.throws(() => park.AdjustTimes(1), RangeError);
    assert.equal(ball.mPosUpdateTime, 5n);
    assert.equal(ball.mNewTime, 15n);
    assert.equal(park.time, 5n);
});

test("the plain names are Carbon's double overloads: Update reports and zeroes, GetValueAt samples the last update time", t =>
{
    const park = new Park();
    const ego = add(park, 1, 0, true, 0);
    const ball = add(park, 2, 5, true, 0);
    park.ego = ego.id;
    for (const value of [ego, ball])
    {
        vec3.copy(value.mOldPos, value.mNewPos);
        vec3.copy(value.mOldVel, value.mNewVel);
        value.mOldTime = 0n;
        value.mNewTime = 10000000n;
    }
    const errors = t.mock.method(console, "error", () => {});
    const position = vec3.fromValues(7, 7, 7), rotation = quat.fromValues(7, 7, 7, 7);
    assert.ok(ball.Update(2.5, position) === position);
    assert.deepEqual(Array.from(position), [0, 0, 0]);
    ball.Update(2.5, rotation);
    assert.deepEqual(Array.from(rotation), [0, 0, 0, -1]);
    assert.equal(errors.mock.callCount(), 2, "Ball.cpp:960, 1339 report the wrong overload");
    // GetValueAt(double) ignores its argument and samples mPosUpdateTime (Ball.cpp:1427-1430).
    const viaTicks = vec3.create(), viaSeconds = vec3.create();
    ball.GetValueAtTicks(25000000, viaTicks);
    ball.GetValueAt(999, viaSeconds);
    assert.deepEqual(Array.from(viaSeconds), Array.from(viaTicks));
    rotation.set([1, 2, 3, 4]);
    assert.deepEqual(Array.from(ball.GetValueAt(1, rotation)), [1, 2, 3, 4]);
    const derivative = vec3.fromValues(3, 3, 3);
    assert.deepEqual(Array.from(ball.GetValueDotAt(1, derivative)), [3, 3, 3]);
    assert.deepEqual(Array.from(ball.GetValueDoubleDotAt(1, derivative)), [3, 3, 3]);
});
