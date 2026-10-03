import assert from "node:assert/strict";
import test from "node:test";
import { CjsBallparkController as Park, CjsDestinyBall as Ball } from "@carbonenginejs/server";
import { BubbleUpdater } from "@carbonenginejs/server/destiny/net/server";

const add = (park, id = 1, x = 240, interactive = true) =>
    park.AddBall(id, 1e6, 1, 100, true, false, false, interactive, false, x, 240, 240, 0, 0, 0, 1, 1);
const outputs = () => [new Map(), new Map(), new Map(), new Map()];
const master = () => { const park = new Park(); park.isMaster = true; return park; };
const capture = park =>
{
    const events = [];
    park._pyOS = { SendEvent(...args) { events.push(args); return true; }, PyError() { assert.fail("unexpected PyError"); } };
    return events;
};

// Source: destiny/python/destiny/test/ballpark/test_lifecycle_management.py:44-183.
test("donor invalid user ID raises TypeError after prebuilding", () =>
{
    const park = new Park(), ball = add(park), result = outputs(); park.InitializeBubbles();
    assert.throws(() => park.AdditionsAndDeletions(...result, [null]), TypeError);
    assert.deepEqual(result[2].get(ball.newBubbleId), [ball.id]);
});
test("donor initial addition returns explicit player lists and shared bubble lists", () =>
{
    const park = new Park(), ball = add(park), result = outputs(); park.InitializeBubbles();
    park.AdditionsAndDeletions(...result, [ball.id]);
    assert.deepEqual(result, [new Map([[ball.id, [ball.id]]]), new Map([[ball.id, []]]),
        new Map([[ball.newBubbleId, [ball.id]]]), new Map([[ball.newBubbleId, []]])]);
    assert.notEqual(result[0].get(ball.id), result[2].get(ball.newBubbleId));
});
test("donor unchanged player receives numeric bubble aliases after acknowledgment", () =>
{
    const park = new Park(), ball = add(park), result = outputs(); park.InitializeBubbles();
    park.AdditionsAndDeletions(...result, [ball.id]); park.CopyBubbles();
    park.AdditionsAndDeletions(...result, [ball.id]);
    assert.deepEqual(result, [new Map([[ball.id, ball.newBubbleId]]), new Map([[ball.id, ball.newBubbleId]]),
        new Map([[ball.newBubbleId, []]]), new Map([[ball.newBubbleId, []]])]);
});
test("donor removed user is absent from all outputs", () =>
{
    const park = new Park(), ball = add(park), result = outputs(); park.InitializeBubbles();
    park.AdditionsAndDeletions(...result, [ball.id]); park.RemoveBall(ball.id); park.CopyBubbles();
    park.AdditionsAndDeletions(...result, [ball.id]); assert.deepEqual(result, outputs());
});
test("donor empty transition batch is still delivered", () =>
{
    const park = new Park(), events = capture(park); park.InitializeBubbles();
    park.AdditionsAndDeletions(...outputs(), []);
    assert.deepEqual(events, [[park, "Destiny::DoBubbleTransitions", "DoBubbleTransitions", null, "(O)", []]]);
});
for (const count of [1, 2]) test(`donor ${count}-ball transition batch preserves user order and previous IDs`, () =>
{
    const park = new Park(), balls = Array.from({ length: count }, (_, i) => add(park, i + 1));
    const old = balls.map(ball => ball.newBubbleId), events = capture(park); park.InitializeBubbles();
    park.AdditionsAndDeletions(...outputs(), balls.map(ball => ball.id));
    assert.deepEqual(events[0][5], balls.map((ball, i) => [ball.id, old[i], ball.newBubbleId]));
    for (const ball of balls) assert.equal(ball.oldBubbleId, ball.newBubbleId);
});

// Source: destiny/python/destiny/test/ballpark/test_getters_and_setters.py:324-362.
test("donor remote followers empty", () => assert.deepEqual(new Park().GetRemoteFollowers(), []));
test("donor fixed follower excluded", () =>
{
    const park = new Park(), src = add(park, 1), dst = add(park, 2);
    park.SetBallFree(src.id, false); park.FollowBall(src.id, dst.id);
    dst.x = 5e8; park.InitializeBubbles();
    assert.deepEqual(park.GetRemoteFollowers(), []);
});
test("donor cross-bubble follower included", () =>
{
    const park = new Park(), src = add(park, 1), dst = add(park, 2);
    park.FollowBall(src.id, dst.id); dst.x = 5e8; park.InitializeBubbles();
    assert.notEqual(src.newBubbleId, dst.newBubbleId); assert.deepEqual(park.GetRemoteFollowers(), [src.id]);
});
test("donor ordinary free balls excluded", () =>
{
    const park = master(); add(park, 1); add(park, 2, 5e8); assert.deepEqual(park.GetRemoteFollowers(), []);
});
test("donor same-bubble follower excluded", () =>
{
    const park = master(), src = add(park, 1), dst = add(park, 2);
    park.FollowBall(src.id, dst.id); assert.deepEqual(park.GetRemoteFollowers(), []);
});

// Source: destiny/src/Thunkers.cpp:2509-2895; destiny/src/Ballpark.cpp:6009-6057.
test("same-bubble filters preserve global and missing deletions and strict local boundary", () =>
{
    const park = new Park(), limit = -1073741824n;
    for (const id of [1, 2, 3, 4, 5, limit, limit - 1n]) add(park, id);
    park.GetBall(2).isGlobal = true; park.GetBall(3).isCloaked = true;
    const bubble = new Map([[1n, 1], [2n, -1], [3n, -1], [4n, 0], [5n, 2], [99n, -1],
        [98n, 1], [limit, 1], [limit - 1n, 1]]), adds = [100n], dels = [101n];
    park.PopulateAddDelForBubble(bubble, adds, dels);
    assert.deepEqual(adds, [100n, 1n, limit]); assert.deepEqual(dels, [101n, 2n, 99n]);
});
test("moving player retains membership-marker and visibility asymmetries", () =>
{
    const park = new Park(), user = add(park, 1), result = outputs();
    for (const id of [2, 3, 4, 5, 6, 7, 8]) add(park, id);
    park.GetBall(4).isGlobal = true; park.GetBall(5).isCloaked = true;
    user.mOldBubble = 10; user.mNewBubble = 20;
    park.bubbles = new Map([[10, new Map([[2n, 0], [3n, -1], [4n, -1], [5n, -1], [6n, 1], [7n, 0], [90n, 0], [91n, -1]])],
        [20, new Map([[2n, 0], [3n, -1], [4n, -1], [5n, -1], [8n, 2], [92n, 0], [93n, -1]])]]);
    park.AdditionsAndDeletions(...result, [user.id]);
    assert.deepEqual(result[0].get(user.id), [8n, 92n]);
    assert.deepEqual(result[1].get(user.id), [3n, 7n, 91n]);
    assert.equal(park.bubbles.get(20).get(3n), -1);
});
test("new arrival includes missing additions and deletions but skips existing global deletion", () =>
{
    const park = new Park(), user = add(park), global = add(park, 2), result = outputs();
    global.isGlobal = true; user.mNewBubble = 3;
    park.bubbles.set(3, new Map([[90n, 0], [91n, -1], [2n, -1]]));
    park.AdditionsAndDeletions(...result, [user.id]);
    assert.deepEqual(result[0].get(user.id), [90n]); assert.deepEqual(result[1].get(user.id), [91n]);
});
test("prebuild tests key existence while fallback remains player-specific", () =>
{
    const park = new Park(), a = add(park, 1), b = add(park, 2), result = outputs();
    a.mOldBubble = a.mNewBubble = 10; b.mOldBubble = b.mNewBubble = 20;
    park.bubbles = new Map([[10, new Map([[a.id, 1]])], [20, new Map([[b.id, 1]])]]);
    park.bubbleInteractives.set(10, new Set());
    park.AdditionsAndDeletions(...result, [a.id, b.id]);
    assert.equal(result[0].get(a.id), 10); assert.deepEqual(result[0].get(b.id), [b.id]);
    assert.equal(result[2].has(20), false); assert.deepEqual(result[2].get(10), [a.id]);
});
test("duplicate users overwrite earlier lists after updating old IDs", () =>
{
    const park = master(), ball = add(park), result = outputs(), events = capture(park);
    park.AdditionsAndDeletions(...result, [ball.id, ball.id]);
    assert.equal(result[0].get(ball.id), ball.newBubbleId);
    assert.deepEqual(events[0][5], [[ball.id, -1, ball.newBubbleId]]);
});
test("sentinel and missing equal bubbles still transition; trolls only suppress tuples", () =>
{
    const park = new Park(), a = add(park, 1), b = add(park, 2), troll = add(park, 3), events = capture(park);
    b.mOldBubble = b.mNewBubble = 40; troll.mMode = Ball.DSTBALLMODE.DSTBALL_TROLL;
    const result = outputs(); park.AdditionsAndDeletions(...result, [a.id, b.id, troll.id]);
    assert.deepEqual(events[0][5], [[1n, -1, -1], [2n, 40, 40]]);
    assert.equal(result[0].size, 3);
});
test("container admission precedes clearing but invalid later ID leaves earlier changes", () =>
{
    const park = master(), ball = add(park), result = outputs(); result[0].set(99n, 1);
    assert.throws(() => park.AdditionsAndDeletions(...result, new Set()), TypeError);
    assert.equal(result[0].get(99n), 1);
    const bubbles = park.bubbles; park.bubbles = null;
    assert.throws(() => park.AdditionsAndDeletions(...result, []), /not initialized/);
    assert.equal(result[0].get(99n), 1); park.bubbles = bubbles;
    assert.throws(() => park.AdditionsAndDeletions(...result, [ball.id, null]), TypeError);
    assert.equal(result[0].has(99n), false); assert.equal(ball.oldBubbleId, ball.newBubbleId);
    assert.deepEqual(result[0].get(ball.id), [ball.id]);
});
test("transition send observes updated IDs and reports host failure", () =>
{
    const park = master(), ball = add(park); let errors = 0, calls = 0;
    park._pyOS = { SendEvent(...args) { ++calls; assert.equal(ball.oldBubbleId, ball.newBubbleId);
        assert.deepEqual(args[5], [[ball.id, -1, ball.newBubbleId]]); return false; }, PyError() { ++errors; } };
    park.AdditionsAndDeletions(...outputs(), [ball.id]);
    park.NotifyOfBubbleTransitions(null); assert.equal(calls, 1); assert.equal(errors, 1);
});
test("JS aliased output maps retain lists safely through overwrite", () =>
{
    const park = master(), ball = add(park), player = new Map(), bubble = new Map();
    park.AdditionsAndDeletions(player, player, bubble, bubble, [ball.id]);
    assert.deepEqual(player, new Map([[ball.id, []]]));
    assert.deepEqual(bubble, new Map([[ball.newBubbleId, []]]));
});
test("JS cross-domain output aliases retain Number and BigInt key domains", () =>
{
    const park = master(), ball = add(park, 1), adds = new Map(), dels = new Map();
    park.bubbles = new Map([[1, new Map([[ball.id, 1]])]]);
    park.bubbleInteractives = new Map([[1, new Set([ball.id])]]); ball.mNewBubble = 1;
    park.AdditionsAndDeletions(adds, dels, adds, dels, [ball.id]);
    assert.deepEqual([...adds.keys()], [1, 1n]); assert.deepEqual([...dels.keys()], [1, 1n]);
});
test("malformed bubble keys fail immediately after earlier output mutations", () =>
{
    const park = master(), ball = add(park), result = outputs(), events = capture(park);
    park.bubbles.get(ball.newBubbleId).set("bad", 1);
    assert.throws(() => park.AdditionsAndDeletions(...result, [ball.id]), RangeError);
    assert.deepEqual(result[2].get(ball.newBubbleId), [ball.id]);
    assert.equal(ball.oldBubbleId, -1); assert.deepEqual(events, []);
});
test("remote followers use ID lookup, all four modes and sorted IDs, including moribund", () =>
{
    const park = new Park(), target = add(park, 99), ids = [8, -4, 6, 2]; target.mNewBubble = 4;
    const modes = ["FOLLOW", "ORBIT", "MISSILE", "FORMATION"];
    ids.forEach((id, i) => { const ball = add(park, id); ball.mMode = Ball.DSTBALLMODE[`DSTBALL_${modes[i]}`];
        ball.mFollowId = target.id; ball.mFollowPtr = null; });
    park.GetBall(2).isMoribund = true;
    assert.deepEqual(park.GetRemoteFollowers(), [-4n, 2n, 6n, 8n]);
    park.balls.delete(target.id); const size = park.balls.size;
    assert.deepEqual(park.GetRemoteFollowers(), [-4n, 2n, 6n, 8n]); assert.equal(park.balls.size, size);
});

// Source: destiny/python/destiny/test/net/server/test_bubbleupdater.py:23-82.
test("donor updater distributes two bubbles", () =>
{
    const park = master(), updater = new BubbleUpdater(park); add(park, 1001, 0); add(park, 1002, 5e8);
    updater.additions_and_deletions();
    assert.deepEqual(updater.additions_per_player, new Map([[1001n, [1001n]], [1002n, [1002n]]]));
    assert.deepEqual(updater.deletions_per_player, new Map([[1001n, []], [1002n, []]]));
    assert.deepEqual(updater.additions_per_bubble, new Map([[0, [1001n]], [1, [1002n]]]));
    assert.deepEqual(updater.deletions_per_bubble, new Map([[0, []], [1, []]]));
});
test("donor updater acknowledges markers after collecting", () =>
{
    const park = master(), updater = new BubbleUpdater(park); add(park, 1001, 0); add(park, 1002, 5e8);
    updater.additions_and_deletions();
    assert.deepEqual(park.bubbles, new Map([[0, new Map([[1001n, 0]])], [1, new Map([[1002n, 0]])]]));
});
test("donor updater reports deletion next tick", () =>
{
    const park = master(), updater = new BubbleUpdater(park); add(park, 1001); add(park, 1002);
    updater.additions_and_deletions(); park.Evolve(); park.RemoveBall(1001); updater.additions_and_deletions();
    assert.deepEqual(updater.additions_per_player, new Map([[1002n, 0]]));
    assert.deepEqual(updater.deletions_per_player, new Map([[1002n, 0]]));
    assert.deepEqual(updater.additions_per_bubble, new Map([[0, []]]));
    assert.deepEqual(updater.deletions_per_bubble, new Map([[0, [1001n]]]));
});
test("donor updater retains deltas for repeated calls in one tick", () =>
{
    const park = master(), updater = new BubbleUpdater(park); add(park, 1001, 0); add(park, 1002, 5e8);
    updater.additions_and_deletions(); const previous = updater.additions_per_player;
    updater.additions_and_deletions(); updater.additions_and_deletions();
    assert.equal(updater.additions_per_player, previous);
    assert.deepEqual(previous, new Map([[1001n, [1001n]], [1002n, [1002n]]]));
});
test("updater failures do not acknowledge tick and next processing replaces output maps", () =>
{
    const park = master(), updater = new BubbleUpdater(park); add(park);
    const previous = updater.additions_per_player, original = park.AdditionsAndDeletions;
    park.AdditionsAndDeletions = () => { throw new Error("callback"); };
    assert.throws(() => updater.additions_and_deletions(), /callback/); assert.equal(updater._tick, null);
    assert.notEqual(updater.additions_per_player, previous); assert.equal(park.bubbles.get(0).get(1n), 1);
    park.AdditionsAndDeletions = original; updater.additions_and_deletions(); assert.equal(updater._tick, 0);
});
test("moving between live bubbles computes deltas before acknowledgment", () =>
{
    const park = master(), mover = add(park, 1), left = add(park, 2), right = add(park, 3, 5e8);
    const updater = new BubbleUpdater(park); updater.additions_and_deletions();
    park.Evolve(); park.SetBallPosition(mover.id, 5e8, 240, 240);
    assert.equal(mover.newBubbleId, right.newBubbleId); assert.notEqual(mover.newBubbleId, left.newBubbleId);
    updater.additions_and_deletions();
    // The mover is still present with a deletion marker in its old bubble.
    assert.deepEqual(updater.additions_per_player.get(mover.id), [right.id]);
    assert.deepEqual(updater.deletions_per_player.get(mover.id), [left.id]);
    assert.deepEqual(updater.deletions_per_bubble.get(left.newBubbleId), [mover.id]);
    assert.deepEqual(updater.additions_per_bubble.get(right.newBubbleId), [mover.id]);
    assert.equal(park.bubbles.get(left.newBubbleId).has(mover.id), false);
});
for (const axis of ["x", "y", "z"]) test(`Blue ${axis} writes notify the park and update membership`, () =>
{
    const park = master(), ball = add(park), old = ball.newBubbleId;
    ball[axis] = 5e8;
    assert.equal(ball[axis], 5e8); assert.notEqual(ball.newBubbleId, old);
    assert.equal(park.bubbles.get(ball.newBubbleId).get(ball.id), 1);
    const detached = new Ball(); detached[axis] = 123.5; assert.equal(detached[axis], 123.5);
});
test("position notifications bypass game overrides and notify unchanged writes", () =>
{
    const park = master(), ball = add(park), owner = Park.prototype.SetBallPosition; let calls = 0;
    park.SetBallPosition = () => assert.fail("game override must not intercept native notification");
    Park.prototype.SetBallPosition = function(...args) { ++calls; return owner.apply(this, args); };
    try
    {
        ball.x = ball.x; ball.y = 5e8; ball.z = 5e8;
        assert.equal(calls, 3); assert.deepEqual(ball.mOldPos, Array.from(ball.mNewPos));
    }
    finally { Park.prototype.SetBallPosition = owner; }
});
