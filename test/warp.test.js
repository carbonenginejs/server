import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { CjsBallparkController as Park, CjsDestinyBall as Ball, MapOfLongLongs,
    ProximitySensor, settings } from "@carbonenginejs/server";
import { vec3 } from "@carbonenginejs/runtime/math/vec3";
import { vec3d } from "../dist/destiny/math/vec3d.js";

// Source: destiny/src/Ballpark.cpp:4072-4410; destiny/src/Ball.cpp:1885-1923.
const Mode = Ball.DSTBALLMODE, AU = 149597870700;
afterEach(() => settings.Reset());
const near = (actual, expected, epsilon = 1e-9) =>
    assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`);
function space(park, id = 1, x = 0, vx = 0, mass = 13e6, maxVel = 10)
{
    return park.AddBall(id, mass, 2, maxVel, true, false, true, false, false,
        x, 0, 0, vx, 0, 0, 0.9, 0.95);
}
function proper(park, id = 1, distance = 255, factor = 1000)
{
    const ball = space(park, id);
    ball.mMode = Mode.DSTBALL_WARP;
    ball.mEffectStamp = 0;
    ball.mOwnerId = BigInt(factor);
    ball.mLastCollision = distance;
    vec3.set(ball.mGoto, distance, 0, 0);
    ball.isMassive = ball.mSensor.active = false;
    return ball;
}
function events(park, callback = () => {})
{
    const log = [];
    park._pyOS = {
        PostEvent(owner, event, name, format, ...args)
        {
            log.push([event, ...args]); callback(event, args); return true;
        },
        SendEvent(owner, event, name, flags, format, ...args)
        {
            log.push([event, ...args]); callback(event, args); return true;
        },
        PyError() { throw Error("unexpected host failure"); }
    };
    return log;
}

test("native sensor record owns a non-inserting signed-int64 map", () =>
{
    // Source: destiny/src/Ball.h:31-40; destiny/src/MapOfLongLongs.h.
    const sensor = new ProximitySensor(), other = new ProximitySensor();
    assert.deepEqual([sensor.range, sensor.period, sensor.elapsed, sensor.active, sensor.onlyInteractives],
        [0, 2, 0, false, false]);
    assert.equal(sensor.balls.constructor, MapOfLongLongs);
    assert.equal(sensor.balls.get(5n), 0n); assert.equal(sensor.balls.size, 0);
    const key = 9007199254740993n;
    sensor.balls.insert(key, 7n); sensor.balls.insert(-key, 9n); sensor.balls.insert(key, 11n);
    assert.equal(sensor.balls.size, 2); assert.equal(sensor.balls.get(key), 11n);
    assert.equal(sensor.balls.get(-key), 9n); assert.equal(other.balls.size, 0);
    sensor.balls.delete(key); assert.equal(sensor.balls.get(key), 0n);
    sensor.balls.clear(); assert.equal(sensor.balls.size, 0);
});

test("ShiftFromPlanets keeps first global hit, strict radius and zero-normalization behavior", () =>
{
    // Source: destiny/src/Ballpark.cpp:4443-4462.
    const park = new Park(), sphere = space(park), second = space(park, 2, 5);
    sphere.radius = 10; second.radius = 100; second.isGlobal = true;
    const p = vec3d.fromValues(1, 0, 0);
    park.ShiftFromPlanets(p); near(p[0], -105);
    sphere.isGlobal = true; vec3.set(p, 1, 0, 0);
    park.ShiftFromPlanets(p); assert.equal(p[0], 11, "first containing global sphere wins");
    p.fill(0); park.ShiftFromPlanets(p); assert.equal(p[0], 0, "center quirk still stops traversal");
    second.isGlobal = false; vec3.set(p, 11, 0, 0);
    park.ShiftFromPlanets(p); assert.equal(p[0], 11, "exact shell stays unchanged");
});

test("WarpTo keeps native field reuse, repeated-target no-op and raw minRange bits", () =>
{
    // Source: destiny/python/destiny/test/ballpark/test_movement_controls.py:69-96.
    const park = new Park(), ball = space(park);
    park.WarpTo(ball.id, 100000, 200000, 300000, 42, 10000);
    assert.equal(ball.mode, Mode.DSTBALL_WARP);
    assert.deepEqual(Array.from(ball.mGoto), [100000, 200000, 300000]);
    assert.equal(ball.followId, 4631107791820423168n);
    assert.equal(ball.ownerId, 10000n); assert.equal(ball.effectStamp, -1);
    assert.equal(ball.followRange, 0);
    ball.mEffectStamp = -77;
    park.WarpTo(ball.id, 100000, 200000, 300000, 99, 3);
    assert.equal(ball.effectStamp, -77); assert.equal(ball.ownerId, 10000n);
    assert.equal(ball.followId, 4631107791820423168n);
    for (const [range, bits] of [[-0, -9223372036854775808n], [-5, 0n], [-Infinity, 0n]])
    {
        park.Stop(ball); park.WarpTo(ball.id, 100000, 0, 0, range, 0);
        assert.equal(ball.followId, bits); assert.equal(ball.ownerId, 1n);
    }
    const view = new DataView(new ArrayBuffer(8));
    for (const range of [NaN, Infinity])
    {
        park.Stop(ball); park.WarpTo(ball.id, 100000, 0, 0, range);
        view.setBigInt64(0, ball.followId, true);
        assert.ok(Object.is(view.getFloat64(0, true), range));
    }
    park.WarpTo(ball.id, NaN, 0, 0);
    assert.equal(ball.ownerId, 20n);
    assert.throws(() => park.WarpTo(ball.id, 100000, 0, 0, 0, 1.5), RangeError);
    park.WarpTo(999, 100000, 0, 0);
});

test("100km boundary and short-warp event order match native pointer GotoPoint", () =>
{
    const park = new Park(), ball = space(park);
    park.WarpTo(ball.id, 100000, 0, 0);
    assert.equal(ball.mode, Mode.DSTBALL_WARP);
    const log = events(park);
    park.WarpTo(ball.id, 99999, 0, 0);
    assert.equal(ball.mode, Mode.DSTBALL_GOTO);
    assert.deepEqual(log, [
        ["Destiny::OnExitWarp", ball.id, 0],
        ["Destiny::Ball::DoModeChange", Mode.DSTBALL_WARP, Mode.DSTBALL_STOP],
        ["Destiny::Ball::DoModeChange", Mode.DSTBALL_STOP, Mode.DSTBALL_GOTO],
        ["Destiny::OnExitWarp", ball.id, 1]
    ]);
});

test("alignment predicates keep strict speed, heading and tick-count thresholds", () =>
{
    const park = new Park(), ball = space(park, 1, 0, 7.5);
    park.WarpTo(ball.id, 100000, 0, 0);
    assert.ok(ball.IsWarpish()); assert.ok(ball.IsAligningForWarp()); assert.ok(!ball.IsWarping());
    assert.ok(!ball.IsAlignedForWarp(), "exact 75% speed fails strict greater-than");
    ball.vx = 7.50001; assert.ok(ball.IsAlignedForWarp());
    ball.vx = -10; assert.ok(!ball.IsAlignedForWarp());
    ball.vx = 10 * 0.98; ball.vy = 10 * Math.sqrt(1 - 0.98 ** 2);
    assert.ok(!ball.IsAlignedForWarp());
    ball.vx = 10 * 0.999; ball.vy = 10 * Math.sqrt(1 - 0.999 ** 2);
    assert.ok(ball.IsAlignedForWarp());
    ball.vx = ball.vy = 0;
    ball.mEffectStamp = -180; assert.ok(!ball.IsAlignedForWarp());
    park.EvolveWarp(ball); assert.equal(ball.effectStamp, -181); assert.ok(ball.IsAlignedForWarp());
    park.currentTime = 91; park.EvolveWarp(ball);
    assert.equal(ball.effectStamp, 91); assert.ok(ball.IsWarping()); assert.ok(!ball.IsAlignedForWarp());
    assert.deepEqual(Array.from(ball.mLastG), [0, 0, 0]);
    assert.equal(ball.isMassive, false); assert.equal(ball.mSensor.active, false);
    ball.maxVelocity = 0.1;
    assert.equal(ball.maxVelocity, Math.fround(0.1), "Ball.h:126 float storage");
});

test("RealWarp stops followers before reading destination and allows minimum-range overshoot", () =>
{
    const park = new Park(), ball = space(park), follower = space(park, 2);
    park.FollowBall(follower.id, ball.id);
    park.WarpTo(ball.id, 100000, 0, 0, 200000, 1000);
    events(park, event =>
    {
        if (event === "Destiny::Ball::DoModeChange") ball.mGoto[0] = 150000;
    });
    park.currentTime = 7; park.RealWarp(ball);
    assert.equal(follower.mode, Mode.DSTBALL_STOP);
    assert.equal(ball.gotoX, -50000); assert.equal(ball.mLastCollision, 50000);
    assert.equal(ball.effectStamp, 7); assert.equal(ball.mSensor.active, false);
    park.RealWarp(null);
});

test("activation callback sees aligning state and its mutation precedes native entry", () =>
{
    const park = new Park(), ball = space(park, 1, 0, 10);
    park.WarpTo(ball.id, 100000, 0, 0, 0, 1000);
    const log = events(park, event =>
    {
        if (event !== "Destiny::OnActivatingWarp") return;
        assert.equal(ball.effectStamp, -1); assert.ok(ball.isMassive);
        ball.mGoto[0] = 200000; ball.mLastG.fill(123);
    });
    park.EvolveWarp(ball);
    assert.equal(log[0][0], "Destiny::OnActivatingWarp");
    assert.equal(ball.mLastCollision, 200000); assert.deepEqual(Array.from(ball.mLastG), [0, 0, 0]);
});

test("short warp constants and phase samples follow the native exponential equations", () =>
{
    const park = new Park(), ball = proper(park), c = {};
    assert.equal(park.SetupWarpConstants(1000, 255, c), c);
    assert.equal(c.accelRate, 1); assert.equal(c.decelRate, 1 / 3);
    assert.equal(c.warpSpeed, 64); assert.equal(c.cruiseDuration, 0);
    assert.deepEqual([c.accelDistance, c.cruiseDistance, c.decelDistance], [64, 0, 191]);
    near(c.accelDuration, Math.log(64)); near(c.decelDuration, 3 * Math.log(192));
    const p = vec3d.create(), v = vec3d.create();
    for (const [t, distance, speed] of [[0, 1, 1], [Math.log(2), 2, 2],
        [Math.log(64), 64, 64], [Math.log(64) + 3 * Math.log(2), 160, 32]])
    {
        p.fill(0); v.fill(0);
        near(park.WarpDistance(ball, p, v, t, true), distance);
        near(p[0], distance); near(v[0], speed);
        assert.ok(ball.IsWarping());
    }
    vec3.set(ball.mGoto, 153, 204, 0); p.fill(0); vec3.set(v, 0, 3, 4);
    park.WarpDistance(ball, p, v, 0, true);
    near(p[0], 0.6); near(p[1], 0.8);
    near(v[0], 3); near(v[1], 4); assert.equal(v[2], 0);
});

test("long cruise, deceleration cap and non-clamped tiny cruise durations", () =>
{
    const park = new Park(), distance = 10 * AU - 1, ball = proper(park, 1, distance, 3000);
    const c = park.SetupWarpConstants(3000, distance, {}), p = vec3d.create(), v = vec3d.create();
    assert.equal(c.accelRate, 3); assert.equal(c.decelRate, 1); assert.equal(c.warpSpeed, 3 * AU);
    park.WarpDistance(ball, p, v, c.accelDuration + 1, true);
    near(p[0], 4 * AU, 0.001); near(v[0], 3 * AU, 0.001);
    p.fill(0); v.fill(0);
    park.WarpDistance(ball, p, v, c.accelDuration + c.cruiseDuration + Math.log(2), true);
    near(p[0], 8.5 * AU, 0.001); near(v[0], 1.5 * AU, 0.001);
    assert.ok(park.SetupWarpConstants(6000, 1023, c).cruiseDuration > 0);
    assert.ok(park.SetupWarpConstants(10000, 1023, c).cruiseDuration < 0);
    assert.equal(c.decelRate, 2);
    park.SetupWarpConstants(1000, NaN, c);
    assert.equal(c.warpSpeed, AU, "native std::min keeps its first operand when the second is NaN");
    assert.ok(Number.isNaN(c.cruiseDuration));
});

for (const master of [false, true]) test(`warp exit outputs and native event/flag order, master=${master}`, () =>
{
    const park = new Park(); park.isMaster = master;
    const ball = proper(park), p = vec3d.create(), v = vec3d.create();
    ball.maxVelocity = 128;
    const log = events(park, event =>
    {
        near(p[0], 160); near(v[0], 32);
        if (event === "Destiny::OnDeactivatingWarp")
        {
            assert.equal(ball.isMassive, false); assert.equal(ball.mSensor.active, false);
        }
        else { assert.ok(ball.isMassive); assert.ok(ball.mSensor.active); }
        assert.equal(ball.mode, Mode.DSTBALL_WARP, "mode commits after callbacks");
    });
    park.WarpDistance(ball, p, v, Math.log(64), false);
    assert.equal(log.length, 0, "speed exactly half maxVel does not exit");
    p.fill(0); v.fill(0);
    park.WarpDistance(ball, p, v, Math.log(64) + 3 * Math.log(2), false);
    assert.equal(ball.mode, Mode.DSTBALL_STOP);
    assert.deepEqual(log.map(event => event[0]), master
        ? ["Destiny::OnExitWarp", "Destiny::Ball::DoModeChange"]
        : ["Destiny::OnDeactivatingWarp", "Destiny::OnExitWarp", "Destiny::Ball::DoModeChange"]);
});

test("interpolation preserves warp beyond nominal duration; extended fallback snaps without exit", () =>
{
    const park = new Park(), ball = proper(park), c = park.SetupWarpConstants(1000, 255, {});
    const log = events(park), p = vec3d.create(), v = vec3d.create();
    park.WarpDistance(ball, p, v, c.accelDuration + c.decelDuration + 0.5, true);
    near(p[0], 255.15351827510938); near(v[0], 0.2821605749635382);
    const error = console.error, errors = [];
    console.error = (...args) => errors.push(args);
    try
    {
        assert.equal(park.WarpDistance(ball, p, v, c.accelDuration + c.decelDuration + 1, true), 0);
    }
    finally { console.error = error; }
    assert.equal(errors.length, 1); assert.deepEqual(Array.from(p), [255, 0, 0]);
    assert.deepEqual(Array.from(v), [0, 0, 0]); assert.equal(log.length, 0); assert.ok(ball.IsWarping());
});

test("EntityWarpIn uses absolute destination direction, five ticks and master-only activation", () =>
{
    // Source: destiny/python/destiny/test/ballpark/test_movement_controls.py:357-380.
    for (const master of [false, true])
    {
        const park = new Park(); park.isMaster = master; park.currentTime = 12;
        const ball = space(park, 1, 1e6), log = events(park);
        park.EntityWarpIn(ball.id, 0, 1e6, 0, 1000);
        assert.deepEqual(Array.from(ball.mNewVel), [0, AU, 0]);
        assert.equal(ball.effectStamp, 7); assert.ok(ball.IsWarping());
        assert.equal(log.filter(event => event[0] === "Destiny::OnActivatingWarp").length, master ? 1 : 0);
        park.EntityWarpIn(ball.id, 0, 0, 0, 1000);
        assert.deepEqual(Array.from(ball.mNewVel), [0, 0, 0], "zero absolute destination normalizes to zero");
        park.currentTime = 3; park.EntityWarpIn(ball.id, 0, 1e6, 0, 1000);
        assert.equal(ball.effectStamp, 0);
        park.EntityWarpIn(ball.id, ball.x + 1, ball.y, ball.z, 1000);
        assert.equal(ball.mode, Mode.DSTBALL_GOTO);
    }
});

test("donor ten-tick alignment trajectory", () =>
{
    // Source: destiny/python/destiny/test/ballpark/evolve/test_warp.py:12-42.
    const expected = [
        [1.0639340706602571, 2.1278681413205143, 3.1918022119807685],
        [2.248703156860341, 4.497406313720682, 6.746109470581021],
        [3.544408527173739, 7.088817054347478, 10.633225581521215],
        [4.941962348268478, 9.883924696536956, 14.825887044805434],
        [6.433021256625409, 12.866042513250818, 19.299063769876224],
        [8.00992537202119, 16.01985074404238, 24.029776116063566],
        [9.665642306989863, 19.331284613979726, 28.99692692096958],
        [11.393715762995505, 22.78743152599101, 34.18114728898651],
        [13.188218337575332, 26.376436675150664, 39.56465501272599],
        [15.043708197493105, 30.08741639498621, 45.13112459247932]
    ];
    const park = new Park(), ball = space(park);
    vec3.set(ball.mNewVel, 1, 2, 3);
    park.WarpTo(ball.id, 100000, 200000, 300000);
    for (const point of expected)
    {
        park.Evolve(); assert.equal(ball.mode, Mode.DSTBALL_WARP);
        for (let axis = 0; axis < 3; ++axis) near(ball.mNewPos[axis], point[axis], 1e-7);
    }
});

for (const iterative of [false, true]) test(`donor opposing balls pass through proper warp, iterative=${iterative}`, () =>
{
    // Source: destiny/python/destiny/test/ballpark/evolve/test_simple_collision.py:158-174.
    // Source: destiny/python/destiny/test/ballpark/evolve/test_iterative_collision.py:271-287.
    const config = settings.Get(); config.useIterativeCollision = iterative; settings.Apply(config);
    const park = new Park(), speed = iterative ? 10 : 1000, origin = iterative ? 40 : 4;
    const a = space(park, 1, -origin, speed, iterative ? 13e6 : 1, speed);
    const b = space(park, 2, origin, -speed, iterative ? 13e6 : 1, speed);
    if (iterative)
    {
        park.WarpTo(a.id, 1e7, 0, 0, 0, 1000); park.WarpTo(b.id, -1e7, 0, 0, 0, 1000);
    }
    else { park.WarpTo(a.id, 100000, 0, 0); park.WarpTo(b.id, -100000, 0, 0); }
    for (let i = 0; i < 80; ++i) park.Evolve();
    assert.ok(a.x > b.x);
    assert.deepEqual([a.y, a.z, b.y, b.z], [0, 0, 0, 0]);
});
