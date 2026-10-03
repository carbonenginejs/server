import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { CjsDestinyBall, CjsDestinyClientBall, CjsBallparkController, settings } from "@carbonenginejs/server";
import { vec3 } from "@carbonenginejs/runtime/math/vec3";
import { quat } from "@carbonenginejs/runtime/math/quat";
import { mat4 } from "@carbonenginejs/runtime/math/mat4";

afterEach(() => settings.Reset());

function near(actual, expected, tolerance = 4e-7)
{
    for (let i = 0; i < expected.length; ++i)
        assert.ok(Math.abs(actual[i] - expected[i]) <= tolerance, `${i}: ${actual[i]} != ${expected[i]}`);
}

function dynamic()
{
    const config = settings.Get();
    config.useDynamicalOrientation = true;
    settings.Apply(config);
}

test("native dynamic state is owned by Ball and separate from visual impact parameters", () =>
{
    // Source: destiny/src/Ball.cpp:74-83; Ball.h:129-166.
    const first = new CjsDestinyBall(), second = new CjsDestinyBall();
    assert.deepEqual(Array.from(first.mNewRot), [0, 0, 0, 1]);
    assert.deepEqual(Array.from(first.mOldRot), [0, 0, 0, 1]);
    assert.deepEqual(Array.from(first.mTorque), [0, 0, 0]);
    assert.equal(first.mMaxAngVel, 1);
    assert.equal(first.mRotAgility, Math.fround(0.9));
    assert.notEqual(first.mNewRot, first.mOldRot);
    assert.notEqual(first.mNewAngVel, second.mNewAngVel);
    const client = new CjsDestinyClientBall();
    client.maxAngularVelocity = 7;
    assert.equal(client.mMaxAngularVelocity, 7);
    assert.equal(client.mMaxAngVel, 1);
});

test("SnapOrientation keeps native stationary and reverse-heading edge cases", () =>
{
    // Source: destiny/src/Ball.cpp:290-333; no repair of the zero cross axis.
    const ball = new CjsDestinyBall();
    quat.set(ball.mNewRot, 1, 2, 3, 4);
    vec3.set(ball.mNewAngVel, 1, 2, 3);
    ball.SnapOrientation();
    assert.deepEqual(Array.from(ball.mNewRot), [1, 2, 3, 4]);
    assert.deepEqual(Array.from(ball.mNewAngVel), [1, 2, 3]);
    vec3.set(ball.mNewVel, 1, 0, 0);
    ball.SnapOrientation();
    near(ball.mNewRot, [0, Math.SQRT1_2, 0, Math.SQRT1_2]);
    assert.deepEqual(ball.mNewRot, ball.mOldRot);
    assert.deepEqual(Array.from(ball.mNewAngVel), [0, 0, 0]);
    vec3.set(ball.mNewVel, 0, 0, -1);
    ball.SnapOrientation();
    near(ball.mNewRot, [0, 0, 0, Math.cos(Math.fround(Math.PI) / 2)], 1e-12);
    assert.ok(quat.length(ball.mNewRot) < 1e-6, "native reverse heading is not repaired into a unit quaternion");
    vec3.set(ball.mNewVel, 0, 0, 1e40);
    ball.SnapOrientation();
    assert.ok(ball.mNewRot.every(Number.isNaN), "float overflow retains Cross zero-times-Infinity NaNs");
});

test("SnapOrientation preserves the native boolean roll guard for downward headings", () =>
{
    // Source: destiny/src/Ball.cpp:322 uses fabs(up.z < .99f), not fabs(up.z).
    // Independently form the shortest +Z-to-direction rotation, then apply the
    // local Z roll that makes inverse-world-up's XY projection vertical.
    const ball = new CjsDestinyBall();
    vec3.set(ball.mNewVel, 1, -100, 1);
    const angle = Math.acos(1 / Math.sqrt(10002));
    const sine = Math.sin(angle / 2), w = Math.cos(angle / 2);
    const x = 100 / Math.sqrt(10001) * sine, y = sine / Math.sqrt(10001);
    const upX = 2 * x * y, upY = 1 - 2 * x * x, upZ = -2 * x * w;
    assert.ok(upZ < -0.99);
    const roll = Math.atan2(-upX, upY), c = Math.cos(roll / 2), t = Math.sin(roll / 2);
    ball.SnapOrientation();
    near(ball.mNewRot, [x * c + y * t, y * c - x * t, w * t, w * c], 3e-6);
    assert.ok(Math.abs(ball.mNewRot[2]) > 0.1, "an abs(up.z) repair would incorrectly skip this roll");
});

test("GetRotatedVector uses current physical or legacy orientation without normalization", () =>
{
    // Source: destiny/src/Ball.cpp:2191-2203; math/include/Matrix_inline.h:365-385.
    const ball = new CjsDestinyBall(), value = vec3.create();
    dynamic();
    quat.set(ball.mNewRot, 0, 1, 0, 1);
    vec3.set(value, 0, 0, 1);
    ball.GetRotatedVector(value);
    assert.deepEqual(Array.from(value), [2, 0, -1]);
    quat.set(ball.mNewRot, 0, 0, 0, 0);
    vec3.set(value, 2, 3, 4);
    ball.GetRotatedVector(value);
    assert.deepEqual(Array.from(value), [2, 3, 4]);
    vec3.set(value, Infinity, 0, 0);
    ball.GetRotatedVector(value);
    assert.ok(value.every(Number.isNaN), "native homogeneous divisor retains zero-times-Infinity NaN");
    settings.Reset();
    ball.mNewYaw = Math.PI / 2;
    vec3.set(value, 0, 0, 1);
    ball.GetRotatedVector(value);
    near(value, [1, 0, 0]);
});

test("ApplyTorque matches independently integrated angular drag and constant torque", () =>
{
    // Source: destiny/src/Ballpark.cpp:1936-1983. For tau=dt=1 the solutions
    // are omega=e^-1, angle=1-e^-1; and omega=1-e^-1, angle=e^-1 respectively.
    const park = new CjsBallparkController();
    const rotation = quat.create(), omega = vec3.fromValues(0, 0, 1), torque = vec3.create();
    park.ApplyTorque(rotation, omega, torque, 0, 1, 1);
    const decay = Math.exp(-1), half = (1 - decay) / 2;
    near(omega, [0, 0, decay]);
    near(rotation, [0, 0, Math.sin(half), Math.cos(half)]);
    quat.identity(rotation);
    vec3.zero(omega);
    vec3.set(torque, 1, 0, 0);
    park.ApplyTorque(rotation, omega, torque, 0, 1, 1);
    near(omega, [1 - decay, 0, 0]);
    near(rotation, [Math.sin(decay / 2), 0, 0, Math.cos(decay / 2)]);
});

test("heading and roll compose after an existing orientation in native order", () =>
{
    // Source: destiny/src/Ballpark.cpp:1955-1973. Independent composition:
    // initial Y(pi/2), world heading Y(e^-1), then roll about the new heading.
    const park = new CjsBallparkController();
    const rotation = quat.fromValues(0, Math.SQRT1_2, 0, Math.SQRT1_2);
    const omega = vec3.create(), torque = vec3.fromValues(0, 1, 0);
    park.ApplyTorque(rotation, omega, torque, 0.4, 1, 1);
    const a = Math.exp(-1), phi = (Math.PI / 2 + a) / 2, rho = 0.4 * a / 2;
    near(rotation, [Math.sin(phi) * Math.sin(rho), Math.sin(phi) * Math.cos(rho),
        Math.cos(phi) * Math.sin(rho), Math.cos(phi) * Math.cos(rho)]);
    near(omega, [0.4 * (1 - a) * Math.cos(a), 1 - a, -0.4 * (1 - a) * Math.sin(a)]);
});

test("rotation sampling preserves zero-fraction bypass and original record fraction", () =>
{
    // Source: destiny/src/Ballpark.cpp:2685-2712.
    const park = new CjsBallparkController(), ball = new CjsDestinyBall();
    const rotation = quat.fromValues(0, 0, 0, 2), omega = vec3.create();
    park.CalculateBallRotationVelocity(ball, 0, rotation, omega);
    assert.equal(rotation[3], 2);
    park.ApplyTorque(rotation, omega, ball.mTorque, 0, 1, 0);
    assert.equal(rotation[3], 1);
    let called = 0;
    const fraction = 0.123456789123;
    park.mCollisionLocations.set(ball.mId, {
        CalculateRotation(outRotation, outOmega, actualFraction)
        {
            called++;
            assert.equal(outRotation, rotation);
            assert.equal(outOmega, omega);
            assert.equal(actualFraction, fraction);
        }
    });
    park.CalculateBallRotationVelocity(ball, 0, rotation, omega);
    assert.equal(called, 0);
    park.CalculateBallRotationVelocity(ball, fraction, rotation, omega);
    assert.equal(called, 1);
    park.mCollisionLocations.clear();
    ball.mMass = park.mFriction;
    ball.mAgility = ball.mRotAgility = 1;
    vec3.set(ball.mTorque, 1, 0, 0);
    park.CalculateBallRotationVelocity(ball, 1, rotation, omega);
    near(omega, [1 - Math.exp(-1), 0, 0]);
});

test("angular setters retain native thresholds, float casts and zero-speed snap behavior", () =>
{
    // Source: destiny/src/Ballpark.cpp:4721-4732,4770-4846,4958-4966.
    const park = new CjsBallparkController();
    const ball = park.AddBall(1, 1e6, 2, 10, true, false, false, false, false,
        0, 0, 0, 0, 0, 0, 1, 1);
    park.SetBallAngularVelocity(1, 1 / 3, 2, 3);
    assert.equal(ball.mNewAngVel[0], Math.fround(1 / 3));
    assert.deepEqual(ball.mNewAngVel, ball.mOldAngVel);
    park.SetBallRotation(1, 0, 0, 0, 0);
    assert.equal(ball.mNewAngVel[1], 2);
    park.SetBallRotation(1, 0, 0, 0, NaN);
    assert.equal(ball.mNewAngVel[1], 2);
    park.SetBallRotation(1, 0, 2, 0, 2);
    near(ball.mNewRot, [0, Math.SQRT1_2, 0, Math.SQRT1_2]);
    assert.deepEqual(ball.mOldRot, ball.mNewRot);
    assert.deepEqual(Array.from(ball.mNewAngVel), [0, 0, 0]);
    park.SetMaxAngularSpeed(1, -1);
    assert.equal(ball.mMaxAngVel, 1);
    park.SetMaxAngularSpeed(1, NaN);
    assert.ok(Number.isNaN(ball.mMaxAngVel));
    park.SetBallAngularAgility(1, 0);
    assert.equal(ball.mRotAgility, Math.fround(0.9));
    park.SetBallAngularAgility(1, NaN);
    assert.ok(Number.isNaN(ball.mRotAgility));
    dynamic();
    park.SetBallVelocity(1, 1, 0, 0);
    near(ball.mNewRot, [0, Math.SQRT1_2, 0, Math.SQRT1_2]);
    park.SetBallAngularVelocity(1, 3, 2, 1);
    park.SetBallFree(1, false);
    assert.deepEqual(Array.from(ball.mNewAngVel), [3, 2, 1], "zero linear velocity does not stop native angular motion");
    park.SetBallRotation(1, 1e30, 0, 0, 0);
    assert.deepEqual(Array.from(ball.mNewRot), [0, 0, 0, 0], "native float squared-length overflows before normalization");
});

test("orientation kernels reuse dirty scratch with aliased torque and outputs", () =>
{
    const park = new CjsBallparkController(), ball = new CjsDestinyBall();
    const rotation = CjsBallparkController.scratch.quat_1;
    const omega = CjsBallparkController.scratch.vec3_0;
    for (const value of Object.values(CjsDestinyBall.scratch)) value.fill(NaN);
    quat.identity(rotation);
    vec3.set(omega, 1, 0, 0);
    const v = vec3.create, q = quat.create, m = mat4.create;
    vec3.create = quat.create = mat4.create = () => { throw new Error("allocation in kernel"); };
    try
    {
        park.ApplyTorque(rotation, omega, omega, 0, 1, 1);
        near(omega, [1, 0, 0]);
        near(rotation, [Math.sin(0.5), 0, 0, Math.cos(0.5)]);
        vec3.set(ball.mNewVel, 1, 0, 0);
        ball.SnapOrientation();
        dynamic();
        vec3.set(omega, 0, 0, 1);
        ball.GetRotatedVector(omega);
        near(omega, [1, 0, 0]);
    }
    finally { vec3.create = v; quat.create = q; mat4.create = m; }
});
