import assert from "node:assert/strict";
import test from "node:test";
import { CjsBallparkController as Park } from "@carbonenginejs/server";

// Source: destiny/src/Ballpark.cpp:3224-3231,3639-3713,5594-5817,5895-5952
// Source: destiny/python/destiny/test/ballpark/test_lifecycle_management.py:251-329
const cap = (park, id = 10n) => park.AddCapsule(id, 1n, 240, 240, 240, 244, 240, 240, 1);
const box = (park, id = 20n) => park.AddOrientedBox(id, 1n, 240, 240, 240, 4, 0, 0, 0, 4, 0, 0, 0, 4);
const quiet = callback =>
{
    const original = console.error; const logs = []; console.error = (...args) => logs.push(args);
    try { callback(logs); } finally { console.error = original; }
};

test("native shape parameter preservation and shared replica local-ID allocation", () =>
{
    const park = new Park(), a = cap(park, -1n), b = box(park, -1n);
    assert.equal(a.id, -1073741825n); assert.equal(b.id, -1073741826n);
    assert.deepEqual([a.ax, a.ay, a.az, a.bx, a.by, a.bz, a.radius], [240, 240, 240, 244, 240, 240, 1]);
    assert.equal(a.park, park); assert.equal(b.park, park);
    assert.deepEqual(park.GetStaticCollidableBox(a.id), [480, [240, 240, 240]]);
    assert.equal(park.GetStaticCollidableBox(999n), null);
});

test("existing shape IDs preserve geometry and moribund state", () =>
{
    const park = new Park(), a = cap(park), b = box(park);
    park.RemoveCapsule(a.id, 10); park.RemoveOrientedBox(b.id, 10);
    assert.equal(park.AddCapsule(a.id, 99n, 0, 0, 0, 1, 1, 1, 100), a);
    assert.equal(park.AddOrientedBox(b.id, 99n, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1), b);
    assert.equal(a.mParentBallId, 1n); assert.equal(a.radius, 1); assert.equal(b.corner_x, 240);
    assert.equal(a.isMoribund, true); assert.equal(b.isMoribund, true);
    assert.equal(a.mEffectStamp, 10); assert.equal(b.mEffectStamp, 10);
});

test("creation callbacks observe typed ownership before aggregate registration", () =>
{
    let park; const seen = [];
    const host = { SendEvent(target, event, method, unused, format, bubble, id)
    {
        if (event === "Destiny::DoBubbleAdd")
            seen.push([park.mCapsules.has(id) || park.mOrientedBoxes.has(id), park.mStaticCollidables.has(id)]);
        return true;
    }, PyError() { assert.fail("unexpected host error"); } };
    park = new Park(null, host); park.isMaster = true; park.mBubbleSubscriptions.set(0, true);
    const a = cap(park), b = box(park);
    assert.deepEqual(seen, [[true, false], [true, false]]);
    assert.equal(park.mStaticCollidables.get(a.id), a); assert.equal(park.mStaticCollidables.get(b.id), b);
});

test("immediate cleanup event precedes detachment and retains native aggregate entries", () =>
{
    const events = []; let park;
    const host = { SendEvent(target, event, method, unused, format)
    {
        if (method === "DoFinalCleanup") events.push([event, target.mPark === park, target.mBoxes.length > 0, target.isMoribund, format]);
        return false;
    }, PyError() { events.push("error"); } };
    park = new Park(null, host); const a = cap(park), b = box(park);
    park.RemoveCapsule(a.id); park.RemoveOrientedBox(b.id);
    assert.deepEqual(events, [["Destiny::Capsule::DoFinalCleanup", true, true, true, "()"], "error",
        ["Destiny::OrientedBox::DoFinalCleanup", true, true, true, "()"], "error"]);
    assert.equal(park.mCapsules.size, 0); assert.equal(park.mOrientedBoxes.size, 0);
    assert.equal(park.mStaticCollidables.get(a.id), a); assert.equal(park.mStaticCollidables.get(b.id), b);
    assert.equal(a.mPark, null); assert.equal(b.mPark, null);
    assert.equal(park.GetStaticCollidableBox(a.id), null);
});

test("deferred capsules retain membership and drain with uncapped overdue plus capped buffered removals", () =>
{
    const park = new Park(), shapes = [];
    for (let i = 0; i < 19; ++i)
    {
        const a = cap(park, BigInt(i + 1)); shapes.push(a);
        park.RemoveCapsule(a.id, i < 9 ? 9 : i < 18 ? 11 : 12);
        assert.ok(a.mBoxes.length > 0);
    }
    park.currentTime = 10; park.BringOutTheDeads();
    assert.equal(park.mCapsules.size, 3); assert.equal(park.moribundCapsules.size, 3);
    for (const a of shapes.slice(0, 9)) assert.equal(a.mPark, null);
    assert.equal(shapes[18].mPark, park);
});

test("unflagged capsule queue entries still expire; null entries are discarded", () => quiet(logs =>
{
    const park = new Park(), a = cap(park); a.mEffectStamp = 12;
    park.moribundCapsules.add(a); park.moribundCapsules.add(null); park.currentTime = 10;
    park.BringOutDeadCapsules(); assert.equal(park.moribundCapsules.size, 1); assert.equal(a.mPark, park);
    park.currentTime = 13; park.BringOutDeadCapsules(); assert.equal(a.mPark, null);
    assert.equal(park.moribundCapsules.size, 0); assert.ok(logs.length >= 2);
}));

test("native delayed oriented-box queue does not drain and AdjustTimes leaves shape stamps unchanged", () =>
{
    const park = new Park(), a = cap(park), b = box(park);
    park.RemoveCapsule(a.id, 100); park.RemoveOrientedBox(b.id, 1);
    park.AdjustTimes(50000000n); assert.equal(a.mEffectStamp, 100); assert.equal(b.mEffectStamp, 1);
    park.currentTime = 10; park.BringOutTheDeads();
    assert.equal(b.mPark, park); assert.equal(park.moribundOrientedBoxes.has(b), true);
    park.RemoveOrientedBox(b.id); assert.equal(b.mPark, null); assert.equal(park.moribundOrientedBoxes.size, 0);
});

test("in-evolve additions skip aggregate ownership and native ClearAll only detaches aggregate shapes", () =>
{
    const park = new Park(), a = cap(park); park.RemoveCapsule(a.id, 100);
    park.inEvolve = true; const b = box(park); park.inEvolve = false;
    assert.equal(park.mStaticCollidables.has(b.id), false);
    park.ClearAll();
    assert.equal(a.mPark, null); assert.equal(park.moribundCapsules.has(a), true);
    assert.equal(b.mPark, park); assert.ok(b.mBoxes.length > 0);
    assert.equal(park.mCapsules.size, 0); assert.equal(park.mOrientedBoxes.size, 0); assert.equal(park.mStaticCollidables.size, 0);
    // Manual teardown of the deliberately retained source gap keeps this test isolated.
    b.DeleteFromBoxes();
});

test("missing-ID removal retains native null map insertion and Add fails at reuse", () => quiet(() =>
{
    const park = new Park(); park.RemoveCapsule(10n); park.RemoveOrientedBox(20n);
    assert.equal(park.mCapsules.get(10n), null); assert.equal(park.mOrientedBoxes.get(20n), null);
    assert.throws(() => cap(park), TypeError); assert.throws(() => box(park), TypeError);
}));

test("separate shape maps allow equal IDs while aggregate ownership uses last assignment", () =>
{
    const park = new Park(), a = cap(park, 10n), b = box(park, 10n);
    assert.equal(park.mCapsules.get(10n), a); assert.equal(park.mOrientedBoxes.get(10n), b);
    assert.equal(park.mStaticCollidables.get(10n), b);
    park.ClearAll(); a.DeleteFromBoxes();
});
