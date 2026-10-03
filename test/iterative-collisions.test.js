import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { CjsBallparkController as Park, CjsDestinyBall as Ball,
    CollisionBallProperties, CollisionItem, CollisionImpact, settings } from "@carbonenginejs/server";
import { vec3 } from "@carbonenginejs/runtime/math/vec3";

// Source: destiny/src/Ballpark.cpp:332-519,1988-2320,2675-2682,5556-5562,5912-5917.
// Source: destiny/python/destiny/test/ballpark/evolve/test_iterative_collision.py.
afterEach(() => settings.Reset());

function enable(cap = 20n, dynamic = false)
{
    const config = settings.Get();
    config.useIterativeCollision = true;
    config.collisionMaxIterations = cap;
    config.useDynamicalOrientation = dynamic;
    settings.Apply(config);
}

function add(park, id, options = {})
{
    return park.AddBall(id, options.mass ?? 13e6, options.radius ?? 2, options.maxVelocity ?? 10,
        true, false, true, false, false, options.x ?? 0, options.y ?? 0, options.z ?? 0,
        options.vx ?? 0, options.vy ?? 0, options.vz ?? 0, options.agility ?? 0.9, options.speedFraction ?? 0.95);
}

function near(actual, expected, tolerance = 1e-10)
{
    assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);
}

function sampled(ball, start, end, position)
{
    // Discovery-only records isolate search intervals from already-tested drag integration.
    return { m_ball: ball, m_tStart: start, m_tEnd: end, m_locations: [{ time: start, collider: -1n }],
        CalculatePosition(p, v, time) { vec3.set(p, position(time), 0, 0); vec3.zero(v); },
        IgnoreCollision() { return false; }, CalculateEnd() {} };
}

test("static discovery preserves fraction-versus-absolute comparison and partial writes", () =>
{
    const park = new Park(), ball = add(park, 1, { radius: 0.5 });
    const fixed = add(park, 2, { radius: 0.5, x: 6 });
    park.SetBallFree(fixed.id, false);
    const capsule = park.AddCapsule(100, 99, 3, 0, 0, 3, 0, 0, 0.5);
    const record = sampled(ball, 0.5, 1, time => 20 * (time - 0.5));
    const item = new CollisionItem(), ignored = [];
    item.mbIndex2 = 42;
    record.IgnoreCollision = (id, time) => { ignored.push([id, time]); return false; };
    park.GetNextCollisionStatic(record, item, [fixed], [capsule]);
    assert.equal(item.collider, fixed);
    near(item.timeOfImpact, 0.75);
    assert.deepEqual(Array.from(item.normal), [-1, 0, 0]);
    assert.deepEqual([item.mbIndex1, item.mbIndex2], [-1, 42]);
    assert.deepEqual(ignored, [[100n, 0.2], [2n, 0.5]]);
});

test("static misses preserve an existing item and start hits suppress later candidates", () =>
{
    const park = new Park(), ball = add(park, 1), record = sampled(ball, 0, 1, () => 0);
    const item = new CollisionItem();
    item.timeOfImpact = 0.75;
    item.collider = ball;
    vec3.set(item.normal, 3, 4, 5);
    park.GetNextCollisionStatic(record, item, [], [{ CheckCollision(a, b, radius, out)
    { vec3.set(out.normal, 90, 80, 70); out.timeOfImpact = 0; return false; } }]);
    assert.equal(item.collider, ball);
    assert.equal(item.timeOfImpact, 0.75);
    assert.deepEqual(Array.from(item.normal), [3, 4, 5]);
    const capsule = park.AddCapsule(100, 99, 0, 0, 0, 0, 0, 0, 2);
    park.GetNextCollisionStatic(record, item, [{ get isFree() { assert.fail("fixed search after start hit"); } }],
        [capsule, { CheckCollision() { assert.fail("shape search after start hit"); } }]);
    assert.equal(item.collider, capsule);
    assert.equal(item.timeOfImpact, 0);
});

test("ignored free substep preserves native stale starting positions", () =>
{
    const park = new Park(), ball = add(park, 1, { radius: 0.5 }), other = add(park, 2, { radius: 0.5 });
    const record = sampled(ball, 0, 1, () => 0);
    const otherRecord = sampled(other, 0, 1, time => time <= 0.5 ? 8 * time : 8 * (1 - time));
    otherRecord.m_locations.push({ time: 0.5 });
    park.mCollisionLocations.set(other.id, otherRecord);
    const fractions = [], item = new CollisionItem();
    record.IgnoreCollision = (id, fraction) => { fractions.push(fraction); return fraction === 0; };
    park.GetNextCollisionFree(record, item, [other], 0n);
    assert.deepEqual(fractions, [0, 0]);
    assert.equal(item.collider, null);
});

test("free discovery uses exact numeric IDs and keeps equal-time candidate order and normal", () =>
{
    for (const base of [2n, 9007199254740993n])
    {
        const park = new Park(), ball = add(park, base, { radius: 0.5 });
        const low = add(park, base - 1n, { radius: 0.5 });
        const first = add(park, base + 8n, { radius: 0.5 });
        const second = add(park, base + 1n, { radius: 0.5 });
        const record = sampled(ball, 0, 1, time => 10 * time), item = new CollisionItem();
        for (const other of [low, first, second]) park.mCollisionLocations.set(other.id, sampled(other, 0, 1, () => 6));
        vec3.set(item.normal, 8, 9, 10);
        item.impact = new CollisionImpact();
        park.GetNextCollisionFree(record, item, [low, first, second], 0n);
        assert.equal(item.collider, first);
        near(item.timeOfImpact, 0.5);
        assert.deepEqual([item.mbIndex1, item.mbIndex2, item.impact], [-1, -1, null]);
        assert.deepEqual(Array.from(item.normal), [8, 9, 10]);
        ball.mMode = Ball.DSTBALLMODE.DSTBALL_MISSILE;
        const missileItem = new CollisionItem();
        park.GetNextCollisionFree(record, missileItem, [low], 1n);
        assert.equal(missileItem.collider, low);
    }
});

test("free subdivision keeps duplicate interior times and clips to the other endpoint", () =>
{
    const park = new Park(), ball = add(park, 1), other = add(park, 2);
    const record = sampled(ball, 0.2, 1, () => 0), otherRecord = sampled(other, 0, 0.8, () => 100);
    otherRecord.m_locations = [0, 0.2, 0.4, 0.4, 0.8, 1].map(time => ({ time }));
    const calls = [], calculate = otherRecord.CalculatePosition;
    otherRecord.CalculatePosition = (p, v, t) => { calls.push(t); calculate(p, v, t); };
    park.mCollisionLocations.set(other.id, otherRecord);
    park.GetNextCollisionFree(record, new CollisionItem(), [other], 0n);
    assert.deepEqual(calls, [0.2, 0.4, 0.4, 0.8]);
    calls.length = 0;
    record.m_tStart = 0.8;
    park.GetNextCollisionFree(record, new CollisionItem(), [other], 0n);
    assert.deepEqual(calls, []);
});

test("neighbor exclusions preserve native owner signs and asymmetric junk and target rules", () =>
{
    const park = new Park(), ball = add(park, 1), other = add(park, 2), mode = Ball.DSTBALLMODE;
    assert.equal(park.CollisionBallNeighborIgnore(ball, other), false);
    other.isSpaceJunk = true;
    assert.equal(park.CollisionBallNeighborIgnore(ball, other), true);
    ball.isSpaceJunk = true;
    assert.equal(park.CollisionBallNeighborIgnore(ball, other), false);
    other.isMassive = false;
    assert.equal(park.CollisionBallNeighborIgnore(ball, other), true);
    other.isMassive = true;
    ball.mMode = mode.DSTBALL_MISSILE;
    ball.mOwnerId = -2n;
    assert.equal(park.CollisionBallNeighborIgnore(ball, other), false);
    ball.mOwnerId = 2n;
    assert.equal(park.CollisionBallNeighborIgnore(ball, other), true);
    other.mMode = mode.DSTBALL_MINIBALL;
    other.mOwnerId = ball.mOwnerId = 99n;
    assert.equal(park.CollisionBallNeighborIgnore(ball, other), true);
    ball.mMode = mode.DSTBALL_STOP;
    other.mMode = mode.DSTBALL_MUSHROOM;
    other.mOwnerId = ball.id;
    assert.equal(park.CollisionBallNeighborIgnore(ball, other), true);
    other.mMode = mode.DSTBALL_MISSILE;
    other.mOwnerId = 99n;
    other.mFollowId = ball.id;
    assert.equal(park.CollisionBallNeighborIgnore(ball, other), true);
});

test("discovery frames survive nested search and return on thrown geometry", () =>
{
    const park = new Park(), ball = add(park, 1), record = sampled(ball, 0, 1, t => t * 10);
    const capsule = park.AddCapsule(100, 99, 6, 0, 0, 6, 0, 0, 1);
    const item = new CollisionItem();
    park.GetNextCollisionStatic(record, item, [], [{ mId: 101n, CheckCollision(a, b, r, out)
    {
        park.GetNextCollisionStatic(sampled(ball, 0, 1, () => 100), new CollisionItem(), [], [capsule]);
        return capsule.CheckCollision(a, b, r, out);
    } }]);
    near(item.timeOfImpact, 0.3);
    const count = Park.collisionFrames.length;
    assert.throws(() => park.GetNextCollisionStatic(record, item, [], [{ CheckCollision() { throw Error("geometry"); } }]), /geometry/);
    assert.equal(Park.collisionFrames.length, count);
    assert.ok(Park.collisionFrames.every(frame => frame.times.length === 0));
});

test("response initializes before fetching candidates, appends only on pass zero", () =>
{
    const park = new Park(), ball = add(park, 1), candidates = [], shapes = [];
    park.mPotentialCollisionBalls.set(ball.id, candidates);
    park.mPotentialCollidables.set(ball.id, shapes);
    let queries = 0;
    park.mPartition.GetCollisionCandidates = (value, balls, statics) =>
    {
        assert.equal(park.mCollisionLocations.get(ball.id).m_ball, ball);
        assert.equal(value, ball); assert.equal(balls, candidates); assert.equal(statics, shapes);
        queries++;
        balls.push(ball);
    };
    park.GetNextCollisionStatic = () => {};
    park.GetNextCollisionFree = () => {};
    for (const iteration of [0, 0n, 1n]) assert.equal(park.CalculateCollisionResponse(ball, iteration), false);
    assert.equal(queries, 2);
    assert.deepEqual(candidates, [ball, ball]);
});

test("response early exits retain native endpoint-update distinctions", () =>
{
    const park = new Park(), ball = add(park, 1), record = sampled(ball, 0, 1, () => 0);
    park.mCollisionLocations.set(ball.id, record);
    let ends = 0;
    record.CalculateEnd = () => ends++;
    assert.equal(park.CalculateCollisionResponse(ball, 1n), false);
    assert.equal(ends, 0); // Empty candidates.
    record.m_locations[0].collider = 2n;
    assert.equal(park.CalculateCollisionResponse(ball, 1n), false);
    assert.equal(ends, 0); // Collision at the first record.
    record.m_tStart = record.m_tEnd;
    assert.equal(park.CalculateCollisionResponse(ball, 1n), false);
    assert.equal(ends, 1); // Exhausted interval still updates its end.
});

test("response applies neighbor first and accepts default-zero impact identities", () =>
{
    const park = new Park(), ball = add(park, 1), other = add(park, 2), events = [];
    const record = sampled(ball, 0, 1, () => 0);
    record.CalculateEnd = () => events.push("end");
    park.mCollisionLocations.set(ball.id, record);
    park.mCollisionLocations.set(other.id, sampled(other, 0, 1, () => 0));
    park.mPotentialCollisionBalls.set(ball.id, [other]);
    park.GetNextCollisionStatic = () => {};
    park.GetNextCollisionFree = (record, item) => { item.collider = other; item.mbIndex2 = -1; };
    park.CalculateCollisionImpactFree = (a, b, item) =>
    {
        item.impact = new CollisionImpact();
        return { collider: other, impact: new CollisionImpact() };
    };
    park.AddImpact = (impact, iteration, value) => { assert.equal(impact.collider, 0n); events.push(value.id); };
    assert.equal(park.CalculateCollisionResponse(ball, 1n), true);
    assert.deepEqual(events, [other.id, ball.id, "end"]);
});

test("scheduler always runs pass zero and caps later passes with exact uint64 values", () =>
{
    for (const [cap, passes] of [[0n, 1], [1n, 1], [2n, 2], [3n, 3]])
    {
        enable(cap);
        const park = new Park(), ball = add(park, 1), calls = [];
        park.mPotentialCollisionBalls.set(ball.id, []);
        park.CalculateCollisionResponse = (value, iteration) => { calls.push(iteration); return true; };
        park.CalculateIterativeCollisionResponses();
        assert.deepEqual(calls, Array.from({ length: passes }, (_, i) => BigInt(i)));
    }
});

test("response candidates remain independent across reentry and release frames on errors", () =>
{
    const park = new Park(), a = add(park, 1), b = add(park, 2), calls = [];
    for (const ball of [a, b])
    {
        park.mCollisionLocations.set(ball.id, sampled(ball, 0, 1, () => 0));
        park.mPotentialCollidables.set(ball.id, [{}]);
    }
    park.GetNextCollisionStatic = (record, item) =>
    {
        item.timeOfImpact = 0;
        item.collider = record.m_ball;
        vec3.set(item.normal, Number(record.m_ball.id), 0, 0);
        if (record.m_ball === a)
        {
            assert.equal(park.CalculateCollisionResponse(b, 1n), true);
            assert.equal(item.collider, a);
            assert.equal(item.normal[0], 1);
        }
    };
    park.GetNextCollisionFree = () => assert.fail("free search after start hit");
    park.CalculateCollisionImpactStatic = (record, item) =>
    { item.impact = new CollisionImpact(); item.impact.collider = record.m_ball.id; };
    park.AddImpact = (impact, iteration, ball) => calls.push(ball.id);
    assert.equal(park.CalculateCollisionResponse(a, 1n), true);
    assert.deepEqual(calls, [2n, 1n]);
    const count = Park.collisionFrames.length;
    park.GetNextCollisionStatic = () => { throw Error("search"); };
    assert.throws(() => park.CalculateCollisionResponse(a, 1n), /search/);
    assert.equal(Park.collisionFrames.length, count);
    assert.ok(Park.collisionFrames.every(frame => frame.collisionItem.collider === null && frame.collisionItem.impact === null));
});

test("scheduler deduplicates and orders signed IDs, filtering enqueued inactive balls", () =>
{
    enable(2n);
    const park = new Park(), ids = [10n, 2n, -3n, 9007199254740993n];
    const balls = ids.map(id => add(park, id));
    const fixed = add(park, 11), dead = add(park, 12), light = add(park, 13);
    park.SetBallFree(fixed.id, false);
    dead.mInDeadBubble = true;
    light.isMassive = false;
    const calls = [];
    park.CalculateCollisionResponse = (ball, iteration) =>
    {
        calls.push([ball.id, iteration]);
        park.mPotentialCollisionBalls.set(ball.id, [balls[0], balls[1], balls[0], fixed, dead, light]);
        return ball === balls[2];
    };
    park.CalculateIterativeCollisionResponses();
    assert.deepEqual(calls, [[-3n, 0n], [2n, 0n], [10n, 0n], [9007199254740993n, 0n],
        [-3n, 1n], [2n, 1n], [10n, 1n]]);
});

test("scheduler reinitializes all histories, clears cached arrays in place, stops on no impacts", () =>
{
    enable();
    const park = new Park(), ball = add(park, 1), fixed = add(park, 2), events = [];
    park.SetBallFree(fixed.id, false);
    fixed.isMoribund = true;
    const candidates = [fixed], shapes = [{}];
    park.mPotentialCollisionBalls.set(ball.id, candidates);
    park.mPotentialCollidables.set(ball.id, shapes);
    park.mCollisionLocations.set(fixed.id, { m_ball: fixed, Initialize(value, dt)
    { assert.equal(value, fixed); assert.equal(dt, park.dt); events.push("init"); } });
    park.CalculateCollisionResponse = () =>
    {
        assert.equal(park.mPotentialCollisionBalls.get(ball.id), candidates);
        assert.equal(park.mPotentialCollidables.get(ball.id), shapes);
        assert.deepEqual(candidates, []); assert.deepEqual(shapes, []);
        events.push("response"); return false;
    };
    park.CalculateIterativeCollisionResponses();
    assert.deepEqual(events, ["init", "response"]);
});

test("Evolve solves after all behavior and commits after sampling, with native angular fraction", () =>
{
    enable(20n, true);
    const park = new Park();
    park.dt = 0.5;
    const a = add(park, 1), b = add(park, 2), events = [];
    park.EvolveBehaviorForBall = ball => events.push(`behavior${ball.id}`);
    park.CalculateIterativeCollisionResponses = () => events.push("solve");
    park.Gradient = () => assert.fail("legacy gradient in iterative evolution");
    park.CalculateBallPositionVelocity = (ball, fraction, p, v) =>
    {
        assert.equal(a.x, 0); assert.equal(b.x, 0);
        assert.equal(a.mNewTime, 0n); assert.equal(b.mNewTime, 0n);
        assert.equal(fraction, 0.5);
        vec3.set(p, Number(ball.id) * 10, 0, 0); vec3.zero(v);
        events.push(`position${ball.id}`);
    };
    park.CalculateBallRotationVelocity = (ball, fraction) =>
    { assert.equal(fraction, 1); events.push(`rotation${ball.id}`); };
    park.Evolve(10000000n);
    assert.deepEqual(events, ["behavior1", "behavior2", "solve", "position1", "rotation1", "position2", "rotation2"]);
    assert.deepEqual([a.x, b.x, a.mNewTime, b.mNewTime], [10, 20, 10000000n, 10000000n]);
});

test("conditional cache cleanup occurs after final callbacks and delayed removal retains records", () =>
{
    enable();
    let park;
    park = new Park(null, { SendEvent(ball)
    { assert.ok(park.mCollisionLocations.has(ball.id)); return true; } });
    const ball = add(park, 1);
    for (const cache of [park.mCollisionLocations, park.mPotentialCollisionBalls, park.mPotentialCollidables])
        cache.set(ball.id, []);
    park.RemoveBall(ball.id, 1);
    assert.ok(park.mCollisionLocations.has(ball.id));
    park.RemoveBall(ball.id);
    for (const cache of [park.mCollisionLocations, park.mPotentialCollisionBalls, park.mPotentialCollidables]) assert.equal(cache.size, 0);
});

test("disabled iterative settings retain histories on removal and ClearAll, as Carbon does", () =>
{
    for (const enabled of [false, true]) for (const operation of ["RemoveBall", "ClearAll"])
    {
        settings.Reset();
        if (enabled) enable();
        const park = new Park(), ball = add(park, 1), history = new CollisionBallProperties();
        history.Initialize(ball, park.dt);
        park.mCollisionLocations.set(ball.id, history);
        park.mPotentialCollisionBalls.set(ball.id, []);
        park.mPotentialCollidables.set(ball.id, []);
        park[operation](ball.id);
        for (const cache of [park.mCollisionLocations, park.mPotentialCollisionBalls, park.mPotentialCollidables])
            assert.equal(cache.size, enabled ? 0 : 1);
    }
});

test("donor sphere substeps transfer velocity through out-of-order neighbors", () =>
{
    // Source: destiny/python/destiny/test/ballpark/evolve/test_iterative_collision.py:350-371.
    enable();
    const park = new Park(); park.mFriction = 1e-10;
    const a = add(park, 1, { vz: 20, maxVelocity: 100 });
    const c = add(park, 2, { z: 10, maxVelocity: 100 });
    const b = add(park, 3, { z: 5, maxVelocity: 100 });
    park.Evolve();
    for (const [actual, expected] of [[a.vz, 0], [a.z, 1], [b.vz, 0], [b.z, 6], [c.vz, 20], [c.z, 28]]) near(actual, expected, 0.5);
    // Committed results must come from solved histories, not a second direct integration.
    for (const ball of [a, b, c])
    {
        const record = park.mCollisionLocations.get(ball.id);
        const last = record.m_locations[record.m_locations.length - 1];
        near(ball.z, last.p[2]); near(ball.vz, last.v[2]);
    }
});

test("donor fixed/free substeps preserve oblique velocity transfer", () =>
{
    // Source: destiny/python/destiny/test/ballpark/evolve/test_iterative_collision.py:373-394.
    enable();
    const park = new Park(); park.mFriction = 1e-10;
    const a = add(park, 1, { z: -14, vz: 50, maxVelocity: 100 });
    const b = add(park, 2, { x: -10, vx: 50, maxVelocity: 100 });
    const c = add(park, 3, { z: 20 }), d = add(park, 4, { x: 20 });
    park.SetBallFree(c.id, false); park.SetBallFree(d.id, false);
    park.Evolve();
    for (const [actual, expected] of [[a.vz, 0], [a.vx, 0], [a.z, -4], [b.vz, 50], [b.vx, 50]]) near(actual, expected, 0.005);
});

test("donor fixed collision precedes an otherwise reachable free ball", () =>
{
    // Source: destiny/python/destiny/test/ballpark/evolve/test_iterative_collision.py:331-348.
    enable();
    const park = new Park(), b = add(park, 1, { z: 4 }), c = add(park, 2, { z: 10, mass: 1e6 });
    const a = add(park, 3, { z: -4, vz: 20, maxVelocity: 100 });
    park.SetBallFree(b.id, false);
    park.Evolve();
    assert.deepEqual([c.x, c.y, c.z], [0, 0, 10]);
    assert.ok(a.z < b.z);
});

function miniParent(park, id, radius = 0)
{
    // Source: destiny/python/destiny/test/ballpark/evolve/test_iterative_collision.py:403-408,604-610.
    return park.AddBall(id, 0, radius, 0, false, false, false, false, false,
        0, 0, 0, 0, 0, 0, 0, 0);
}

for (const shape of ["capsule", "box"]) test(`donor ${shape} approach retains clearance over twenty ticks`, () =>
{
    // Source: destiny/python/destiny/test/ballpark/evolve/test_iterative_collision.py:418-437,619-639.
    // Exercise the actual native fixed-parent Mini ownership path.
    enable();
    const park = new Park();
    let ball;
    if (shape === "capsule")
    {
        miniParent(park, 99, 500).PyAddMiniCapsule( 100, 100, 0, 200, 100, 0, 10);
        ball = add(park, 1, { x: 80, y: 100 });
        park.GotoPoint(ball.id, 300, 100, 0);
    }
    else
    {
        miniParent(park, 99).PyAddMiniBox( 0, 0, 0, 100, 0, 0, 0, 100, 0, 0, 0, 100);
        ball = add(park, 1, { x: -10, y: 50, z: 50 });
        park.GotoPoint(ball.id, 50, 50, 50);
    }
    for (let tick = 0; tick < 20; ++tick)
    {
        park.Evolve();
        if (shape === "capsule")
        {
            assert.ok(1.11 * Math.abs(ball.x - 100) > ball.radius + 10);
            near(ball.y, 100, 0.00005); near(ball.z, 0, 0.005);
        }
        else
        {
            assert.ok(1.11 * Math.abs(ball.x) > ball.radius);
            near(ball.y, 50, 0.00005); near(ball.z, 50, 0.00005);
        }
    }
});

test("donor coincident stopped spheres separate with opposite velocities", () =>
{
    // Source: destiny/python/destiny/test/ballpark/evolve/test_iterative_collision.py:24-43.
    enable();
    const park = new Park(), a = add(park, 1), b = add(park, 2);
    for (let tick = 0; tick < 10; ++tick)
    {
        park.Evolve();
        for (let axis = 0; axis < 3; ++axis) near(a.mNewVel[axis], -b.mNewVel[axis], 5e-8);
        if (tick === 2) assert.ok(vec3.distance(a.mNewPos, b.mNewPos) > 4);
    }
});

test("donor four overlapping spheres separate in the horizontal plane", () =>
{
    // Source: destiny/python/destiny/test/ballpark/evolve/test_iterative_collision.py:45-78.
    enable();
    const park = new Park(), balls = [add(park, 1, { x: 1 }), add(park, 2, { x: -1 }),
        add(park, 3, { z: 1 }), add(park, 4, { z: -1 })];
    for (let tick = 0; tick < 10; ++tick)
    {
        park.Evolve();
        for (const ball of balls) near(ball.vy, 0, 5e-8);
        if (tick === 4)
            for (let a = 0; a < balls.length; ++a) for (let b = a + 1; b < balls.length; ++b)
                assert.ok(vec3.distance(balls[a].mNewPos, balls[b].mNewPos) > 4);
    }
});

test("donor stopped intersecting spheres eject along their separation axis", () =>
{
    // Source: destiny/python/destiny/test/ballpark/evolve/test_iterative_collision.py:80-110.
    enable();
    const park = new Park(), a = add(park, 1, { y: 1.9 }), b = add(park, 2);
    for (let tick = 0; tick < 10; ++tick)
    {
        park.Evolve();
        assert.ok(a.vy > 0 && b.vy < 0); near(a.vy, -b.vy, 5e-8);
        for (const ball of [a, b])
        {
            near(ball.vx, 0, 5e-8); near(ball.vz, 0, 5e-8);
            near(ball.x, 0, 5e-5); near(ball.z, 0, 5e-5);
        }
        if (tick === 1) assert.ok(vec3.distance(a.mNewPos, b.mNewPos) > 4);
    }
});

test("donor sphere starting inside a fixed sphere exits outward", () =>
{
    // Source: destiny/python/destiny/test/ballpark/evolve/test_iterative_collision.py:112-123.
    enable();
    const park = new Park(), ball = add(park, 1, { z: 8, vz: 2 }), fixed = add(park, 2, { radius: 10 });
    park.SetBallFree(fixed.id, false);
    for (let tick = 0; tick < 10; ++tick) park.Evolve();
    assert.ok(ball.z > 12); near(ball.x, 0, 5e-5); near(ball.y, 0, 5e-5);
});

test("donor intersecting goto spheres alternate ejection and commanded acceleration", () =>
{
    // Source: destiny/python/destiny/test/ballpark/evolve/test_iterative_collision.py:125-181.
    enable();
    const park = new Park(), a = add(park, 1, { radius: 10, vx: 3 }), b = add(park, 2, { radius: 10, x: 10, vx: -3 });
    park.GotoDirection(a.id, 1, 0, 0); park.GotoDirection(b.id, -1, 0, 0);
    const samples = [];
    for (let tick = 0; tick < 20; ++tick)
    {
        park.Evolve();
        for (const ball of [a, b]) for (const value of [ball.y, ball.z, ball.vy, ball.vz]) near(value, 0, 0.05);
        samples.push({ distance: vec3.distance(a.mNewPos, b.mNewPos), a: a.vx, b: b.vx });
    }
    let inside = true;
    for (let i = 0; i < samples.length; ++i)
    {
        const current = samples[i], next = samples[i + 1];
        if (current.distance > 20) inside = false;
        if (inside)
        {
            assert.ok(current.a < 0 && current.b > 0);
            if (i > 0) assert.ok(current.distance > samples[i - 1].distance);
        }
        else if (next)
        {
            if (current.distance + current.b - current.a > 20) assert.ok(next.b < current.b && next.a > current.a);
            else assert.ok(next.b > current.b && next.a < current.a);
        }
    }
    assert.equal(inside, false);
});

test("donor small sphere transfers a small impulse to a massive sphere", () =>
{
    // Source: destiny/python/destiny/test/ballpark/evolve/test_iterative_collision.py:183-207.
    enable();
    const park = new Park(), small = add(park, 1, { x: -2, vx: 20, mass: 1e6, maxVelocity: 20, agility: 1000, speedFraction: 1 });
    const large = add(park, 2, { x: 22.01, mass: 1e9, radius: 20, speedFraction: 1 });
    park.GotoDirection(small.id, -1, 0, 0);
    park.Evolve();
    near(large.vx, 0.04, 0.005); near(small.vx, -19.96, 0.05);
    near(large.vy, 0, 5e-8); near(large.vz, 0, 5e-8);
    near(small.vy, 0, 5e-5); near(small.vz, 0, 5e-5);
});

test("donor massive sphere pushes a smaller sphere ahead", () =>
{
    // Source: destiny/python/destiny/test/ballpark/evolve/test_iterative_collision.py:209-235.
    enable();
    const park = new Park(), small = add(park, 1, { mass: 1e6, agility: 3 });
    const large = add(park, 2, { x: 30, vx: -20, mass: 1e9, radius: 20, maxVelocity: 20, speedFraction: 1 });
    park.GotoDirection(large.id, -1, 0, 0);
    for (let tick = 0; tick < 20; ++tick)
    {
        park.Evolve();
        assert.ok(vec3.distance(small.mNewPos, large.mNewPos) >= 0.9 * 22);
        assert.ok(large.vx < -19);
        for (const ball of [small, large]) { near(ball.vy, 0, 0.005); near(ball.vz, 0, 0.005); }
    }
});

test("donor opposing goto spheres maintain clearance", () =>
{
    // Source: destiny/python/destiny/test/ballpark/evolve/test_iterative_collision.py:237-269.
    enable();
    const park = new Park(), a = add(park, 1), b = add(park, 2, { z: 10 });
    park.GotoPoint(a.id, 0, 0, 10); park.GotoPoint(b.id, 0, 0, 0);
    for (let tick = 0; tick < 20; ++tick)
    {
        park.Evolve();
        assert.ok(1.11 * vec3.distance(a.mNewPos, b.mNewPos) > 4);
        for (const ball of [a, b]) { near(ball.x, 0, 5e-8); near(ball.y, 0, 5e-8); }
    }
});

test("donor nonmassive sphere does not obstruct a commanded sphere", () =>
{
    // Source: destiny/python/destiny/test/ballpark/evolve/test_iterative_collision.py:289-305.
    enable();
    const park = new Park(), a = add(park, 1, { z: -4 }), b = add(park, 2, { z: 4 });
    b.isMassive = false; // Native SetBallMassive only assigns this field.
    park.GotoDirection(a.id, 0, 0, 1);
    for (let tick = 0; tick < 80; ++tick) park.Evolve();
    assert.ok(a.z > b.z); near(b.z, 4, 5e-8);
    for (const ball of [a, b]) { near(ball.x, 0, 5e-8); near(ball.y, 0, 5e-8); }
});

for (const [name, position, target, reference, direction, tolerances] of [
    ["right", [220, 100, 0], [0, 100, 0], [200, 100, 0], false, [null, 5e-5, 0.005]],
    ["top", [150, 120, 0], [150, 0, 0], [150, 100, 0], false, [0.005, null, 0.005]],
    ["bottom", [150, 80, 0], [0, 1, 0], [150, 100, 0], true, [5e-5, null, 0.005]],
    ["zero-length", [100, 0, -10], [0, 0, 1], [100, 0, 0], true, [5e-5, 0.005, null]]
]) test(`donor capsule ${name} approach`, () =>
{
    // Source: destiny/python/destiny/test/ballpark/evolve/test_iterative_collision.py:439-523.
    // Exercise actual fixed-parent MiniCapsule materialization.
    enable();
    const park = new Park();
    miniParent(park, 99, 500).PyAddMiniCapsule( 100, 100, 0, 200, 100, 0, 10);
    if (name === "zero-length") miniParent(park, 98, 500).PyAddMiniCapsule( 100, 0, 0, 100, 0, 0, 2);
    const ball = add(park, 1, { x: position[0], y: position[1], z: position[2] });
    park[direction ? "GotoDirection" : "GotoPoint"](ball.id, ...target);
    for (let tick = 0; tick < 20; ++tick)
    {
        park.Evolve();
        assert.ok(1.11 * vec3.distance(ball.mNewPos, reference) > (name === "zero-length" ? 4 : 12));
        for (let axis = 0; axis < 3; ++axis)
            if (tolerances[axis] !== null) near(ball.mNewPos[axis], position[axis], tolerances[axis]);
    }
});

for (const name of ["oblique", "inside cylinder", "inside hemisphere"]) test(`donor capsule ${name}`, () =>
{
    // Source: destiny/python/destiny/test/ballpark/evolve/test_iterative_collision.py:525-570.
    enable();
    const park = new Park();
    miniParent(park, 99, 500).PyAddMiniCapsule( 100, 100, 0, 200, 100, 0, 10);
    const hemisphere = name === "inside hemisphere", oblique = name === "oblique";
    const ball = add(park, 1, { x: oblique ? 170 : hemisphere ? 95 : 160,
        y: oblique ? 80 : hemisphere ? 100 : 95, agility: oblique ? 0.3 : 0.9 });
    if (oblique)
    {
        park.GotoDirection(ball.id, -1, 1, 0);
        park.SetBallVelocity(ball.id, -6.7, 6.7, 0);
    }
    for (let tick = 0; tick < (oblique ? 10 : 20); ++tick)
    {
        park.Evolve();
        if (oblique) { assert.ok(ball.y + 10.8 < 100); near(ball.z, 0, 0.05); }
        else
        {
            assert.ok((hemisphere ? ball.vx : ball.vy) < 0);
            near(hemisphere ? ball.vy : ball.vx, 0, 0.005); near(ball.vz, 0, 0.005);
        }
    }
    if (!oblique) assert.ok((hemisphere ? ball.x : ball.y) + 10.8 < 100);
});

for (const [name, position, reference, ticks, tolerance, axis] of [
    ["right", [110, 50, 50], [100, 50, 50], 20, 5e-5, 0],
    ["top", [50, 110, 50], [50, 100, 50], 20, 0.005, 1],
    ["bottom", [50, -50, 50], [50, 0, 50], 20, 0.0005, 1],
    ["front", [50, 50, 110], [50, 50, 100], 100, 5e-5, 2],
    ["back", [50, 50, -10], [50, 50, 0], 20, 5e-5, 2]
]) test(`donor box ${name} approach`, () =>
{
    // Source: destiny/python/destiny/test/ballpark/evolve/test_iterative_collision.py:641-745.
    // Exercise actual fixed-parent MiniBox materialization.
    enable();
    const park = new Park();
    miniParent(park, 99).PyAddMiniBox( 0, 0, 0, 100, 0, 0, 0, 100, 0, 0, 0, 100);
    const ball = add(park, 1, { x: position[0], y: position[1], z: position[2] });
    park.GotoPoint(ball.id, 50, 50, 50);
    for (let tick = 0; tick < ticks; ++tick)
    {
        park.Evolve();
        assert.ok(1.11 * vec3.distance(ball.mNewPos, reference) > 2);
        for (let i = 0; i < 3; ++i) if (i !== axis) near(ball.mNewPos[i], 50, tolerance);
    }
});

test("donor oblique box contact retains clearance across three reused-body phases", () =>
{
    // Source: destiny/python/destiny/test/ballpark/evolve/test_iterative_collision.py:747-789.
    enable();
    const park = new Park();
    miniParent(park, 99).PyAddMiniBox( 0, 0, 0, 100, 0, 0, 0, 100, 0, 0, 0, 100);
    const ball = add(park, 1, { maxVelocity: 100, agility: 0.5 });
    for (const [position, velocity, exitAxis, contactAxis, stillAxis] of [
        [[0, 50, -50], [0.1, 0, 90], 0, 2, 1],
        [[50, -50, 0], [0, 90, 0.1], 2, 1, 0],
        [[-50, 0, 50], [90, 0.1, 0], 1, 0, 2]
    ])
    {
        park.SetBallPosition(ball.id, ...position); park.SetBallVelocity(ball.id, ...velocity);
        // Native Blue maxVelocity notification reinserts after the velocity writes.
        park.SetMaxSpeed(ball.id, 100); park.SetBallAgility(ball.id, 0.5);
        park.GotoDirection(ball.id, ...velocity);
        for (let tick = 0; tick < 40; ++tick)
        {
            park.Evolve();
            if (ball.mNewPos[exitAxis] > 100) break;
            assert.ok(ball.mNewPos[contactAxis] + 1.8 < 0);
            near(ball.mNewVel[stillAxis], 0, 0.005);
        }
    }
});

test("donor sphere starting inside a box exits and decays toward rest", () =>
{
    // Source: destiny/python/destiny/test/ballpark/evolve/test_iterative_collision.py:791-805.
    enable();
    const park = new Park();
    miniParent(park, 99).PyAddMiniBox( 0, 0, 0, 100, 0, 0, 0, 100, 0, 0, 0, 100);
    const ball = add(park, 1, { x: 20, y: 60, z: 30, vx: -10, agility: 0.01 });
    for (let tick = 0; tick < 100; ++tick)
    {
        park.Evolve();
        assert.ok(ball.vx < 0); near(ball.vy, 0, 5e-8); near(ball.vz, 0, 5e-8);
    }
    assert.ok(ball.x + 1.8 < 0); near(ball.vx, 0, 0.0005);
});

test("donor adjacent boxes stop a fast sphere at their shared face edge", () =>
{
    // Source: destiny/python/destiny/test/ballpark/evolve/test_iterative_collision.py:807-827.
    enable();
    const park = new Park();
    miniParent(park, 99).PyAddMiniBox( 0, 0, 0, 100, 0, 0, 0, 100, 0, 0, 0, 100);
    miniParent(park, 98).PyAddMiniBox( -100, 0, 0, 100, 0, 0, 0, 100, 0, 0, 0, 100);
    const ball = add(park, 1, { y: 50, z: -10, vz: 1000, maxVelocity: 1000, agility: 0.5 });
    park.GotoDirection(ball.id, 0, 0, 1);
    for (let tick = 0; tick < 100; ++tick)
    {
        park.Evolve();
        near(ball.vx, 0, 5e-8); near(ball.vy, 0, 5e-8);
        assert.ok(ball.z < -1.6);
    }
});
