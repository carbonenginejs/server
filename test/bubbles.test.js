import assert from "node:assert/strict";
import test from "node:test";
import { CjsBallparkController as Park, CjsDestinyBall as Ball } from "@carbonenginejs/server";

const add = (park, id = 1, x = 240, interactive = false, free = true) =>
    park.AddBall(id, 1e6, 1, 100, free, false, false, interactive, false, x, 240, 240, 4, 0, 0, 1, 1);
const master = () => { const park = new Park(); park.isMaster = true; return park; };

// Source: destiny/python/destiny/test/ballpark/test_boxes_and_bubbles.py:8-22
test("donor test_can_initialize_bubbles", () =>
{
    const park = new Park(), ball = add(park);
    assert.equal(ball.newBubbleId, -1);
    park.InitializeBubbles();
    assert.notEqual(ball.newBubbleId, -1);
    assert.equal(ball.oldBubbleId, -1);
});

test("donor test_can_initialize_bubble_for_specific_ball", () =>
{
    const park = new Park(), ball = add(park), other = add(park, 2);
    assert.equal(ball.newBubbleId, -1);
    park.InitializeBubbles(ball.id);
    assert.notEqual(ball.newBubbleId, -1);
    assert.equal(ball.oldBubbleId, -1);
    assert.equal(other.newBubbleId, -1);
    assert.equal(park.bubbles.size, 0);
    assert.equal(park.GetBubbleAtCoordinates(240, 240, 240), -1);
});

// Bubble distribution inputs from donor test_bubbleupdater.py:23-30.
// This checks native tracking only; Python updater/batching is not implemented here.
test("donor two-bubble distribution stabilizes to zero action markers", () =>
{
    const park = master(), a = add(park, 1001, 0, true), b = add(park, 1002, 500000000, true);
    assert.equal(a.newBubbleId, 0); assert.equal(b.newBubbleId, 1);
    park.CopyBubbles();
    assert.deepEqual(park.bubbles, new Map([[0, new Map([[1001n, 0]])], [1, new Map([[1002n, 0]])]]));
});

test("master without activity freezes complete ball state but advances its counter", () =>
{
    const replica = new Park(), authority = master();
    const a = add(replica), b = add(authority);
    replica.GotoDirection(1, 1, 0, 0); authority.GotoDirection(1, 1, 0, 0);
    const before = [b.mNewPos.slice(), b.mOldPos.slice(), b.mNewVel.slice(), b.mLastG.slice(), b.mNewTime];
    replica.Evolve(10000000n); authority.Evolve(10000000n);
    assert.ok(a.x > 240);
    assert.deepEqual([b.mNewPos, b.mOldPos, b.mNewVel, b.mLastG, b.mNewTime], before);
    assert.equal(authority.currentTime, 1);
    assert.equal(b.mInDeadBubble, false);
    b.mMode = Ball.DSTBALLMODE.DSTBALL_WARP;
    assert.equal(authority.InDeadBubble(b), false);
});

test("interactive membership wakes a region and removal freezes it again", () =>
{
    const park = master(), a = add(park), b = add(park, 2, 240, true);
    assert.equal(park.GetInteractiveCnt(a), 1);
    park.Evolve(); assert.ok(a.x > 240);
    park.RemoveBall(b.id);
    assert.equal(park.GetInteractiveCnt(a), 0);
    const x = a.x; park.Evolve(); assert.equal(a.x, x);
    park.SetBallInteractive(a.id, true); park.SetBallInteractive(a.id, true);
    assert.equal(park.GetInteractiveCnt(a), 1);
    park.SetBallInteractive(a.id, false);
    assert.equal(park.GetInteractiveCnt(a), 0);
});

test("keep-alive registration follows transitions without becoming interactive", () =>
{
    const park = master(), ball = add(park);
    park.bubbleKeepAliveBalls.add(ball.id);
    park.AddKeepAliveBall(ball.id, ball.newBubbleId);
    assert.equal(park.InDeadBubble(ball), false);
    assert.equal(park.GetInteractiveCnt(ball), 0);
    const old = ball.newBubbleId;
    park.SetBallPosition(ball.id, 500000000, 240, 240);
    assert.notEqual(ball.newBubbleId, old);
    assert.equal(park.bubbleKeepAlives.has(old), false);
    assert.deepEqual(park.bubbleKeepAlives.get(ball.newBubbleId), new Set([ball.id]));
    park.RemoveBall(ball.id);
    assert.equal(park.bubbleKeepAlives.size, 0);
    assert.equal(park.bubbleKeepAliveBalls.has(ball.id), true);
});

test("bubble actions preserve add/copy/remove and cancellation semantics", () =>
{
    const park = master(), a = add(park);
    assert.equal(park.bubbles.get(0).get(a.id), 1);
    park.CopyBubbles(); assert.equal(park.bubbles.get(0).get(a.id), 0);
    park.RemoveBall(a.id); assert.equal(park.bubbles.get(0).get(a.id), -1);
    park.CopyBubbles(); assert.equal(park.bubbles.size, 0);
    const b = add(park, 2), bubble = b.newBubbleId;
    park.RemoveBall(b.id); assert.equal(park.bubbles.get(bubble).has(b.id), false);
    park.CopyBubbles(); assert.equal(park.bubbles.size, 0);
});

test("callbacks see map mutations before count updates and before new registration", () =>
{
    const events = [];
    const park = new Park(null, {
        SendEvent(owner, event, method, unused, format, bubble, id)
        {
            events.push([event, format, bubble, id, owner.GetBall(id), owner.bubbleInteractives.get(bubble)?.size ?? 0]);
            return true;
        }, PyError() { assert.fail("unexpected host failure"); }
    });
    park.isMaster = true;
    park.bubbleSubs.set(0, false); park.bubbleSubs.set(1, 0);
    const ball = add(park, 1, 240, true);
    assert.deepEqual(events[0], ["Destiny::DoBubbleAdd", "(iL)", 0, 1n, null, 0]);
    park.CopyBubbles();
    park.SetBallPosition(1, 500000000, 240, 240);
    assert.equal(events[1][0], "Destiny::DoBubbleAdd"); assert.equal(events[1][5], 0);
    assert.equal(events[2][0], "Destiny::DoBubbleDel"); assert.equal(events[2][5], 1);
    assert.equal(park.GetInteractiveCnt(ball), 1);
});

test("equal-ID AddToBubble and repeated initialization retain donor cancellation quirk", () =>
{
    const park = master(), ball = add(park, 1, 240, true);
    park.InitializeBubbles();
    assert.equal(ball.newBubbleId, 0); assert.equal(ball.oldBubbleId, 0);
    assert.equal(park.bubbles.get(0).has(ball.id), false);
    assert.equal(park.GetInteractiveCnt(ball), 0);
    park.AddKeepAliveBall(ball.id, 0); park.bubbleKeepAliveBalls.add(ball.id);
    park.UpdateKeepAliveBalls(ball, 0, 0);
    assert.equal(park.bubbleKeepAlives.size, 0);
});

test("reentrant same-ID creation preserves native first free-map insertion", () =>
{
    let entered = false, inner;
    const park = new Park(null, {
        SendEvent(owner, event)
        {
            if (event === "Destiny::DoBubbleAdd" && !entered)
            {
                entered = true;
                assert.equal(owner.GetBall(1), null);
                inner = add(owner, 1, 240, true);
            }
            return true;
        }, PyError() { assert.fail("unexpected host failure"); }
    });
    park.isMaster = true; park.bubbleSubs.set(0, true);
    const outer = add(park, 1, 240, true);
    assert.notEqual(inner, outer);
    assert.equal(park.GetBall(1), outer);
    assert.equal(park.mFreeBalls.get(1n), outer);
});

test("ClearAll retains subscriptions and counter but clears keep-alive registrations", () =>
{
    const park = master(), ball = add(park);
    park.bubbleSubs.set(0, true); park.bubbleKeepAliveBalls.add(ball.id);
    park.AddKeepAliveBall(ball.id, 0);
    park.ClearAll();
    assert.equal(park.mBubbleId, 1);
    assert.equal(park.bubbleSubs.has(0), true);
    assert.equal(park.bubbleKeepAliveBalls.size, 0);
    assert.equal(park.bubbleKeepAlives.size, 0);
    assert.equal(park.bubbles.size, 0);
    assert.equal(park.mPartition.GetSize(), 0);
    assert.equal(park.mFreeBalls.size, 0);
});

test("same-bubble replacement does not silently repair native interactive bookkeeping", () =>
{
    const park = master(), a = add(park, 1, 240, false);
    add(park, 2, 240, false); // Keep the top cell alive during replacement.
    add(park, 1, 240, true);
    assert.equal(a.isInteractive, true);
    assert.equal(park.GetInteractiveCnt(a), 0);
    park.SetBallInteractive(a.id, false); park.SetBallInteractive(a.id, true);
    assert.equal(park.GetInteractiveCnt(a), 1);
});

test("coordinate lookup distinguishes an unassigned existing cell from no cell", () =>
{
    const park = new Park(); add(park);
    assert.equal(park.GetBubbleAtCoordinates(240, 240, 240), -1);
    assert.equal(park.GetBubbleAtCoordinates(500000000, 240, 240), null);
    assert.equal(park.GetBubbleAtCoordinates(240n, 240, 240), -1);
    for (const value of ["240", null, undefined, [], {}])
        assert.throws(() => park.GetBubbleAtCoordinates(value, 240, 240), TypeError);
});

test("position, radius, speed and free-to-fixed setters drive native reinsertion", () =>
{
    const park = new Park(), ball = add(park);
    const calls = [], original = park.InsertBallInBoxes;
    park.InsertBallInBoxes = function(value) { calls.push(value); return original.call(this, value); };
    park.SetBallVelocity(1, 9, 0, 0); park.SetBallMass(1, 2e6); park.SetBallAgility(1, 2); park.SetSpeedFraction(1, 0.5);
    assert.equal(calls.length, 0);
    park.SetBallRadius(1, 2); park.SetMaxSpeed(1, 90); park.SetBallPosition(1, 900, 240, 240); park.SetBallFree(1, false);
    assert.equal(calls.length, 4);
    assert.equal(park.mFreeBalls.has(ball.id), false);
    assert.equal(ball.mMyBox.lo[0], 480);
});

test("small displacement skips reinsertion and Evolve does not acknowledge bubble deltas", () =>
{
    const park = master(), ball = add(park, 1, 240, true);
    park.SetBallVelocity(1, 0, 0, 0);
    let count = 0;
    park.InsertBallInBoxes = () => count++;
    park.Evolve();
    assert.equal(count, 0);
    assert.equal(park.bubbles.get(ball.newBubbleId).get(ball.id), 1);
});

test("free-ball order is signed-ID order and insertion callbacks see staged later positions", () =>
{
    const park = new Park(), later = add(park, 9), earlier = add(park, 2);
    const order = [], original = park.InsertBallInBoxes;
    park.InsertBallInBoxes = function(ball)
    {
        order.push([ball.id, earlier.x, later.x]);
        original.call(this, ball);
    };
    park.Evolve();
    assert.deepEqual(order.map(row => row[0]), [2n, 9n]);
    assert.ok(order[0][1] > 240); assert.equal(order[0][2], 240);
    assert.ok(order[1][2] > 240);
});
