import assert from "node:assert/strict";
import test from "node:test";
import { CjsBallparkController as Park } from "@carbonenginejs/server";

// Source: destiny/src/Ballpark.h:60; destiny/src/Ballpark.cpp:3406-3414,4894-4922
// Source-derived std::map iteration fixtures, using real lifecycle mutations.
const add = (park, id, free = true) => park.AddBall(id, 1e6, 1, 10,
    free, false, false, false, false, 240, 240, 240, 0, 0, 0, 1, 1);
const ids = park => [...park._iterateFreeBalls()].map(ball => ball.id);

test("free traversal retains signed-int64 order beyond Number precision", () =>
{
    const park = new Park();
    for (const id of [9007199254740993n, -10n, 7n, 9007199254740992n, -4n]) add(park, id);
    assert.deepEqual(ids(park), [-10n, -4n, 7n, 9007199254740992n, 9007199254740993n]);
});

test("live traversal observes later insertions and future removals without revisiting earlier IDs", () =>
{
    const park = new Park();
    for (const id of [-10n, 2n, 8n, 20n]) add(park, id);
    const iterator = park._iterateFreeBalls();
    assert.equal(iterator.next().value.id, -10n);
    add(park, -20n); // Before current native iterator: no revisit.
    const one = add(park, 1n); // Between current and former next.
    assert.equal(iterator.next().value, one);
    park.SetBallFree(2n, false);
    assert.equal(add(park, 1n), one); // Duplicate does not replace or add a second node.
    assert.equal(iterator.next().value.id, 8n);
    park.RemoveBall(20n);
    add(park, 4n);
    add(park, 30n);
    assert.equal(iterator.next().value.id, 30n);
    assert.equal(iterator.next().done, true);
    assert.deepEqual(ids(park), [-20n, -10n, 1n, 4n, 8n, 30n]);
});

test("replacement, fixed/free switches, removal and clear maintain ordered membership", () =>
{
    const park = new Park(), a = add(park, 5n);
    add(park, 2n); add(park, 9n, false);
    assert.equal(add(park, 5n, false), a);
    assert.deepEqual(ids(park), [2n]);
    park.SetBallFree(9n, true); park.SetBallFree(5n, true);
    assert.deepEqual(ids(park), [2n, 5n, 9n]);
    park.RemoveBall(5n);
    assert.deepEqual(ids(park), [2n, 9n]);
    park.ClearAll();
    assert.deepEqual(ids(park), []);
    add(park, 9n); add(park, -5n);
    assert.deepEqual(ids(park), [-5n, 9n]);
});

test("JS continuation after current-node removal is explicit, monotonic and finite", () =>
{
    // Native erasure of the currently iterated std::map node invalidates its iterator.
    // JS intentionally retains the prior checked implementation's safe continuation.
    const park = new Park(); add(park, 1n); add(park, 3n);
    const iterator = park._iterateFreeBalls();
    assert.equal(iterator.next().value.id, 1n);
    park.RemoveBall(1n);
    assert.equal(iterator.next().value.id, 3n);
    park.ClearAll();
    assert.equal(iterator.next().done, true);
});
