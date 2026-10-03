import assert from "node:assert/strict";
import test from "node:test";
import { CjsBlueOS } from "@carbonenginejs/runtime/blue";
import { CjsBallparkController } from "@carbonenginejs/server/destiny";
import { Actions } from "@carbonenginejs/server/destiny/net/server";

// Source: destiny/python/destiny/test/ballpark/test_time.py
// Source: destiny/src/Ballpark.cpp:219-330,550-559,3013-3032,4415-4441,5471-5572,5699-5766
// Donor: 114e89fa584f0e1a81eb0a679aabf41af8870072. No native binary is required.
const STEP = 10000000n;

function ball(park, id = 1, free = true)
{
    return park.AddBall(id, 13000000, 2, 10, free, false, true, false, false,
        0, 0, 0, 0, 0, 0, 0.9, 0.95);
}

function eventHost()
{
    return {
        events: [], errors: 0,
        SendEvent(target, context, name, flags, format, stamp)
        {
            this.events.push({ target, context, name, flags, format, stamp });
            return true;
        },
        PyError() { this.errors++; }
    };
}

test("donor time: ballpark time initializes to zero", () =>
{
    assert.equal(new CjsBallparkController().time, 0n);
});

test("donor time: AdjustTimes adds to ballpark time", () =>
{
    const park = new CjsBallparkController();
    park.AdjustTimes(2);
    assert.equal(park.time, 2n);
    park.AdjustTimes(3);
    assert.equal(park.time, 5n);
});

test("donor lifecycle: initial state is paused", () =>
{
    assert.equal(new CjsBallparkController().isRunning, false);
});

test("donor lifecycle: can start", () =>
{
    const park = new CjsBallparkController(new CjsBlueOS());
    park.Start();
    assert.equal(park.isRunning, true);
    park.Pause();
});

test("donor lifecycle: can pause", () =>
{
    const park = new CjsBallparkController(new CjsBlueOS());
    park.Start();
    park.Pause();
    assert.equal(park.isRunning, false);
});

test("Start/Pause are idempotent and runtime manual pumping needs no simulation schema calls", () =>
{
    const host = new CjsBlueOS();
    let now = STEP;
    host.GetRealTime = () => Number(now);
    const park = new CjsBallparkController(host);
    park.Start();
    park.Start();
    assert.ok(host.IsRegisteredForTicks(park));
    host.PumpOS();
    assert.equal(park.currentTime, 1);
    assert.equal(park.time, STEP);
    park.Pause();
    park.Pause();
    now = 2n * STEP;
    host.PumpOS();
    assert.equal(park.currentTime, 1);
    park.Start();
    host.PumpOS();
    assert.equal(park.currentTime, 2);
    assert.equal(park.mFirstTime, false);
    park.Pause();
    park.OnTick(0, 3n * STEP, null);
    park.Evolve();
    assert.equal(park.currentTime, 4);
    assert.equal(park.time, 3n * STEP);
    assert.throws(() => new CjsBallparkController().Start(), /Blue tick host/);
});

test("Evolve timestamps only participating balls and keeps counter separate from time", () =>
{
    const park = new CjsBallparkController();
    const moving = ball(park), fixed = ball(park, 2, false);
    park.Evolve(5n * STEP);
    assert.deepEqual([moving.mOldTime, moving.mNewTime], [4n * STEP, 5n * STEP]);
    assert.deepEqual([fixed.mOldTime, fixed.mNewTime], [0n, 0n]);
    assert.deepEqual([park.time, park.currentTime], [0n, 1]);
    park.Evolve();
    assert.deepEqual([moving.mOldTime, moving.mNewTime], [4n * STEP, 5n * STEP]);
    park.Evolve(7n * STEP);
    assert.deepEqual([moving.mOldTime, moving.mNewTime], [5n * STEP, 7n * STEP]);
    const actions = new Actions(park);
    actions.stop(1);
    assert.equal(actions.flush_history()[0][1], 4);
});

test("first eligible tick ignores backlog and notifications; later ticks preserve native timestamp lag", () =>
{
    const events = eventHost(), park = new CjsBallparkController(null, events);
    const moving = ball(park);
    park.OnTick(0, STEP - 1n, "unused");
    assert.deepEqual([park.time, park.currentTime, park.mFirstTime], [0n, 0, true]);
    park.OnTick(0, STEP, null);
    assert.deepEqual(events.events, []);
    assert.deepEqual([moving.mOldTime, moving.mNewTime], [0n, STEP]);
    park.OnTick(999, 35n * STEP / 10n, null);
    assert.deepEqual([park.time, park.currentTime], [3n * STEP, 3]);
    assert.deepEqual([moving.mOldTime, moving.mNewTime], [STEP, 2n * STEP]);
    assert.deepEqual(events.events.map(e => [e.name, e.stamp]),
        [["DoPreTick", 1], ["DoPostTick", 2], ["DoPreTick", 2], ["DoPostTick", 3]]);
    assert.ok(events.events.every(e => e.target === park && e.context === `Destiny::${e.name}`
        && e.flags === null && e.format === "(i)"));
    const late = new CjsBallparkController();
    late.OnTick(0, 100n * STEP, null);
    assert.deepEqual([late.currentTime, late.time], [1, 100n * STEP]);
});

test("master drops backlog only at six whole intervals; replica catches up", () =>
{
    for (const [master, elapsed, steps, time] of [
        [true, 5.9, 5, 6], [true, 6, 1, 7], [false, 6, 6, 7]
    ])
    {
        const park = new CjsBallparkController();
        park.isMaster = master;
        park.OnTick(0, STEP, null);
        park.OnTick(0, STEP + BigInt(elapsed * 10000000), null);
        assert.deepEqual([park.currentTime, park.time], [1 + steps, BigInt(time) * STEP]);
    }
});

test("native false dispatch is reported without aborting evolution or post notification", () =>
{
    const events = eventHost(), park = new CjsBallparkController(null, events);
    const send = events.SendEvent;
    events.SendEvent = function (...args) { send.apply(this, args); return false; };
    park.OnTick(0, STEP, null);
    park.OnTick(0, 2n * STEP, null);
    assert.equal(events.errors, 2);
    assert.deepEqual(events.events.map(e => e.name), ["DoPreTick", "DoPostTick"]);
    assert.deepEqual([park.currentTime, park.time], [2, 2n * STEP]);
});

test("pre-tick commands affect the current step and post-tick sees the incremented counter", () =>
{
    const events = eventHost(), park = new CjsBallparkController(null, events);
    const moving = ball(park);
    park.OnTick(0, STEP, null);
    events.SendEvent = (target, context, name, flags, format, stamp) =>
    {
        if (name === "DoPreTick") { assert.equal(stamp, 1); park.GotoDirection(1, 1, 0, 0); }
        if (name === "DoPostTick") { assert.equal(stamp, 2); assert.ok(moving.x > 0); }
        return true;
    };
    park.OnTick(0, 2n * STEP, null);
});

test("AdjustTimes preserves zero sentinels, includes static balls and leaves currentTime untouched", () =>
{
    const park = new CjsBallparkController();
    const moving = ball(park), fixed = ball(park, 2, false);
    park.Evolve(STEP);
    fixed.mNewTime = 7n;
    park.AdjustTimes(-3);
    assert.deepEqual([park.time, park.currentTime], [-3n, 1]);
    assert.deepEqual([moving.mOldTime, moving.mNewTime, fixed.mOldTime, fixed.mNewTime], [0n, STEP - 3n, 0n, 4n]);
});

test("tickInterval changes retain native cached dt and drag until their own refresh sites", () =>
{
    const park = new CjsBallparkController(), moving = ball(park);
    const factor = moving._timeFactor;
    park.tickInterval = 250;
    park.Evolve();
    assert.equal(park.dt, 1);
    park.OnTick(0, 2500000 - 1, null);
    assert.equal(park.dt, 1);
    park.OnTick(0, 2500000, null);
    assert.equal(park.dt, 0.25);
    assert.equal(moving._timeFactor, factor);
    park.SetBallMass(1, moving.mass);
    assert.equal(moving._timeFactor, Math.exp(-1000000 * 0.25 / (moving.mass * moving.agility)));
});

test("SetBallFree sets the new timestamp one interval behind park time only on transition", () =>
{
    const park = new CjsBallparkController(), fixed = ball(park, 1, false);
    park.time = 9n * STEP;
    fixed.mOldTime = 17n;
    park.SetBallFree(1, true);
    assert.deepEqual([fixed.mOldTime, fixed.mNewTime], [17n, 8n * STEP]);
    park.time += STEP;
    park.SetBallFree(1, true);
    assert.equal(fixed.mNewTime, 8n * STEP);
});

test("donor delayed removal retains a moribund ball until eligible cleanup", () =>
{
    // Source: destiny/python/destiny/test/ballpark/test_lifecycle_management.py:25-34.
    const events = eventHost(), park = new CjsBallparkController(null, events);
    const moving = ball(park);
    park.RemoveBall(1, 100);
    assert.equal(park.GetBall(1), moving);
    assert.equal(moving.isMoribund, true);
    assert.equal(moving.isMassive, false);
    park.currentTime = 98;
    park.OnTick(0, 0, null);
    assert.equal(park.GetBall(1), moving);
    park.currentTime = 99;
    park.OnTick(0, 0, null);
    assert.equal(park.GetBall(1), null);
    assert.deepEqual(events.events.map(e => [e.target, e.context, e.name, e.format]),
        [[moving, "Destiny::Ball::DoFinalCleanup", "DoFinalCleanup", "()"]]);
});

test("buffered cleanup caps seven per call but overdue cleanup is uncapped", () =>
{
    const park = new CjsBallparkController();
    for (let id = 1; id <= 12; id++) { ball(park, id); park.RemoveBall(id, 3); }
    park.currentTime = 2;
    park.OnTick(0, 0, null);
    assert.equal(park.moribundBalls.size, 5);
    park.currentTime = 4;
    park.OnTick(0, 0, null);
    assert.equal(park.moribundBalls.size, 0);
    assert.equal(park._balls.size, 0);
});

test("re-add cancels pending removal without replacing object identity", () =>
{
    const park = new CjsBallparkController(), first = ball(park);
    park.RemoveBall(1, 100);
    assert.equal(ball(park), first);
    assert.equal(first.isMoribund, false);
    assert.equal(first.mEffectStamp, 0);
    assert.equal(park.moribundBalls.size, 0);
});

test("removal during Evolve is deferred and skips integration", () =>
{
    const park = new CjsBallparkController(), moving = ball(park);
    park.EvolveBehaviorForBall = () => park.RemoveBall(1);
    park.Evolve(STEP);
    assert.equal(park.GetBall(1), moving);
    assert.equal(moving.mNewTime, 0n);
    assert.equal(park.inEvolve, false);
    park.OnTick(0, 0, null);
    assert.equal(park.GetBall(1), null);
});

test("ClearAll releases references without cleanup callbacks or clock/lifecycle reset", () =>
{
    const events = eventHost(), host = new CjsBlueOS();
    const park = new CjsBallparkController(host, events);
    ball(park);
    park.RemoveBall(1, 100);
    park.Start();
    park.OnTick(0, STEP, null);
    park.ClearAll();
    assert.equal(park._balls.size, 0);
    assert.equal(park.moribundBalls.size, 0);
    assert.deepEqual(events.events, []);
    assert.deepEqual([park.time, park.currentTime, park.mFirstTime, park.isRunning], [STEP, 1, false, true]);
    park.Pause();
});

test("target removal preserves interactive orbit flight and stops ordinary followers", () =>
{
    // Source: destiny/src/Ballpark.cpp:5415-5468.
    const park = new CjsBallparkController(), target = ball(park, 10);
    const orbiting = ball(park, 1), following = ball(park, 2), passive = ball(park, 3);
    orbiting.isInteractive = true;
    park.SetBallVelocity(1, 0, 4, 0);
    park.Orbit(1, 10);
    park.FollowBall(2, 10);
    park.Orbit(3, 10);
    park.RemoveBall(10, 5);
    assert.equal(orbiting.mode, 0); // DSTBALL_GOTO
    assert.deepEqual([orbiting.gotoX, orbiting.gotoY, orbiting.gotoZ], [0, 1e17, 0]);
    assert.equal(following.mode, 2); // DSTBALL_STOP
    assert.equal(passive.mode, 2);
    assert.equal(target._followers.size, 0);
    for (const follower of [orbiting, following, passive])
    {
        assert.equal(follower.followId, 0n);
        assert.equal(follower._followPtr, null);
    }
});

test("deferred cleanup skips active evolution and removes invalid queued references", () =>
{
    const park = new CjsBallparkController(), moving = ball(park);
    park.RemoveBall(1, 1);
    park.inEvolve = true;
    park.BringOutTheDeads();
    assert.equal(park.GetBall(1), moving);
    park.inEvolve = false;
    moving.isMoribund = false;
    park.moribundBalls.add(null);
    park.BringOutTheDeads();
    assert.equal(park.GetBall(1), moving);
    assert.equal(park.moribundBalls.size, 0);
});

test("a JavaScript evolution exception releases the deletion guard without advancing the counter", () =>
{
    const park = new CjsBallparkController();
    ball(park);
    park.EvolveBehaviorForBall = () => { throw new Error("synthetic callback failure"); };
    assert.throws(() => park.Evolve(), /synthetic callback failure/);
    assert.equal(park.inEvolve, false);
    assert.equal(park.currentTime, 0);
    park.RemoveBall(1);
    assert.equal(park.GetBall(1), null);
});

test("all integrations precede timestamp updates, including when a later integration throws", () =>
{
    // Source: destiny/src/Ballpark.cpp:450-521,529-560.
    const park = new CjsBallparkController();
    const first = ball(park), second = ball(park, 2);
    const integrate = park.Integrate;
    park.Integrate = function (...args)
    {
        assert.deepEqual([first.mNewTime, second.mNewTime], [0n, 0n]);
        if (args[0] === second.mOldPos) throw new Error("synthetic integration failure");
        integrate.apply(this, args);
    };
    assert.throws(() => park.Evolve(STEP), /synthetic integration failure/);
    assert.deepEqual([first.mNewTime, second.mNewTime, park.currentTime], [0n, 0n, 0]);
    assert.equal(park.inEvolve, false);
    park.Integrate = integrate;
    park.Evolve(STEP);
    assert.deepEqual([first.mNewTime, second.mNewTime, park.currentTime], [STEP, STEP, 1]);
});
