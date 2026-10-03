import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { afterEach } from "node:test";
import { CjsBallparkController as Park, CjsDestinyBall as Ball, settings } from "@carbonenginejs/server";
import { vec3 } from "@carbonenginejs/runtime/math/vec3";

// Source: destiny/python/destiny/test/ballpark/evolve/test_follow.py:16-71.
// Source: destiny/python/destiny/test/test_ball.py:46-82.
// Source: destiny/python/destiny/test/ballpark/test_getters_and_setters.py:383-402.
const fixture = JSON.parse(readFileSync(new URL("fixtures/carbon-formations.json", import.meta.url)));
const Mode = Ball.DSTBALLMODE;
afterEach(() => settings.Reset());

function space(park, id, x = 0)
{
    return park.AddBall(id, 13e6, 2, 10, true, false, true, false, false,
        x, 0, 0, 0, 0, 0, 0.9, 0.95);
}

function setup(master = false)
{
    const park = new Park(); park.isMaster = master;
    park.LoadFormations(fixture.formations);
    const leader = space(park, 1), follower = space(park, 2, 100);
    park.SetBallFormation(leader.id, 1);
    return { park, leader, follower };
}

for (const moving of [false, true]) test(`donor formation ten-tick trajectory, moving leader=${moving}`, () =>
{
    const park = new Park(); park.LoadFormations(fixture.formations);
    const follower = space(park, 1), leader = space(park, 2, -5);
    park.SetBallFormation(leader.id, 1);
    park.FormationFollow(follower.id, leader.id, leader.ReserveFormationSlot());
    if (moving) park.GotoPoint(leader.id, 0, 100, 0);
    const expected = fixture.trajectories[moving ? "test_formation_follow_moving_ball" : "test_formation_follow_stopped_ball"];
    for (let tick = 0; tick < expected.length; ++tick)
    {
        park.Evolve();
        for (let q = 0; q < 3; ++q)
            assert.ok(Math.abs(follower.mNewPos[q] - expected[tick][q]) < 5e-5,
                `test_follow.py tick ${tick + 1}, axis ${q}: ${follower.mNewPos[q]} != ${expected[tick][q]}`);
    }
});

test("donor default, sequential reservation, exhaustion and freed-slot reuse", () =>
{
    const detached = new Ball();
    assert.equal(detached.ReserveFormationSlot(), -1); assert.equal(detached.formationID, 255);
    const { leader } = setup();
    for (let i = 0; i < 4; ++i) assert.equal(leader.ReserveFormationSlot(), i);
    assert.equal(leader.ReserveFormationSlot(), -1);
    leader.FreeFormationSlot(2);
    assert.equal(leader.ReserveFormationSlot(), 2);
    assert.throws(() => { leader.formationID = 2; }, TypeError);
});

test("native formation size guards retain unsigned empty-size underflow", () =>
{
    const { park, leader } = setup();
    park.LoadFormations([["empty", []], ["too many", Array.from({ length: 17 }, () => [1, 0, 0])]]);
    assert.equal(leader.ReserveFormationSlot(), -1);
    park.SetBallFormation(leader.id, 0);
    leader.mFormationSlots = 65535;
    assert.equal(leader.ReserveFormationSlot(), -1);
    leader.FreeFormationSlot(3);
    assert.equal(leader.mFormationSlots, 65527);
    assert.throws(() => leader.FreeFormationSlot(16), RangeError);
    assert.throws(() => leader.FreeFormationSlot(-1), RangeError);
    leader.mFormationID = 1;
    leader.FreeFormationSlot(-1); // Unsigned negative exceeds the nonempty formation size.
});

test("loading copies f64 vectors, ignores names and retains ball reservations", () =>
{
    const { park, leader } = setup(); leader.ReserveFormationSlot();
    const offsets = [[2 ** 40 + 0.25, 2, 3]], table = [["not retained", offsets]];
    park.LoadFormations(table); offsets[0][0] = 0;
    assert.ok(park.mFormations[0][0] instanceof Float64Array);
    assert.equal(park.mFormations[0][0][0], 2 ** 40 + 0.25);
    assert.equal(leader.mFormationID, 1); assert.equal(leader.mFormationSlots, 1);
    assert.equal(leader.ReserveFormationSlot(), -1);
    park.ClearAll(); assert.equal(park.mFormations.length, 1);
});

test("ClearAll preserves retained formation state without mode events or slot cleanup", () =>
{
    // Source: destiny/src/Ballpark.cpp:5894-5953; destiny/src/Ball.cpp:124-131.
    const { park, leader, follower } = setup(true);
    park.FormationFollow(follower.id, leader.id, leader.ReserveFormationSlot());
    park.LoadFormations([]); // Existing formation IDs now refer outside the table.
    const events = [];
    park._pyOS = { SendEvent(...args) { events.push(args); return true; } };
    park.ClearAll();
    assert.deepEqual(events, []);
    assert.equal(follower.mMode, Mode.DSTBALL_FORMATION);
    assert.equal(follower.mFollowPtr, leader);
    assert.ok(leader.mFollowers.has(follower.id));
    assert.equal(leader.mFormationSlots, 1);
    assert.equal(follower.isMoribund, false);
    assert.equal(follower.mPark, null); assert.equal(leader.mPark, null);
});

test("donor out-of-range assignment preserves sentinel and shrinking drops high followers", () =>
{
    const park = new Park(); park.LoadFormations(fixture.formations);
    const follower = space(park, 1), leader = space(park, 2);
    park.SetBallFormation(leader.id, 3); assert.equal(leader.formationID, 255);
    park.SetBallFormation(leader.id, 1); assert.equal(leader.formationID, 1);
    park.FormationFollow(follower.id, leader.id, 1);
    park.SetBallFormation(leader.id, 2);
    assert.equal(follower.mode, Mode.DSTBALL_STOP);
    assert.equal(follower.followId, 0n); assert.equal(follower.mFollowPtr, null);
});

for (const master of [false, true]) test(`Stop frees formation reservations only on master=${master}`, () =>
{
    const { park, leader, follower } = setup(master);
    const slot = leader.ReserveFormationSlot();
    park.FormationFollow(follower.id, leader.id, slot);
    follower.mOwnerId = 91n;
    park.Stop(follower.id);
    assert.deepEqual([follower.mEffectStamp, follower.mOwnerId, follower.mFollowRange], [0, 0n, 0]);
    assert.equal(leader.mFormationSlots, master ? 0 : 1);
});

test("native reversed shrink-reset loop retains reservations without active followers", () =>
{
    const { park, leader } = setup(true);
    for (let i = 0; i < 4; ++i) leader.ReserveFormationSlot();
    park.SetBallFormation(leader.id, 2);
    assert.equal(leader.mFormationSlots, 15);
    park.SetBallFormation(leader.id, 1);
    assert.equal(leader.ReserveFormationSlot(), -1);
});

test("formation removal stops ordinary followers too and stores leader ID after callbacks", () =>
{
    const { park, leader, follower } = setup(true);
    const ordinary = space(park, 3, 200);
    park.FormationFollow(follower.id, leader.id, leader.ReserveFormationSlot());
    park.FollowBall(ordinary.id, leader.id);
    const observed = [];
    park._pyOS = { SendEvent(ball, event)
    { if (event === "Destiny::Ball::DoModeChange") observed.push([ball.id, leader.mFormationID]); return true; } };
    park.SetBallFormation(leader.id, -1);
    assert.equal(leader.formationID, 255); assert.equal(leader.mFormationSlots, 0);
    assert.deepEqual(observed, [[follower.id, 1], [ordinary.id, 1]]);
    assert.equal(ordinary.mode, Mode.DSTBALL_STOP);
});

test("formation command stops before bubble/cloak rejection and does not reject moribund leaders", () =>
{
    const { park, leader, follower } = setup();
    for (const reason of ["bubble", "cloak"])
    {
        park.GotoPoint(follower.id, 1000, 0, 0);
        if (reason === "bubble") leader.mNewBubble = follower.mNewBubble + 1;
        else leader.isCloaked = true;
        park.FormationFollow(follower.id, leader.id, 0);
        assert.equal(follower.mode, Mode.DSTBALL_STOP);
        leader.mNewBubble = follower.mNewBubble; leader.isCloaked = false;
    }
    leader.isMoribund = true;
    follower.mFollowRange = 42;
    park.FormationFollow(follower.id, leader.id, 0);
    assert.equal(follower.mode, Mode.DSTBALL_FORMATION);
    assert.equal(follower.mFollowRange, 42); assert.equal(leader.mFormationSlots, 0);
});

test("signed-char narrowing, occupied slots and negative-slot invalid access follow native boundaries", () =>
{
    const { park, leader, follower } = setup();
    park.SetBallFormation(leader.id, 257); assert.equal(leader.mFormationID, 1);
    leader.ReserveFormationSlot();
    park.FormationFollow(follower.id, leader.id, 256);
    assert.equal(follower.mEffectStamp, 0);
    park.FormationFollow(follower.id, leader.id, -1);
    assert.equal(follower.mEffectStamp, -1);
    assert.throws(() => park.EvolveFormation(follower), TypeError);
});

test("formation target uses physical rotation and narrowing before double-position addition", () =>
{
    const config = settings.Get(); config.useDynamicalOrientation = true; settings.Apply(config);
    const { park, leader, follower } = setup();
    park.SetBallPosition(leader.id, 1e10, 1e10, 1e10);
    park.SetBallPosition(follower.id, 1e10, 1e10, 1e10);
    park.SetBallFormation(leader.id, -1);
    park.LoadFormations([["axis", [[3, 0, 0]]]]); park.SetBallFormation(leader.id, 0);
    park.SetBallRotation(leader.id, 0, Math.SQRT1_2, 0, Math.SQRT1_2);
    park.FormationFollow(follower.id, leader.id, 0);
    park.EvolveFormation(follower);
    assert.ok(Math.abs(follower.mGoto[0] - 1e10) < 1e-5);
    assert.ok(Math.abs(follower.mGoto[2] - (1e10 - 7)) < 1e-5);
});

test("formation rotation reentry owns pooled offsets and returns them after throws", () =>
{
    const { park, leader, follower } = setup();
    park.LoadFormations([["unused", []], ["axes", [[3, 0, 0], [0, 3, 0]]]]);
    park.FormationFollow(follower.id, leader.id, 0);
    const nested = space(park, 3); park.FormationFollow(nested.id, leader.id, 1);
    const rotate = leader.GetRotatedVector.bind(leader);
    let inside = false, fail = false;
    leader.GetRotatedVector = value =>
    {
        if (!inside) { inside = true; park.EvolveFormation(nested); inside = false; }
        else if (fail) throw Error("nested rotation");
        rotate(value);
    };
    park.EvolveFormation(follower);
    assert.deepEqual(Array.from(follower.mGoto), [7, 0, 0]);
    assert.deepEqual(Array.from(nested.mGoto), [0, 7, 0]);
    const alloc = vec3.alloc, unalloc = vec3.unalloc;
    let live = 0;
    vec3.alloc = () => { ++live; return alloc(); };
    vec3.unalloc = value => { --live; unalloc(value); };
    try { fail = true; assert.throws(() => park.EvolveFormation(follower), /nested rotation/); assert.equal(live, 0); }
    finally { vec3.alloc = alloc; vec3.unalloc = unalloc; }
});
