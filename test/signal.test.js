import assert from "node:assert/strict";
import test from "node:test";
import { Signal } from "@carbonenginejs/server/destiny/_util/signal";

// Source: destiny/python/destiny/_util/signal.py:8-97.
// Source-derived tests; the donor tree contains no dedicated Signal fixture.
test("Signal deduplicates free callbacks and receiver/function pairs separately", () =>
{
    const signal = new Signal("demo"), seen = [], first = { id: 1 }, second = { id: 2 };
    function slot(x) { seen.push([this?.id ?? 0, x]); }
    signal.connect(slot, first); signal.connect(slot, first); signal.connect(slot, second);
    signal.connect(slot); signal.connect(slot); assert.equal(signal.__len__(), 3);
    signal.__call__([7]); assert.deepEqual(seen, [[0, 7], [1, 7], [2, 7]]);
    signal.disconnect(slot, first); signal.disconnect(slot, first); signal.disconnect(slot);
    assert.equal(signal.__len__(), 1); assert.equal(signal.debugDisplayName, "demo");
    assert.match(signal.__repr__(), /^demo <Signal connected to/);
    signal.clear(); assert.equal(signal.__repr__(), "demo <Signal>");
});
test("Signal callbacks mutate future snapshots, not the current emission", () =>
{
    const signal = new Signal(), seen = [];
    function late() { seen.push("late"); }
    function first() { seen.push("first"); signal.clear(); signal.connect(late); }
    function second() { seen.push("second"); }
    signal.connect(first); signal.connect(second); signal.__call__();
    assert.deepEqual(seen, ["first", "second"]); signal.__call__(); assert.deepEqual(seen, ["first", "second", "late"]);
});
test("monitor precedes snapshot and receives explicit positional and keyword arguments", () =>
{
    const signal = new Signal("event"), args = [4], kwargs = { key: 5 }, seen = [];
    function slot(a, options) { seen.push([a, options]); }
    Signal.StartSignalMonitoring((name, positional, named) =>
    { assert.equal(name, "event"); assert.equal(positional, args); assert.equal(named, kwargs); signal.connect(slot); });
    try { signal.__call__(args, kwargs); assert.deepEqual(seen, [[4, kwargs]]); }
    finally { Signal.StopSignalMonitoring(); }
});
test("monitor errors propagate before delivery; handler errors log and continue", () =>
{
    const signal = new Signal(), seen = [], original = console.error;
    function fail() { throw new Error("handler"); } function ok() { seen.push("ok"); }
    signal.connect(fail); signal.connect(ok);
    Signal.StartSignalMonitoring(() => { throw new Error("monitor"); });
    try { assert.throws(() => signal.__call__(), /monitor/); assert.deepEqual(seen, []); }
    finally { Signal.StopSignalMonitoring(); }
    console.error = (...args) => seen.push(args[2].message);
    try { signal.__call__(); assert.deepEqual(seen, ["handler", "ok"]); }
    finally { console.error = original; }
});
test("iterators retain a strong snapshot after disconnect and clear", () =>
{
    const signal = new Signal(), receiver = { value: 3 }; function slot() { return this.value; }
    signal.connect(slot, receiver); const snapshot = signal.__iter__(); signal.clear();
    assert.equal(signal.__len__(), 0); assert.equal(snapshot.next().value(), 3);
});
test("JS weak records retain neither receiver nor method strongly", () =>
{
    const signal = new Signal(), receiver = {}; function slot() {}
    signal.connect(slot); signal.connect(slot, receiver);
    assert.ok(signal._functions[0] instanceof WeakRef);
    assert.ok(signal._methods[0].receiver instanceof WeakRef); assert.ok(signal._methods[0].functions[0] instanceof WeakRef);
    // Deterministically exercise dead-reference cleanup without depending on GC timing.
    signal._functions[0].deref = () => undefined; signal._methods[0].receiver.deref = () => undefined;
    assert.equal(signal.__len__(), 0); assert.deepEqual([...signal.__iter__()], []);
});
test("JS arrow callbacks are allowed; noncallables are rejected", () =>
{
    const signal = new Signal(), seen = [], arrow = value => seen.push(value);
    signal.connect(arrow); signal.__call__([8]); assert.deepEqual(seen, [8]);
    assert.throws(() => signal.connect({}), TypeError); assert.throws(() => signal.connect(arrow, 4), TypeError);
});
test("nested Signal emissions have independent snapshots", () =>
{
    const signal = new Signal(), seen = [];
    function callback(n) { seen.push(n); if (n === 0) signal.__call__([1]); }
    signal.connect(callback); signal.__call__([0]); assert.deepEqual(seen, [0, 1]);
});
test("keyword mappings are isolated per handler while nested values stay shared", () =>
{
    const signal = new Signal(), kwargs = { value: 1, nested: [] }, seen = [];
    function first(options) { options.value = 9; options.nested.push(2); }
    function second(options) { seen.push([options.value, options.nested]); }
    signal.connect(first); signal.connect(second); signal.__call__([], kwargs);
    assert.deepEqual(seen, [[1, [2]]]); assert.equal(kwargs.value, 1);
});
