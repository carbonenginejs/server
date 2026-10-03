import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { CjsBallparkController, CjsDestinyBall, settings } from "@carbonenginejs/server";
import { quat } from "@carbonenginejs/runtime/math/quat";
import { vec3 } from "@carbonenginejs/runtime/math/vec3";

afterEach(() => settings.Reset());

function configure(dynamic)
{
    const value = settings.Get();
    value.useDynamicalOrientation = dynamic;
    settings.Apply(value);
}

function add(park, id = 1, method = "AddBall", free = true)
{
    return park[method](id, 1e6, 1, 10, free, false, false, false, false,
        0, 0, 0, 1, 0, 0, 1, 1);
}

function oriented(park, id = 1, rotation = [0, 0, 0, 1], omega = [0, 1, 0], max = 2, agility = 0.9)
{
    return park.AddDynamicallyOrientedBall(id, 1e6, 1, 10, max,
        true, false, false, false, false, 0, 0, 0, 1, 0, 0,
        ...rotation, ...omega, 1, agility, 1);
}

function near(actual, expected, tolerance = 5e-7)
{
    for (let i = 0; i < expected.length; ++i)
        assert.ok(Math.abs(actual[i] - expected[i]) <= tolerance, `${i}: ${actual[i]} != ${expected[i]}`);
}

test("raw AddBall leaves orientation alone; legacy wrapper snaps exactly once under either setting", () =>
{
    // Source: destiny/src/Ballpark.cpp:3303-3496.
    for (const dynamic of [false, true])
    {
        configure(dynamic);
        const park = new CjsBallparkController();
        const ball = add(park);
        assert.equal(ball.mNewYaw, 0);
        ball.mNewYaw = 0.25;
        ball.mOldYaw = -0.5;
        let snaps = 0;
        const original = ball.CalculateYawPitchRoll;
        ball.CalculateYawPitchRoll = function(snap) { ++snaps; return original.call(this, snap); };
        assert.equal(add(park), ball);
        assert.equal(snaps, 0);
        assert.equal(ball.mNewYaw, 0.25);
        assert.equal(add(park, 1, "AddOldStyleOrientedBall"), ball);
        assert.equal(snaps, 1);
        assert.equal(ball.mOldYaw, 0.25, "double snapping would replace the prior yaw");
        assert.equal(ball.mNewYaw, Math.PI / 2);
        add(park, 1, "AddOldStyleOrientedBall", false);
        assert.equal(snaps, 1, "fixed balls are not snapped");
    }
});

test("dynamic creation retains nonunit rotation and backsteps in Carbon quaternion order", () =>
{
    // Source: destiny/src/Ballpark.cpp:3503-3553; math/include/Quaternion_inline.h:118-126.
    for (const dynamic of [false, true])
    {
        configure(dynamic);
        const park = new CjsBallparkController();
        park.dt = 0.5;
        const ball = oriented(park, 1, [1, 0, 0, 2], [0, 2, 0]);
        assert.deepEqual(Array.from(ball.mNewRot), [1, 0, 0, 2]);
        const sine = Math.sin(-0.5), cosine = Math.cos(-0.5);
        near(ball.mOldRot, [cosine, 2 * sine, -sine, 2 * cosine]);
        assert.deepEqual(Array.from(ball.mOldAngVel), [0, 2, 0]);
        assert.equal(ball.mNewYaw, 0, "dynamic creation never legacy-snaps");
        const old = Array.from(ball.mOldRot);
        const oldOmega = Array.from(ball.mOldAngVel);
        assert.equal(oriented(park, 1, [3, 2, 1, 0], [4, 5, 6], -1, 0), ball);
        assert.deepEqual(Array.from(ball.mOldRot), old);
        assert.deepEqual(Array.from(ball.mOldAngVel), oldOmega);
        assert.deepEqual(Array.from(ball.mNewRot), [3, 2, 1, 0]);
        assert.equal(ball.mMaxAngVel, 0);
        assert.equal(ball.mRotAgility, 1);
        oriented(park, 1, [0, 0, 0, 1], [0, 0, 0], NaN, NaN);
        assert.ok(Number.isNaN(ball.mMaxAngVel));
        assert.ok(Number.isNaN(ball.mRotAgility));
    }
});

test("dynamic creation consumes both native sentinel resolutions without inserting a probe entry", () =>
{
    // Source: destiny/src/Ballpark.cpp:3265-3288,3528-3531; MapOfBalls.h:25-40.
    for (const [master, id, expected] of [[false, -1, -1073741826n], [true, -5, -1073741826n],
        [true, 0, -3n], [false, 0, 0n], [false, -5, -5n], [true, 5, 5n]])
    {
        const park = new CjsBallparkController();
        park.isMaster = master;
        const ball = oriented(park, id);
        assert.equal(ball.id, expected);
        assert.equal(park._balls.size, 1);
        assert.equal(park.GetBall(expected), ball);
    }
});

test("captured native probe result determines old state even when the second resolved identity differs", () =>
{
    // Source: destiny/src/Ballpark.cpp:3528-3550. Probe and returned IDs may alias explicit entries.
    const park = new CjsBallparkController();
    add(park, -1073741825n);
    const created = oriented(park, -1, [1, 0, 0, 2], [0, 2, 0]);
    assert.equal(created.id, -1073741826n);
    assert.deepEqual(Array.from(created.mOldRot), [0, 0, 0, 1]);
    assert.deepEqual(Array.from(created.mOldAngVel), [0, 0, 0]);
    const second = new CjsBallparkController();
    const existing = add(second, -1073741826n);
    quat.set(existing.mOldRot, 1, 2, 3, 4);
    assert.equal(oriented(second, -1, [0, 0, 0, 2], [0, 0, 0]), existing);
    assert.deepEqual(Array.from(existing.mOldRot), [0, 0, 0, 2]);
});

test("angular Blue aliases narrow detached values and attached writes notify after mutation", () =>
{
    // Source: destiny/src/Ball_Blue.cpp:58-63,219-273,317-323; Ball.cpp:1506-1584.
    const detached = new CjsDestinyBall();
    for (const [name, index] of [["wx", 0], ["wy", 1], ["wz", 2]])
    {
        detached[name] = 1 / 3;
        assert.equal(detached.mNewAngVel[index], Math.fround(1 / 3));
        assert.equal(detached.mOldAngVel[index], 0);
    }
    for (const [name, index] of [["rx", 0], ["ry", 1], ["rz", 2], ["rw", 3]])
    {
        detached[name] = 1 / 3;
        assert.equal(detached.mNewRot[index], Math.fround(1 / 3));
    }
    assert.deepEqual(Array.from(detached.mOldRot), [0, 0, 0, 1]);
    const park = new CjsBallparkController();
    park.isMaster = true;
    const ball = add(park);
    for (const name of ["wx", "wy", "wz"])
    {
        ball[name] = 1 / 3;
        assert.deepEqual(ball.mOldAngVel, ball.mNewAngVel);
    }
    ball.maxAngularVelocity = -1;
    ball.RotationalAgility = 0;
    assert.equal(ball.mMaxAngVel, -1);
    assert.equal(ball.mRotAgility, 0);
    ball.rw = 0;
    assert.deepEqual(Array.from(ball.mNewRot), [0, 0, 0, 0]);
    assert.deepEqual(Array.from(ball.mOldRot), [0, 0, 0, 1]);
    assert.ok(ball.mNewAngVel[0] > 0, "rejected zero quaternion leaves angular motion");
    for (const name of ["rx", "ry", "rz", "rw"])
    {
        vec3.set(ball.mNewAngVel, 1, 2, 3);
        ball[name] = 2;
        assert.deepEqual(ball.mOldRot, ball.mNewRot);
        assert.ok(Math.abs(quat.length(ball.mNewRot) - 1) < 1e-6);
        assert.deepEqual(Array.from(ball.mNewAngVel), [0, 0, 0]);
        assert.deepEqual(Array.from(ball.mOldAngVel), [0, 0, 0]);
    }
});

test("ClientBall visual angular limit shadows physical Blue notification", () =>
{
    // Source: destiny/src/Ball_Blue.cpp:578-584 versus base Ball.cpp:1577-1584.
    const park = new CjsBallparkController();
    const ball = add(park);
    ball.maxAngularVelocity = 7;
    assert.equal(ball.mMaxAngularVelocity, 7);
    assert.equal(ball.mMaxAngVel, 1);
    ball.RotationalAgility = 0;
    assert.equal(ball.mRotAgility, 0);
});


test("creation callbacks precede orientation assignment and may create another oriented ball", () =>
{
    // Source: destiny/src/Ballpark.cpp:3445-3459,3528-3548.
    const park = new CjsBallparkController();
    park.dt = 0.5;
    const insert = park.InsertBallInBoxes;
    let nested;
    park.InsertBallInBoxes = function(ball)
    {
        insert.call(this, ball);
        if (ball.id !== 1n) return;
        assert.deepEqual(Array.from(ball.mNewRot), [0, 0, 0, 1]);
        assert.deepEqual(Array.from(ball.mNewAngVel), [0, 0, 0]);
        nested = oriented(this, 2, [0, 0, 1, 2], [2, 0, 0]);
        quat.set(CjsBallparkController.scratch.quat_0, 20, 30, 40, 50);
    };
    const outer = oriented(park, 1, [1, 0, 0, 2], [0, 2, 0]);
    const sine = Math.sin(-0.5), cosine = Math.cos(-0.5);
    near(outer.mOldRot, [cosine, 2 * sine, -sine, 2 * cosine]);
    near(nested.mOldRot, [2 * sine, -sine, cosine, 2 * cosine]);
    assert.notEqual(nested.mOldRot, outer.mOldRot);
});
