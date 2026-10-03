import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { CjsBallparkController as Park, CjsDestinyBall as Ball, settings } from "@carbonenginejs/server";
import { Actions } from "@carbonenginejs/server/destiny/net/server";
import { vec3 } from "@carbonenginejs/runtime/math/vec3";

// Source: destiny/src/Ballpark.cpp:543-648,3719-3789,4852-4880,6278-6337.
// Source: destiny/python/destiny/test/ballpark/test_lifecycle_management.py:187-249.
// Source: destiny/python/destiny/test/ballpark/test_getters_and_setters.py:107-178.
afterEach(() => settings.Reset());
const Mode = Ball.DSTBALLMODE;
function add(park, id = 1, free = false, x = 0)
{
    return park.AddBall(id, 13e6, 2, 10, free, false, false, false, false,
        x, 0, 0, 0, 0, 0, 0.9, 0.95);
}
function configure(dynamic, iterative = false)
{
    const config = settings.Get(); config.useDynamicalOrientation = dynamic;
    config.useIterativeCollision = iterative; settings.Apply(config);
}
function silenceWarnings(fn)
{
    const warn = console.warn; console.warn = () => {};
    try { fn(); } finally { console.warn = warn; }
}

for (const dynamic of [false, true])
test(`donor mushroom creation and fixed growth boundary, dynamic=${dynamic}`, () =>
{
    configure(dynamic);
    const park = new Park(), owner = add(park, 1, false, 30);
    assert.equal(park.AddMushroom(owner.id, 10, 5), undefined);
    const mushroom = park.GetBall(0);
    assert.equal(mushroom.mode, Mode.DSTBALL_MUSHROOM);
    assert.equal(mushroom.ownerId, owner.id); assert.equal(mushroom.followRange, 10);
    assert.equal(mushroom.gotoX, 5); assert.equal(mushroom.mass, 100000002004087730000);
    assert.deepEqual([mushroom.x, mushroom.y, mushroom.z], [30, 0, 0]);
    assert.equal(mushroom.isFree, false); assert.equal(mushroom.isMassive, true);
    assert.equal(mushroom.isMoribund, false); assert.equal(mushroom.isInteractive, false);
    assert.equal(mushroom.maxVelocity, 0);
    if (dynamic)
    {
        assert.equal(mushroom.mMaxAngVel, 0); assert.equal(mushroom.mRotAgility, 1);
        assert.deepEqual(Array.from(mushroom.mNewRot), [0, 0, 0, 1]);
    }
    park.Evolve(); park.Evolve(); assert.equal(mushroom.radius, 0);
});

for (const iterative of [false, true])
test(`literal donor mushroom radius trajectory and deferred expiry, iterative=${iterative}`, () =>
{
    configure(false, iterative);
    const park = new Park(), owner = add(park);
    park.AddMushroom(owner.id, 10, 5);
    const mushroom = park.GetBall(0); park.SetBallFree(0, true);
    const expected = [0, 6.687403202056885, 7.952707290649414, 8.801117897033691, 9.457415580749512, 9.457415580749512];
    for (const radius of expected) { park.Evolve(); assert.equal(mushroom.radius, radius); }
    assert.equal(mushroom.isMoribund, true); assert.equal(park.GetBall(0), mushroom);
    assert.equal(mushroom.effectStamp, 5); assert.ok(park.moribundBalls.has(mushroom));
    park.BringOutTheDeads(); assert.equal(park.GetBall(0), null);
});

test("mushroom invalid input guards, exact owner lookup and NaN duration expiry", () =>
{
    const park = new Park(), owner = add(park, 7);
    silenceWarnings(() =>
    {
        for (const args of [[999, 10, 1], [-7, 10, 1], [7, 0, 1], [7, 10, -1]])
            park.AddMushroom(...args);
    });
    assert.equal(park.GetBall(0), null);
    owner.isCloaked = true; owner.isMoribund = true;
    park.PyAddMushroom(owner.id, 10, NaN);
    const mushroom = park.GetBall(0); assert.ok(Number.isNaN(mushroom.gotoX));
    park.SetBallFree(0, true); park.Evolve(); assert.ok(mushroom.isMoribund);
    assert.throws(() => park.PyAddMushroom(7, 10), TypeError);
});

for (const iterative of [false, true])
test(`mushroom collision owner filter retains solver asymmetry, iterative=${iterative}`, () =>
{
    configure(false, iterative);
    const park = new Park(), owner = add(park, 1, true), neighbor = add(park, 2, true, 5);
    park.SetBallMassive(owner.id, true); park.SetBallMassive(neighbor.id, true);
    park.AddMushroom(owner.id, 100, 5); park.SetBallFree(0, true);
    for (let i = 0; i < 4; ++i) park.Evolve();
    if (iterative)
    {
        // Source: destiny/src/Ballpark.cpp:2206-2210,2490-2500,2678-2681.
        // Mushroom ID0 queries owner1: the reverse-only owner exclusion does not
        // apply. Coincident centers use +Z normal, separating the owner toward -Z.
        assert.ok(owner.z < 0); assert.deepEqual(Array.from(neighbor.mNewPos), [5, 0, 0]);
        assert.ok(park.mCollisionLocations.get(owner.id).m_locations.some(location => location.collider === 0n));
        // Source: destiny/src/Ballpark.cpp:2060-2066,2308-2310,2461-2464,2522-2528.
        // Separating contacts retain default collider0, so IgnoreCollision(owner1)
        // misses them and repeated earliest owner hits starve neighbor2 until the cap.
        assert.ok(park.mCollisionLocations.get(0n).m_locations.filter(location => location.collider === 0n).length > 1);
    }
    else
    {
        assert.deepEqual(Array.from(owner.mNewPos), [0, 0, 0]); assert.ok(neighbor.x > 5);
    }
});

test("mushroom overflow and troll deadline overflow fail with evolution semaphore released", () =>
{
    const park = new Park(); add(park); park.AddMushroom(1, 10, Infinity); park.SetBallFree(0, true);
    park.currentTime = 2147484;
    assert.throws(() => park.Evolve(), /elapsed milliseconds/); assert.equal(park.inEvolve, false);
    park.currentTime = 2147483647;
    assert.throws(() => park.SetBallTroll(1, 1), /deadline/);
});

test("mushroom legacy/master IDs and dynamic double-allocation remain native", () =>
{
    for (const dynamic of [false, true])
    {
        configure(dynamic); const park = new Park(); park.isMaster = true;
        add(park); park.AddMushroom(1, 10, 5); park.AddMushroom(1, 20, 6);
        assert.equal(park.mLocalCnt, dynamic ? -5n : -3n);
        assert.equal(park.GetBall(dynamic ? -3n : -2n).followRange, 10);
        assert.equal(park.GetBall(dynamic ? -5n : -3n).followRange, 20);
    }
});

test("mushroom replica replacement preserves goto Y/Z and has no Python evolution guard", () =>
{
    const park = new Park(); add(park); park.AddMushroom(1, 10, 5);
    const mushroom = park.GetBall(0); mushroom.mGoto[1] = 4; mushroom.mGoto[2] = 8;
    park.inEvolve = true;
    park.PyAddMushroom(1, 12, 7);
    assert.equal(park.GetBall(0), mushroom);
    assert.deepEqual(Array.from(mushroom.mGoto), [7, 4, 8]);
    assert.equal(mushroom.followRange, 12);
});

test("mushroom grows after timestamps without committing staged motion or orientation", () =>
{
    configure(true);
    const park = new Park(); add(park); park.AddMushroom(1, 10, 5);
    const mushroom = park.GetBall(0); park.SetBallFree(0, true);
    vec3.set(mushroom.mNewVel, 3, 4, 5);
    const position = Array.from(mushroom.mNewPos), velocity = Array.from(mushroom.mNewVel);
    const rotation = Array.from(mushroom.mNewRot); let inserts = 0;
    const insert = park.InsertBallInBoxes;
    park.InsertBallInBoxes = function(ball) { if (ball === mushroom) inserts++; return insert.call(this, ball); };
    park.Evolve(10000000);
    assert.equal(mushroom.mNewTime, 10000000n); assert.equal(inserts, 1);
    assert.deepEqual(Array.from(mushroom.mNewPos), position);
    assert.deepEqual(Array.from(mushroom.mNewVel), velocity);
    assert.deepEqual(Array.from(mushroom.mNewRot), rotation);
    assert.notDeepEqual(mushroom.mOldPos, mushroom.mNewPos, "integration staged its position but growth did not swap it");
});

for (const iterative of [false, true])
test(`troll moves through inclusive deadline then becomes fixed rigid, iterative=${iterative}`, () =>
{
    configure(false, iterative);
    const park = new Park(), ball = add(park); ball.vx = 10;
    park.PySetBallTroll(ball.id, 0);
    assert.equal(ball.effectStamp, 1); assert.ok(ball.isFree && ball.isInteractive);
    assert.equal(ball.mode, Mode.DSTBALL_TROLL); assert.equal(ball.vx, 10);
    park.Evolve(); assert.equal(ball.mode, Mode.DSTBALL_TROLL); const first = ball.x;
    park.Evolve(); assert.ok(ball.x > first); assert.equal(ball.mode, Mode.DSTBALL_RIGID);
    assert.equal(ball.isFree, false); assert.equal(ball.isInteractive, false);
    assert.deepEqual(Array.from(ball.mNewVel), [0, 0, 0]);
    assert.deepEqual(Array.from(ball.mOldVel), [0, 0, 0]);
    const finalX = ball.x; park.Evolve(); assert.equal(ball.x, finalX);
});

test("SetBallRigid preserves velocity, freedom and interactive membership", () =>
{
    const park = new Park(), ball = add(park, 1, true); park.SetBallInteractive(1, true); ball.vx = 10;
    park.PySetBallRigid(1);
    assert.equal(ball.mode, Mode.DSTBALL_RIGID); assert.ok(ball.isFree && ball.isInteractive);
    assert.equal(ball.vx, 10); park.Evolve(); assert.ok(ball.x > 0 && ball.vx > 0);
});

test("petrification waits until later ball commits and rechecks mode/deadline", () =>
{
    for (const cancel of [false, true])
    {
        const park = new Park(), troll = add(park, 1, true), later = add(park, 2, true, 100);
        park.SetBallTroll(1, 1); park.currentTime = 1; later.vx = 1;
        const insert = park.InsertBallInBoxes;
        park.InsertBallInBoxes = function(ball)
        {
            if (ball === later)
            {
                assert.equal(troll.mode, Mode.DSTBALL_TROLL); assert.ok(troll.isFree);
                if (cancel) troll.mEffectStamp = 20;
            }
            return insert.call(this, ball);
        };
        park.Evolve();
        assert.equal(troll.mode, cancel ? Mode.DSTBALL_TROLL : Mode.DSTBALL_RIGID);
    }
});

test("dead bubbles and moribund trolls do not enter petrification", () =>
{
    for (const dead of [false, true])
    {
        const park = new Park(), ball = add(park); park.SetBallTroll(1, 1); park.currentTime = 5;
        if (dead) park.InDeadBubble = () => true; else ball.isMoribund = true;
        park.Evolve(); assert.equal(ball.mode, Mode.DSTBALL_TROLL); assert.ok(ball.isFree);
    }
});

test("troll collection remains independent across nested park evolution", () =>
{
    const outer = new Park(), inner = new Park();
    const first = add(outer), second = add(inner), mover = add(outer, 2, true, 100);
    outer.SetBallTroll(first.id, 1); inner.SetBallTroll(second.id, 1);
    outer.currentTime = inner.currentTime = 1; mover.vx = 1;
    const insert = outer.InsertBallInBoxes;
    outer.InsertBallInBoxes = function(ball)
    {
        if (ball === mover) inner.Evolve();
        return insert.call(this, ball);
    };
    outer.Evolve();
    assert.equal(first.mode, Mode.DSTBALL_RIGID); assert.equal(second.mode, Mode.DSTBALL_RIGID);
    assert.equal(first.isFree, false); assert.equal(second.isFree, false);
});

test("petrification materializes MiniBalls but native inEvolve insertion omits the ball map", () =>
{
    const park = new Park(), ball = add(park); ball.AddMiniBall(20, 0, 0, 2);
    const oldId = ball.miniBalls[0].id; assert.ok(park.GetBall(oldId));
    park.SetBallTroll(1, 1); assert.equal(park.GetBall(oldId), null);
    let created = null; const create = park.AddMiniball;
    park.AddMiniball = function(...args) { created = create.apply(this, args); return created; };
    park.Evolve(); park.Evolve();
    assert.equal(ball.mode, Mode.DSTBALL_RIGID);
    // Source: destiny/src/Ballpark.cpp:3187-3204,3624-3636. No map insertion in Evolve.
    assert.ok(created.mMyBox); assert.equal(ball.miniBalls[0].id, created.id);
    assert.equal(park.GetBall(created.id), null); assert.notEqual(created.id, oldId);
});

test("harmonic fields store before mode events; notifications remove FIELD even on equal writes", () =>
{
    const park = new Park(), ball = add(park);
    const seen = [];
    park._pyOS = { SendEvent(value, event, name, flags, format, oldMode, mode)
    { if (name === "DoModeChange") seen.push([value.harmonic, value.corporationID, value.allianceID, oldMode, mode]); return true; } };
    park.PySetBallHarmonic(1, 9007199254740993n, 2, 3, true);
    assert.deepEqual(seen, [[9007199254740993n, 2, 3, Mode.DSTBALL_STOP, Mode.DSTBALL_FIELD]]);
    assert.equal(ball.isMassive, false, "native core does not alter participation");
    for (const property of ["harmonic", "corporationID", "allianceID"])
    {
        park.SetBallHarmonic(1, 1, 2, 3, true); ball[property] = ball[property];
        assert.equal(ball.mode, Mode.DSTBALL_STOP, property);
    }
    park.GotoPoint(1, 100, 0, 0); park.SetBallHarmonic(1, 2, 3, 4, false);
    assert.equal(ball.mode, Mode.DSTBALL_GOTO);
    const detached = new Ball(); detached.harmonic = -2; detached.corporationID = 4; detached.allianceID = 5;
    assert.deepEqual([detached.mHarmonic, detached.mCorporationID, detached.mAllianceID], [-2n, 4, 5]);
});

test("boid enabling retains native stale follow links, with passive drag rather than follow thrust", () =>
{
    const park = new Park(), ball = add(park, 1, true), target = add(park, 2, false, 1000);
    park.FollowBall(1, 2, 1); park.SetBoid(1, true);
    assert.equal(ball.mode, Mode.DSTBALL_BOID); assert.equal(ball.mFollowPtr, target);
    assert.ok(target.mFollowers.has(ball.id)); ball.vx = 10;
    park.Evolve(); assert.deepEqual(Array.from(ball.mLastG), [0, 0, 0]); assert.ok(ball.x > 0);
    park.SetBoid(1, false); assert.equal(ball.mode, Mode.DSTBALL_STOP);
    assert.equal(ball.mFollowPtr, target); assert.ok(target.mFollowers.has(ball.id));
});

test("all native passive modes supply zero intrinsic thrust without Stop", () =>
{
    for (const mode of [Mode.DSTBALL_BOID, Mode.DSTBALL_FIELD, Mode.DSTBALL_RIGID, Mode.DSTBALL_MINIBALL])
    {
        const park = new Park(), ball = add(park, 1, true); ball.mMode = mode; ball.vx = 10;
        park.EvolveStop = () => { assert.fail("passive mode cannot use Stop's steering"); };
        park.Evolve(); assert.deepEqual(Array.from(ball.mLastG), [0, 0, 0]); assert.ok(ball.x > 0);
        assert.equal(ball.mode, mode);
    }
});

test("special-mode Python arity and native integer boundaries fail explicitly", () =>
{
    const park = new Park(); add(park);
    for (const run of [() => park.PySetBallRigid(), () => park.PySetBallTroll(1),
        () => park.PySetBallHarmonic(1, 1, 2, 3), () => park.PySetBoid(1), () => park.SetBoid(1, 1, 1)])
        assert.throws(run, TypeError);
    for (const run of [() => park.SetBallTroll(1, 2147483648), () => park.PySetBoid(1, NaN),
        () => park.PySetBallHarmonic(1, 1, 2, 3, 2147483648), () => park.SetBallHarmonic(1, 1, 0.5, 0),
        () => { park.GetBall(1).harmonic = 9223372036854775808n; }]) assert.throws(run, RangeError);
    park.SetBallRigid(999); park.SetBallTroll(999, 1); park.SetBallHarmonic(999, 1, 2, 3, false);
});

test("queued field actions precede affiliation and preserve native sentinel decisions", () =>
{
    // Source: destiny/python/destiny/net/server/_actions.py:475-508.
    const park = new Park(); add(park); const actions = new Actions(park);
    for (const [harmonic, corporation, alliance, massive] of [[-1n, -1, -1, false], [-2n, -1, -1, true], [-1n, 7, -1, true], [-1n, -1, 8, true]])
    {
        actions.set_ball_harmonic(1, harmonic, corporation, alliance, true);
        const history = actions.flush_history();
        assert.deepEqual(history.map(row => row[2]), [["SetBallMassive", [1n, massive]],
            ["SetBallHarmonic", [1n, harmonic, corporation, alliance, true]]]);
        for (const [, , [method, args]] of history) park[method](...args);
        assert.equal(park.GetBall(1).isMassive, massive); assert.equal(park.GetBall(1).mode, Mode.DSTBALL_FIELD);
    }
    actions.set_ball_harmonic(1, -1, -1, -1, false); actions.set_ball_troll(1, 3);
    assert.deepEqual(actions.flush_history().map(row => row[2]), [
        ["SetBallHarmonic", [1n, -1n, -1, -1, false]], ["SetBallTroll", [1n, 3]]]);
});
