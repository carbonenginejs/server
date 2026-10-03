import assert from "node:assert/strict";
import test from "node:test";
import {
    CjsDestinyKey as Key, CjsDestinyKeyHash as KeyHash,
    CjsDestinyPartition as Partition, CjsDestinyPartitionable as Partitionable,
    CjsDestinyStaticCollidable as StaticCollidable, CjsDestinyBox as Box,
    CjsDestinyBoxSortComparer as BoxSortComparer,
    CjsDestinyBallSortComparer as BallSortComparer,
    CjsDestinyStaticCollidableSortComparer as StaticComparer, GetBoxCenter
} from "@carbonenginejs/server/destiny/partition";
import { GetBoxCenter as moduleGetBoxCenter } from "@carbonenginejs/server";

// Source revision: 114e89fa584f0e1a81eb0a679aabf41af8870072.
// Source: destiny/src/Partition.h; destiny/src/Partition.cpp; destiny/src/Box.cpp
// Except the named TestPartition fixture, these are source-derived kernel tests.
// Native-shaped records isolate candidate enumeration; they are not Ballpark integration.
const ball = (id, values = {}) => ({
    mId: BigInt(id), mOwnerId: 0n, mHandled: false, mBoxes: [], mNewBubble: 1,
    mMode: 2, mHarmonic: -1n, mCorporationID: -1, mAllianceID: -1,
    isMoribund: false, isCloaked: false, isMassive: true, isInteractive: false,
    isGlobal: false, isFree: true, mSensor: { onlyInteractives: false },
    mPark: { GetInteractiveCnt: () => 1 }, ...values
});
const shape = (id, parent = 0n, values = {}) => ({
    mId: BigInt(id), mParentBallId: BigInt(parent), mHandled: false, mNewBubble: 1, ...values
});
const add = (box, value) => { box.AddBall(value); Box._insert(value.mBoxes, box, new BoxSortComparer()); };
const ids = (values) => values.map(value => value.mId);
const scene = (others = []) =>
{
    const partition = new Partition(), box = partition.GetBox(100, [0, 0, 0]), owner = ball(100);
    add(box, owner);
    for (const other of others) add(box, other);
    return { partition, box, owner };
};

test("Key preserves default versus lower-first clamping, exact int64s and overflow guard", () =>
{
    assert.deepEqual([new Key().ix, new Key().n], [0n, 0n]);
    const zero = new Key(0, -1, 1, 0);
    assert.deepEqual([zero.ix, zero.iy, zero.iz, zero.n], [-1n, 0n, -1n, 0n]);
    const large = new Key(9007199254740993n, -4n, 9223372036854775807n, 9223372036854775807n);
    assert.deepEqual([large.ix, large.iy, large.iz], [9007199254740993n, 0n, 9223372036854775806n]);
    assert.throws(() => new Key(0n, 0n, 0n, -9223372036854775808n), RangeError);
    assert.equal(new Key(-1n, -1n, -1n, -9223372036854775808n).ix, 0n);
    assert.throws(() => new Key(Number.MAX_SAFE_INTEGER + 1, 0, 0, 16), RangeError);
});

test("Key equality and ordering include all four members", () =>
{
    const a = new Key(1, 2, 3, 16), equal = new Key(1, 2, 3, 16);
    assert.equal(a.Equals(equal), true);
    assert.equal(a.LessThan(equal), false);
    for (const greater of [new Key(2, 0, 0, 16), new Key(1, 3, 0, 16), new Key(1, 2, 4, 16), new Key(1, 2, 3, 17)])
    {
        assert.equal(a.LessThan(greater), true);
        assert.equal(greater.LessThan(a), false);
        assert.equal(a.Equals(greater), false);
    }
});

// Source: destiny/tests/TestPartition.cpp:5-13
test("TestPartition.cpp: PartitionKeyHash.SeparatesCoordinatesThatPreviouslyCollided", () =>
    assert.notEqual(new KeyHash().Call(new Key(1, 0, 0, 16)), new KeyHash().Call(new Key(0, 2, 0, 16))));

// Also verified by compiling the actual donor Partition.h with MSVC 14.50 x64.
// That header-only probe exercises Key/KeyHash, not the full native simulation.
test("KeyHash matches Windows64 MSVC native-header probe values", () =>
{
    const hash = new KeyHash();
    assert.equal(hash.Call(new Key(1, 0, 0, 16)), 0x01fe2127393d0c1cn);
    assert.equal(hash.Call(new Key(0, 2, 0, 16)), 0x2bd2beeb15ebb2fcn);
});

test("Partition dimensions retain all eight levels and 37-bit finest indices", () =>
{
    const p = new Partition();
    assert.deepEqual(p.mLevelWidth, [7864320, 1966080, 491520, 122880, 30720, 7680, 1920, 480]);
    assert.deepEqual(p.mLevelGrid, [8388608n, 33554432n, 134217728n, 536870912n,
        2147483648n, 8589934592n, 34359738368n, 137438953472n]);
    assert.equal(p.GetSize(), 0);
    assert.equal(p.GetActiveBoxes(7), null);
});

test("Radius threshold uses strict comparison and one leaf creates eight cells", () =>
{
    const p = new Partition(), box = p.GetBox(160, [0, 0, 0]);
    assert.equal(box.mLevel, 7);
    assert.equal(p.GetSize(), 8);
    assert.deepEqual(box.lo, [0, 0, 0]);
    assert.deepEqual(box.hi, [480, 480, 480]);
    assert.equal(box.mKey.ix, 68719476736n);
    assert.equal(p.GetBox(160.001, [0, 0, 0]), box.mParent);
    assert.equal(p.GetExistingTopBox([0, 0, 0]), p.GetTopmost(box));
});

test("Position factory selects negative cells and noncreating lookups allocate nothing", () =>
{
    const p = new Partition();
    assert.equal(p.GetBox(1, [-1, -480, -481], false), null);
    assert.equal(p.GetSize(), 0);
    const box = p.GetBox(1, [-1, -480, -481]);
    assert.deepEqual(box.lo, [-480, -480, -960]);
    assert.equal(p.GetBox(1, [-1, -480, -481], false), box);
});

test("Key conversion truncates before clamping and center stays unclamped", () =>
{
    const p = new Partition(), half = p.mLevelWidth[7] * Number(p.mLevelGrid[7]) * 0.5;
    const out = { ix: 9n, iy: 9n, iz: 9n };
    p.GetBoxKey([-half - 240, -half - 480, -half - 720], 7, out);
    assert.deepEqual(out, { ix: 0n, iy: -1n, iz: -1n });
    const pos = [-half - 720, 0, 0];
    p.GetBoxCenter(7, pos);
    assert.equal(pos[0], -half - 240);
    assert.equal(p.GetBox(1, [-half - 720, 0, 0]).lo[0], -half);
});

test("Offset lookup preserves edge-clamped key equivalence and null behavior", () =>
{
    const p = new Partition(), box = p.GetBox(0n, 0n, 0n, 7);
    assert.equal(p.GetBox(-10n, -20n, -30n, 7), box);
    assert.equal(p.CheckOffsetBox(box, -1, 0, 0), box);
    assert.equal(p.GetOffsetBox(box, 1n, 0n, 0n).mKey.ix, 1n);
    assert.equal(p.GetOffsetBox(null, 0, 0, 0), null);
    assert.equal(p.CheckOffsetBox(null, 0, 0, 0), null);
});

test("Invalid levels retain native sentinels and undefined numeric domains throw", () =>
{
    const p = new Partition(), out = {};
    p.GetBoxKey([0, 0, 0], -1, out);
    assert.deepEqual(out, { ix: 0n, iy: 0n, iz: 0n });
    assert.equal(p.GetBox(0, 0, 0, 8), null);
    assert.equal(p.CheckBox(0, 0, 0, -1), null);
    assert.equal(p.GetActiveBoxes(8), null);
    assert.throws(() => p.GetBoxCenter(-1, [0, 0, 0]), RangeError);
    assert.throws(() => p.GetBox(1, [Infinity, 0, 0]), RangeError);
    assert.throws(() => p.GetBox(1, [1e40, 0, 0]), RangeError);
});

test("Module GetBoxCenter retains native signature and TypeError boundary", () =>
{
    assert.equal(GetBoxCenter, moduleGetBoxCenter);
    assert.deepEqual(GetBoxCenter(7, 0, 0, 0), [240, 240, 240]);
    assert.deepEqual(GetBoxCenter(7, -1, 480, -481), [-240, 720, -720]);
    assert.throws(() => GetBoxCenter(8, 0, 0, 0), TypeError);
    assert.deepEqual(GetBoxCenter(7n, 1n, false, true), [240, 240, 240]);
    for (const value of ["1", null, undefined, {}, []])
        assert.throws(() => GetBoxCenter(7, value, 0, 0), TypeError);
});

test("Removing last occupant synchronously releases the entire ancestor chain", () =>
{
    const p = new Partition(), box = p.GetBox(1, [0, 0, 0]), value = ball(1);
    box.AddBall(value);
    box.SetObject({ label: "synthetic" });
    box.RemoveBall(value);
    assert.equal(p.GetSize(), 0);
    assert.equal(p.GetExistingTopBox([0, 0, 0]), null);
    assert.equal(box.mObject, null);
});

test("Sibling and static occupants keep ancestors alive until their own removal", () =>
{
    const p = new Partition(), a = p.GetBox(1, [0, 0, 0]), b = p.GetOffsetBox(a, 1, 0, 0);
    const mover = ball(1), fixed = shape(-2);
    a.AddBall(mover);
    b.AddStaticCollidable(fixed);
    a.RemoveBall(mover);
    assert.equal(p.GetSize(), 8);
    assert.equal(p.CheckBox(b.mKey.ix, b.mKey.iy, b.mKey.iz, 7), b);
    b.RemoveStaticCollidable(fixed);
    assert.equal(p.GetSize(), 0);
});

test("Sorted ball sets retain representatives and use parent order only for two local IDs", () =>
{
    const p = new Partition(), box = p.GetBox(1, [0, 0, 0]);
    const a = ball(-5, { mOwnerId: 2n }), b = ball(-9, { mOwnerId: 3n });
    const c = ball(1), duplicate = ball(-5, { mOwnerId: 2n });
    for (const value of [c, b, a, duplicate]) box.AddBall(value);
    assert.deepEqual(box.balls, [a, b, c]);
    box.RemoveBall(duplicate);
    assert.deepEqual(box.balls, [b, c]);
    assert.equal(new BallSortComparer().Call(a, b), true);
    assert.equal(new BallSortComparer().Call(b, c), true);
});

test("Sorted static and child sets use comparator equivalence rather than identity", () =>
{
    const p = new Partition(), box = p.GetBox(1, [0, 0, 0]);
    const a = shape(-2, 8), b = shape(-1, 7), duplicate = shape(-2, 8);
    box.AddStaticCollidable(a); box.AddStaticCollidable(b); box.AddStaticCollidable(duplicate);
    assert.deepEqual(box.mStaticCollidables, [b, a]);
    box.RemoveStaticCollidable(duplicate);
    assert.deepEqual(box.mStaticCollidables, [b]);
    assert.equal(new StaticComparer().Call(b, a), true);
    const parent = box.mParent, oldLength = parent.mChildren.length;
    parent.AddChildren({ mKey: new Key(box.mKey.ix, box.mKey.iy, box.mKey.iz, box.mKey.n) });
    assert.equal(parent.mChildren.length, oldLength);
    assert.equal(parent.mChildren[0], box);
});

test("Removing a missing occupant still releases an empty box", (t) =>
{
    const p = new Partition(), box = p.GetBox(1, [0, 0, 0]);
    const log = t.mock.method(console, "error", () => {});
    box.RemoveBall(ball(999));
    assert.equal(log.mock.callCount(), 1);
    assert.equal(p.GetSize(), 0);
});

test("Box object ownership retains false-valued host objects", () =>
{
    const box = new Partition().GetBox(1, [0, 0, 0]);
    for (const value of [false, 0, "", [], {}, null])
    {
        box.SetObject(value);
        assert.equal(box.mObject, value);
    }
});

test("Bubble traversal includes diagonal neighbors and clear affects only level zero", () =>
{
    const p = new Partition(), a = p.GetBox(10n, 10n, 10n, 0), b = p.GetBox(11n, 11n, 11n, 0);
    const far = p.GetBox(13n, 13n, 13n, 0);
    a.Traverse(7);
    assert.equal(b.mBubble, 7);
    assert.equal(far.mBubble, -1);
    const leaf = p.GetBox(1, [0, 0, 0]);
    leaf.mBubble = 8;
    p.ClearTraversalFlag();
    assert.equal(a.mBubble, -1);
    assert.equal(b.mBubble, -1);
    assert.equal(leaf.mBubble, 8);
});

test("NearbyBubbles returns first native-order neighbor, including edge self aliases", () =>
{
    const p = new Partition(), center = p.GetBox(10n, 10n, 10n, 0);
    p.GetBox(9n, 9n, 9n, 0).mBubble = 11;
    p.GetBox(11n, 11n, 11n, 0).mBubble = 22;
    assert.equal(center.NearbyBubbles(), 11);
    const edge = p.GetBox(0n, 0n, 0n, 0);
    edge.mBubble = 33;
    assert.equal(edge.NearbyBubbles(), 33);
});

test("NearbyCriteria uses native presets and truncates assignments to one bit", () =>
{
    const first = new Partition.NearbyCriteria(1), third = new Partition.NearbyCriteria(3);
    assert.equal(first.EXCLUDE_MISSILES, 1);
    assert.equal(first.EXCLUDE_CLOAKED, 1);
    assert.equal(third.EXCLUDE_MISSILES, 0);
    assert.equal(third.EXCLUDE_CLOAKED, 1);
    for (const field of ["EXCLUDE_FIXED_BALLS", "EXCLUDE_INERT_BALLS", "EXCLUDE_MISSILES", "EXCLUDE_CLOAKED", "EXCLUDE_HARMONICS_TEST"])
    {
        third[field] = 2; assert.equal(third[field], 0);
        third[field] = -1; assert.equal(third[field], 1);
        third[field] = 9007199254740993n; assert.equal(third[field], 1);
    }
});

test("Candidate enumeration preserves ancestor-descendant-self discovery order", () =>
{
    const p = new Partition(), mid = p.GetBox(400, [0, 0, 0]), owner = ball(100);
    add(mid, owner);
    add(mid.mParent, ball(9));
    const child = p.GetBox(1, [0, 0, 0]);
    add(child, ball(1));
    add(mid, ball(5));
    const uni = [], stat = [];
    p.GetNearbyBalls(owner, uni, stat, true, new Partition.NearbyCriteria());
    assert.deepEqual(ids(uni), [9n, 1n, 5n]);
    assert.equal(uni.every(value => !value.mHandled), true);
    assert.equal(mid.mHandled, false);
});

test("Candidates deduplicate shared memberships, append and reset preexisting output flags", () =>
{
    const other = ball(1), { partition: p, box, owner } = scene([other]);
    const next = p.GetOffsetBox(box, 1, 0, 0);
    add(next, owner); add(next, other);
    const preexisting = ball(999, { mHandled: true }), uni = [preexisting], stat = [];
    p.GetNearbyBalls(owner, uni, stat, false, new Partition.NearbyCriteria());
    assert.deepEqual(ids(uni), [999n, 1n]);
    assert.equal(preexisting.mHandled, false);
    assert.equal(other.mHandled, false);
    const appended = [other];
    p.GetNearbyBalls(owner, appended, [], false, new Partition.NearbyCriteria());
    assert.deepEqual(ids(appended), [1n, 1n]);
});

for (const [name, changes, flag, master, expected] of [
    ["moribund", { isMoribund: true }, null, false, []],
    ["cloaked", { isCloaked: true }, "EXCLUDE_CLOAKED", false, []],
    ["nonmassive", { isMassive: false }, "EXCLUDE_CLOAKED", false, []],
    ["fixed", { isFree: false }, "EXCLUDE_FIXED_BALLS", false, []],
    ["missile", { mMode: 5 }, "EXCLUDE_MISSILES", false, []],
    ["other bubble", { mNewBubble: 2 }, null, true, []],
    ["global other bubble", { mNewBubble: 2, isGlobal: true }, null, true, [1n]],
    ["replica other bubble", { mNewBubble: 2 }, null, false, [1n]]
]) test(`Candidate native filter: ${name}`, () =>
{
    const { partition, owner } = scene([ball(1, changes)]), filter = new Partition.NearbyCriteria();
    if (flag) filter[flag] = 1;
    const uni = [];
    partition.GetNearbyBalls(owner, uni, [], master, filter);
    assert.deepEqual(ids(uni), expected);
});

test("Field filters preserve int64 harmonics and int32 corporation/alliance sentinels", () =>
{
    const field = ball(1, { mMode: 10 }), { partition, owner } = scene([field]);
    const run = (filter = new Partition.NearbyCriteria()) =>
    {
        const result = [];
        partition.GetNearbyBalls(owner, result, [], true, filter);
        return ids(result);
    };
    assert.deepEqual(run(), [1n]);
    owner.mHarmonic = -2n; assert.deepEqual(run(), []);
    owner.mHarmonic = field.mHarmonic = 9007199254740993n; assert.deepEqual(run(), []);
    field.mHarmonic = -1n;
    owner.mCorporationID = field.mCorporationID = 0; assert.deepEqual(run(), []);
    field.mCorporationID = -1;
    owner.mAllianceID = field.mAllianceID = 10; assert.deepEqual(run(), []);
    const filter = new Partition.NearbyCriteria(); filter.EXCLUDE_HARMONICS_TEST = 1;
    assert.deepEqual(run(filter), [1n]);
});

test("Interactive-only branch bypasses ordinary bubble/fixed/missile checks", () =>
{
    const other = ball(1, { isInteractive: true, mNewBubble: 2, isFree: false, mMode: 5 });
    const { partition, owner } = scene([other, ball(2)]);
    const filter = new Partition.NearbyCriteria(1);
    filter.EXCLUDE_INERT_BALLS = filter.EXCLUDE_FIXED_BALLS = 1;
    const uni = [];
    partition.GetNearbyBalls(owner, uni, [], true, filter);
    assert.deepEqual(ids(uni), [1n]);
    owner.mPark.GetInteractiveCnt = () => 0;
    const sentinel = ball(999, { mHandled: true }), early = [sentinel];
    partition.GetNearbyBalls(owner, early, [], true, filter);
    assert.deepEqual(ids(early), [999n]);
    assert.equal(sentinel.mHandled, true);
});

test("Static candidates ignore moribund state but honor master bubbles and fixed exclusion", () =>
{
    const { partition, owner, box } = scene();
    const fixed = shape(-2, 1, { isMoribund: true }), elsewhere = shape(-3, 1, { mNewBubble: 2, isGlobal: true });
    box.AddStaticCollidable(fixed); box.AddStaticCollidable(elsewhere);
    const filter = new Partition.NearbyCriteria(), master = [], replica = [];
    partition.GetNearbyBalls(owner, [], master, true, filter);
    partition.GetNearbyBalls(owner, [], replica, false, filter);
    assert.deepEqual(ids(master), [-2n]);
    assert.deepEqual(ids(replica), [-3n, -2n]);
    filter.EXCLUDE_FIXED_BALLS = 1;
    const none = [];
    partition.GetNearbyBalls(owner, [], none, false, filter);
    assert.deepEqual(none, []);
});

test("Ordinary missiles append their same-bubble target without normal filters", () =>
{
    const target = ball(1, { isMoribund: true, isCloaked: true }), { partition, owner } = scene();
    owner.mMode = 5; owner.mOwnerId = 0n; owner.mFollowPtr = target;
    const uni = [], stat = [];
    partition.GetCollisionCandidates(owner, uni, stat, true);
    assert.deepEqual(uni, [target]);
    assert.deepEqual(stat, []);
    target.mNewBubble = 2;
    partition.GetCollisionCandidates(owner, uni, stat, false);
    assert.equal(uni.length, 1);
});

test("Normal and defender collision presets differ on missiles", () =>
{
    const { partition, owner } = scene([ball(1, { mMode: 5 }), ball(2, { isCloaked: true }), ball(3)]);
    const normal = [], defender = [];
    partition.GetCollisionCandidates(owner, normal, [], false);
    owner.mMode = 5; owner.mOwnerId = -1n;
    partition.GetCollisionCandidates(owner, defender, [], false);
    assert.deepEqual(ids(normal), [3n]);
    assert.deepEqual(ids(defender), [1n, 3n]);
});

test("Proximity wrapper includes missiles and ignores harmonics, with cloaked fixed behavior", () =>
{
    const { partition, owner } = scene([ball(1, { mMode: 5 }), ball(2, { isFree: false }),
        ball(3, { mMode: 10, mHarmonic: 7n })]);
    owner.mHarmonic = 7n;
    const normal = [], cloaked = [];
    partition.GetProximityCandidates(owner, normal, [], true);
    owner.isCloaked = true;
    partition.GetProximityCandidates(owner, cloaked, [], true);
    assert.deepEqual(ids(normal), [1n, 3n]);
    assert.deepEqual(ids(cloaked), [1n, 2n, 3n]);
});

test("Static membership has native defaults, sorted links and synchronous removal", () =>
{
    const base = new Partitionable();
    assert.equal(base.mId, 0n); assert.equal(base.mNewBubble, -1); assert.equal(base.mOldBubble, -1);
    assert.notEqual(base.mOldPos, base.mNewPos);
    assert.throws(() => base.InsertInBox(null), /abstract/);
    const fixed = new StaticCollidable(), p = new Partition();
    fixed.mId = -2n;
    const b = p.GetBox(1, [480, 0, 0]), a = p.GetBox(1, [0, 0, 0]);
    fixed.InsertInBox(b); fixed.InsertInBox(a); fixed.InsertInBox(a); fixed.InsertInBox(null);
    assert.deepEqual(fixed.mBoxes, [a, b]);
    assert.equal(a.mStaticCollidables[0], fixed);
    fixed.mMyBox = a;
    fixed.SetBoxActive(13, true);
    fixed.DeleteFromBoxes();
    assert.deepEqual(fixed.mBoxes, []);
    assert.equal(fixed.mMyBox, null);
    assert.equal(p.GetSize(), 0);
});

test("Static ClearBoxes only drops links and inflated radius delegates unchanged", () =>
{
    const fixed = new StaticCollidable(), p = new Partition(), box = p.GetBox(1, [0, 0, 0]);
    fixed.InsertInBox(box);
    fixed.ClearBoxes();
    assert.equal(box.mStaticCollidables[0], fixed);
    fixed.GetBoundingRadius = () => 3.25;
    assert.equal(fixed.GetInflatedRadius(999), 3.25);
    assert.throws(() => fixed.CheckCollision([], [], 0, {}), /abstract/);
    box.RemoveStaticCollidable(fixed);
});

test("Active boxes include empty ancestors and return detached double coordinates", () =>
{
    const p = new Partition(), box = p.GetBox(1, [1e12, 0, 0]);
    const result = p.GetActiveBoxes(7);
    assert.deepEqual(result, [480, [[999999999840, 0, 0]]]);
    result[1][0][0] = 0;
    assert.equal(box.lo[0], 999999999840);
    assert.equal(p.GetActiveBoxes(0)[1].length, 1);
});

test("Multilevel candidate sets match an independent cell-volume overlap oracle", () =>
{
    const p = new Partition(), balls = [];
    for (let i = 0; i < 32; ++i)
    {
        const value = ball(i + 1);
        const radius = [1, 200, 1000][i % 3];
        const position = [(i % 5 - 2) * 480 + 20, (i % 7 - 3) * 480 + 30, (i % 2) * 480 + 40];
        const box = p.GetBox(radius, position);
        add(box, value);
        if (i % 4 === 0) add(p.GetOffsetBox(box, 1, 0, 0), value);
        balls.push(value);
    }
    const overlaps = (a, b) => [0, 1, 2].every(i => a.lo[i] < b.hi[i] && b.lo[i] < a.hi[i]);
    for (const owner of balls)
    {
        const expected = balls.filter(other => other !== owner
            && owner.mBoxes.some(a => other.mBoxes.some(b => overlaps(a, b))));
        const actual = [];
        p.GetNearbyBalls(owner, actual, [], false, new Partition.NearbyCriteria());
        assert.deepEqual(new Set(ids(actual)), new Set(ids(expected)));
        assert.equal(actual.length, new Set(actual).size);
    }
});
