import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { CjsDestinyStream as Stream, CjsDestinyBall as Ball, CjsBallparkController as Park, settings } from "@carbonenginejs/server";
import { vec3d } from "../dist/destiny/math/vec3d.js";

// Source: destiny/src/Thunkers.cpp:2083-2142,2463-2509,2897-3177.
// Source: destiny/python/destiny/test/ballpark/test_stream_read_write.py:8-75.
afterEach(() => settings.Reset());
const Mode = Ball.DSTBALLMODE;
const rigid = "000403020108070605040302010b0000803f00000000000000400000000000000840000000000000104002ff";
const dynamic = "01050000000100000000000000020000c03f0000000000000040000000000000084000000000000010401f0000000000002040fff9ffffffffffffff00000080f7ffffff00001041000000000000144000000000000018400000000000001c4000002041000030410000803e0000003f0000403f0000803f0000884100009041000098410000a0410000a841ff";
function add(park, id = 1, free = false)
{
    return park.AddBall(id, 13e6, 2, 10, free, false, false, false, false, 10, 20, 30, 0, 0, 0, 0.9, 0.95);
}
function minis(ball, offset = 0)
{
    ball.AddMiniBall(offset + 1, 2, 3, 4);
    ball.AddMiniCapsule(offset + 5, 6, 7, 8, 9, 10, 11);
    ball.AddMiniBox([offset + 12, 13, 14], [15, 0, 0], [0, 16, 0], [0, 0, 17]);
}
function packet(...balls)
{
    const stream = new Stream(), park = new Park();
    stream.WriteUint8(1); stream.WriteInt32(17);
    for (const ball of balls) park.WriteBallToStream(ball, stream);
    stream.Seek(0); return stream;
}

test("reader accepts independent rigid golden with native defaults in both orientation modes", () =>
{
    for (const enabled of [false, true])
    {
        const config = settings.Get(); config.useDynamicalOrientation = enabled; settings.Apply(config);
        const park = new Park(), stream = new Stream(Buffer.from(rigid, "hex"));
        park.ReadFullStateFromStream(stream);
        const ball = park.GetBall(0x0102030405060708n);
        assert.equal(park.currentTime, 0x01020304); assert.equal(stream.remaining, 0);
        assert.deepEqual(Array.from(ball.mNewPos), [2, 3, 4]); assert.equal(ball.radius, 1);
        assert.deepEqual([ball.mass, ball.maxVelocity, ball.agility, ball.speedFraction], [1e34, 0, 1, 0]);
        assert.deepEqual(Array.from(ball.mNewVel), [0, 0, 0]);
        assert.deepEqual([ball.mHarmonic, ball.mCorporationID, ball.mAllianceID], [-1n, -1, -1]);
        assert.equal(ball.mMode, Mode.DSTBALL_RIGID); assert.equal(ball.mFormationID, -1); assert.equal(ball.formationID, 255);
        if (enabled)
        {
            assert.deepEqual(Array.from(ball.mNewRot), [0, 0, 0, 1]);
            assert.deepEqual(Array.from(ball.mNewAngVel), [0, 0, 0]);
            assert.equal(ball.mMaxAngVel, 0); assert.equal(ball.mRotAgility, 1);
        }
    }
});

test("independent dynamic packet preserves signed bytes, affiliations and native backsteps", () =>
{
    const config = settings.Get(); config.useDynamicalOrientation = true; settings.Apply(config);
    const park = new Park(), stream = new Stream(Buffer.from(dynamic, "hex"));
    park.ReadFullStateFromStream(stream);
    const ball = park.GetBall(1);
    assert.equal(stream.remaining, 0); assert.equal(park.currentTime, 5);
    assert.deepEqual(Array.from(ball.mNewPos), [2, 3, 4]); assert.equal(ball.radius, 1.5);
    assert.deepEqual(Array.from(ball.mNewVel), [5, 6, 7]); assert.deepEqual(Array.from(ball.mOldPos), [-3, -3, -3]);
    assert.deepEqual(Array.from(ball.mNewRot), [0.25, 0.5, 0.75, 1]);
    assert.deepEqual(Array.from(ball.mNewAngVel), [18, 19, 20]);
    assert.deepEqual([ball.mass, ball.maxVelocity, ball.agility, ball.speedFraction, ball.mMaxAngVel, ball.mRotAgility], [8, 9, 10, 11, 17, 21]);
    assert.deepEqual([ball.isFree, ball.isGlobal, ball.isMassive, ball.isInteractive, ball.isSpaceJunk].map(Boolean), [true, true, true, true, true]);
    assert.deepEqual([ball.isCloaked, ball.mHarmonic, ball.mCorporationID, ball.mAllianceID, ball.mFormationID], [255, -7n, -2147483648, -9, -1]);
    for (let i = 0; i < 3; ++i) { ball.mOldPos[i] = 100 * (i + 1); ball.mOldVel[i] = 100 * (i + 1) + 1; }
    ball.mOldRot.set([1, 2, 3, 4]);
    park.ReadFullStateFromStream(stream, 1);
    assert.equal(park.GetBall(1), ball);
    assert.deepEqual(Array.from(ball.mOldPos), [100, 200, 300]); assert.deepEqual(Array.from(ball.mOldVel), [101, 201, 301]);
    assert.deepEqual(Array.from(ball.mOldRot), [1, 2, 3, 4]);
});

for (const mode of [Mode.DSTBALL_GOTO, Mode.DSTBALL_FOLLOW, Mode.DSTBALL_STOP, Mode.DSTBALL_WARP,
    Mode.DSTBALL_ORBIT, Mode.DSTBALL_MISSILE, Mode.DSTBALL_MUSHROOM, Mode.DSTBALL_TROLL,
    Mode.DSTBALL_FIELD, Mode.DSTBALL_FORMATION])
test(`reader restores native mode ${mode} tail without movement commands`, () =>
{
    const source = add(new Park()); source.mMode = mode; source.mFollowId = 0x8000000000000001n - (1n << 64n);
    source.mFollowRange = 12; source.mEffectStamp = -123; source.mOwnerId = -3n;
    source.mGoto.set([14, 15, 16]); source.mLastCollision = 13;
    const stream = packet(source); stream.Seek(5);
    const park = new Park(), ball = park.ReadBallFromStream(stream, 0);
    assert.equal(ball.mMode, mode); assert.equal(stream.remaining, 0);
    if ([Mode.DSTBALL_FOLLOW, Mode.DSTBALL_ORBIT, Mode.DSTBALL_MISSILE, Mode.DSTBALL_FORMATION].includes(mode))
        assert.deepEqual([ball.mFollowId, ball.mFollowRange], [source.mFollowId, 12]);
    if ([Mode.DSTBALL_FORMATION, Mode.DSTBALL_MISSILE, Mode.DSTBALL_WARP, Mode.DSTBALL_MUSHROOM, Mode.DSTBALL_TROLL].includes(mode))
        assert.equal(ball.mEffectStamp, -123);
    if ([Mode.DSTBALL_MISSILE, Mode.DSTBALL_WARP, Mode.DSTBALL_MUSHROOM].includes(mode)) assert.equal(ball.mOwnerId, -3n);
    if ([Mode.DSTBALL_GOTO, Mode.DSTBALL_WARP, Mode.DSTBALL_MISSILE].includes(mode)) assert.deepEqual(Array.from(ball.mGoto), [14, 15, 16]);
    if (mode === Mode.DSTBALL_WARP) { assert.equal(ball.mFollowId, source.mFollowId); assert.equal(ball.mLastCollision, 13); }
    if (mode === Mode.DSTBALL_MUSHROOM) { assert.equal(ball.mFollowRange, 12); assert.equal(ball.mGoto[0], 14); }
});

test("follow fixup resolves forward and duplicate records; missing target changes only mode", () =>
{
    const src = new Park(), follower = add(src), target = add(src, 2), missing = add(src, 3);
    follower.mMode = Mode.DSTBALL_FOLLOW; follower.mFollowId = target.id;
    missing.mMode = Mode.DSTBALL_ORBIT; missing.mFollowId = 999n;
    const park = new Park(); park.ReadFullStateFromStream(packet(follower, follower, missing, target));
    const got = park.GetBall(1), lost = park.GetBall(3);
    assert.equal(got.mFollowPtr, park.GetBall(2)); assert.deepEqual([...park.GetBall(2).mFollowers], [1n]);
    assert.equal(lost.mMode, Mode.DSTBALL_GOTO); assert.equal(lost.mFollowId, 999n);
    assert.equal(lost.mFollowPtr, null);
});

test("full wrapper clears only selected registries, retaining absent aggregate balls", () =>
{
    for (const partial of [0, 1, 2, true, 2n])
    {
        const park = new Park(), absent = add(park, 7, true);
        park.mProximityBalls.set(7n, absent); park.bubbleInteractives = new Map([[7, 1]]);
        const stream = new Stream(Buffer.from("0109000000", "hex"));
        park.ReadFullStateFromStream(stream, partial);
        assert.equal(park.GetBall(7), absent); assert.equal(park.currentTime, 9);
        assert.equal(park.mFreeBalls.has(7n), partial !== 0); assert.equal(park._freeBallIds.includes(7n), partial !== 0);
        assert.equal(park.mProximityBalls.has(7n), partial !== 0); assert.equal(park.bubbleInteractives.has(7), partial !== 0);
    }
});

for (const free of [false, true]) for (const partial of [0, 1, 2])
test(`mini restoration incoming free=${free} partial=${partial} retains native ownership`, () =>
{
    const source = add(new Park(), 1, free); minis(source, 100);
    const park = new Park(), existing = add(park); minis(existing);
    const lists = [existing.mMiniBalls, existing.mMiniCapsules, existing.mMiniBoxes];
    const descriptors = lists.map(list => list.GetAt(0)), ids = descriptors.map(d => d.id);
    const worlds = [park.GetBall(ids[0]), park.mCapsules.get(ids[1]), park.mOrientedBoxes.get(ids[2])];
    const stream = packet(source); park.ReadFullStateFromStream(stream, partial);
    assert.equal(stream.remaining, 0); assert.equal(park.GetBall(1), existing);
    assert.equal(existing.mMiniBalls, lists[0]); assert.equal(existing.mMiniCapsules, lists[1]); assert.equal(existing.mMiniBoxes, lists[2]);
    for (let i = 0; i < 3; i++)
    {
        assert.equal(lists[i].GetSize(), partial === 1 || !free ? 1 : 2);
        if (partial === 1 || free) assert.equal(lists[i].GetAt(0), descriptors[i]);
        else assert.notEqual(lists[i].GetAt(0), descriptors[i]);
    }
    const retained = [park.GetBall(ids[0]), park.mCapsules.get(ids[1]), park.mOrientedBoxes.get(ids[2])];
    if (partial === 1 || free) assert.deepEqual(retained, worlds);
    else { assert.equal(retained[0], null); assert.equal(retained[1], undefined); assert.equal(retained[2], undefined); }
    if (partial !== 1)
    {
        const index = free ? 1 : 0;
        const [mb, mc, mx] = lists.map(list => list.GetAt(index));
        assert.deepEqual([mb.x, mb.y, mb.z, mb.radius], [101, 2, 3, 4]);
        assert.deepEqual([mc.ax, mc.ay, mc.az, mc.bx, mc.by, mc.bz, mc.radius], [105, 6, 7, 8, 9, 10, 11]);
        assert.deepEqual(Array.from(mx.mCorner), [112, 13, 14]);
        assert.deepEqual(Array.from(mx.mLocalX), [15, 0, 0]);
        if (free) assert.deepEqual([mb.id, mc.id, mx.id], [0n, 0n, 0n]);
    }
});

test("fixed mini replacement removes in reverse per-kind order before adding new shapes", () =>
{
    const source = add(new Park()); minis(source, 100);
    const park = new Park(), existing = add(park); minis(existing); minis(existing, 20);
    const expected = [], observed = [], originals = new Map();
    for (const [method, list] of [["RemoveBall", existing.mMiniBalls], ["RemoveCapsule", existing.mMiniCapsules], ["RemoveOrientedBox", existing.mMiniBoxes]])
    {
        for (let i = list.GetSize() - 1; i >= 0; --i) expected.push([method, list.GetAt(i).id]);
        const original = Park.prototype[method]; originals.set(method, original);
        Park.prototype[method] = function(id) { observed.push([method, id]); return original.call(this, id); };
    }
    try { park.ReadFullStateFromStream(packet(source), 2); }
    finally { for (const [method, original] of originals) Park.prototype[method] = original; }
    assert.deepEqual(observed, expected);
});

test("reader uses core mini capsule creation and attempts removal of zero descriptor IDs", () =>
{
    const source = add(new Park(), 1, true); source.AddMiniCapsule(1, 2, 3, 4, 5, 6, -7);
    const park = new Park(); park.ReadFullStateFromStream(packet(source));
    assert.equal(park.GetBall(1).miniCapsules[0].radius, -7);
    const fixed = add(new Park()), calls = [], remove = park.RemoveCapsule;
    park.RemoveCapsule = function(id) { calls.push(id); return remove.call(this, id); };
    park.ReadFullStateFromStream(packet(fixed), 2);
    assert.deepEqual(calls, [0n]); assert.equal(park.GetBall(1).miniCapsules.length, 0);
});

test("stream restoration retains checked finite physical admission as an explicit adaptation", () =>
{
    const source = add(new Park()); source.mMass = NaN;
    const park = new Park();
    assert.throws(() => park.ReadFullStateFromStream(packet(source)), /finite/);
    assert.equal(park.currentTime, 17); assert.equal(park.GetBall(1), null);
});

test("bounded errors retain completed records and fields, and reject invalid adapters before clearing", () =>
{
    const park = new Park(), existing = add(park, 8, true);
    assert.throws(() => park.ReadFullStateFromStream({ Seek() {}, ReadUint8() {} }), TypeError);
    assert.equal(park.mFreeBalls.get(8n), existing);
    assert.throws(() => park.ReadFullStateFromStream(new Stream(), 0x80000000), RangeError);
    assert.throws(() => park.ReadFullStateFromStream(new Stream(Buffer.from([2]))), /packet type/);
    const bytes = Buffer.concat([Buffer.from(rigid, "hex"), Buffer.from([1, 2, 3])]);
    assert.throws(() => park.ReadFullStateFromStream(new Stream(bytes)), RangeError);
    assert.ok(park.GetBall(0x0102030405060708n)); assert.equal(park.currentTime, 0x01020304);
    const source = add(new Park()); source.mMode = Mode.DSTBALL_GOTO; source.mGoto.set([2, 3, 4]);
    const truncated = packet(source).GetBytes().slice(0, -8);
    assert.throws(() => park.ReadFullStateFromStream(new Stream(truncated)), RangeError);
    assert.deepEqual(Array.from(park.GetBall(1).mGoto), [2, 3, 0]);
});

test("unknown record modes preserve creation before returning null", () =>
{
    const source = add(new Park()), bytes = packet(source).GetBytes(); bytes[13] = 255;
    const park = new Park(), error = console.error, messages = []; console.error = (...args) => messages.push(args);
    try { park.ReadFullStateFromStream(new Stream(bytes)); } finally { console.error = error; }
    assert.equal(park.GetBall(1).mMode, 255); assert.equal(messages.length, 1);
});

test("mini box vectors are independent during reentry and returned on read errors", () =>
{
    const source = add(new Park()); minis(source);
    const outer = packet(source), inner = packet(source), park = new Park();
    const alloc = vec3d.alloc, unalloc = vec3d.unalloc, live = new Set();
    vec3d.alloc = () => { const value = alloc(); assert.equal(live.has(value), false); live.add(value); return value; };
    vec3d.unalloc = value => { assert.equal(live.delete(value), true); unalloc(value); };
    const read = outer.ReadVector3d; let nested = false;
    outer.ReadVector3d = function(out)
    {
        read.call(this, out);
        if (!nested) { nested = true; new Park().ReadFullStateFromStream(inner); }
    };
    try
    {
        park.ReadFullStateFromStream(outer); assert.equal(live.size, 0);
        assert.deepEqual(Array.from(park.GetBall(1).miniBoxes[0].mCorner), [12, 13, 14]);
        assert.throws(() => new Park().ReadFullStateFromStream(new Stream(outer.GetBytes().slice(0, -8))), RangeError);
        assert.equal(live.size, 0);
    }
    finally { vec3d.alloc = alloc; vec3d.unalloc = unalloc; }
});
