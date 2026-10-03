import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { CjsBallparkController, CollisionBallProperties, CollisionItem, CollisionImpact,
    BallLocation, settings } from "@carbonenginejs/server";
import { vec3 } from "@carbonenginejs/runtime/math/vec3";
import { quat } from "@carbonenginejs/runtime/math/quat";
import { vec3d } from "../dist/destiny/math/vec3d.js";

afterEach(() => settings.Reset());

function dynamic(value = true)
{
    const config = settings.Get();
    config.useDynamicalOrientation = value;
    settings.Apply(config);
}

function park()
{
    const value = new CjsBallparkController();
    value.isMaster = true;
    value.mFriction = 1;
    return value;
}

function add(owner, id = 1, mass = 1, radius = 2)
{
    return owner.AddBall(id, mass, radius, 10, true, false, false, false, false,
        0, 0, 0, 0, 0, 0, 1, 1);
}

function sampled(ball, p = [0, 0, 0], v = [0, 0, 0], omega = [0, 0, 0], rotation = [0, 0, 0, 1])
{
    // Isolate impulse formulas from already-tested trajectory integration.
    return {
        m_ball: ball, m_tStart: -1,
        CalculatePosition(position, velocity) { vec3.copy(position, p); vec3.copy(velocity, v); },
        CalculateRotation(out, angular) { quat.copy(out, rotation); vec3.copy(angular, omega); }
    };
}

function candidate(collider, normal = [1, 0, 0], time = 0.25, free = false)
{
    const value = new CollisionItem();
    value.collider = collider;
    value.timeOfImpact = time;
    value.mbIndex2 = free ? -1 : -2;
    vec3.copy(value.normal, normal);
    return value;
}

function impact(time, collider, vx = 0, wx = 0)
{
    const value = new CollisionImpact();
    value.timeOfImpact = time;
    value.collider = BigInt(collider);
    value.velocityChange[0] = vx;
    value.angularVelocityChange[0] = wx;
    return value;
}

function near(actual, expected, tolerance = 2e-6)
{
    for (let i = 0; i < expected.length; ++i)
        assert.ok(Math.abs(actual[i] - expected[i]) <= tolerance, `${i}: ${actual[i]} != ${expected[i]}`);
}

test("ellipse contacts preserve legacy radius scaling and dynamic branch omissions", () =>
{
    // Source: destiny/src/Ballpark.cpp:2323-2367.
    const owner = park(), ball = add(owner), location = new BallLocation(), out = vec3d.create();
    const collision = candidate(ball, [0, 0, 1]);
    owner.ApproximateEllipsePointOfImpact(ball, location, collision, out);
    near(out, [0, 0, -2], 0);
    dynamic();
    for (const normal of [[0, 0, 1], [0, 0, -1], [1, 0, 0], [0, 0, 2]])
    {
        vec3.copy(collision.normal, normal);
        owner.ApproximateEllipsePointOfImpact(ball, location, collision, out);
        near(out, normal.map(value => -value), 0);
    }
    vec3.set(collision.normal, 0.6, 0, 0.8);
    owner.ApproximateEllipsePointOfImpact(ball, location, collision, out);
    near(out, [-0.5402073873040285, 0, -1.460793786580369]);
    const expected = Array.from(out);
    owner.ApproximateEllipsePointOfImpact(ball, location, collision, collision.normal);
    near(collision.normal, expected, 0);
});

test("ellipse Rodrigues path keeps the native zero-axis nonunit-quaternion matrix", () =>
{
    // Source: destiny/src/Ballpark.cpp:2333-2360; math/include/Matrix_inline.h:388-412.
    dynamic();
    const owner = park(), ball = add(owner), location = new BallLocation();
    quat.set(location.rot, 0.5, 0, 0, 0);
    const collision = candidate(ball, [0, 0, 1]);
    owner.ApproximateEllipsePointOfImpact(ball, location, collision, CjsBallparkController.scratch.vec3_16);
    near(CjsBallparkController.scratch.vec3_16, [0, 0, -1.4022426933363854]);
    assert.ok(Math.abs(CjsBallparkController.scratch.vec3_16[2] + 1.455650685748102) > 0.05);
});

test("static elastic impulse reflects only inward velocity and is calculated once", () =>
{
    // Source: destiny/src/Ballpark.cpp:2370-2440.
    const owner = park(), ball = add(owner), wall = { mId: 90n };
    const history = sampled(ball, [0, 0, 0], [-3, 2, 0]);
    const collision = candidate(wall);
    owner.CalculateCollisionImpactStatic(history, collision);
    near(collision.impact.velocityChange, [6, 0, 0], 0);
    near(collision.impact.angularVelocityChange, [0, 0, 0], 0);
    assert.equal(collision.impact.collider, 90n);
    assert.equal(collision.impact.timeOfImpact, 0.25);
    const saved = collision.impact;
    history.CalculatePosition = () => { throw new Error("must not recompute"); };
    owner.CalculateCollisionImpactStatic(history, collision);
    assert.equal(collision.impact, saved);
    const free = candidate(wall, [1, 0, 0], 0.25, true);
    owner.CalculateCollisionImpactStatic(history, free);
    assert.equal(free.impact, null);
});

test("separating and zero-impulse static contacts retain distinct native collider IDs", () =>
{
    // Source: destiny/src/Ballpark.cpp:2415-2419,2438.
    const owner = park(), ball = add(owner), wall = { mId: 90n };
    const leaving = candidate(wall), still = candidate(wall);
    owner.CalculateCollisionImpactStatic(sampled(ball, [0, 0, 0], [3, 0, 0]), leaving);
    assert.equal(leaving.impact.collider, 0n);
    near(leaving.impact.velocityChange, [0, 0, 0], 0);
    owner.CalculateCollisionImpactStatic(sampled(ball), still);
    assert.equal(still.impact.collider, 90n, "zero is accepted; only negative impulse returns early");
});

test("static overlap acceleration is updated at search start before position sampling", () =>
{
    // Source: destiny/src/Ballpark.cpp:2380-2390.
    const owner = park(), ball = add(owner, 1, 2), history = sampled(ball);
    vec3.set(ball.mLastG, 1, 0, 0);
    history.m_tStart = 0.25;
    const sample = history.CalculatePosition;
    history.CalculatePosition = (p, v) =>
    {
        near(ball.mLastC, [4, 0, 0], 0);
        sample(p, v);
    };
    owner.CalculateCollisionImpactStatic(history, candidate({ mId: 90n }));
});

test("dynamic static impulse matches independently derived oblique contact and inertia", () =>
{
    // Source: destiny/src/Ballpark.cpp:2395-2438. Analytic Rodrigues/inertia fixture.
    dynamic();
    const owner = park(), ball = add(owner), collision = candidate({ mId: 90n }, [0.6, 0, 0.8]);
    owner.CalculateCollisionImpactStatic(sampled(ball, [0, 0, 0], [-1.8, 0, -2.4], [0, 1, 0]), collision);
    near(collision.impact.velocityChange, [3.7618553123432315, 0, 5.015807083124309]);
    near(collision.impact.angularVelocityChange, [0, -1.3928593397140503, 0]);
});

test("free elastic impulses respect unequal masses, reciprocal normals and native candidate pointer", () =>
{
    // Source: destiny/src/Ballpark.cpp:2442-2574.
    const owner = park(), a = add(owner, 1, 3), b = add(owner, 2, 5);
    const collision = candidate(b, [9, 9, 9], 0.25, true);
    collision.mbIndex1 = 7;
    collision.mbIndex2 = 9;
    const other = owner.CalculateCollisionImpactFree(sampled(a, [2, 0, 0], [-3, 0, 0]),
        sampled(b, [0, 0, 0], [1, 0, 0]), collision);
    near(collision.normal, [1, 0, 0], 0);
    near(other.normal, [-1, 0, 0], 0);
    near(collision.impact.velocityChange, [5, 0, 0], 0);
    near(other.impact.velocityChange, [-3, 0, 0], 0);
    assert.equal(collision.impact.collider, b.id);
    assert.equal(other.impact.collider, a.id);
    assert.equal(other.collider, b, "native candidate pointer is copied, not swapped");
    assert.equal(other.mbIndex1, 9);
    assert.equal(other.mbIndex2, 7);
    assert.notEqual(collision.impact.velocityChange, other.impact.velocityChange);
    const rejected = owner.CalculateCollisionImpactFree(null, null, collision);
    assert.equal(rejected.timeOfImpact, -1);
    assert.equal(rejected.impact, null);
    assert.equal(owner.CalculateCollisionImpactFree(null, null, candidate(b)).impact, null);
});

test("separating free collisions return owned zero impacts with native collider zero", () =>
{
    // Source: destiny/src/Ballpark.cpp:2525-2528.
    const owner = park(), a = add(owner), b = add(owner, 2);
    const collision = candidate(b, [0, 0, 0], 0.25, true);
    const other = owner.CalculateCollisionImpactFree(sampled(a, [2, 0, 0], [1, 0, 0]), sampled(b), collision);
    assert.equal(collision.impact.collider, 0n);
    assert.equal(other.impact.collider, 0n);
    assert.notEqual(other.impact, collision.impact);
    near(other.impact.velocityChange, [0, 0, 0], 0);
});

test("coincident free centers use positive Z and zero-time overlap updates both accelerations", () =>
{
    // Source: destiny/src/Ballpark.cpp:2480-2508.
    const owner = park(), a = add(owner), b = add(owner, 2, 2);
    vec3.set(a.mLastG, 0, 0, 1);
    vec3.set(b.mLastG, 0, 0, -2);
    const collision = candidate(b, [9, 9, 9], 0, true);
    const other = owner.CalculateCollisionImpactFree(sampled(a, [0, 0, 0], [0, 0, -3]),
        sampled(b, [0, 0, 0], [0, 0, 1]), collision);
    near(collision.normal, [0, 0, 1], 0);
    near(a.mLastC, [0, 0, 9], 0);
    near(b.mLastC, [0, 0, -3], 0);
    near(other.normal, [0, 0, -1], 0);
    assert.equal(other.impact.collider, a.id);
});

test("dynamic free impulses match independent two-body rotational-contact expectations", () =>
{
    // Source: destiny/src/Ballpark.cpp:2511-2570.
    dynamic();
    const owner = park(), a = add(owner, 1, 3, 2), b = add(owner, 2, 5, 3);
    const collision = candidate(b, [0, 0, 0], 0.25, true);
    const other = owner.CalculateCollisionImpactFree(sampled(a, [3, 0, 4], [-1.8, 0, -2.4], [0, 1, 0]),
        sampled(b, [0, 0, 0], [0.6, 0, 0.8], [0, -0.5, 0]), collision);
    near(collision.impact.velocityChange, [2.8063090386092906, 0, 3.741745384812388]);
    near(other.impact.velocityChange, [-1.6837854231655747, 0, -2.2450472308874327]);
    near(collision.impact.angularVelocityChange, [0, -1.039060115814209, 0]);
    near(other.impact.angularVelocityChange, [0, -0.41562408208847046, 0]);
});

test("impact caps retain squared-ratio scaling and native float numerator rounding", () =>
{
    // Source: destiny/src/Ballpark.cpp:2597-2615.
    dynamic();
    const owner = park(), ball = add(owner);
    const history = new CollisionBallProperties();
    history.Initialize(ball, 1);
    owner.mCollisionLocations.set(ball.id, history);
    const value = impact(0.25, 90, 100, 10);
    owner.AddImpact(value, 0, ball);
    near(value.velocityChange, [25, 0, 0], 0);
    near(value.angularVelocityChange, [0.3999999761581421, 0, 0], 0);
    assert.notEqual(value.velocityChange, history.m_locations[1].v);
    history.Initialize(ball, 1);
    ball.mMaxVel = ball.mMaxAngVel = Math.fround(1 / 3);
    const rounded = impact(0.25, 90, 1, 1);
    owner.AddImpact(rounded, 0, ball);
    // Linear fraction>1: use a larger input to exercise the narrowed numerator.
    assert.equal(rounded.angularVelocityChange[0], 0.444444477558136);
    history.Initialize(ball, 1);
    rounded.velocityChange[0] = 10;
    owner.AddImpact(rounded, 0, ball);
    assert.equal(rounded.velocityChange[0], 10 * (2.777778148651123 / 100));
});

test("late impulses are unchanged, disabled angular caps are skipped and zero changes stay finite", () =>
{
    const owner = park(), ball = add(owner), history = new CollisionBallProperties();
    history.Initialize(ball, 1);
    owner.mCollisionLocations.set(ball.id, history);
    const late = impact(1, 90, 100, 100);
    owner.AddImpact(late, 0, ball);
    assert.equal(late.velocityChange[0], 100);
    assert.equal(late.angularVelocityChange[0], 100);
    const value = impact(0.25, 90, 0, 100);
    owner.AddImpact(value, 0, ball);
    assert.equal(value.angularVelocityChange[0], 100);
    assert.ok(value.velocityChange.every(Number.isFinite));
});

test("recursive invalidation follows native depth-first order including repeated visits", () =>
{
    // Source: destiny/src/Ballpark.cpp:2618-2672; actual history graph, not stubs.
    const owner = park();
    const balls = [1, 2, 3, 4].map(id => add(owner, id));
    const histories = balls.map(ball =>
    {
        const history = new CollisionBallProperties();
        history.Initialize(ball, 1);
        owner.mCollisionLocations.set(ball.id, history);
        return history;
    });
    for (const [index, contacts] of [[0, [[0.6, 4], [0.8, 2]]], [1, [[0.8, 1], [0.9, 3]]],
        [2, [[0.9, 2], [0.95, 4]]], [3, [[0.6, 1], [0.95, 3]]]])
    {
        for (const [time, id] of contacts)
        {
            histories[index].AddImpact(impact(time, id));
            histories[index].CalculateEnd();
        }
    }
    const calls = [], original = owner.RemoveImpactFromFree;
    owner.RemoveImpactFromFree = function(time, collider, ball)
    {
        calls.push([time, collider, ball.id]);
        return original.call(this, time, collider, ball);
    };
    owner.AddImpact(impact(0.4, 99), 0, balls[0]);
    assert.deepEqual(calls, [[0.8, 1n, 2n], [0.9, 2n, 3n], [0.95, 3n, 4n], [0.6, 1n, 4n]]);
    assert.deepEqual(histories[0].m_locations.map(value => value.time), [0, 0.4]);
    for (const history of histories.slice(1))
        assert.deepEqual(history.m_locations.map(value => value.collider), [-1n, -1n]);
});

test("native missing-history diagnostics and initial-negative ordering warning are retained", () =>
{
    const owner = park(), ball = add(owner), errors = [], warnings = [];
    const error = console.error, warn = console.warn;
    console.error = (...values) => errors.push(values);
    console.warn = (...values) => warnings.push(values);
    try
    {
        owner.AddImpact(impact(0.25, 99), 0, ball);
        owner.RemoveImpactFromFree(0.25, 99, ball);
        owner.RemoveImpactFromFree(0.25, 99, null);
        ball.isFree = false;
        owner.RemoveImpactFromFree(0.25, 99, ball);
        assert.equal(errors.length, 2);
        ball.isFree = true;
        const history = new CollisionBallProperties();
        history.Initialize(ball, 1);
        owner.mCollisionLocations.set(ball.id, history);
        owner.AddImpact(impact(-0.1, 99), 0, ball);
        assert.equal(warnings.length, 1);
    }
    finally { console.error = error; console.warn = warn; }
});

test("collision frames survive sampling reentry, reset angular defaults and return on throws", () =>
{
    dynamic();
    const owner = park(), a = add(owner), b = add(owner, 2), wall = { mId: 90n };
    const first = sampled(a, [0, 0, 0], [-3, 0, 0], [0, 1, 0]);
    const normalSample = first.CalculatePosition;
    let nested;
    first.CalculatePosition = (p, v) =>
    {
        normalSample(p, v);
        const inner = candidate(b, [1, 0, 0], 0.25, true);
        nested = owner.CalculateCollisionImpactFree(sampled(a, [2, 0, 0], [-3, 0, 0]), sampled(b), inner);
    };
    const collision = candidate(wall);
    owner.CalculateCollisionImpactStatic(first, collision);
    near(collision.impact.velocityChange, [6, 0, 0]);
    assert.equal(nested.impact.collider, a.id);
    const poolSize = CjsBallparkController.collisionFrames.length;
    assert.ok(poolSize >= 2);
    dynamic(false);
    const clean = candidate(wall);
    owner.CalculateCollisionImpactStatic(sampled(a, [0, 0, 0], [-3, 0, 0]), clean);
    near(clean.impact.velocityChange, [6, 0, 0], 0);
    const broken = sampled(a);
    broken.CalculatePosition = () => { throw new Error("sampling failure"); };
    assert.throws(() => owner.CalculateCollisionImpactStatic(broken, candidate(wall)), /sampling failure/);
    assert.equal(CjsBallparkController.collisionFrames.length, poolSize);
    assert.throws(() => owner.CalculateCollisionImpactFree(broken, sampled(b), candidate(b, [1, 0, 0], 0.25, true)), /sampling failure/);
    assert.equal(CjsBallparkController.collisionFrames.length, poolSize);
});


test("native float quaternion matrix rounding selects the exact-zero contact branch", () =>
{
    // Source: math/include/Matrix_inline.h:365-385; destiny/src/Ballpark.cpp:2335-2340.
    dynamic();
    const owner = park(), ball = add(owner, 1, 1, 10), location = new BallLocation();
    quat.set(location.rot, 0.3, 0.6403124332427979, 0, Math.SQRT1_2);
    const collision = candidate(ball, [0, 0, 1]), out = vec3d.create();
    owner.ApproximateEllipsePointOfImpact(ball, location, collision, out);
    near(out, [0, 0, -1], 0);
    // A double-intermediate matrix gives a nonzero z and wrongly scales to ~-7.
    const doubleZ = Math.fround(1 - 2 * (location.rot[0] ** 2 + location.rot[1] ** 2));
    assert.notEqual(doubleZ, 0);
});

test("native singular radius and mass responses remain nonfinite instead of using an epsilon", () =>
{
    // Source: destiny/src/Ballpark.cpp:2430-2433,2553-2569.
    dynamic();
    const owner = park(), a = add(owner, 1, 1, 0), b = add(owner, 2);
    const collision = candidate({ mId: 90n });
    owner.CalculateCollisionImpactStatic(sampled(a, [0, 0, 0], [-3, 0, 0]), collision);
    assert.ok(collision.impact.velocityChange.every(Number.isNaN));
    assert.ok(collision.impact.angularVelocityChange.every(Number.isNaN));
    dynamic(false);
    a.mMass = 0;
    const free = candidate(b, [1, 0, 0], 0.25, true);
    const other = owner.CalculateCollisionImpactFree(sampled(a, [2, 0, 0], [-3, 0, 0]), sampled(b), free);
    assert.ok(free.impact.velocityChange.every(Number.isNaN));
    near(other.impact.velocityChange, [0, 0, 0], 0);
});

test("free overlap acceleration happens after sampling and only at absolute time zero", () =>
{
    // Source: destiny/src/Ballpark.cpp:2468-2475,2494-2508.
    const owner = park(), a = add(owner), b = add(owner, 2);
    const first = sampled(a, [2, 0, 0], [-3, 0, 0]), second = sampled(b);
    const readFirst = first.CalculatePosition, readSecond = second.CalculatePosition;
    first.CalculatePosition = (p, v) => { assert.equal(a.mLastC[0], 0); assert.equal(b.mLastC[0], 0); readFirst(p, v); };
    second.CalculatePosition = (p, v) => { assert.equal(a.mLastC[0], 0); assert.equal(b.mLastC[0], 0); readSecond(p, v); };
    owner.CalculateCollisionImpactFree(first, second, candidate(b, [1, 0, 0], 0, true));
    near(a.mLastC, [10, 0, 0], 0);
    near(b.mLastC, [-10, 0, 0], 0);
    vec3.zero(a.mLastC); vec3.zero(b.mLastC);
    first.m_tStart = second.m_tStart = 0.25;
    owner.CalculateCollisionImpactFree(first, second, candidate(b, [1, 0, 0], 0.25, true));
    near(a.mLastC, [0, 0, 0], 0);
    near(b.mLastC, [0, 0, 0], 0);
});
