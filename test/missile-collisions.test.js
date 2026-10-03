import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { CjsBallparkController as Park, CjsDestinyBall as Ball, settings } from "@carbonenginejs/server";
import { vec3 } from "@carbonenginejs/runtime/math/vec3";

// Source: destiny/src/Ballpark.cpp:601-638; destiny/src/Ball.cpp:468-488.
afterEach(() => settings.Reset());
const Mode = Ball.DSTBALLMODE;

function add(park, id, x = 0, free = true)
{
    return park.AddBall(id, 1e4, 2, 300, free, false, true, true, false,
        x, 0, 0, 0, 0, 0, 0.01, 1);
}

function configure(iterative, dynamic = false, disableMissileOrientation = true)
{
    const config = settings.Get();
    config.useIterativeCollision = iterative;
    config.useDynamicalOrientation = dynamic;
    config.disableDynamicalOrientationForMissiles = disableMissileOrientation;
    settings.Apply(config);
}

function host(park, events)
{
    park._pyOS = { SendEvent(ball, event, name, flags, format, ...args)
    {
        if (name === "DoCollision")
        {
            assert.equal(event, "Destiny::Ball::DoCollision");
            assert.equal(flags, null); assert.equal(format, "Lddd");
            events.push([ball.id, ...args]);
        }
        return true;
    }, PyError() { assert.fail("unexpected dispatch failure"); } };
}

for (const iterative of [false, true])
test(`target collision dispatch through the real solver, iterative=${iterative}`, () =>
{
    configure(iterative);
    const park = new Park(), target = add(park, 1, 100, false), owner = add(park, 2, 0, false);
    const missile = add(park, 3), events = [];
    park.LaunchMissile(missile.id, target.id, owner.id, 1, 1);
    host(park, events);
    for (let tick = 0; tick < 10 && events.length === 0; ++tick) park.Evolve();
    assert.ok(events.length > 0, "solver must find a real target contact");
    assert.ok(events.every(event => event[0] === missile.id && event[1] === target.id));
    assert.equal(park.GetBall(missile.id), missile, "event delivery itself never destroys the missile");
    assert.equal(missile.mode, Mode.DSTBALL_MISSILE);
    assert.equal(park.inEvolve, false);
});

test("DispatchCollisions snapshots count but rereads IDs and force through callbacks", () =>
{
    const park = new Park(), ball = add(park, 1), events = [];
    ball.mCollisions.push(4n, 5n, 5n); vec3.set(ball.mLastC, 1, 2, 3);
    let errors = 0;
    host(park, events);
    const send = park._pyOS.SendEvent;
    park._pyOS.SendEvent = (...args) =>
    {
        send(...args);
        if (events.length === 1)
        {
            ball.mCollisions[1] = 0n; ball.mCollisions.push(99n);
            vec3.set(ball.mLastC, 7, 8, 9); ball.mPark = null;
            return false;
        }
        return true;
    };
    park._pyOS.PyError = () => { errors++; };
    ball.DispatchCollisions();
    assert.deepEqual(events, [[1n, 4n, 1, 2, 3], [1n, 0n, 7, 8, 9], [1n, 5n, 7, 8, 9]]);
    assert.equal(errors, 1); assert.equal(ball.mCollisions.length, 4);
    ball.DispatchCollisions(); assert.equal(events.length, 3, "detached calls have no injected host");
});

// Isolate the completion phase from already-tested discovery/integration: force a
// known displacement and collision history, while running Evolve's native ordering.
function completion(iterative, distance = 1)
{
    configure(iterative);
    const park = new Park(), owner = add(park, 2, 0, false), missile = add(park, 3), events = [];
    missile.mMode = Mode.DSTBALL_MISSILE; missile.mOwnerId = -owner.id;
    park.EvolveBehaviorForBall = () => { missile.mCollisions.length = 0; };
    park.Gradient = () => {};
    park.CalculateIterativeCollisionResponses = () => {};
    park.CalculateBallPositionVelocity = (ball, time, outPosition, outVelocity) =>
    {
        vec3.copy(outPosition, ball.mNewPos); outPosition[0] += distance;
        vec3.copy(outVelocity, ball.mNewVel);
    };
    park.InsertBallInBoxes = () => {};
    host(park, events);
    return { park, owner, missile, events };
}

for (const iterative of [false, true])
test(`completion owner checks respect master, signed owner and bubble sentinel, iterative=${iterative}`, () =>
{
    for (const scenario of ["valid", "missing", "cloaked", "wrong-bubble", "sentinel", "sentinel-cloaked", "replica"])
    {
        const { park, owner, missile, events } = completion(iterative);
        park.isMaster = scenario !== "replica";
        park.InDeadBubble = () => false;
        missile.mNewBubble = scenario.startsWith("sentinel") ? -1 : 10;
        owner.mNewBubble = scenario === "wrong-bubble" || scenario === "sentinel" ? 11 : missile.mNewBubble;
        if (scenario === "missing" || scenario === "replica") park._balls.delete(owner.id);
        if (scenario.includes("cloaked")) owner.isCloaked = true;
        park.Evolve();
        const expected = ["missing", "cloaked", "wrong-bubble", "sentinel-cloaked"].includes(scenario) ? [missile.id] : [];
        assert.deepEqual(events.map(event => event[1]), expected, scenario);
    }
});

test("iterative completion keeps collider zero and duplicates before orphan self-contact", () =>
{
    const { park, owner, missile, events } = completion(true);
    park.isMaster = true; park.InDeadBubble = () => false; park._balls.delete(owner.id);
    park.mCollisionLocations.set(missile.id, { m_locations: [-1n, 0n, 7n, 7n].map(collider => ({ collider })) });
    park.Evolve();
    assert.deepEqual(events.map(event => event[1]), [0n, 7n, 7n, missile.id]);
});

test("subthreshold movement skips reinsertion and even orphan collision dispatch", () =>
{
    const { park, owner, events } = completion(false, 0.3);
    park.isMaster = true; park.InDeadBubble = () => false; park._balls.delete(owner.id);
    park.InsertBallInBoxes = () => { assert.fail("movement squared is below 0.1"); };
    park.Evolve(); assert.deepEqual(events, []);
});

test("mode changes during insertion precede dispatch; thrown collision callbacks release inEvolve", () =>
{
    const { park, missile, events } = completion(true);
    park.mCollisionLocations.set(missile.id, { m_locations: [{ collider: 9n }] });
    park.InsertBallInBoxes = ball => { ball.mMode = Mode.DSTBALL_STOP; };
    park.Evolve(); assert.deepEqual(events, []);
    missile.mMode = Mode.DSTBALL_MISSILE; park.InsertBallInBoxes = () => {};
    park._pyOS.SendEvent = () => { throw Error("host failure"); };
    assert.throws(() => park.Evolve(), /host failure/); assert.equal(park.inEvolve, false);
});

for (const disable of [false, true])
test(`dynamic missile evolution honors its orientation exception, disabled=${disable}`, () =>
{
    // Source: destiny/src/Ballpark.cpp:409-412,584-598,839-900.
    configure(false, true, disable);
    const park = new Park(), target = add(park, 1, 1e6, false), owner = add(park, 2, 0, false);
    const missile = add(park, 3);
    park.LaunchMissile(missile.id, target.id, owner.id, 1, 1);
    let snaps = 0; const snap = missile.SnapOrientation;
    missile.SnapOrientation = function() { snaps++; return snap.call(this); };
    for (let i = 0; i < 4; ++i) park.Evolve();
    assert.equal(snaps, disable ? 4 : 0);
    assert.ok(missile.mNewRot.every(Number.isFinite));
    assert.ok(missile.mNewPos.every(Number.isFinite));
    assert.ok(missile.x > 0);
});
