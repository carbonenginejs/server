import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { CjsBallparkController as Park, CjsDestinyBall as Ball, settings } from "@carbonenginejs/server";
import { vec3 } from "@carbonenginejs/runtime/math/vec3";
import { quat } from "@carbonenginejs/runtime/math/quat";
import { mat4 } from "@carbonenginejs/runtime/math/mat4";

afterEach(() => settings.Reset());
const near = (a, b, e = 3e-6) => assert.ok(Math.abs(a - b) <= e, `${a} != ${b}`);
const nearVector = (a, b, e) => b.forEach((x, i) => near(a[i], x, e));
function config(values = {})
{
    const value = settings.Get();
    Object.assign(value, { useDynamicalOrientation: true }, values);
    settings.Apply(value);
}
function scene()
{
    const park = new Park();
    const ball = park.AddBall(1, 1e6, 1, 10, true, false, false, false, false,
        0, 0, 0, 0, 0, 0, 1, 1);
    ball.mRotAgility = 1;
    return { park, ball };
}

test("direct torque retains dt cap and per-component alternate rotation", () =>
{
    // Source: destiny/src/Ballpark.cpp:1511-1578. With heading +Z, tau=1,
    // aligned target and omega X=.5, raw torque=-.5; dt=.25 causes native cap=-1.
    const { park, ball } = scene();
    const out = vec3.create(), direction = vec3.fromValues(0, 0, 1);
    vec3.set(ball.mNewAngVel, 0.5, 0, 0);
    park.dt = 0.25;
    park.GotoTorque(out, ball, direction);
    nearVector(out, [-1, 0, 0]);
    park.dt = 2;
    ball.mNewAngVel[0] = 1.5;
    park.GotoTorque(out, ball, direction);
    nearVector(out, [-1.5, 0, 0]);
    park.dt = 1;
    ball.mNewAngVel[0] = 5;
    park.GotoTorque(out, ball, direction);
    nearVector(out, [1, 0, 0]);
});

test("heading braking matches one-step acceleration and braking-only solutions", () =>
{
    // Source: destiny/src/Ballpark.cpp:1616-1749. For tau=dt=1 and a one-step
    // acceleration/deceleration pair, alpha=theta/(1-exp(-1)). A braking-only
    // initial omega=1 travels 1-1/(e-1) with acceleration -1/(e-1).
    const { park, ball } = scene();
    const out = vec3.create();
    const small = vec3.fromValues(Math.sin(0.1), 0, Math.cos(0.1));
    park.GotoTorqueBreaks(out, ball, small);
    nearVector(out, [0, 0.1 / (1 - Math.exp(-1)), 0]);
    const theta = 1 - 1 / (Math.E - 1);
    vec3.set(ball.mNewAngVel, 0, 1, 0);
    const braking = vec3.fromValues(Math.sin(theta), 0, Math.cos(theta));
    park.GotoTorqueBreaks(out, ball, braking);
    nearVector(out, [0, -1 / (Math.E - 1), 0]);
    assert.equal(Park.scratch.vectorBraking.n2, 1);
});

test("torque ignores pure roll, preserves opposite-heading axis and limits acceleration", () =>
{
    // Source: destiny/src/Ballpark.cpp:1649-1676,1730-1747.
    const { park, ball } = scene();
    const out = vec3.create(), direction = vec3.fromValues(0, 0, 1);
    vec3.set(ball.mNewAngVel, 0, 0, 3);
    park.GotoTorqueBreaks(out, ball, direction);
    nearVector(out, [0, 0, 0]);
    park.GotoTorque(out, ball, direction);
    nearVector(out, [0, 0, 0]);
    vec3.zero(ball.mNewAngVel);
    direction[2] = -1;
    park.GotoTorqueBreaks(out, ball, direction);
    nearVector(out, [-1, 0, 0]);
    ball.mMaxAngVel = 0;
    park.GotoTorqueBreaks(out, ball, direction);
    nearVector(out, [0, 0, 0]);
});

test("roll banking distinguishes braking suppression from the direct solver", () =>
{
    // Source: destiny/src/Ballpark.cpp:1751-1934.
    const { park, ball } = scene();
    const torque = vec3.fromValues(0, -1, 0);
    vec3.set(ball.mNewAngVel, 0, 0.1, 0);
    near(park.GotoRollBreaks(ball, torque), 0);
    near(park.GotoRoll(ball, torque), 1);
    vec3.zero(ball.mNewAngVel);
    vec3.zero(torque);
    quat.set(ball.mNewRot, 0, 0, Math.sin(-0.05), Math.cos(-0.05));
    near(park.GotoRollBreaks(ball, torque), 0.1 / (1 - Math.exp(-1)));
    near(park.GotoRoll(ball, torque), 0.1);
});

test("steering reuses dirty scratch and permits aliased direction output", () =>
{
    const { park, ball } = scene();
    const out = Park.scratch.vec3_5;
    for (const key of ["vec3_6", "vec3_7", "vec3_8", "vec3_9", "vec3_10", "vec3_12"])
        Park.scratch[key].fill(NaN);
    Park.scratch.vectorBraking.alpha2.fill(NaN);
    Park.scratch.vectorBraking.n2 = Park.scratch.vectorBraking.kappa2 = NaN;
    const v = vec3.create, q = quat.create, m = mat4.create;
    vec3.create = quat.create = mat4.create = () => { throw new Error("steering allocation"); };
    try
    {
        vec3.set(out, Math.sin(0.1), 0, Math.cos(0.1));
        park.GotoTorqueBreaks(out, ball, out);
        nearVector(out, [0, 0.1 / (1 - Math.exp(-1)), 0]);
        assert.ok(Number.isFinite(park.GotoRollBreaks(ball, out)));
        vec3.set(out, 0, 0, -1);
        park.GotoTorque(out, ball, out);
        nearVector(out, [-1, 0, 0]);
    }
    finally { vec3.create = v; quat.create = q; mat4.create = m; }
});

test("dynamic behavior previews orientation and the tick integrates it exactly once", () =>
{
    // Source: destiny/src/Ballpark.cpp:841-893,502-519,584-595.
    config();
    const { park, ball } = scene();
    park.GotoDirection(1, 1, 0, 0);
    park.EvolveBehaviorForBall(ball);
    assert.deepEqual(Array.from(ball.mNewRot), [0, 0, 0, 1]);
    assert.deepEqual(Array.from(ball.mNewAngVel), [0, 0, 0]);
    assert.ok(ball.mTorque[1] > 0);
    assert.ok(ball.mLastG[2] > 0, "preview redirects thrust along the partly turned heading");
    const expectedRotation = quat.clone(ball.mNewRot), expectedOmega = vec3.clone(ball.mNewAngVel);
    park.ApplyTorque(expectedRotation, expectedOmega, ball.mTorque, ball.mRoll, 1, 1);
    park.Evolve(10000000);
    nearVector(ball.mNewRot, expectedRotation);
    nearVector(ball.mNewAngVel, expectedOmega);
    assert.deepEqual(Array.from(ball.mOldRot), [0, 0, 0, 1]);
    assert.equal(park.currentTime, 1);
    assert.equal(ball.mNewTime, 10000000n);
});

test("angular commit independently rejects nonfinite float rotation and velocity lengths", () =>
{
    // Source: destiny/src/Ballpark.cpp:584-595; f32 squared-length overflow counts.
    config();
    const { park, ball } = scene();
    park.ApplyTorque = (rotation, omega) =>
    {
        quat.set(rotation, 0, 0, 0, 1e30);
        vec3.set(omega, 1, 2, 3);
    };
    park.Evolve();
    assert.deepEqual(Array.from(ball.mNewRot), [0, 0, 0, 1]);
    nearVector(ball.mNewAngVel, [1, 2, 3]);
    park.ApplyTorque = (rotation, omega) =>
    {
        quat.set(rotation, 0, 1, 0, 0);
        vec3.set(omega, 1e30, 0, 0);
    };
    park.Evolve();
    nearVector(ball.mNewRot, [0, 1, 0, 0]);
    nearVector(ball.mNewAngVel, [1, 2, 3]);
});

test("dynamic client samples old physical rotation on Number ticks and bypasses impact", () =>
{
    // Source: destiny/src/Ball.cpp:877-901,1026-1043. Fraction=.5, tau=dt=1:
    // free spin omega=e^-.5, angle=1-e^-.5, irrespective of visual impacts.
    config();
    const { park, ball } = scene();
    ball.mOldTime = 0n; ball.mNewTime = 10000000n;
    vec3.set(ball.mOldAngVel, 0, 0, 1);
    vec3.zero(ball.mTorque); ball.mRoll = 0;
    ball.mProcessingImpact = true;
    ball.ProcessImpact = () => { throw new Error("dynamic path must not process impact"); };
    const out = quat.create();
    ball.UpdateTicks(25000000, out);
    const omega = Math.exp(-0.5), angle = 1 - omega;
    nearVector(out, [0, 0, Math.sin(angle / 2), Math.cos(angle / 2)]);
    nearVector(ball.mLastAngVel, [0, 0, omega]);
    nearVector(ball.mLastSpeed, [0, 0, 0.5 * omega * Math.cos(angle / 2), -0.5 * omega * Math.sin(angle / 2)]);
    const derivative = quat.fromValues(1, 2, 3, 4);
    ball.GetValueDotAtTicks(25000000, derivative);
    assert.deepEqual(Array.from(derivative), [1, 2, 3, 4]);
    config({ useIterativeCollision: true, disableDynamicalOrientationForMissiles: true });
    ball.mode = Ball.DSTBALLMODE.DSTBALL_MISSILE;
    let calls = 0;
    park.mCollisionLocations.set(ball.id, { CalculateRotation(rotation, angular, fraction)
    {
        calls++;
        assert.equal(fraction, 0.75);
        quat.identity(rotation); vec3.zero(angular);
    } });
    ball.UpdateTicks(27500000, out);
    assert.equal(calls, 1, "client branch follows global flag even for disabled missiles");
});

test("new orbit chooses physical heading when velocity cannot define a plane", () =>
{
    // Source: destiny/src/Ballpark.cpp:712-732.
    config({ useNewOrbit: true });
    const { park, ball } = scene();
    park.AddBall(2, 1e6, 1, 0, false, false, false, false, false, 10, 0, 0, 0, 0, 0, 1, 1);
    park.Orbit(1, 2, 10);
    const out = { toVector: [0, 0, 0], orbitalVector: [0, 0, 0], dist: 0 };
    park.GetOrbitalNormal(ball, out);
    nearVector(out.orbitalVector, [0, -1, 0]);
    nearVector(out.toVector, [1, 0, 0]);
    assert.equal(out.dist, 10);
});


test("steering retains native float overflow and reciprocal normalization", () =>
{
    // Source: math/include/Vector3_inline.h:81-87,163-192;
    // destiny/src/Ballpark.cpp:1522-1555,1628-1661.
    const { park, ball } = scene();
    const out = vec3.create(), direction = vec3.fromValues(1e30, 0, 0);
    park.GotoTorque(out, ball, direction);
    nearVector(out, [-1, 0, 0]);
    park.GotoTorqueBreaks(out, ball, direction);
    nearVector(out, [-1, 0, 0]);
    vec3.set(direction, 1, 3, 13);
    Ball._normalizeVector3(out, direction);
    assert.deepEqual(Array.from(out), [0.07474350929260254, 0.2242305427789688, 0.971665620803833]);
    vec3.set(direction, Math.fround(1e-40), 0, 0);
    Ball._normalizeVector3(out, direction);
    assert.ok(out.every(Number.isNaN));
    park.dt = 0;
    vec3.set(ball.mNewAngVel, 0, 1, 0);
    vec3.set(direction, 1, 0, 0);
    assert.throws(() => park.GotoTorqueBreaks(out, ball, direction), /outside int32/,
        "undefined native float-to-int conversion is an explicit JS rejection");
});

test("dynamic angular staging completes for all balls before either state is committed", () =>
{
    // Source: destiny/src/Ballpark.cpp:502-519,524-595.
    config();
    const { park, ball } = scene();
    const second = park.AddBall(2, 1e6, 1, 10, true, false, false, false, false,
        1000, 0, 0, 0, 0, 0, 1, 1);
    let calls = 0;
    park.ApplyTorque = (rotation, omega) =>
    {
        calls++;
        assert.deepEqual(Array.from(ball.mNewRot), [0, 0, 0, 1]);
        assert.deepEqual(Array.from(second.mNewRot), [0, 0, 0, 1]);
        quat.set(rotation, 0, 1, 0, 0);
        vec3.set(omega, 1, 0, 0);
    };
    park.Evolve();
    assert.equal(calls, 2);
    nearVector(ball.mNewRot, [0, 1, 0, 0]);
    nearVector(second.mNewRot, [0, 1, 0, 0]);
});

test("disabled-missile commit still swaps then snaps under the global dynamic flag", () =>
{
    // Source: destiny/src/Ballpark.cpp:409-416,584-595. A behavior seam selects
    // missile mode after preflight solely to exercise commit; missile movement
    // itself remains unsupported and is not claimed by this fixture.
    config({ disableDynamicalOrientationForMissiles: true });
    const { park, ball } = scene();
    vec3.set(ball.mNewVel, 1, 0, 0);
    park.EvolveBehaviorForBall = value => { value.mode = Ball.DSTBALLMODE.DSTBALL_MISSILE; };
    park.ApplyTorque = () => { throw new Error("disabled missile angular integration"); };
    park.Evolve();
    nearVector(ball.mNewRot, [0, Math.SQRT1_2, 0, Math.SQRT1_2]);
    nearVector(ball.mNewAngVel, [0, 0, 0]);
});

test("dynamic creation reuse keeps explicit angular state and continuity keeps last omega", () =>
{
    // Source: destiny/src/Ballpark.cpp:3445-3460; destiny/src/Ball.cpp:877-902.
    config();
    const { park, ball } = scene();
    park.SetBallRotation(1, 0, 1, 0, 1);
    park.SetBallAngularVelocity(1, 1, 2, 3);
    const rotation = Array.from(ball.mNewRot);
    park.AddBall(1, 1e6, 1, 10, true, false, false, false, false, 0, 0, 0, 0, 0, 4, 1, 1);
    assert.deepEqual(Array.from(ball.mNewRot), rotation);
    assert.deepEqual(Array.from(ball.mNewAngVel), [1, 2, 3]);
    vec3.set(ball.mLastAngVel, 7, 8, 9);
    ball.InforceContinuity();
    assert.deepEqual(ball.mLastRot, ball.mOldRot);
    assert.deepEqual(Array.from(ball.mLastAngVel), [7, 8, 9]);
});


test("dynamic goto remains finite and turns toward its target over repeated ticks", () =>
{
    config();
    const { park, ball } = scene();
    park.GotoDirection(1, 1, 0.2, 0.5);
    const heading = vec3.fromValues(0, 0, 1), rotation = quat.create();
    for (let i = 1; i <= 100; ++i)
    {
        park.Evolve(i * 10000000);
        assert.ok(ball.mNewRot.every(Number.isFinite));
        assert.ok(ball.mNewAngVel.every(Number.isFinite));
        near(quat.length(ball.mNewRot), 1, 2e-6);
        ball.UpdateTicks((i + 2) * 10000000, rotation);
        assert.ok(rotation.every(Number.isFinite));
    }
    ball.GetRotatedVector(heading);
    const targetLength = Math.sqrt(1.29);
    assert.ok((heading[0] + 0.2 * heading[1] + 0.5 * heading[2]) / targetLength > 0.999);
});
