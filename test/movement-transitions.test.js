import assert from "node:assert/strict";
import test from "node:test";
import { CjsBallparkController as Park, CjsDestinyBall as Ball } from "@carbonenginejs/server";
import { vec3d } from "../dist/destiny/math/vec3d.js";

// Source: destiny/src/Ballpark.cpp:3879-3941,4007-4066,4471-4643,5416-5469.
const Mode = Ball.DSTBALLMODE;
function add(park, id, x = 0)
{
    return park.AddBall(id, 13e6, 2, 10, true, false, false, false, false,
        x, 0, 0, 0, 0, 0, 0.9, 0.95);
}

for (const command of ["FollowBall", "Orbit"]) test(`${command} preserves old order on native bubble/finite-range rejection`, () =>
{
    const park = new Park(), ball = add(park, 1), target = add(park, 2);
    park.GotoPoint(ball.id, 100, 200, 300);
    target.mNewBubble = ball.mNewBubble + 1;
    park[command](ball.id, target.id, 1);
    assert.equal(ball.mode, Mode.DSTBALL_GOTO);
    target.mNewBubble = ball.mNewBubble;
    park[command](ball.id, target.id, 1e40); // Overflow after native float narrowing.
    assert.equal(ball.mode, Mode.DSTBALL_GOTO);
    park[command](Number.MAX_VALUE, Number.MAX_VALUE, NaN); // Range is checked first.
    park[command](ball.id, target.id, -0.1);
    assert.equal(ball.followRange, Math.fround(-0.1));
});

for (const command of ["FollowBall", "Orbit"]) test(`${command} callbacks observe stop cleanup and new fields before set insertion`, () =>
{
    const park = new Park(), ball = add(park, 1), previous = add(park, 2), target = add(park, 3);
    park.FollowBall(ball.id, previous.id);
    ball.mEffectStamp = 91; ball.mOwnerId = 92n;
    const events = [];
    park._pyOS = { SendEvent(value, event, name, flags, format, oldMode, mode)
    {
        assert.equal(value.mMode, oldMode);
        events.push([oldMode, mode, value.mFollowId, value.mEffectStamp, value.mOwnerId,
            previous.mFollowers.has(ball.id), target.mFollowers.has(ball.id)]);
        return true;
    } };
    park[command](ball.id, target.id, 12);
    const mode = command === "FollowBall" ? Mode.DSTBALL_FOLLOW : Mode.DSTBALL_ORBIT;
    assert.deepEqual(events, [[Mode.DSTBALL_FOLLOW, Mode.DSTBALL_STOP, 0n, 0, 0n, false, false],
        [Mode.DSTBALL_STOP, mode, target.id, 0, 0n, false, false]]);
    assert.ok(target.mFollowers.has(ball.id));
});

test("native negative target IDs remain available but Python wrappers reject them", () =>
{
    // Source: destiny/src/Thunkers.cpp:244-269,330-355.
    const park = new Park(), ball = add(park, 1), target = add(park, -20n);
    for (const command of ["FollowBall", "Orbit"])
    {
        park[command](ball.id, target.id);
        assert.equal(ball.followId, target.id);
        assert.throws(() => park[`Py${command}`](ball.id, target.id), RangeError);
    }
});

test("GotoDirection preserves zero-length-underflow values and supports pointer arguments", () =>
{
    // Source: destiny/src/Vector3d.h:62-72.
    const park = new Park(), ball = add(park, 1);
    park.GotoDirection(ball, vec3d.fromValues(1e-200, 0, 0));
    assert.equal(ball.gotoX, 1e-200 * 1e17);
    park.GotoDirection(ball.id, 0, 0, 0);
    assert.deepEqual(Array.from(ball.mGoto), [0, 0, 0]);
    park.GotoDirection(null, [1, 2, 3]);
});

test("GotoPoint retains target through nested commands and balances wrappers on throw", () =>
{
    const park = new Park(), ball = add(park, 1), other = add(park, 2);
    park.GotoPoint(ball.id, 1, 0, 0);
    let entered = false, throwing = false;
    park._pyOS = { SendEvent(value)
    {
        if (value === ball && !entered)
        {
            entered = true;
            park.GotoDirection(other.id, 0, 1, 0);
            if (throwing) throw Error("event");
        }
        return true;
    } };
    park.GotoPoint(ball.id, 10, 20, 30);
    assert.deepEqual(Array.from(ball.mGoto), [10, 20, 30]);
    assert.deepEqual(Array.from(other.mGoto), [0, 1e17, 0]);
    const count = vec3d._pool.length;
    entered = false; throwing = true;
    assert.throws(() => park.GotoPoint(ball.id, 40, 50, 60), /event/);
    assert.equal(vec3d._pool.length, count);
});

test("pointer GotoPoint reads an aliased target after native stop callbacks", () =>
{
    const park = new Park(), ball = add(park, 1);
    park.GotoPoint(ball.id, 1, 2, 3);
    park._pyOS = { SendEvent(value, event, name, flags, format, previous, mode)
    { if (mode === Mode.DSTBALL_STOP) ball.mGoto[0] = 42; return true; } };
    park.GotoPoint(ball, ball.mGoto);
    assert.equal(ball.gotoX, 42);
});

test("ID Stop skips an already stopped ball; pointer Stop retains unrelated follow fields", () =>
{
    const park = new Park(), ball = add(park, 1), target = add(park, 2);
    ball.mFollowPtr = target; ball.mFollowId = target.id; target.mFollowers.add(ball.id);
    ball.mEffectStamp = 42; ball.mOwnerId = 43n;
    const setMode = ball.SetMode.bind(ball); let calls = 0;
    ball.SetMode = mode => { ++calls; setMode(mode); };
    park.Stop(ball.id); assert.equal(calls, 0);
    park.Stop(ball); assert.equal(calls, 1);
    assert.equal(ball.mFollowPtr, target); assert.equal(ball.mOwnerId, 43n); assert.equal(ball.mEffectStamp, 42);
    assert.ok(target.mFollowers.has(ball.id));
});

for (const master of [false, true]) test(`Stop stale map validation differs on master=${master}`, () =>
{
    const park = new Park(); park.isMaster = master;
    const ball = add(park, 1), target = add(park, 2), stale = add(park, 3);
    park.FollowBall(ball.id, target.id);
    ball.mFollowPtr = stale; stale.mFollowers.add(ball.id);
    const error = console.error, warn = console.warn, messages = [];
    console.error = console.warn = (...args) => messages.push(args);
    try { park.Stop(ball.id); }
    finally { console.error = error; console.warn = warn; }
    assert.equal(stale.mFollowers.has(ball.id), !master);
    assert.ok(target.mFollowers.has(ball.id));
    assert.equal(ball.mFollowId, 0n); assert.equal(ball.mFollowPtr, null);
    assert.equal(messages.length, master ? 0 : 2);
});

test("StopAllFollowers uses a snapshot while callbacks add another follower", () =>
{
    const park = new Park(), leader = add(park, 1), first = add(park, 2), late = add(park, 3);
    park.FollowBall(first.id, leader.id);
    park._pyOS = { SendEvent(ball, event, name, flags, format, previous, mode)
    { if (ball === first && mode === Mode.DSTBALL_STOP) park.FollowBall(late.id, leader.id); return true; } };
    park.StopAllFollowers(leader);
    assert.equal(first.mode, Mode.DSTBALL_STOP);
    assert.equal(late.mode, Mode.DSTBALL_FOLLOW);
    assert.deepEqual([...leader.mFollowers], [late.id]);
});

test("StopAllFollowers preserves velocity direction for missiles and interactive orbiters", () =>
{
    const park = new Park(), leader = add(park, 1), missile = add(park, 2), orbiter = add(park, 3);
    park.FollowBall(missile.id, leader.id); missile.mMode = Mode.DSTBALL_MISSILE; missile.isMassive = true;
    park.Orbit(orbiter.id, leader.id); orbiter.isInteractive = true;
    missile.mNewVel[1] = 10; orbiter.mNewVel[2] = 10;
    park.StopAllFollowers(leader);
    assert.equal(missile.isMassive, false);
    assert.deepEqual(Array.from(missile.mGoto), [0, 1e17, 0]);
    assert.deepEqual(Array.from(orbiter.mGoto), [0, 0, 1e17]);
    assert.equal(leader.mFollowers.size, 0);
});
