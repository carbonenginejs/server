import assert from "node:assert/strict";
import test from "node:test";
import { Timer, TimedFunction } from "@carbonenginejs/server/destiny/_util/timing";
import { CjsBallparkController } from "@carbonenginejs/server";
import { Actions } from "@carbonenginejs/server/destiny/net/server";

// Source: destiny/python/destiny/_util/timing.py:8-32.
test("TimedFunction preserves this/result and returns the host token in finally", () =>
{
    const events = [], host = { EnterTasklet(context) { events.push(context); return 7; }, ReturnFromTasklet(token) { events.push(token); } };
    function action(value) { return this.base + value; }
    const wrapped = TimedFunction("label", host)(action);
    assert.equal(wrapped.call({ base: 4 }, 3), 7); assert.deepEqual(events, ["label", 7]);
    assert.equal(wrapped.name, action.name); assert.equal(wrapped.__wrapped__, action);
});
test("TimedFunction exits on handler throw but not failed entry", () =>
{
    let returns = 0;
    const host = { EnterTasklet() { return 1; }, ReturnFromTasklet() { ++returns; } };
    const wrapped = TimedFunction("label", host)(() => { throw new Error("body"); });
    assert.throws(wrapped, /body/); assert.equal(returns, 1);
    host.EnterTasklet = () => { throw new Error("entry"); };
    assert.throws(wrapped, /entry/); assert.equal(returns, 1);
});
test("Timer enters with previous token on reuse and exit never suppresses", () =>
{
    const events = [], host = { EnterTasklet(context) { events.push(context); return 4; }, ReturnFromTasklet(token) { events.push(token); } };
    const timer = new Timer("label", host);
    assert.equal(timer.__enter__(), undefined); assert.equal(timer.ctxt, 4); assert.equal(timer.__exit__(), undefined);
    timer.__enter__(); timer.__exit__(); assert.deepEqual(events, ["label", 4, 4, 4]);
});
test("timing wrappers return promises without awaiting completion", async () =>
{
    const events = [], host = { EnterTasklet() { return 1; }, ReturnFromTasklet() { events.push("exit"); } };
    const promise = Promise.resolve(42), wrapped = TimedFunction("label", host)(() => promise);
    assert.equal(wrapped(), promise); assert.deepEqual(events, ["exit"]); assert.equal(await promise, 42);
});
test("Actions timing uses native labels and balances failure", () =>
{
    const park = new CjsBallparkController(), events = [], host = {
        EnterTasklet(context) { events.push(context); return events.length; }, ReturnFromTasklet(token) { events.push(token); } };
    const actions = new Actions(park, { taskletTimer: host });
    actions.clean_up_followers(); actions.undo_pending_cloak(1);
    assert.deepEqual(events, ["destiny.net::actions::clean_up_followers", 1, "destiny.net::actions::undo_pending_cloak", 3]);
    park.GetRemoteFollowers = () => { throw new Error("native failure"); };
    assert.throws(() => actions.clean_up_followers(), /native failure/); assert.equal(events.at(-1), 5);
});
