import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { CjsDestinyStream as Stream, CjsDestinyBall as Ball, CjsBallparkController as Park, settings, BALLFLAGS, DESTINYPACKETS } from "@carbonenginejs/server";
import { vec3 } from "@carbonenginejs/runtime/math/vec3";

// Source: destiny/src/Thunkers.cpp:2145-2257,3180-3377.
afterEach(() => settings.Reset());
const Mode = Ball.DSTBALLMODE;
function ball(mode = Mode.DSTBALL_STOP, free = false)
{
    const value = new Ball();
    value.mId = 0x0102030405060708n; value.mMode = mode; value.isFree = free;
    value.isGlobal = true; value.isMassive = false; value.isInteractive = false; value.isSpaceJunk = false;
    value.mRadius = 1; value.mMass = 8; value.isCloaked = 255; value.mHarmonic = -7n;
    value.mCorporationID = 0x80000000; value.mAllianceID = -9; value.mFormationID = 255;
    vec3.set(value.mNewPos, 2, 3, 4); vec3.set(value.mNewVel, 5, 6, 7);
    value.mMaxVel = 9; value.mAgility = 10; value.mSpeedFraction = 11;
    value.mFollowId = 0x1122334455667788n; value.mFollowRange = 12; value.mOwnerId = -3n;
    value.mEffectStamp = 0x80000001; value.mLastCollision = 13; vec3.set(value.mGoto, 14, 15, 16);
    return value;
}
function encoded(value)
{
    const stream = new Stream(); new Park().WriteBallToStream(value, stream);
    return Buffer.from(stream.GetBytes());
}

test("native empty packet goldens", () =>
{
    // Source: destiny/python/destiny/test/ballpark/test_stream_read_write.py:8-12,62-66.
    const park = new Park(), full = new Stream(), selected = new Stream();
    park.WriteFullStateToStream(full); park.WriteBallsToStream([], selected);
    assert.equal(Buffer.from(full.Read()).toString("hex"), "0000000000");
    assert.equal(Buffer.from(selected.Read()).toString("hex"), "0100000000");
    assert.equal(DESTINYPACKETS.DESTINY_BALLS, 1); assert.equal(BALLFLAGS.DSTBALL_HASMINIBOXES, 32);
});

test("independent literal rigid packet fixes field widths, byte order and no padding", () =>
{
    const park = new Park(), value = ball(Mode.DSTBALL_RIGID), stream = new Stream();
    park._balls.set(value.mId, value); park.currentTime = 0x01020304;
    park.WriteFullStateToStream(stream);
    assert.equal(Buffer.from(stream.Read()).toString("hex"),
        "000403020108070605040302010b0000803f00000000000000400000000000000840000000000000104002ff");
});

test("native common prefix narrows signed fields and distinguishes free orientation layout", () =>
{
    const value = ball(Mode.DSTBALL_STOP, true);
    value.isMassive = value.isInteractive = value.isSpaceJunk = true;
    let bytes = encoded(value);
    assert.equal(bytes.length, 100); assert.equal(bytes.readBigInt64LE(0), value.mId);
    assert.equal(bytes[8], Mode.DSTBALL_STOP); assert.equal(bytes.readFloatLE(9), 1);
    assert.deepEqual([13, 21, 29].map(i => bytes.readDoubleLE(i)), [2, 3, 4]);
    assert.equal(bytes[37], 31); assert.equal(bytes.readDoubleLE(38), 8);
    assert.equal(bytes.readInt8(46), -1); assert.equal(bytes.readBigInt64LE(47), -7n);
    assert.equal(bytes.readInt32LE(55), -2147483648); assert.equal(bytes.readInt32LE(59), -9);
    assert.equal(bytes.readFloatLE(63), 9);
    assert.deepEqual([67, 75, 83].map(i => bytes.readDoubleLE(i)), [5, 6, 7]);
    assert.equal(bytes.readFloatLE(91), 10); assert.equal(bytes.readFloatLE(95), 11); assert.equal(bytes.readInt8(99), -1);
    const config = settings.Get(); config.useDynamicalOrientation = true; settings.Apply(config);
    value.mNewRot.set([0.25, 0.5, 0.75, 1]); value.mMaxAngVel = 17;
    vec3.set(value.mNewAngVel, 18, 19, 20); value.mRotAgility = 21;
    bytes = encoded(value);
    assert.equal(bytes.length, 136);
    assert.deepEqual([99, 103, 107, 111, 115, 119, 123, 127, 131].map(i => bytes.readFloatLE(i)),
        [0.25, 0.5, 0.75, 1, 17, 18, 19, 20, 21]);
    assert.equal(bytes.readInt8(135), -1);
    value.isFree = false; assert.equal(encoded(value).length, 64);
});

for (const [mode, length] of [[Mode.DSTBALL_GOTO, 24], [Mode.DSTBALL_FOLLOW, 12], [Mode.DSTBALL_STOP, 0],
    [Mode.DSTBALL_WARP, 52], [Mode.DSTBALL_ORBIT, 12], [Mode.DSTBALL_MISSILE, 48],
    [Mode.DSTBALL_MUSHROOM, 24], [Mode.DSTBALL_TROLL, 4], [Mode.DSTBALL_FIELD, 0], [Mode.DSTBALL_FORMATION, 16]])
{
    test(`native mode ${mode} payload layout`, () =>
    {
        const value = ball(mode), bytes = encoded(value).subarray(64);
        assert.equal(bytes.length, length);
        if ([Mode.DSTBALL_FOLLOW, Mode.DSTBALL_ORBIT, Mode.DSTBALL_MISSILE, Mode.DSTBALL_FORMATION].includes(mode))
        {
            assert.equal(bytes.readBigInt64LE(0), value.mFollowId); assert.equal(bytes.readFloatLE(8), 12);
        }
        if (mode === Mode.DSTBALL_FORMATION) assert.equal(bytes.readInt32LE(12), -2147483647);
        if (mode === Mode.DSTBALL_GOTO || mode === Mode.DSTBALL_WARP)
            assert.deepEqual([0, 8, 16].map(i => bytes.readDoubleLE(i)), [14, 15, 16]);
        if (mode === Mode.DSTBALL_WARP)
        {
            assert.equal(bytes.readInt32LE(24), -2147483647); assert.equal(bytes.readDoubleLE(28), 13);
            assert.equal(bytes.readBigInt64LE(36), value.mFollowId); assert.equal(bytes.readBigInt64LE(44), -3n);
        }
        if (mode === Mode.DSTBALL_MISSILE)
        {
            assert.equal(bytes.readBigInt64LE(12), -3n); assert.equal(bytes.readInt32LE(20), -2147483647);
            assert.deepEqual([24, 32, 40].map(i => bytes.readDoubleLE(i)), [14, 15, 16]);
        }
        if (mode === Mode.DSTBALL_MUSHROOM)
        {
            assert.equal(bytes.readFloatLE(0), 12); assert.equal(bytes.readDoubleLE(4), 14);
            assert.equal(bytes.readInt32LE(12), -2147483647); assert.equal(bytes.readBigInt64LE(16), -3n);
        }
        if (mode === Mode.DSTBALL_TROLL) assert.equal(bytes.readInt32LE(0), -2147483647);
    });
}

test("mini sections use ball/capsule/box order and native double vectors", () =>
{
    const value = ball(Mode.DSTBALL_STOP, true);
    value.AddMiniBall(1, 2, 3, 4); value.AddMiniCapsule(5, 6, 7, 8, 9, 10, 11);
    value.PyAddMiniBox(12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23);
    const bytes = encoded(value);
    assert.equal(bytes[37], 0xe3); assert.equal(bytes.length, 282);
    assert.equal(bytes.readUInt16LE(100), 1);
    assert.deepEqual([102, 110, 118].map(i => bytes.readDoubleLE(i)), [1, 2, 3]); assert.equal(bytes.readFloatLE(126), 4);
    assert.equal(bytes.readUInt16LE(130), 1);
    assert.deepEqual([132, 140, 148, 156, 164, 172].map(i => bytes.readDoubleLE(i)), [5, 6, 7, 8, 9, 10]);
    assert.equal(bytes.readFloatLE(180), 11); assert.equal(bytes.readUInt16LE(184), 1);
    assert.deepEqual(Array.from({ length: 12 }, (_, i) => bytes.readDoubleLE(186 + i * 8)),
        [12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23]);
});

test("mini counts narrow before flags and loops; unsupported modes emit only the common prefix", () =>
{
    const value = ball(Mode.DSTBALL_STOP, true);
    value.AddMiniBall(1, 2, 3, 4); const mini = value.mMiniBalls.GetAt(0);
    let count = 65536, accesses = 0;
    value.mMiniBalls = { GetSize: () => count, GetAt: () => { accesses++; return mini; } };
    assert.equal(encoded(value).length, 100); assert.equal(accesses, 0);
    count++; const bytes = encoded(value); assert.equal(bytes.length, 130); assert.equal(bytes.readUInt16LE(100), 1);
    assert.equal(accesses, 1);
    const error = console.error, messages = []; console.error = (...args) => messages.push(args);
    try
    {
        for (const mode of [Mode.DSTBALL_BOID, Mode.DSTBALL_MINIBALL])
        {
            value.mMode = mode; assert.equal(encoded(value).length, 100);
        }
    }
    finally { console.error = error; }
    assert.equal(messages.length, 2); assert.equal(accesses, 1);
    value.isMoribund = true; assert.equal(encoded(value).length, 0);
});

test("full-state filters differ from selected-ball ordering and malformed-ID skipping", () =>
{
    const park = new Park(), source = ball(Mode.DSTBALL_RIGID); source.mId = 1n; source.isGlobal = false; source.mNewBubble = 1;
    const other = ball(Mode.DSTBALL_RIGID); other.mId = 2n; other.isGlobal = false; other.mNewBubble = 2;
    const global = ball(Mode.DSTBALL_RIGID); global.mId = 3n; global.mNewBubble = 2;
    const cloaked = ball(Mode.DSTBALL_RIGID); cloaked.mId = 4n; cloaked.mNewBubble = 1;
    const local = ball(Mode.DSTBALL_RIGID); local.mId = -1073741825n;
    for (const value of [source, other, global, local]) value.isCloaked = 0;
    for (const value of [source, other, global, cloaked, local]) park._balls.set(value.mId, value);
    const ids = stream => { const bytes = Buffer.from(stream.Read()), result = []; for (let i = 5; i < bytes.length; i += 39) result.push(bytes.readBigInt64LE(i)); return result; };
    park.isMaster = true;
    let stream = new Stream(); park.WriteFullStateToStream(stream, 1); assert.deepEqual(ids(stream), [1n, 3n]);
    stream = new Stream(); park.WriteFullStateToStream(stream, 99); assert.deepEqual(ids(stream), [1n, 2n, 3n, 4n]);
    park.isMaster = false;
    stream = new Stream(); park.WriteFullStateToStream(stream, 1); assert.deepEqual(ids(stream), [1n, 2n, 3n, 4n]);
    stream = new Stream(); park.WriteBallsToStream([4n, local.mId, "bad", 99, 4n], stream);
    assert.deepEqual(ids(stream), [4n, local.mId, 4n]);
});

test("stream overwrite retains trailing bytes and scalar writes retain negative zero and NaN", () =>
{
    const stream = new Stream(new Uint8Array([9, 8, 7, 6, 5, 4, 3]));
    new Park().WriteFullStateToStream(stream);
    assert.deepEqual(Array.from(stream.Read()), [0, 0, 0, 0, 0, 4, 3]);
    assert.equal(stream.Read().length, 0); stream.Seek(1); stream.Write(new Uint8Array([22]));
    assert.equal(stream.GetBytes()[1], 22); assert.equal(stream.end, 7);
    const floats = new Stream(); floats.WriteFloat32(-0); floats.WriteFloat64(-0); floats.WriteFloat32(NaN); floats.WriteFloat64(NaN);
    floats.Seek(0); assert.ok(Object.is(floats.ReadFloat32(), -0)); assert.ok(Object.is(floats.ReadFloat64(), -0));
    assert.ok(Number.isNaN(floats.ReadFloat32())); assert.ok(Number.isNaN(floats.ReadFloat64()));
    assert.throws(() => floats.ReadInt64(), RangeError); assert.throws(() => floats.Seek(-1), RangeError);
    const value = ball(); value.mRadius = -0; value.mMass = -0; value.mNewPos[0] = NaN;
    const bytes = encoded(value); assert.ok(Object.is(bytes.readFloatLE(9), -0));
    assert.ok(Object.is(bytes.readDoubleLE(38), -0)); assert.ok(Number.isNaN(bytes.readDoubleLE(13)));
});

test("stream owns Buffer subranges and returned payloads independently of source storage", () =>
{
    const input = Buffer.from([99, 1, 2, 3, 88]), stream = new Stream(input.subarray(1, 4));
    input[1] = 77;
    assert.equal(stream.ReadUint8(), 1);
    const snapshot = stream.GetBytes(); snapshot[1] = 66;
    assert.equal(stream.ReadUint8(), 2);
    stream.Seek(0); const payload = stream.Read(); payload[0] = 55;
    assert.deepEqual(Array.from(stream.GetBytes()), [1, 2, 3]);
});

test("native stack snapshots survive nested stream writes and effect-stamp mutation", () =>
{
    const park = new Park(), value = ball(Mode.DSTBALL_FORMATION, true), stream = new Stream();
    const write = stream.WriteInt64;
    let first = true;
    stream.WriteInt64 = function (field)
    {
        if (first)
        {
            first = false; value.mRadius = 99; value.mMass = 100;
            vec3.set(value.mNewPos, 101, 102, 103); vec3.set(value.mNewVel, 104, 105, 106);
            park.WriteBallToStream(ball(Mode.DSTBALL_RIGID), new Stream());
        }
        else if (this.offset === 100) value.mEffectStamp = 42;
        write.call(this, field);
    };
    park.WriteBallToStream(value, stream);
    const bytes = Buffer.from(stream.GetBytes());
    assert.equal(bytes.readFloatLE(9), 1); assert.equal(bytes.readDoubleLE(38), 8);
    assert.deepEqual([13, 21, 29].map(i => bytes.readDoubleLE(i)), [2, 3, 4]);
    assert.deepEqual([67, 75, 83].map(i => bytes.readDoubleLE(i)), [5, 6, 7]);
    assert.equal(bytes.readInt32LE(112), -2147483647);
});
