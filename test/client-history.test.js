import assert from "node:assert/strict";
import test from "node:test";
import { merge_state_into_history as merge } from "@carbonenginejs/server/destiny/net/client";

// Source: destiny/python/destiny/test/net/client/test_mergestateintohistory.py:13-135.
const go = ["GotoDirection", [1000000176143n, 1, 0, 0]], stop = ["Stop", [1000000176143n]];
test("donor merging empty state into empty history has no effect", () =>
{
    const history = []; merge([], history, true); merge([], history, false); assert.deepEqual(history, []);
});
for (const wait of [true, false]) test(`donor first state retains wait=${wait}`, () =>
{
    const state = [[101, go]], history = []; merge(state, history, wait); assert.deepEqual(history, [[state, wait]]);
});
for (const [first, second] of [[true, false], [false, true], [false, false]])
test(`donor same-tick states clear waiting ${first}/${second}`, () =>
{
    const a = [[101, go]], b = [[101, stop]], history = [];
    merge(a, history, first); merge(b, history, second); assert.deepEqual(history, [[a.concat(b), false]]);
});
for (const name of ["older state", "newer state"])
test(`donor newer-state arrival preserves older wait (${name} fixture)`, () =>
{
    const a = [[101, go]], b = [[102, stop]], history = [];
    merge(a, history, true); merge(b, history, false); assert.deepEqual(history, [[a, true], [b, false]]);
});
for (const [first, second] of [[false, false], [false, true], [true, false]])
test(`donor earlier-state insertion retains existing wait ${first}/${second}`, () =>
{
    const a = [[101, go]], b = [[100, stop]], history = [];
    merge(a, history, first); merge(b, history, second); assert.deepEqual(history, [[b, second], [a, first]]);
});
test("native mixed-stamp append marks every new group waiting; empty/nonempty combination throws", () =>
{
    // Source: destiny/python/destiny/net/client/_util.py:43-68.
    const history = [], early = [1, go], late = [2, stop];
    merge([late, early], history, true); assert.deepEqual(history, [[[early], true], [[late], true]]);
    assert.throws(() => merge([], history, false), RangeError);
    merge([[3, go]], history, true); assert.equal(history[2][1], false);
});
test("live history insertion handles multiple earlier stamps and preserves event identity", () =>
{
    const history = [[[[10, go]], true], [[[20, stop]], false]], a = [5, stop], b = [6, go], c = [15, stop];
    merge([c, b, a], history, true);
    assert.deepEqual(history.map(([state, wait]) => [state[0][0], wait]), [[5, true], [6, false], [10, true], [15, false], [20, false]]);
    assert.equal(history[0][0][0], a); assert.equal(history[1][0][0], b); assert.equal(history[3][0][0], c);
});
test("large same-tick history merge does not spread an unbounded event collection", () =>
{
    const state = Array.from({ length: 150000 }, () => [101, go]), history = [[[[101, stop]], true]];
    merge(state, history, false); assert.equal(history[0][0].length, 150001); assert.equal(history[0][1], false);
    assert.equal(history[0][0][150000], state[149999]);
});
