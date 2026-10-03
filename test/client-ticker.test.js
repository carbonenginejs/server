import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { CjsBallparkController as Park, CjsDestinyBall as Ball, CjsDestinyStream as Stream, settings } from "@carbonenginejs/server";
import { Ticker, ClientTickerInterface, TickErrorHandlerInterface, BaseTicker } from "@carbonenginejs/server/destiny/net/client";

// Source: destiny/python/destiny/test/net/client/test_ticker.py:18-125.
// Source: destiny/python/destiny/net/client/_ticker.py:14-415.
afterEach(() => settings.Reset());
const Mode = Ball.DSTBALLMODE;
const logger = { level: 30, info() {}, warn() {}, error() {} };
const host = { RegisterForTicks() {}, UnregisterForTicks() {} };
function add(park, id, x = 0)
{
    return park.AddBall(id, 1, 1, 1, true, false, true, true, false, x, 0, 0, 0, 0, 0, 1, 1);
}
function callbacks()
{
    const errors = new TickErrorHandlerInterface(); errors.fatal = 0; errors.recoverable = 0;
    errors.on_fatal_desync = () => ++errors.fatal; errors.on_recoverable_desync = () => ++errors.recoverable;
    const client = new ClientTickerInterface(); client.events = [];
    client.on_set_state = () => client.events.push("set");
    client.on_ballpark_local_action = (name, args) => client.events.push([name, args]);
    client.should_log_actions = () => false;
    client.get_ball_destruction_delay = () => 0;
    client.get_ball_destruction_delays = ids => new Map(ids.map(id => [id, 0]));
    client.clean_up_after_ball_removal = () => {};
    client.clean_up_after_multiple_ball_removal = () => {};
    return { errors, client };
}
function bytes(park)
{
    const stream = new Stream(); park.WriteFullStateToStream(stream); return stream.Read();
}
function tick(ticker, park, stamp) { ticker.do_pre_tick(); Park.prototype.Evolve.call(park); ticker.do_post_tick(stamp); }
function setup()
{
    const { errors, client } = callbacks(), ticker = new Ticker(errors, client, { logger });
    const park = new Park(host), source = new Park(); ticker.set_ballpark(park);
    add(source, 1); add(source, 2, 1000); add(source, 3, -1000);
    source.Orbit(2, 1); source.GotoPoint(3, 0, 0, 0); source.GotoDirection(1, 0, 1, 0);
    for (let i = 0; i < 10; ++i) source.Evolve();
    ticker.update([[0, ["SetState", [bytes(source), 1n]]]], false); tick(ticker, park, 10);
    return { ticker, park, errors, client };
}
test("donor SetState restores native clock, orbit and ego", () =>
{
    const { park, ticker } = setup(); assert.equal(park.currentTime, 11); assert.equal(park.GetBall(2).mode, Mode.DSTBALL_ORBIT);
    assert.equal(park.ego, 1n); assert.equal(park.isRunning, true); assert.equal(ticker._state_is_valid, true);
});
test("donor Stop action applies to the current tick", () =>
{
    const { ticker, park } = setup(); ticker.update([[11, ["Stop", [2n]]]], false);
    ticker.do_pre_tick(); ticker.do_post_tick(10); assert.equal(park.GetBall(2).mode, Mode.DSTBALL_STOP);
});
test("donor near-future state waits for its tick", () =>
{
    const { ticker, park } = setup(); ticker.update([[12, ["Stop", [2n]]]], false);
    tick(ticker, park, 11); assert.equal(park.GetBall(2).mode, Mode.DSTBALL_ORBIT);
    tick(ticker, park, 12); assert.equal(park.GetBall(2).mode, Mode.DSTBALL_STOP);
});
test("donor late arrival rewinds and applies the action", () =>
{
    const { ticker, park } = setup(); tick(ticker, park, 11); tick(ticker, park, 12);
    assert.equal(park.GetBall(2).mode, Mode.DSTBALL_ORBIT);
    ticker.update([[12, ["Stop", [2n]]]], false); tick(ticker, park, 13);
    assert.equal(park.GetBall(2).mode, Mode.DSTBALL_STOP);
});
test("donor rewind before first snapshot fails", () => assert.equal(setup().ticker.synchronize_to_simulation_time(9), 0));
for (const count of [1, 2]) test(`donor rewind restores removed ball after ${count} tick(s)`, () =>
{
    const { ticker, park } = setup(); tick(ticker, park, 11); park.RemoveBall(1);
    assert.equal(park.GetBall(1), null); if (count === 2) tick(ticker, park, 12);
    assert.equal(park.currentTime, 12 + count - 1); assert.equal(ticker.synchronize_to_simulation_time(11), 1);
    assert.equal(park.currentTime, 11); assert.ok(park.GetBall(1));
});
test("donor successful action reports no desync", () =>
{
    const { ticker, errors } = setup(); ticker.update([[11, ["Stop", [2n]]]], false); ticker.do_pre_tick();
    assert.equal(errors.fatal, 0); assert.equal(errors.recoverable, 0);
});
test("donor mixed timestamps report fatal desync but still merge", () =>
{
    const { ticker, errors } = setup(); ticker.update([[11, ["Stop", [2n]]], [12, ["Stop", [2n]]]], false);
    assert.equal(errors.fatal, 1); assert.equal(ticker._history.length, 2);
});
test("donor failed synchronization reports recoverable desync", () =>
{
    const { ticker, errors } = setup(); ticker.update([[11, ["Stop", [2n]]]], false);
    ticker.synchronize_to_simulation_time = () => 0; ticker.do_pre_tick(); assert.equal(errors.recoverable, 1);
});

test("packaged actions use injected Load once, drop only failed packages and do not recursively expand", () =>
{
    const { errors } = callbacks(), messages = [], calls = [], ticker = new BaseTicker(errors,
        { logger: { ...logger, error: (...args) => messages.push(args) }, marshal: { Load(payload)
        { calls.push(payload); if (payload === "bad") throw new Error("decode"); return [[1, ["PackagedAction", "nested"]], [1, ["Stop", [2n]]]]; } } });
    const ordinary = [1, ["Stop", [3n]]]; let received;
    ticker._flush_state = (state, wait) => { received = [state, wait]; };
    ticker.update([[1, ["PackagedAction", "ignored"]]], false); assert.equal(calls.length, 0);
    ticker.set_ballpark(new Park()); ticker.update([[1, ["PackagedAction", "good"]], [1, ["PackagedAction", "bad"]], ordinary], true);
    assert.deepEqual(calls, ["good", "bad"]); assert.equal(messages.length, 1); assert.equal(received[0].length, 3);
    assert.equal(received[0][0][1][0], "PackagedAction"); assert.equal(received[0][2], ordinary); assert.equal(received[1], true);
});
test("latest arriving SetState filters older history but can move its timestamp backwards", () =>
{
    const { ticker } = setup();
    ticker.update([[20, ["Stop", [1n]]]], true); ticker.update([[15, ["Stop", [2n]]]], false);
    const state = [[18, ["SetState", [new Uint8Array(), 1n]]]]; ticker.update(state, false);
    assert.deepEqual(ticker._history.map(entry => entry[0][0][0]), [18, 20]);
    ticker.update([[17, ["Stop", [3n]]]], false); assert.equal(ticker._history.length, 2);
    ticker.update([[16, ["SetState", [new Uint8Array(), 1n]]]], false); assert.equal(ticker._latest_set_state_time, 16);
});
test("waiting groups block; +1/+2 defer while +3 fast-forwards using core Evolve", () =>
{
    for (const delta of [1, 2, 3])
    {
        const { ticker, park } = setup(); park.Evolve = () => { throw new Error("game override"); };
        ticker.update([[11 + delta, ["Stop", [2n]]]], true); ticker.do_pre_tick(); assert.equal(park.currentTime, 11);
        ticker.update([[11 + delta, ["Stop", [2n]]]], false); ticker.do_pre_tick();
        assert.equal(park.currentTime, delta < 3 ? 11 : 14); assert.equal(park.GetBall(2).mode, delta < 3 ? Mode.DSTBALL_ORBIT : Mode.DSTBALL_STOP);
    }
});
test("pre-tick extra evolution requires more than one remaining group", () =>
{
    for (const count of [2, 3])
    {
        const { ticker, park } = setup(); ticker._real_flush_state = () => {};
        ticker._history = Array.from({ length: count }, () => [[[11, ["Stop", [2n]]]], false]);
        ticker.do_pre_tick(); assert.equal(park.currentTime, count === 3 ? 12 : 11);
    }
});
test("snapshot pruning retains the first and last five; stopped parks do not store", () =>
{
    const { ticker, park } = setup(); ticker.clear_states();
    for (let i = 0; i < 11; ++i) { park.currentTime = i; ticker.store_state(i % 2 === 0); }
    assert.deepEqual(ticker._states.map(item => item[1]), [0, 6, 7, 8, 9, 10]); assert.equal(ticker._last_stamp, 10);
    park.Pause(); ticker.store_state(); assert.equal(ticker._states.length, 6);
});
test("rebasing preserves only a last previous-tick mid-state", () =>
{
    const { ticker, park } = setup(); ticker.clear_states(); ticker.store_state(true); const mid = ticker._states[0];
    park.Evolve(); ticker.flush_simulation_history(); assert.equal(ticker._states.length, 2); assert.equal(ticker._states[0], mid);
    ticker.flush_simulation_history(); assert.equal(ticker._states.length, 1); assert.equal(ticker._states[0][2], false);
    ticker.flush_simulation_history(false); assert.deepEqual(ticker._states, []);
});
test("rewind selects the last eligible list entry and retains absent balls, existing minis and old samples", () =>
{
    const { ticker, park } = setup(); const first = ticker._states[0];
    park.currentTime = 8; ticker.store_state(); const laterEntry = ticker._states[ticker._states.length - 1];
    ticker._states = [first, laterEntry]; park.currentTime = 20;
    const absent = add(park, 99); absent.AddMiniBall(1, 2, 3, 4); const mini = absent.miniBalls[0];
    const oldX = park.GetBall(1)._oldX = 999;
    let restoredStamp; const original = laterEntry[0].ReadInt32;
    laterEntry[0].ReadInt32 = function() { const value = original.call(this); if (restoredStamp === undefined) restoredStamp = value; return value; };
    park.ReadFullStateFromStream = park.PyReadFullStateFromStream = () => { throw new Error("game reader override"); };
    assert.equal(ticker.synchronize_to_simulation_time(10), 1); assert.equal(restoredStamp, 8); assert.equal(park.currentTime, 10);
    assert.equal(park.GetBall(99), absent); assert.equal(absent.miniBalls[0], mini); assert.equal(ticker._states.length, 2);
    // A zero-evolve rewind isolates retained old samples from Evolve's ordinary update.
    park.GetBall(1)._oldX = oldX; park.currentTime = 20; ticker.synchronize_to_simulation_time(8); assert.equal(park.GetBall(1)._oldX, oldX);
});
test("core action dispatch bypasses overrides, continues after errors and removes cloaked non-ego", () =>
{
    const { ticker, park, client } = setup(); park.Stop = () => { throw new Error("game override"); };
    ticker._real_flush_state([[11, ["MissingAction", []]], [11, ["Stop", [2]]]]);
    assert.equal(park.GetBall(2).mode, Mode.DSTBALL_STOP);
    ticker._real_flush_state([[11, ["CloakBall", [3, 1]]]]); assert.equal(park.GetBall(3), null);
    assert.deepEqual(client.events.slice(1).map(entry => entry[0]), ["Stop", "CloakBall"]);
    ticker._real_flush_state([[11, ["CloakBall", [1, 1]]]]); assert.ok(park.GetBall(1));
});
test("invalid cloak and non-Blue method names fail before side effects and later actions continue", () =>
{
    const { ticker, park } = setup();
    ticker._real_flush_state([[11, ["CloakBall", [3, 256]]], [11, ["__defineGetter__", ["injected", () => 1]]],
        [11, ["_ReadFullStateBody", []]], [11, ["Stop", [2]]]]);
    assert.ok(park.GetBall(3)); assert.equal(park.GetBall(3).isCloaked, 0);
    assert.equal(Object.hasOwn(park, "injected"), false); assert.equal(park.GetBall(2).mode, Mode.DSTBALL_STOP);
});
test("incoming Python bindings and nested native calls bypass application method overrides", () =>
{
    const { ticker, park } = setup(); let intercepted = 0;
    for (const name of ["FollowBall", "Stop", "CloakBall", "AddBall", "AddOldStyleOrientedBall", "PyAddOldStyleOrientedBall"])
        park[name] = () => { ++intercepted; throw new Error("application override"); };
    ticker._real_flush_state([[11, ["FollowBall", [3n, 2n, 5]]], [11, ["CloakBall", [3n, 1]]],
        [11, ["AddBall", [4n, 13e6, 2, 10, true, false, false, false, false, 10, 20, 30, 0, 0, 0, 1, 1]]]]);
    assert.equal(intercepted, 0); assert.equal(park.GetBall(3), null); assert.ok(park.GetBall(4));
});
test("replay rejects noninteger and nonfinite range counts without evolving", () =>
{
    const { ticker, park } = setup();
    for (const stamp of [11.5, Infinity, NaN]) assert.throws(() => ticker.synchronize_to_simulation_time(stamp), RangeError);
    assert.equal(park.currentTime, 11);
});
test("Blue Evolve ignores supplied time and uses the native zero-tick Python entry", () =>
{
    const { ticker, park } = setup(); park.Evolve = () => { throw new Error("game override"); };
    ticker._real_flush_state([[11, ["Evolve", [123456789n]]]]);
    assert.equal(park.currentTime, 12); assert.equal(park.GetBall(1).mNewTime, 0n);
});
test("removal callback ordering and release preserve native running/ticker fields", () =>
{
    const { ticker, park, client } = setup(), seen = [], ball = park.GetBall(2);
    client.get_ball_destruction_delay = (value, terminal) => { seen.push(["delay", value, terminal]); return 0; };
    client.clean_up_after_ball_removal = (id, value, terminal) => { seen.push(["cleanup", value, terminal]); assert.equal(park.GetBall(id), null); };
    ticker.RemoveBall(2, true); assert.deepEqual(seen, [["delay", ball, true], ["cleanup", ball, true]]);
    client.clean_up_after_multiple_ball_removal = (ids, release) => { seen.push("group-cleanup"); assert.equal(release, true); assert.ok(park.GetBall(1)); };
    client.get_ball_destruction_delays = (ids, release) => { assert.equal(seen.at(-1), "group-cleanup"); return new Map(ids.map(id => [id, 0])); };
    ticker._should_rebase = true; const last = ticker._last_stamp; ticker.release();
    assert.equal(park.balls.size, 0); assert.equal(park.isRunning, true); assert.equal(ticker._ballpark, park);
    assert.equal(ticker._last_stamp, last); assert.equal(ticker._should_rebase, true); assert.equal(ticker._state_is_valid, false);
    assert.deepEqual(ticker._states, []); assert.deepEqual(ticker._history, []);
});

test("late Stop replay reaches the same supported tick-boundary position and velocity", () =>
{
    const source = new Park(), moving = source.AddBall(1, 13e6, 2, 10, true, false, false, false, false,
        0, 0, 0, 0, 0, 0, 0.9, 0.95);
    source.GotoDirection(1, 1, 2, 3);
    for (let i = 0; i < 5; ++i) source.Evolve();
    const initial = bytes(source), { errors, client } = callbacks(), ticker = new Ticker(errors, client, { logger });
    const replica = new Park(host); ticker.set_ballpark(replica); ticker._set_state(initial, 1n);
    for (let i = 5; i < 20; ++i) { if (i === 9) source.Stop(1); source.Evolve(); replica.Evolve(); }
    ticker.update([[9, ["Stop", [1n]]]], false); ticker.do_pre_tick();
    assert.equal(replica.currentTime, 9); assert.equal(ticker.synchronize_to_simulation_time(20), 1);
    const actual = replica.GetBall(1);
    for (const field of ["mNewPos", "mNewVel"])
        for (let i = 0; i < 3; ++i) assert.ok(Math.abs(actual[field][i] - moving[field][i]) < 1e-10);
    assert.equal(errors.recoverable, 0);
});

test("client hooks integrate synchronously with the existing OnTick phases", () =>
{
    const { ticker, park } = setup(), phases = [];
    park._pyOS = { SendEvent(owner, event, name, flags, format, stamp)
    {
        if (name === "DoPreTick") { phases.push([name, stamp]); ticker.do_pre_tick(); }
        if (name === "DoPostTick") { phases.push([name, stamp]); ticker.do_post_tick(stamp); }
        return true;
    }, PyError() { throw new Error("unexpected callback failure"); } };
    ticker.update([[11, ["Stop", [2n]]]], false);
    park.mFirstTime = false; park.OnTick(0n, 10000000n, null);
    assert.equal(park.GetBall(2).mode, Mode.DSTBALL_STOP);
    assert.deepEqual(phases, [["DoPreTick", 11], ["DoPostTick", 12]]);
    assert.equal(park.currentTime, 12); assert.equal(ticker._should_rebase, false);
});

test("set_ballpark retains histories and updates both interfaces; balls remains the live writable dictionary", () =>
{
    const { ticker, park, errors, client } = setup(), history = ticker._history, states = ticker._states;
    ticker.set_ballpark(null); assert.equal(errors._ballpark, null); assert.equal(client._ballpark, null);
    ticker.set_ballpark(park); assert.equal(ticker._history, history); assert.equal(ticker._states, states);
    assert.equal(park.balls, park._balls); const replacement = new Map(); park.balls = replacement;
    assert.equal(park._balls, replacement); assert.ok(park.mFreeBalls.size > 0);
});
