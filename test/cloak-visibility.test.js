import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { CjsBallparkController as Park, CjsDestinyBall as Ball, DSTCONSTANTS as C, settings } from "@carbonenginejs/server";
import { Actions } from "@carbonenginejs/server/destiny/net/server";

// Source: destiny/python/destiny/test/ballpark/test_visibility.py:8-82.
// Source: destiny/python/destiny/test/net/server/test_actions.py:400-417,441-495.
// Source: destiny/src/Ballpark.cpp:5223-5366.
afterEach(() => settings.Reset());
const Mode = Ball.DSTBALLMODE;
function add(park, id = 1, x = 0, radius = 1, massive = true)
{
    return park.AddBall(id, 13e6, radius, 100, true, false, massive, false, false,
        x, 0, 0, 0, 0, 0, 1, 1);
}

test("native cloak constants and numeric state remain separate from command side effects", () =>
{
    assert.deepEqual(C, { DSTLOCALBALLS: -1073741824, DSTNORMALCLOAK: 1, DSTRESTORECLOAK: 2, DSTGMCLOAK: 3 });
    const park = new Park(), ball = add(park);
    assert.equal(park.mLocalHiCnt, BigInt(C.DSTLOCALBALLS));
    assert.equal(ball.isCloaked, 0);
    ball.isCloaked = true; assert.equal(ball.isCloaked, 1);
    ball.isCloaked = 255; assert.equal(ball.isCloaked, 255);
    assert.equal(ball.isMassive, true); assert.equal(ball.mSensor.active, false);
    for (const [value, expected] of [[-1, 255], [256, 0], [257, 1], [-2147483648, 0], [2147483647, 255]])
    {
        ball.isCloaked = value; assert.equal(ball.isCloaked, expected);
    }
    for (const invalid of [-2147483649, 2147483648, 1.5, NaN]) assert.throws(() => { ball.isCloaked = invalid; }, RangeError);
    ball.isCloaked = false; assert.equal(ball.isCloaked, 0);
});

for (const scenario of ["cloak", "nonmassive", "uncloak", "massive", "proper warp"])
test(`donor cloak fixture: ${scenario}`, () =>
{
    const park = new Park(), ball = add(park);
    if (scenario === "cloak" || scenario === "nonmassive")
    {
        park.PyCloakBall(ball.id, C.DSTNORMALCLOAK);
        assert.equal(ball.isCloaked, 1); assert.equal(ball.isMassive, false);
    }
    else
    {
        ball.isCloaked = true; ball.isMassive = false;
        if (scenario === "proper warp")
        {
            ball.maxVelocity = 1; ball.vx = 1;
            park.WarpTo(ball.id, 1e10, 0, 0); park.Evolve();
            assert.equal(ball.IsWarping(), true);
        }
        park.PyUncloakBall(ball.id);
        assert.equal(ball.isCloaked, 0);
        assert.equal(ball.isMassive, scenario !== "proper warp");
    }
});

for (const master of [false, true])
for (const mode of [C.DSTNORMALCLOAK, C.DSTRESTORECLOAK, C.DSTGMCLOAK])
test(`cloak sensor ownership: master=${master}, mode=${mode}`, () =>
{
    const park = new Park(); park.isMaster = master;
    const ball = add(park);
    park.GotoPoint(ball.id, 100, 20, 0);
    ball.mSensor.elapsed = 1.25;
    park.CloakBall(ball.id, mode, 11.123456789);
    assert.equal(ball.isCloaked, mode); assert.equal(ball.isMassive, false);
    assert.equal(ball.mMode, Mode.DSTBALL_GOTO);
    assert.equal(ball.mSensor.active, master && mode === 1);
    if (ball.mSensor.active)
    {
        assert.equal(ball.mSensor.range, Math.fround(11.123456789));
        assert.equal(ball.mSensor.period, 2); assert.equal(ball.mSensor.elapsed, 1.25);
    }
    park.UncloakBall(ball.id);
    assert.equal(ball.isCloaked, 0); assert.equal(ball.isMassive, true);
    assert.equal(ball.mSensor.active, false);
});

test("cloak preserves sensor rejection and normal-to-special sensor retention", () =>
{
    const park = new Park(); park.isMaster = true;
    const ball = add(park);
    park.CloakBall(ball.id, 1, -2);
    assert.equal(ball.isCloaked, 1); assert.equal(ball.mSensor.active, false);
    park.CloakBall(ball.id, 1, 10); ball.mSensor.elapsed = 1.5; ball.mSensor.balls.set(99n, 0n);
    park.CloakBall(ball.id, 1, 20);
    assert.equal(ball.mSensor.elapsed, 1.5); assert.equal(ball.mSensor.balls.size, 0);
    park.CloakBall(ball.id, 2, 30); park.UncloakBall(ball.id);
    assert.equal(ball.mSensor.active, true); assert.equal(ball.mSensor.range, 20);
    assert.equal(park.mProximityBalls.get(ball.id), ball);
});

test("cloak stops incoming followers after sensor setup while retaining its own command", () =>
{
    const park = new Park(); park.isMaster = true;
    const target = add(park, 1), follower = add(park, 2, 10);
    const missile = add(park, 3, 20), orbiter = add(park, 4, 30), snapshots = [];
    park.FollowBall(follower.id, target.id, 5);
    park.MissileFollow(missile.id, target.id, follower.id); missile.vx = 1;
    park.Orbit(orbiter.id, target.id, 5); orbiter.isInteractive = true; orbiter.vy = 1;
    park.GotoPoint(target.id, 100, 0, 0);
    const stop = Park.prototype.Stop;
    Park.prototype.Stop = function(ball)
    {
        snapshots.push([target.mSensor.active, target.isCloaked, target.isMassive]);
        return stop.call(this, ball);
    };
    try { park.CloakBall(target.id, 1, 5); }
    finally { Park.prototype.Stop = stop; }
    assert.ok(snapshots.length > 0);
    assert.ok(snapshots.every(row => row[0] && row[1] === 0 && row[2]));
    assert.equal(follower.mode, Mode.DSTBALL_STOP);
    assert.equal(missile.mode, Mode.DSTBALL_GOTO); assert.equal(missile.isMassive, false);
    assert.equal(orbiter.mode, Mode.DSTBALL_GOTO);
    assert.equal(target.mFollowers.size, 0); assert.equal(target.mode, Mode.DSTBALL_GOTO);
    park.Orbit(follower.id, target.id, 5);
    assert.equal(follower.mode, Mode.DSTBALL_STOP);
});

test("uncloak silently clears only eligible contacts and proper warp skips the whole phase", () =>
{
    for (const stamp of [-1, 0])
    {
        const park = new Park(), ball = add(park), active = add(park, 2), disabled = add(park, 3);
        const dead = add(park, 4), elsewhere = add(park, 5), stale = add(park, 6);
        for (const sensor of [active, disabled, dead, elsewhere, stale])
        {
            sensor.AddProximitySensor(20); sensor.mSensor.balls.set(ball.id, 0n);
        }
        disabled.mSensor.active = false; dead.isMoribund = true;
        elsewhere.mNewBubble = ball.mNewBubble + 1; stale.mHasProximity = false;
        ball.mMode = Mode.DSTBALL_WARP; ball.mEffectStamp = stamp;
        ball.isCloaked = 1; ball.isMassive = false;
        park._pyOS = { SendEvent() { assert.fail("uncloak must not emit proximity leave"); } };
        park.UncloakBall(ball.id);
        assert.equal(ball.isCloaked, 0); assert.equal(ball.isMassive, stamp < 0);
        assert.equal(active.mSensor.balls.has(ball.id), stamp >= 0);
        assert.equal(disabled.mSensor.balls.has(ball.id), stamp >= 0);
        for (const sensor of [dead, elsewhere, stale]) assert.equal(sensor.mSensor.balls.has(ball.id), true);
    }
});

test("normal cloak detects fixed neighbors and uncloak allows a new enter event", () =>
{
    const park = new Park(); park.isMaster = true;
    const ball = add(park), fixed = add(park, 2, 10), watcher = add(park, 3, 20), events = [];
    park.SetBallFree(fixed.id, false);
    park._pyOS = { SendEvent(source, event, name, flags, format, ...args)
    {
        if (name === "DoProximity") events.push([source.id, ...args]);
        return true;
    }, PyError() { assert.fail("unexpected dispatch failure"); } };
    watcher.AddProximitySensor(50, 0); watcher.CheckForProximity_Sensor();
    assert.equal(watcher.mSensor.balls.has(ball.id), true);
    park.CloakBall(ball.id, 1, 50); ball.mSensor.period = 0; ball.CheckForProximity_Sensor();
    assert.ok(events.some(row => row[0] === ball.id && row[1] === fixed.id && row[2] === 1));
    events.length = 0; park.UncloakBall(ball.id);
    assert.deepEqual(events, []); watcher.CheckForProximity_Sensor();
    assert.deepEqual(events, [[watcher.id, ball.id, 1]]);
});

test("cloak wrappers preserve required mode, byte-to-char narrowing and missing-ball behavior", () =>
{
    const park = new Park(); park.isMaster = true;
    const ball = add(park);
    assert.throws(() => park.PyCloakBall(ball.id), TypeError);
    assert.throws(() => park.PyCloakBall(ball.id, 1, 2, 3), TypeError);
    assert.throws(() => park.PyUncloakBall(), TypeError);
    assert.throws(() => park.PyUncloakBall(ball.id, 2), TypeError);
    for (const mode of [-1, 256, 1.5, NaN]) assert.throws(() => park.PyCloakBall(999, mode), RangeError);
    for (const mode of [0, 128, 255]) { park.PyCloakBall(ball.id, mode); assert.equal(ball.isCloaked, 0); }
    park.PyCloakBall(ball.id, 127); assert.equal(ball.isCloaked, 127);
    park.PyUncloakBall(ball.id); park.PyCloakBall(ball.id, true);
    assert.equal(ball.isCloaked, 1); assert.equal(ball.mSensor.range, 2000);
    park.PyCloakBall(999, 1); park.PyUncloakBall(999);
});

for (const scenario of ["clear", "occluder", "nonmassive", "cloaked"])
test(`donor visibility fixture: ${scenario}`, () =>
{
    const park = new Park(), src = add(park), dst = add(park, 2, 100);
    if (scenario !== "clear")
    {
        const occluder = add(park, 3, 50, 25, scenario !== "nonmassive");
        if (scenario === "cloaked") occluder.isCloaked = true;
    }
    assert.equal(park.PyCheckVisibility(src.id, dst.id), scenario === "occluder" ? 3n : 0n);
});

test("visibility preserves tangent, endpoint, inside-sphere and zero-length near-root rules", () =>
{
    const park = new Park(), src = add(park), dst = add(park, 2, 100), block = add(park, 3, 50, 10);
    block.y = 10; assert.equal(park.CheckVisibility(src.id, dst.id), block.id, "tangent inside");
    block.y = 10.001; assert.equal(park.CheckVisibility(src.id, dst.id), 0n);
    block.y = 0; block.x = 10; assert.equal(park.CheckVisibility(src.id, dst.id), 0n, "near root at source");
    block.x = 5; assert.equal(park.CheckVisibility(src.id, dst.id), 0n, "source inside sphere");
    block.x = 110; assert.equal(park.CheckVisibility(src.id, dst.id), 0n, "near root at target");
    block.x = -50; assert.equal(park.CheckVisibility(src.id, dst.id), 0n, "sphere behind source");
    block.x = 50; block.isMoribund = true;
    assert.equal(park.CheckVisibility(src.id, dst.id), block.id, "moribund is not a visibility filter");
    dst.x = 0; assert.equal(park.CheckVisibility(src.id, dst.id), 0n);
});

test("visibility uses first map hit, exact IDs, and native error sentinels", () =>
{
    const park = new Park(), src = add(park), dst = add(park, 2, 100);
    const far = add(park, 9007199254740993n, 80, 5), near = add(park, 3, 20, 5);
    assert.equal(park.CheckVisibility(src.id, dst.id), far.id);
    far.isCloaked = 3; assert.equal(park.CheckVisibility(src.id, dst.id), near.id);
    near.mNewBubble = src.mNewBubble + 1; assert.equal(park.CheckVisibility(src.id, dst.id), 0n);
    assert.equal(park.CheckVisibility(999, dst.id), -2n);
    assert.equal(park.CheckVisibility(src.id, 999), -2n);
    dst.mNewBubble = src.mNewBubble + 1; assert.equal(park.CheckVisibility(src.id, dst.id), -2n);
    assert.throws(() => park.PyCheckVisibility(src.id), TypeError);
    assert.throws(() => park.PyCheckVisibility(999, 9007199254740992), RangeError);
});

test("visibility keeps translated double-precision geometry on a diagonal ray", () =>
{
    const park = new Park(), src = add(park, 1, 1e12), dst = add(park, 2, 1e12 + 6);
    const block = add(park, 3, 1e12 + 3, 1);
    src.y = 1e12; dst.y = 1e12 + 8; block.y = 1e12 + 4;
    assert.equal(park.CheckVisibility(src.id, dst.id), block.id);
    block.z = 2;
    assert.equal(park.CheckVisibility(src.id, dst.id), 0n);
});

test("donor cloak actions preserve bubble hint, pending queries, pruning and absent uncloak", () =>
{
    const park = new Park(), actions = new Actions(park);
    assert.equal(actions.cloak_ball(1, 1, 1000), false);
    assert.deepEqual(actions.flush_history(), []);
    assert.equal(actions.get_pending_cloak_mode(1), null);
    assert.equal(actions.has_pending_cloak(1), false); assert.equal(actions.has_pending_uncloak(1), false);
    const ball = add(park);
    assert.equal(actions.get_pending_cloak_mode(ball.id), 0);
    ball.mOldBubble = 7; ball.mNewBubble = 8;
    assert.equal(actions.cloak_ball(ball.id, 1, 1000), true);
    assert.equal(ball.isCloaked, 0, "queue admission does not execute");
    assert.equal(actions.has_pending_cloak(ball.id), true); assert.equal(actions.get_pending_cloak_mode(ball.id), 1);
    assert.deepEqual(actions.flush_history(), [[ball.id, 0, ["CloakBall", [ball.id, 1, 1000], 7]]]);
    ball.mOldBubble = ball.mNewBubble = 0;
    actions.cloak_ball(ball.id, 2, 200); actions.uncloak_ball(ball.id);
    actions.cloak_ball(ball.id, 3, 300);
    assert.equal(actions.get_pending_cloak_mode(ball.id), 3);
    actions.uncloak_ball(ball.id); assert.equal(actions.get_pending_cloak_mode(ball.id), 3);
    const oldHistory = actions._system_history;
    actions.undo_pending_cloak(2); assert.equal(actions.has_pending_cloak(ball.id), true);
    actions.set_ball_radius(ball.id, 42);
    assert.equal(actions.undo_pending_cloak(ball.id), undefined);
    assert.notEqual(actions._system_history, oldHistory);
    assert.equal(oldHistory.length, 4, "pruning replaces the array");
    assert.equal(actions.has_pending_cloak(ball.id), false); assert.equal(actions.has_pending_uncloak(ball.id), true);
    assert.equal(actions.get_pending_cloak_mode(ball.id), 0);
    assert.equal(actions._prune_pending_actions(ball.id, "UncloakBall"), 2);
    assert.deepEqual(actions.flush_history(), [[ball.id, 0, ["SetBallRadius", [ball.id, 42]]]]);
    actions.uncloak_ball(99);
    assert.deepEqual(actions.flush_history(), [[99n, 0, ["UncloakBall", [99n]]]]);
});

test("cloak queue retains zero/sentinel bubble hints and pending mode after removal", () =>
{
    const park = new Park(), ball = add(park), actions = new Actions(park);
    ball.mOldBubble = ball.mNewBubble = 0;
    actions.cloak_ball(ball.id, 2, 5);
    ball.mOldBubble = -1; ball.mNewBubble = 4;
    actions.cloak_ball(ball.id, 3, 10);
    park.RemoveBall(ball.id);
    actions.uncloak_ball(ball.id);
    assert.equal(actions.get_pending_cloak_mode(ball.id), 3);
    const history = actions.flush_history();
    assert.equal(history[0][2][2], 0); assert.equal(history[1][2][2], -1);
    assert.equal(actions.get_pending_cloak_mode(ball.id), null);
});
