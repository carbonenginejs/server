import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { BallLocation, CollisionImpact, CollisionItem, CollisionBallProperties,
    CjsBallparkController, settings } from "@carbonenginejs/server";
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

function fixture(dt = 1)
{
    const park = new CjsBallparkController();
    park.isMaster = true;
    park.dt = dt;
    park.mFriction = 1;
    const ball = park.AddBall(1, 1, 1, 10, true, false, false, false, false,
        10, 0, 0, 2, 0, 0, 1, 1);
    ball.mRotAgility = 1;
    vec3.set(ball.mLastG, 1.25, 0, 0);
    vec3.set(ball.mLastC, 0.75, 0, 0);
    const history = new CollisionBallProperties();
    history.Initialize(ball, dt);
    return { park, ball, history };
}

function impact(time, id, velocity = 0)
{
    const result = new CollisionImpact();
    result.timeOfImpact = time;
    result.collider = BigInt(id);
    result.velocityChange[0] = velocity;
    return result;
}

function chain()
{
    const result = fixture();
    for (const [time, id, velocity] of [[0.25, 11, 3], [0.5, 22, -1], [0.75, 33, 2]])
    {
        result.history.AddImpact(impact(time, id, velocity));
        result.history.CalculateEnd();
    }
    return result;
}

function near(actual, expected, tolerance = 2e-12)
{
    assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
}

test("collision structures preserve native defaults and independent value ownership", () =>
{
    // Source: destiny/src/CollisionStructures.h:11-48; CollisionStructures.cpp:6-19.
    const a = new CollisionImpact(), b = new CollisionImpact();
    assert.equal(a.timeOfImpact, 0);
    assert.equal(a.collider, 0n, "value-initialized impact collider is not the -1 sentinel");
    assert.ok(a.velocityChange instanceof Float64Array);
    assert.ok(a.angularVelocityChange instanceof Float32Array);
    a.velocityChange[0] = 1e10 + 0.001;
    assert.equal(a.velocityChange[0], 1e10 + 0.001);
    assert.equal(b.velocityChange[0], 0);
    const item = new CollisionItem();
    assert.equal(item.timeOfImpact, -1);
    assert.equal(item.collider, null);
    assert.equal(item.impact, null);
    assert.equal(item.mbIndex1, -2);
    assert.equal(item.mbIndex2, -2);
    assert.ok(item.normal instanceof Float64Array);
    const location = new BallLocation();
    assert.equal(location.time, -1);
    assert.equal(location.collider, -1n);
    assert.deepEqual(Array.from(location.rot), [0, 0, 0, 1]);
    assert.deepEqual(Array.from(location.omega), [0, 0, 0]);
    assert.notEqual(location.p, location.v);
    const history = new CollisionBallProperties();
    assert.equal(history.m_fuzzyDelta, 1e-4);
    assert.equal(history.m_tau, -1);
    assert.equal(history.m_ball, null);
    assert.equal(history.m_maxTime, undefined);
    assert.equal(history.m_tStart, undefined);
    assert.equal(history.m_tEnd, undefined);
    assert.equal(history.FindLocationsIndex(1), 0);
});

test("Initialize snapshots both endpoints and uses total force without changing the Ball", () =>
{
    // Source: destiny/src/CollisionBallProperties.cpp:15-52.
    const { history, ball } = fixture();
    const [first, last] = history.m_locations;
    assert.deepEqual(history.m_locations.map(value => value.time), [0, 1]);
    assert.deepEqual(history.m_locations.map(value => value.collider), [-1n, -1n]);
    assert.equal(first.p[0], 10);
    near(last.p[0], 12);
    near(last.v[0], 2);
    assert.equal(ball.mNewPos[0], 10);
    assert.equal(ball.mNewVel[0], 2);
    assert.notEqual(first.p, last.p);
    assert.notEqual(first.p, ball.mNewPos);
    assert.notEqual(first.v, last.v);
    assert.notEqual(first.rot, last.rot);
    assert.equal(history.m_tStart, 0);
    assert.equal(history.m_tEnd, 1);
});

test("impact insertion and endpoint integration match analytic drag and no-op endpoint guards", () =>
{
    // Source: destiny/src/CollisionBallProperties.cpp:55-117,168-195.
    const { history, ball, park } = fixture();
    assert.deepEqual(history.AddImpact(impact(0.25, 11, 3)), []);
    assert.deepEqual(history.m_locations.map(value => value.time), [0, 0.25]);
    assert.equal(history.m_locations[1].p[0], 10.5);
    assert.equal(history.m_locations[1].v[0], 5);
    assert.equal(history.m_tStart, 0);
    assert.equal(history.m_tEnd, 0.25);
    assert.deepEqual(history.AddImpact(impact(0.25, 12, 100)), []);
    assert.deepEqual(history.AddImpact(impact(2, 12, 100)), []);
    history.CalculateEnd();
    const last = history.m_locations[2];
    near(last.p[0], 12 + 3 * (1 - Math.exp(-0.75)));
    near(last.v[0], 2 + 3 * Math.exp(-0.75));
    assert.equal(last.collider, -1n);
    assert.equal(history.m_tStart, 0.25);
    assert.equal(history.m_tEnd, 1);
    ball.mLastG[0] = 100;
    park.Integrate = () => { throw new Error("should not integrate existing endpoint"); };
    history.CalculateEnd();
    assert.equal(history.m_locations.length, 3);
});

test("zero, equal and negative-time impacts retain the native distinct insertion branches", () =>
{
    // Source: destiny/src/CollisionBallProperties.cpp:61-110.
    const zero = fixture().history;
    zero.AddImpact(impact(0, 11, 3));
    assert.deepEqual(zero.m_locations.map(value => value.time), [0, 0]);
    assert.equal(zero.m_locations[0].v[0], 2);
    assert.equal(zero.m_locations[1].v[0], 5);
    zero.CalculateEnd();
    near(zero.m_locations[2].p[0], 12 + 3 * (1 - Math.exp(-1)));
    zero.AddImpact(impact(0, 22, 1));
    assert.deepEqual(zero.m_locations.map(value => value.time), [0, 0, 0]);
    assert.equal(zero.m_locations[2].v[0], 6);
    const negative = fixture().history;
    negative.AddImpact(impact(-0.25, 11, 3));
    assert.equal(negative.m_locations.length, 1);
    assert.equal(negative.m_locations[0].p[0], 10);
    assert.equal(negative.m_locations[0].v[0], 5);
    negative.CalculateEnd();
    near(negative.m_locations[1].p[0], 12.5 + 3 * (1 - Math.exp(-1.25)));
    near(negative.m_locations[1].v[0], 2 + 3 * Math.exp(-1.25));
});

test("earlier insertion invalidates newest first and retains stale search start until CalculateEnd", () =>
{
    // Source: destiny/src/CollisionBallProperties.cpp:65-79,114-116.
    const { history } = chain();
    const invalidated = history.AddImpact(impact(0.375, 44));
    assert.deepEqual(invalidated, [[0.75, 33n], [0.5, 22n]]);
    assert.deepEqual(history.m_locations.map(value => value.time), [0, 0.25, 0.375]);
    near(history.m_locations[2].p[0], 11.102509292246214);
    near(history.m_locations[2].v[0], 4.647490707753787);
    assert.equal(history.m_tStart, 0.75);
    assert.equal(history.m_tEnd, 0.375);
    history.CalculateEnd();
    assert.equal(history.m_tStart, 0.375);
    assert.equal(history.m_tEnd, 1);
    history.RemoveImpact(0.25, 11n);
    assert.deepEqual(invalidated, [[0.75, 33n], [0.5, 22n]], "returned invalidations remain caller-owned");
});

test("removal invalidates oldest first and rebuilds from the prior segment", () =>
{
    // Source: destiny/src/CollisionBallProperties.cpp:120-165.
    const first = chain().history;
    assert.deepEqual(first.RemoveImpact(0.25, 11), [[0.5, 22n], [0.75, 33n]]);
    assert.deepEqual(first.m_locations.map(value => value.time), [0, 1]);
    near(first.m_locations[1].p[0], 12);
    near(first.m_locations[1].v[0], 2);
    const middle = chain().history;
    assert.deepEqual(middle.RemoveImpact(0.5, 22n), [[0.75, 33n]]);
    near(middle.m_locations[2].p[0], 12 + 3 * (1 - Math.exp(-0.75)));
});

test("native missing-removal bug resets index zero using current velocity while retaining pose and time", () =>
{
    // Source: destiny/src/CollisionBallProperties.cpp:126-163 (found=true).
    dynamic();
    const { history, ball } = chain();
    const first = history.m_locations[0];
    first.rot[0] = 0.25;
    ball.mNewVel[0] = 4;
    ball.mNewAngVel[2] = 0.5;
    assert.deepEqual(history.RemoveImpact(0.5, 999n), [[0.25, 11n], [0.5, 22n], [0.75, 33n]]);
    assert.equal(history.m_locations[0], first);
    assert.equal(first.p[0], 10);
    assert.equal(first.time, 0);
    assert.equal(first.rot[0], 0.25);
    assert.equal(first.omega[2], 0.5);
    assert.equal(first.v[0], 4);
    near(history.m_locations[1].p[0], 12 + 2 * (1 - Math.exp(-1)));
    near(history.m_locations[1].v[0], 2 + 2 * Math.exp(-1));
});

test("RemoveImpact fuzzy comparison is strict and selects the first matching collision", () =>
{
    // Source: destiny/src/CollisionBallProperties.cpp:128-136.
    const { history } = fixture();
    history.AddImpact(impact(0, 11));
    history.CalculateEnd();
    history.AddImpact(impact(0, 11));
    history.CalculateEnd();
    assert.deepEqual(history.RemoveImpact(0, 11n), [[0, 11n]], "second equal-time collision is invalidated");
    const other = fixture().history;
    other.AddImpact(impact(0, 11));
    other.CalculateEnd();
    assert.deepEqual(other.RemoveImpact(other.m_fuzzyDelta, 11n), [[0, 11n]], "boundary misses, so native index-zero reset applies");
});

test("sampling retains pre-impact velocity at fuzzy boundaries and permits extrapolation", () =>
{
    // Source: destiny/src/CollisionBallProperties.cpp:216-244.
    const { history } = fixture();
    history.AddImpact(impact(0.25, 11, 3));
    history.CalculateEnd();
    const f = history.m_fuzzyDelta, p = vec3d.create(), v = vec3d.create();
    assert.equal(history.FindLocationsIndex(0.25), 0);
    assert.equal(history.FindLocationsIndex(0.25 + f), 0);
    assert.equal(history.FindLocationsIndex(0.25 + f + 1e-12), 1);
    history.CalculatePosition(p, v, 0.25);
    near(p[0], 10.5);
    near(v[0], 2);
    history.CalculatePosition(p, v, 0.2502);
    near(p[0], 10.500999940003998);
    near(v[0], 4.999400059996001);
    for (const time of [f, -f, -1])
    {
        history.CalculatePosition(p, v, time);
        near(p[0], 10 + 2 * time);
    }
    history.CalculatePosition(p, v, 2);
    near(p[0], 14 + 3 * (1 - Math.exp(-1.75)));
    history.CalculatePosition(p, v, NaN);
    assert.equal(p[0], 10);
    assert.equal(v[0], 2);
});

test("IgnoreCollision uses relative TOI, skips the tail and includes its lower time boundary", () =>
{
    // Source: destiny/src/CollisionBallProperties.cpp:198-213.
    const { history } = fixture();
    const f = history.m_fuzzyDelta;
    assert.equal(history.IgnoreCollision(11, 0), false);
    history.AddImpact(impact(0.25, 11));
    assert.equal(history.IgnoreCollision(11, 0), false);
    history.CalculateEnd();
    assert.equal(history.IgnoreCollision(11, 0), true);
    for (const [time, id] of [[0.5 - f, 22], [0.5, 33]])
    {
        history.AddImpact(impact(time, id));
        history.CalculateEnd();
    }
    assert.equal(history.IgnoreCollision(11, 0), false);
    assert.equal(history.IgnoreCollision(22, f), true);
    assert.equal(history.IgnoreCollision(33, f), true);
    assert.equal(history.IgnoreCollision(33, f + 1e-12), false);
    assert.equal(history.IgnoreCollision(33, -100), true);
    assert.equal(history.IgnoreCollision(33, NaN), true);
});

test("dynamic-off initialization preserves live angular slots but reconstructs regrown slots", () =>
{
    // Source: destiny/src/CollisionBallProperties.cpp:22-28,43-51; native vector resize.
    dynamic();
    const { history, ball } = fixture();
    const [first, last] = history.m_locations;
    quat.set(first.rot, 1, 2, 3, 4);
    vec3.set(first.omega, 5, 6, 7);
    quat.set(last.rot, 8, 9, 10, 11);
    vec3.set(last.omega, 12, 13, 14);
    const tau = history.m_tau;
    dynamic(false);
    ball.mMass = 123;
    history.Initialize(ball, 1);
    assert.equal(history.m_locations[0], first);
    assert.equal(history.m_locations[1], last);
    assert.deepEqual(Array.from(last.rot), [8, 9, 10, 11]);
    assert.equal(history.m_tau, tau);
    history.AddImpact(impact(-1, 11));
    history.Initialize(ball, 1);
    assert.equal(history.m_locations[1], last, "reuse whole record and owned math storage");
    assert.deepEqual(Array.from(first.rot), [1, 2, 3, 4]);
    assert.deepEqual(Array.from(first.omega), [5, 6, 7]);
    assert.deepEqual(Array.from(last.rot), [0, 0, 0, 1]);
    assert.deepEqual(Array.from(last.omega), [0, 0, 0]);
});

test("angular record integration retains the native seconds-as-fraction quirk for nonunit ticks", () =>
{
    // Source: destiny/src/CollisionBallProperties.cpp:51,108,188,257; Ballpark.cpp:1936-1942.
    dynamic();
    const { history, ball } = fixture(2);
    ball.mNewAngVel[2] = 1;
    history.Initialize(ball, 2);
    const end = history.m_locations[1], decay = Math.exp(-4), angle = 1 - decay;
    near(end.p[0], 14);
    near(end.omega[2], decay, 1e-7);
    near(end.rot[2], Math.sin(angle / 2), 2e-7);
    near(end.rot[3], Math.cos(angle / 2), 2e-7);
    const rotation = quat.create(), omega = vec3.create(), f = history.m_fuzzyDelta;
    for (const time of [f, -f, NaN])
    {
        history.CalculateRotation(rotation, omega, time);
        assert.deepEqual(Array.from(rotation), [0, 0, 0, 1]);
        assert.deepEqual(Array.from(omega), [0, 0, 1]);
    }
    history.CalculateRotation(rotation, omega, 0.5);
    near(omega[2], Math.exp(-1), 1e-7);
});

test("angular impacts add impulses after integration and reset only removed velocity state", () =>
{
    // Source: destiny/src/CollisionBallProperties.cpp:87-110,143-152.
    dynamic();
    const { history, ball } = fixture();
    ball.mNewAngVel[2] = 1;
    history.Initialize(ball, 1);
    const value = impact(0.25, 11);
    value.angularVelocityChange[2] = 2;
    history.AddImpact(value);
    near(history.m_locations[1].omega[2], Math.exp(-0.25) + 2, 2e-7);
    history.CalculateEnd();
    history.RemoveImpact(0.25, 11);
    near(history.m_locations[1].omega[2], Math.exp(-1), 1e-7);
    const negative = impact(-0.1, 22);
    negative.angularVelocityChange[2] = 2;
    history.AddImpact(negative);
    assert.equal(history.m_locations[0].omega[2], 3);
    assert.deepEqual(history.m_locations[0].rot, ball.mNewRot);
});

test("record sampling is directly usable by both Ballpark interpolation dispatchers", () =>
{
    // Source: destiny/src/Ballpark.cpp:2685-2741.
    dynamic();
    const { park, ball, history } = fixture();
    ball.mNewAngVel[2] = 1;
    history.Initialize(ball, 1);
    history.AddImpact(impact(0.25, 11, 3));
    history.CalculateEnd();
    park.mCollisionLocations.set(ball.id, history);
    const p = vec3d.create(), v = vec3d.create(), rotation = quat.create(), omega = vec3.create();
    park.CalculateBallPositionVelocity(ball, 0.5, p, v);
    near(p[0], 11 + 3 * (1 - Math.exp(-0.25)));
    near(v[0], 2 + 3 * Math.exp(-0.25));
    park.CalculateBallRotationVelocity(ball, 0.5, rotation, omega);
    near(omega[2], Math.exp(-0.5), 2e-7);
});

test("sampling handles aliased history outputs and reentry without borrowing live force storage", () =>
{
    const { history, park } = fixture();
    const other = fixture().history;
    other.m_ball.mPark = park;
    const original = park.Integrate;
    const nestedP = vec3d.create(), nestedV = vec3d.create();
    let inside = false;
    park.Integrate = function(p, v, force, ...rest)
    {
        if (!inside)
        {
            inside = true;
            other.CalculatePosition(nestedP, nestedV, 0.6);
            inside = false;
            assert.equal(force[0], 2);
        }
        return original.call(this, p, v, force, ...rest);
    };
    const first = history.m_locations[0];
    history.CalculatePosition(first.v, first.p, 0.25);
    near(first.v[0], 10.5);
    near(first.p[0], 2);
    near(nestedP[0], 11.2);
});

test("every borrowed record-sampling and force vector returns on integrator exceptions", () =>
{
    const { history, park, ball } = fixture();
    const originals = [], borrowed = new Set();
    for (const owner of [vec3d, vec3, quat])
    {
        const alloc = owner.alloc, unalloc = owner.unalloc;
        originals.push([owner, alloc, unalloc]);
        owner.alloc = () => { const value = alloc(); assert.ok(!borrowed.has(value)); borrowed.add(value); return value; };
        owner.unalloc = value => { assert.ok(borrowed.delete(value)); unalloc(value); };
    }
    try
    {
        const fail = () => { throw new Error("integration failure"); };
        const integrate = park.Integrate;
        park.Integrate = fail;
        assert.throws(() => history.Initialize(ball, 1), /integration failure/);
        assert.equal(borrowed.size, 0);
        assert.throws(() => history.AddImpact(impact(0.25, 11)), /integration failure/);
        assert.equal(borrowed.size, 0);
        assert.throws(() => history.CalculateEnd(), /integration failure/);
        assert.equal(borrowed.size, 0);
        const p = vec3d.fromValues(91, 92, 93), v = vec3d.fromValues(81, 82, 83);
        assert.throws(() => history.CalculatePosition(p, v, 0.5), /integration failure/);
        assert.equal(p[0], 91);
        assert.equal(v[0], 81);
        assert.equal(borrowed.size, 0);
        park.Integrate = integrate;
        park.ApplyTorque = fail;
        assert.throws(() => history.CalculateRotation(quat.create(), vec3.create(), 0.5), /integration failure/);
        assert.equal(borrowed.size, 0);
    }
    finally
    {
        for (const [owner, alloc, unalloc] of originals) { owner.alloc = alloc; owner.unalloc = unalloc; }
    }
});


test("accepted impact IDs use signed-int64 normalization including the no-collider sentinel", () =>
{
    const { history } = fixture();
    const value = impact(0.25, 42);
    value.collider = 42;
    history.AddImpact(value);
    assert.equal(history.m_locations[1].collider, 42n);
    history.CalculateEnd();
    assert.equal(history.IgnoreCollision(42, 0), true);
    assert.deepEqual(history.RemoveImpact(0.25, 42), []);
    value.collider = -1;
    history.AddImpact(value);
    history.CalculateEnd();
    assert.equal(history.m_locations[1].collider, -1n);
    assert.deepEqual(history.RemoveImpact(0, 999), [], "sentinel is not a real invalidated collider");
    value.collider = 2n ** 63n;
    const before = history.m_locations.slice();
    assert.throws(() => history.AddImpact(value), RangeError);
    assert.deepEqual(history.m_locations, before);
});
