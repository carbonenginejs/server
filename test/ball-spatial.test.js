import assert from "node:assert/strict";
import test from "node:test";
import { CjsDestinyBall as Ball, CjsBallparkController as Park } from "@carbonenginejs/server";
import { CjsDestinyPartitionable as Partitionable } from "@carbonenginejs/server/destiny/partition";

// Source: destiny/src/Ball.cpp:228-238,812-863,2354-2526
// Source-derived fixtures; these do not claim native executable or bubble integration coverage.
const create = (park, id = 1, radius = 2, pos = [240, 240, 240]) =>
    park.AddBall(id, 8, radius, 10, false, false, true, false, false, ...pos, 0, 0, 0, 0.5, 0.5);
const insert = (ball, bubble = 7) =>
{
    const partition = ball.mPark.mPartition;
    const box = partition.GetBox(ball.GetInflatedRadius(ball.mPark.dt), ball.mNewPos);
    ball.InsertInBoxes(box, partition.GetTopmost(box), bubble);
};
const active = ball => ball.mActiveBoxes.flatMap((value, index) => value ? [index] : []);

test("Ball inherits native spatial state and scalar accessors share its storage", () =>
{
    const a = new Ball(), b = new Ball();
    assert.equal(Object.getPrototypeOf(Ball.prototype), Partitionable.prototype);
    assert.deepEqual(a.mNewPos, [1e10, 1e10, 1e10]);
    assert.deepEqual(a.mOldPos, [0, 0, 0]);
    assert.equal(a.mPark, null);
    assert.deepEqual(a.mMod, [-2, -2, -2]);
    assert.deepEqual(active(a), []);
    a.x = 1e12 + 0.25;
    assert.equal(a.mNewPos[0], a.x);
    a.mNewPos[1] = 31;
    assert.equal(a.y, 31);
    a.id = 9007199254740993n;
    assert.equal(a.mId, 9007199254740993n);
    a.mId = 3n;
    assert.equal(a.id, 3n);
    a.vx = 4; a._oldVy = 5; a._lastGz = 6; a.gotoX = 7;
    assert.equal(a.mNewVel[0], 4);
    assert.equal(a.mOldVel[1], 5);
    assert.equal(a.mLastG[2], 6);
    assert.equal(a.mGoto[0], 7);
    a._oldX = 8;
    assert.equal(a.mOldPos[0], 8);
    assert.deepEqual(b.mNewPos, [1e10, 1e10, 1e10]);
    assert.deepEqual(b.mNewVel, [0, 0, 0]);
});

test("Inflated radius uses the native cached factor and physical radius for fixed balls", () =>
{
    const park = new Park(), ball = create(park, 1, 3);
    park.mFriction = 2;
    ball.isFree = true; ball.vx = 8; ball.mTimeFactor = 0.25;
    assert.equal(ball.GetInflatedRadius(2), 14.5);
    assert.equal(ball.GetBoundingRadius(), 3);
    ball.isFree = false; ball.mPark = null;
    assert.equal(ball.GetInflatedRadius(100), 3);
});

for (const [x, expected] of [[10, [13]], [470, [13]], [9, [12, 13]], [471, [13, 14]]])
{
    test(`Membership uses strict bounds at x=${x}`, () =>
    {
        const ball = create(new Park(), 1, 10, [x, 240, 240]);
        insert(ball);
        assert.deepEqual(active(ball), expected);
        assert.equal(ball.mBoxes.length, expected.length);
    });
}

test("Corner insertion preserves native request order and sorted membership", () =>
{
    const ball = create(new Park(), 1, 2, [1, 1, 1]), order = [];
    ball.DeleteFromBoxes();
    const original = ball.SetBoxActive;
    ball.SetBoxActive = function(index, value) { order.push(index); original.call(this, index, value); };
    insert(ball);
    assert.deepEqual(order, [13, 12, 10, 4, 9, 3, 1, 0]);
    assert.deepEqual(active(ball), [0, 1, 3, 4, 9, 10, 12, 13]);
    assert.equal(ball.mBoxes.length, 8);
    for (let i = 1; i < ball.mBoxes.length; ++i)
        assert.equal(ball.mBoxes[i - 1].mKey.LessThan(ball.mBoxes[i].mKey), true);
});

test("Unchanged membership skips activity repair and bubble restoration", () =>
{
    const park = new Park(); park.isMaster = true;
    const ball = create(park); ball.DeleteFromBoxes(); insert(ball, 23);
    const base = ball.mMyBox, top = park.mPartition.GetTopmost(base);
    assert.equal(top.mBubble, 23);
    ball.mActiveBoxes[13] = false;
    insert(ball, 99);
    assert.equal(ball.mMyBox, base);
    assert.equal(ball.mActiveBoxes[13], false);
    assert.equal(top.mBubble, 23);
});

test("Changed modifiers rebuild released cells and restore only master top bubble", () =>
{
    for (const master of [false, true])
    {
        const park = new Park(); park.isMaster = master;
        const ball = create(park); insert(ball, 23);
        const old = ball.mMyBox;
        ball.x = 1; insert(ball, 41);
        assert.notEqual(ball.mMyBox, old);
        assert.deepEqual(active(ball), [12, 13]);
        assert.equal(park.mPartition.GetTopmost(ball.mMyBox).mBubble, master ? 41 : -1);
        assert.equal(ball.mNewBubble, master ? 0 : -1); // Ballpark owns object bubble transitions.
    }
});

test("Huge physical radius occupies all neighbors but inflated radius alone does not", () =>
{
    const park = new Park(), width = park.mPartition.mLevelWidth[0];
    const ball = create(park, 1, width / 2, Array(3).fill(width / 2));
    insert(ball);
    assert.deepEqual(active(ball), [13]);
    ball.radius += 1; insert(ball);
    assert.equal(ball.mBoxes.length, 27);
    assert.equal(active(ball).length, 27);
    const fast = create(park, 2, 1, Array(3).fill(width / 2));
    fast.isFree = true; fast.mass = fast.agility = 1; fast.maxVelocity = 0;
    fast.vx = 5000000; fast.mTimeFactor = 1; park.mFriction = 1;
    insert(fast);
    assert.equal(fast.mMyBox.mLevel, 0);
    assert.equal(fast.mBoxes.length, 8);
    fast.radius = 4000000; fast.vx = 0;
    insert(fast);
    assert.equal(fast.mBoxes.length, 8); // Native cache omits huge-branch state.
});

test("Zero-radius membership is retained and cell teardown cascades to ancestors", () =>
{
    const park = new Park(), ball = create(park, 1, 0);
    insert(ball);
    assert.equal(ball.mBoxes.length, 1);
    assert.equal(park.mPartition.GetSize(), 8);
    ball.DeleteFromBoxes();
    assert.equal(park.mPartition.GetSize(), 0);
    assert.equal(ball.mMyBox, null);
    assert.deepEqual(ball.mMod, [-2, -2, -2]);
    assert.deepEqual(active(ball), []);
});

test("ClearBoxes clears links only; equivalent single-cell insertions deduplicate", () =>
{
    const park = new Park(), ball = create(park);
    const box = park.mPartition.GetBox(2, ball.mNewPos);
    ball.InsertInBox(null); ball.InsertInBox(box); ball.InsertInBox(box);
    assert.deepEqual(ball.mBoxes, [box]);
    assert.deepEqual(box.balls, [ball]);
    ball.ClearBoxes();
    assert.deepEqual(ball.mBoxes, []);
    assert.deepEqual(box.balls, [ball]);
    box.RemoveBall(ball);
    assert.equal(park.mPartition.GetSize(), 0);
});

test("Live Balls enumerate as candidates and movement writes the shared vectors", () =>
{
    const park = new Park(), a = create(park, 1), b = create(park, 2);
    insert(a); insert(b);
    const balls = [], statics = [];
    park.mPartition.GetCollisionCandidates(a, balls, statics, false);
    assert.deepEqual(balls, [b]);
    park.SetBallFree(a.id, true);
    park.GotoDirection(1, 1, 0, 0);
    park.Evolve();
    assert.equal(a.x, a.mNewPos[0]);
    assert.ok(a.x > 240);
    assert.deepEqual(a.mOldPos, [240, 240, 240]);
});

test("Replacement, immediate deletion and ClearAll detach spatial membership", () =>
{
    const park = new Park(), a = create(park);
    insert(a);
    a.mOwnerId = 9n; a.mCorporationID = 10; a.mAllianceID = 11; a.mHarmonic = 12n;
    assert.equal(create(park), a);
    assert.deepEqual([a.mOwnerId, a.mCorporationID, a.mAllianceID, a.mHarmonic], [0n, -1, -1, -1n]);
    assert.equal(park.mPartition.GetSize(), 8);
    assert.equal(a.mPark, park);
    insert(a); park.RemoveBall(1);
    assert.equal(a.mPark, null);
    assert.equal(park.mPartition.GetSize(), 0);
    const b = create(park, 2), c = create(park, 3);
    insert(b); insert(c); park.ClearAll();
    assert.equal(b.mPark, null); assert.equal(c.mPark, null);
    assert.equal(park.mPartition.GetSize(), 0);
});

test("Deferred removal retains membership until its cleanup phase", () =>
{
    const park = new Park(), ball = create(park);
    insert(ball); park.RemoveBall(1, 1);
    assert.equal(ball.mPark, park);
    assert.equal(ball.mBoxes.length, 1);
    park.currentTime = 2;
    park.BringOutTheDeads();
    assert.equal(ball.mPark, null);
    assert.equal(park.mPartition.GetSize(), 0);
});

test("Small-cell memberships match independent strict bounding-volume overlap", () =>
{
    for (const x of [0, 2, 239, 478, 480])
        for (const y of [0, 3, 479])
        {
            const park = new Park(), ball = create(park, 1, 2, [x, y, 240]);
            insert(ball);
            const expected = [];
            for (let ix = -1; ix <= 1; ++ix)
                for (let iy = -1; iy <= 1; ++iy)
                    if (x + 2 > ix * 480 && x - 2 < (ix + 1) * 480
                        && y + 2 > iy * 480 && y - 2 < (iy + 1) * 480)
                        expected.push([ix * 480, iy * 480, 0]);
            assert.deepEqual(ball.mBoxes.map(box => box.lo), expected);
        }
});
