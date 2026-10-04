import assert from "node:assert/strict";
import test from "node:test";
import { CjsDestinyClientBall as ClientBall, CjsBallparkController as Park } from "@carbonenginejs/server";
import { vec3 } from "@carbonenginejs/runtime/math/vec3";
import { quat } from "@carbonenginejs/runtime/math/quat";
import { vec3d } from "../dist/destiny/math/vec3d.js";

// Source: destiny/src/Ball.cpp:2000-2124; math/include/Quaternion_inline.h:118-272.
// These are source-derived analytic cases, not captured JS output or native executable fixtures.
const close = (actual, expected, epsilon = 2e-6) => assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`);
const impulseBall = () =>
{
    const ball = new ClientBall();
    ball.mMass = 5;
    ball.mRadius = 1;
    ball.mMaxVel = 10;
    return ball;
};

test("native impulse uses the local lever arm, cached inertia and strict threshold", () =>
{
    const ball = impulseBall();
    ball.ApplyImpulsiveForceAtPosition([0, 0.1, 0], [1, 0, 0]);
    assert.equal(ball.mInvInertiaTensor, 0.5);
    assert.equal(ball.mProcessingImpact, false);
    assert.deepEqual(Array.from(ball.mImpactVelocityGoal), [0, 0, 0, 1]);
    ball.ApplyImpulsiveForceAtPosition([0, 20, 0], [2, 0, 0]);
    close(ball.mImpactVelocityGoal[2], Math.sin(0.5));
    close(ball.mImpactVelocityGoal[3], Math.cos(0.5));
    assert.equal(ball.mProcessingImpact, true);
    ball.mMass = 500;
    ball.mRadius = 10;
    ball.ApplyImpulsiveForceAtPosition([0, 0.1, 0], [1, 0, 0]);
    assert.equal(ball.mInvInertiaTensor, 0.5, "inertia is computed once, not refreshed by physical edits");

    const threshold = impulseBall();
    threshold.minimumAngularVelocity = 1;
    threshold.ApplyImpulsiveForceAtPosition([0, 20, 0], [2, 0, 0]);
    assert.equal(threshold.mProcessingImpact, true, "equality passes the strict threshold");
});

test("impact composes noncommuting axes in Carbon order and clamps goal angle", () =>
{
    const ball = impulseBall();
    ball.ApplyImpulsiveForceAtPosition([0, 20, 0], [2, 0, 0]); // Z
    ball.ApplyImpulsiveForceAtPosition([0, 0, 20], [0, 2, 0]); // X
    assert.ok(ball.mImpactVelocityGoal[1] < 0, "Carbon Z then X reverses Hamilton operands");
    ball.maxAngularVelocity = 0.1;
    ball.ApplyImpulsiveForceAtPosition([0, 100, 0], [2, 0, 0]);
    close(2 * Math.acos(ball.mImpactVelocityGoal[3]), Math.fround(0.1));
});

test("angular velocity composes onto an existing rotation without modifying authoritative motion", () =>
{
    const ball = impulseBall(), half = Math.SQRT1_2;
    quat.set(ball.mImpactRotation, half, 0, 0, half);
    quat.set(ball.mImpactVelocity, 0, half, 0, half);
    const position = Array.from(ball.mNewPos), velocity = Array.from(ball.mNewVel);
    ball.ApplyAngularVelocityToRotation(1);
    for (const [index, expected] of [0.5, 0.5, -0.5, 0.5].entries()) close(ball.mImpactRotation[index], expected);
    assert.deepEqual(Array.from(ball.mNewPos), position);
    assert.deepEqual(Array.from(ball.mNewVel), velocity);
});

test("growth reaching zero runs recovery in the same call even with zero elapsed time", () =>
{
    const ball = impulseBall();
    ball.mInvInertiaTensor = 0.5;
    ball.mMaxVel = 0;
    ball.mCurrentVelocityInfluence = Math.fround(0.001);
    ball.ProcessImpact(0);
    assert.equal(ball.mCurrentVelocityInfluence, 0);
    assert.equal(ball.mImpactRotationDeterioration, Math.fround(1 - Math.fround(0.002)));
    assert.equal(ball.mProcessingImpact, true);
    assert.deepEqual(Array.from(ball.mImpactRotation), [0, 0, 0, 1]);
});

test("impact growth, repeated impulses and recovery complete with the native soft angle limit", () =>
{
    const ball = impulseBall();
    ball.ApplyImpulsiveForceAtPosition([0, 20, 0], [2, 0, 0]);
    for (let i = 0; i < 6; ++i)
    {
        quat.identity(ball.mLastRot);
        ball.ProcessImpact(0.1);
    }
    const prior = Array.from(ball.mImpactVelocity);
    ball.ApplyImpulsiveForceAtPosition([0, 0, 20], [0, 2, 0]);
    assert.deepEqual(Array.from(ball.mImpactVelocityAtImpact), prior);
    assert.equal(ball.mCurrentVelocityInfluence, 1);
    let ticks = 0;
    while (ball.mProcessingImpact && ticks++ < 600)
    {
        quat.identity(ball.mLastRot);
        ball.ProcessImpact(0.1);
        const angle = 2 * Math.acos(ball.mImpactRotation[3]);
        assert.ok(angle < ball.mMaxAngle + 1e-5);
        assert.ok(Array.from(ball.mLastRot).every(Number.isFinite));
    }
    assert.ok(ticks < 600);
    assert.equal(ball.mImpactRotationDeterioration, 0);
    assert.deepEqual(Array.from(ball.mImpactRotation), [0, 0, 0, 1]);
});

test("zero mass retains native nonfinite quaternion math and ordered NaN clamp behavior", () =>
{
    const ball = impulseBall();
    ball.mMass = 0;
    ball.ApplyImpulsiveForceAtPosition([0, 20, 0], [2, 0, 0]);
    assert.equal(ball.mInvInertiaTensor, Infinity);
    ball.ProcessImpact(0.1);
    assert.equal(ball.mCurrentVelocityInfluence, Math.fround(1 - Math.fround(0.08)));
    assert.equal(ball.mImpactRotationDeterioration, 1);
    assert.ok(Array.from(ball.mLastRot).some(Number.isNaN));
});

test("impact quaternion adapters preserve native linear slerp, zero normalization and large axes", () =>
{
    const a = quat.create(), b = quat.fromValues(Math.sin(0.02), 0, 0, Math.cos(0.02)), out = quat.create();
    ClientBall._slerp(out, a, b, 0.5);
    assert.equal(out[0], Math.fround(0.5 * b[0]));
    assert.equal(out[3], Math.fround(0.5 + Math.fround(0.5 * b[3])));
    assert.ok(quat.length(out) < 0.99999, "native linear branch is not normalized");
    quat.set(out, 0, 0, 0, 0);
    ClientBall._normalizeQuaternion(out, out);
    assert.ok(Array.from(out).every(Number.isNaN));
    ClientBall._rotationQuaternion(out, Math.fround(1e30), Math.fround(1e30), 0, 1);
    close(out[0], Math.SQRT1_2 * Math.sin(0.5));
    close(out[1], Math.SQRT1_2 * Math.sin(0.5));
    close(out[3], Math.cos(0.5));
});

test("renderer applies impact without per-sample vector or quaternion allocation", () =>
{
    const park = new Park();
    const ball = park.AddBall(1, 5, 1, 10, true, false, false, false, false, 0, 0, 0, 0, 0, 0, 1, 1);
    park.ego = 1;
    ball.mOldTime = 10000000n; ball.mNewTime = 20000000n;
    ball.ApplyImpulsiveForceAtPosition([0, 20, 0], [2, 0, 0]);
    const out = quat.create();
    const factories = [vec3.create, vec3.alloc, quat.create, quat.alloc, vec3d.create, vec3d.alloc];
    const reject = () => { throw new Error("per-sample allocation"); };
    vec3.create = vec3.alloc = quat.create = quat.alloc = vec3d.create = vec3d.alloc = reject;
    try
    {
        for (let time = 30000000; time < 35000000; time += 100000) ball.UpdateTicks(time, out);
        assert.ok(Math.abs(out[2]) > 0, "renderer rotation includes the impact");
    }
    finally
    {
        [vec3.create, vec3.alloc, quat.create, quat.alloc, vec3d.create, vec3d.alloc] = factories;
    }
});

test("native zero-w goal skips the angle cap and slerp permits aliased negative-dot inputs", () =>
{
    const ball = impulseBall();
    ball.minimumAngularVelocity = 0;
    quat.set(ball.mImpactVelocityGoal, 1, 0, 0, 0);
    ball.ApplyImpulsiveForceAtPosition([0, 0, 0], [1, 0, 0]);
    assert.deepEqual(Array.from(ball.mImpactVelocityGoal), [1, 0, 0, 0]);
    assert.equal(ball.mProcessingImpact, true);
    for (const alias of ["first", "second"])
    {
        const a = quat.create(), b = quat.fromValues(-Math.sin(0.02), 0, 0, -Math.cos(0.02));
        const expectedX = Math.fround(-0.5 * b[0]);
        const expectedW = Math.fround(0.5 + Math.fround(-0.5 * b[3]));
        const out = alias === "first" ? a : b;
        ClientBall._slerp(out, a, b, 0.5);
        assert.equal(out[0], expectedX);
        assert.equal(out[3], expectedW);
    }
});
