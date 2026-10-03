import assert from "node:assert/strict";
import test from "node:test";
import { CjsBallparkController } from "@carbonenginejs/server/destiny";
import { Actions } from "@carbonenginejs/server/destiny/net/server";

// Source: destiny/src/Ball.h:74,99,181-182
// Source: destiny/src/Ballpark.cpp:111-112,219-330,3265-3296,5948-5949
// Source: destiny/src/IDstConstants.h:76
// JS boundary fixtures, not output captured from a native executable.
const MIN = -9223372036854775808n;
const MAX = 9223372036854775807n;
const STEP = 10000000n;
const WIDE = 9007199254740993n;

function ball(park, id = 1, free = true)
{
    return park.AddBall(id, 13000000, 2, 10, free, false, true, false, false,
        0, 0, 0, 0, 0, 0, 0.9, 0.95);
}

test("Number and BigInt IDs share identity, self rejection and follower cleanup", () =>
{
    const park = new CjsBallparkController(), first = ball(park), target = ball(park, 2n);
    assert.equal(first.id, 1n);
    assert.equal(park.GetBall(1n), first);
    assert.equal(ball(park, 1n), first);
    park.GotoPoint(1, 10, 0, 0);
    park.FollowBall(1, 1n);
    park.Orbit(1n, 1);
    assert.equal(first.mode, 0);
    assert.equal(first._followers.size, 0);
    park.FollowBall(1, 2);
    assert.equal(first.followId, 2n);
    assert.deepEqual([...target._followers], [1n]);
    park.Stop(1n);
    assert.equal(target._followers.size, 0);
    park.Orbit(1n, 2);
    park.RemoveBall(2);
    assert.equal(park.GetBall(2n), null);
    assert.equal(first.followId, 0n);
    park.RemoveBall(1);
    assert.equal(park._balls.size, 0);
});

test("adjacent wide IDs and signed-int64 endpoints stay distinct through lifecycle", () =>
{
    const park = new CjsBallparkController();
    const first = ball(park, WIDE - 1n), second = ball(park, WIDE);
    const low = ball(park, MIN), high = ball(park, MAX);
    assert.equal(park._balls.size, 4);
    assert.equal(park.GetBall(MIN), low);
    assert.equal(park.GetBall(MAX), high);
    park.FollowBall(WIDE - 1n, WIDE);
    assert.equal(first._followPtr, second);
    assert.equal(ball(park, WIDE), second);
    park.RemoveBall(WIDE, 1);
    assert.equal(first.followId, 0n);
    park.BringOutTheDeads();
    assert.equal(park.GetBall(WIDE), null);
    assert.equal(park.GetBall(WIDE - 1n), first);
});

test("native master local-ID allocation distinguishes zero and negative requests", () =>
{
    const park = new CjsBallparkController();
    park.isMaster = true;
    assert.equal(ball(park, 0).id, -2n);
    assert.equal(ball(park, 0n).id, -3n);
    assert.equal(ball(park, -17).id, -1073741825n);
    assert.equal(ball(park, -1n).id, -1073741826n);
    assert.equal(ball(park, MAX).id, MAX);
    park.time = 123;
    park.ClearAll();
    assert.equal(park.time, 123n);
    assert.equal(ball(park, 0).id, -2n);
    assert.equal(ball(park, -99n).id, -1073741825n);
});

test("native replica allocates only minus one and does not avoid explicit collisions", () =>
{
    const park = new CjsBallparkController();
    const zero = ball(park, 0), negative = ball(park, -2);
    const explicit = ball(park, -1073741825n);
    assert.equal(zero.id, 0n);
    assert.equal(negative.id, -2n);
    assert.equal(ball(park, -1), explicit);
    assert.equal(ball(park, -1n).id, -1073741826n);
    park.FollowBall(-2n, 0);
    assert.equal(negative._followPtr, zero);
    park.RemoveBall(0n);
    assert.equal(negative._followPtr, null);
});

test("invalid IDs and exhausted local counters fail without aliasing or allocation", () =>
{
    const park = new CjsBallparkController();
    for (const id of [MAX + 1n, MIN - 1n, 2 ** 53, -(2 ** 53), 1.1, NaN, Infinity, "1", true, null])
    {
        assert.throws(() => ball(park, id), RangeError);
        assert.throws(() => park.GetBall(id), RangeError);
    }
    assert.equal(park._balls.size, 0);
    assert.equal(park.mLocalHiCnt, -1073741824n);
    park.mLocalHiCnt = MIN;
    assert.throws(() => ball(park, -1), RangeError);
    assert.equal(park.mLocalHiCnt, MIN);
    park.isMaster = true;
    park.mLocalCnt = MIN;
    assert.throws(() => ball(park, 0), RangeError);
    assert.equal(park.mLocalCnt, MIN);
    assert.equal(park._balls.size, 0);
});

test("wide-ID legacy orbit retains the native low sixteen bits", () =>
{
    // Native phase uses ID & 0xffff, Ballpark.cpp:1275.
    const small = new CjsBallparkController(), large = new CjsBallparkController();
    const a = ball(small, 1), b = ball(large, WIDE);
    ball(small, 2); ball(large, 2);
    for (const [park, id] of [[small, 1], [large, WIDE]])
    {
        park.SetBallPosition(2, 100, 200, 300);
        park.Orbit(id, 2, 10);
        for (let i = 0; i < 10; i++) park.Evolve();
    }
    assert.deepEqual([b.x, b.y, b.z, b.vx, b.vy, b.vz], [a.x, a.y, a.z, a.vx, a.vy, a.vz]);
});

test("large native clocks preserve 100ns remainder and separate numeric counters", () =>
{
    const park = new CjsBallparkController(), moving = ball(park);
    const start = 130000000000000001n;
    park.OnTick(0, start, null);
    assert.deepEqual([park.time, moving.mOldTime, moving.mNewTime], [start, start - STEP, start]);
    park.OnTick(0, start + 2n * STEP + 1n, null);
    assert.deepEqual([park.time, moving.mOldTime, moving.mNewTime, park.currentTime],
        [start + 2n * STEP, start, start + STEP, 3]);
    park.AdjustTimes(-1);
    assert.deepEqual([park.time, moving.mOldTime, moving.mNewTime],
        [start + 2n * STEP - 1n, start - 1n, start + STEP - 1n]);
    const actions = new Actions(park);
    actions.stop(1);
    assert.deepEqual(actions.flush_history(), [[1n, 4, ["Stop", [1n]]]]);
});

test("signed clocks normalize safe Numbers and retain the unset zero sentinel", () =>
{
    const park = new CjsBallparkController(), moving = ball(park);
    park.time = -1;
    assert.equal(park.time, -1n);
    park.Evolve(-5);
    assert.deepEqual([moving.mOldTime, moving.mNewTime], [-10000005n, -5n]);
    park.Evolve(0);
    assert.equal(moving.mNewTime, -5n);
    const fixed = ball(park, 2, false);
    park.AdjustTimes(5n);
    assert.deepEqual([moving.mOldTime, moving.mNewTime, fixed.mNewTime], [-10000000n, 0n, 0n]);
    park.AdjustTimes(1);
    assert.equal(moving.mNewTime, 0n);
});

test("clock overflow is rejected before timestamp or physical-state mutation", () =>
{
    const park = new CjsBallparkController(), moving = ball(park), fixed = ball(park, 2, false);
    park.GotoPoint(1, 100, 0, 0);
    assert.throws(() => park.Evolve(MIN), RangeError);
    assert.deepEqual([moving.x, moving.mNewTime, park.currentTime, park.inEvolve], [0, 0n, 0, false]);
    park.time = MIN;
    assert.throws(() => park.SetBallFree(2, true), RangeError);
    assert.equal(fixed.isFree, false);
    assert.throws(() => park.OnTick(0, MAX, null), RangeError);
    assert.equal(park.currentTime, 0);
    park.time = 0;
    moving.mNewTime = MAX;
    fixed.mOldTime = 2n;
    assert.throws(() => park.AdjustTimes(1), RangeError);
    assert.deepEqual([park.time, moving.mNewTime, fixed.mOldTime], [0n, MAX, 2n]);
    park.time = MAX;
    assert.throws(() => park.AdjustTimes(1n), RangeError);
    assert.equal(park.time, MAX);
    for (const value of [MAX + 1n, MIN - 1n, 2 ** 53, 1.5, NaN, "1"])
    {
        assert.throws(() => { park.time = value; }, RangeError);
        assert.throws(() => park.Evolve(value), RangeError);
        assert.throws(() => park.OnTick(0, value, null), RangeError);
        assert.throws(() => park.AdjustTimes(value), RangeError);
    }
});

test("native interval and ordinary catch-up int32 domains are checked explicitly", () =>
{
    const park = new CjsBallparkController();
    for (const interval of [0, -1, 0.5, 214749, Infinity, NaN])
    {
        park.tickInterval = interval;
        assert.throws(() => park.OnTick(0, STEP, null), RangeError);
    }
    park.tickInterval = 1000;
    const far = 2147483648n * STEP;
    park.OnTick(0, far, null); // The first native tick evolves once regardless of backlog.
    assert.equal(park.currentTime, 1);
    assert.throws(() => park.OnTick(0, 2n * far, null), /catch-up/);
    assert.equal(park.currentTime, 1);
    park.isMaster = true;
    park.OnTick(0, 2n * far, null); // Master truncation precedes the ordinary int cast.
    assert.equal(park.currentTime, 2);
});

test("Actions canonicalize only ID slots and retain Number tick labels and scalar payloads", () =>
{
    const actions = new Actions(new CjsBallparkController());
    actions.follow_ball(1, 2, 10);
    actions.follow_ball(1n, 2n, 10);
    actions.orbit(WIDE, MIN, 2.5);
    actions.set_ball_position(MAX, 1, 2, 3, false);
    assert.equal(actions._has_pending_action(1, "FollowBall"), true);
    assert.equal(actions._has_pending_action(1n, "FollowBall"), true);
    assert.deepEqual(actions._get_pending_actions(1, "FollowBall"), [["FollowBall", [1n, 2n, 10]]]);
    assert.deepEqual(actions.flush_history(), [
        [1n, 0, ["FollowBall", [1n, 2n, 10]]],
        [WIDE, 0, ["Orbit", [WIDE, MIN, 2.5]]],
        [MAX, 0, ["SetBallPosition", [MAX, 1, 2, 3], false]]
    ]);
    for (const id of [2 ** 53, MAX + 1n, MIN - 1n, true, "1"])
    {
        assert.throws(() => actions.stop(id), RangeError);
        assert.throws(() => actions.orbit(1, id, 0), RangeError);
        assert.throws(() => actions.follow_ball(1, id, 0), RangeError);
        assert.throws(() => actions._get_pending_actions(id, "Stop"), RangeError);
        assert.throws(() => actions._has_pending_action(id, "Stop"), RangeError);
    }
    assert.deepEqual(actions.flush_history(), []);
});

test("Actions preserve Python bool Number BigInt equality without string coercion", () =>
{
    const actions = new Actions(new CjsBallparkController());
    for (const value of [true, 1, 1n]) actions.set_ball_free(1, value);
    assert.equal(actions.has_pending_set_free(1n), true);
    for (const value of [false, 0, 0n]) actions.set_ball_free(1n, value);
    assert.equal(actions.has_pending_set_not_free(1), true);
    assert.deepEqual(actions.flush_history(), [[1n, 0, ["SetBallFree", [1n, true]]], [1n, 0, ["SetBallFree", [1n, false]]]]);
    actions.set_speed_fraction(1, 9007199254740992);
    actions.set_speed_fraction(1n, 9007199254740992n);
    actions.set_speed_fraction(1, "9007199254740992");
    assert.equal(actions.flush_history().length, 2);
    actions.set_speed_fraction(1, 0.5);
    actions.set_speed_fraction(1, 0n);
    actions.set_speed_fraction(1, null);
    assert.equal(actions.flush_history().length, 3);
});
