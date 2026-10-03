import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { CjsBallparkController as Park, CjsDestinyBall as Ball, CjsDestinyClientBall as ClientBall,
    CjsDestinyMiniBall as MiniBall, CjsDestinyMiniCapsule as MiniCapsule,
    CjsDestinyMiniBox as MiniBox, settings } from "@carbonenginejs/server";
import { BlueList } from "@carbonenginejs/runtime/blue";
import { vec3d } from "../dist/destiny/math/vec3d.js";

// Source: destiny/src/Ball.cpp:1634-1879,2129-2189.
// Source: destiny/src/Ballpark.cpp:3559-3636,4887-4930,5475-5538.
afterEach(() => { settings.Reset(); Park.s_ballNotInParkCallback = null; });

function parent(park, id = 99, free = false, x = 0, y = 0, z = 0)
{
    return park.AddBall(id, 13e6, 2, 10, free, false, false, false, false,
        x, y, z, 0, 0, 0, 0.9, 0.95);
}

function moving(park, id, x, y, z, radius = 2)
{
    return park.AddBall(id, 13e6, radius, 10, true, false, true, false, false,
        x, y, z, 0, 0, 0, 0.9, 0.95);
}

function attachAll(ball)
{
    ball.AddMiniBall(1, 2, 3, 4);
    ball.AddMiniCapsule(-1, -2, -3, 1, 2, 3, 5);
    ball.AddMiniBox([0, 0, 0], [6, 0, 0], [0, 7, 0], [0, 0, 8]);
}

function ids(ball)
{
    return [ball.miniBalls[0].id, ball.miniCapsules[0].id, ball.miniBoxes[0].id];
}

function near(actual, expected, tolerance = 5e-8)
{
    assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);
}

test("mini descriptor defaults own independent float64 values and readonly identities", () =>
{
    const a = new MiniBall(), b = new MiniBall(), c = new MiniCapsule(), box = new MiniBox();
    assert.deepEqual([a.id, c.id, box.id], [0n, 0n, 0n]);
    assert.deepEqual([a.radius, c.radius], [0, 0]);
    assert.equal(c.mParentBallID, undefined); assert.equal(box.mParentBallID, undefined);
    for (const value of [a.mPos, c.mHemisphereA, c.mHemisphereB, box.mCorner, box.mLocalX, box.mLocalY, box.mLocalZ])
    {
        assert.ok(value instanceof Float64Array);
        assert.deepEqual(Array.from(value), [0, 0, 0]);
    }
    a.x = 2 ** 40 + 0.25;
    assert.equal(a.mPos[0], 2 ** 40 + 0.25); assert.equal(b.x, 0);
    a.radius = 0.1; c.radius = 0.1;
    assert.equal(a.mRadius, Math.fround(0.1)); assert.equal(c.mRadius, Math.fround(0.1));
    assert.throws(() => { a.id = 42n; }, TypeError);
});

test("native BlueList owners admit exact mini interfaces without attaching externally inserted descriptors", () =>
{
    const park = new Park(), ball = parent(park), other = parent(park, 100);
    assert.equal(ball.miniBalls.constructor, BlueList);
    assert.notEqual(ball.miniBalls, other.miniBalls);
    assert.equal(ball.miniBalls.Insert(-1, new MiniCapsule()), false);
    const descriptor = new MiniBall();
    descriptor.radius = 2;
    assert.equal(ball.miniBalls.Insert(-1, descriptor), true);
    assert.equal(descriptor.id, 0n);
    assert.equal(park._balls.size, 2);
    assert.throws(() => { ball.miniBalls = []; }, TypeError);
    ball.AddMiniBalls();
    assert.notEqual(descriptor.id, 0n);
    assert.equal(ball.miniBalls.Remove(-1), true);
    assert.ok(park.GetBall(descriptor.id)); // Removing a list item does not own collider cleanup.
});

test("donor mini capsule retains local endpoints and narrows radius", () =>
{
    // Source: destiny/python/destiny/test/ballpark/evolve/test_minis.py:7-16.
    const park = new Park(), ball = parent(park, 99, false, 1e10, 1e10, 1e10);
    assert.equal(ball.PyAddMiniCapsule(-1, -2, -3, 1, 2, 3, 10), undefined);
    const c = ball.miniCapsules[0];
    assert.deepEqual([c.ax, c.ay, c.az, c.bx, c.by, c.bz], [-1, -2, -3, 1, 2, 3]);
    assert.equal(c.mParentBallID, ball.id);
    const actual = park.mCapsules.get(c.id);
    assert.deepEqual(Array.from(actual.mHemisphereA), [1e10 - 1, 1e10 - 2, 1e10 - 3]);
});

for (const [name, axes] of [["axis aligned", [100, 0, 0, 0, 100, 0, 0, 0, 100]],
    ["rotated axes", [1, 1, 1, -1, 0, 1, 1, -2, 1]]])
    test(`donor mini box retains local ${name}`, () =>
    {
        // Source: destiny/python/destiny/test/ballpark/evolve/test_minis.py:20-77.
        const park = new Park(), ball = parent(park, 99, false, 100, 200, 300);
        assert.equal(ball.PyAddMiniBox(0, 0, 0, ...axes), undefined);
        const box = ball.miniBoxes[0];
        assert.deepEqual([box.c0, box.c1, box.c2], [0, 0, 0]);
        assert.deepEqual([box.x0, box.x1, box.x2, box.y0, box.y1, box.y2, box.z0, box.z1, box.z2], axes);
        assert.deepEqual(Array.from(park.mOrientedBoxes.get(box.id).m_boxShape.m_corners[0]), [100, 200, 300]);
    });

test("donor mini ball retains local coordinates and creates a separate fixed sphere", () =>
{
    // Source: destiny/python/destiny/test/ballpark/evolve/test_minis.py:81-88.
    const park = new Park(), ball = parent(park, 99, false, 10, 20, 30);
    assert.equal(ball.PyAddMiniBall(1, 2, 3, 10), undefined);
    const mini = ball.miniBalls[0], actual = park.GetBall(mini.id);
    assert.deepEqual([mini.x, mini.y, mini.z], [1, 2, 3]);
    assert.deepEqual(Array.from(actual.mNewPos), [11, 22, 33]);
    assert.equal(actual.mOwnerId, ball.id);
});

test("Python capsule radius guard precedes append while the C++ entry remains unchecked", () =>
{
    // Source: destiny/python/destiny/test/test_ball.py:25-30; destiny/src/Ball.cpp:2143-2166.
    const ball = new Ball(); ball.isFree = true;
    for (const radius of [-1, 0, -0, 1e-50])
        assert.throws(() => ball.PyAddMiniCapsule(1, 0, 0, 2, 0, 0, radius), /Radius must be positive/);
    assert.equal(ball.miniCapsules.length, 0);
    ball.AddMiniCapsule(1, 0, 0, 2, 0, 0, -1);
    assert.equal(ball.miniCapsules[0].radius, -1);
    ball.PyAddMiniCapsule(1, 0, 0, 2, 0, 0, NaN);
    assert.ok(Number.isNaN(ball.miniCapsules[1].radius));
});

test("fixed attachment ignores parent rotation, then retains world copies across parent/descriptor edits", () =>
{
    const park = new Park(), ball = parent(park, 99, false, 10, 20, 30);
    park.SetBallRotation(ball.id, 0, Math.SQRT1_2, 0, Math.SQRT1_2);
    attachAll(ball);
    const [sphereId, capsuleId, boxId] = ids(ball);
    const sphere = park.GetBall(sphereId), capsule = park.mCapsules.get(capsuleId), box = park.mOrientedBoxes.get(boxId);
    assert.deepEqual(Array.from(sphere.mNewPos), [11, 22, 33]);
    assert.deepEqual(Array.from(capsule.mHemisphereA), [9, 18, 27]);
    assert.deepEqual(Array.from(box.m_boxShape.m_corners[0]), [10, 20, 30]);
    assert.deepEqual(Array.from(box.m_boxShape.m_localX), [6, 0, 0]);
    park.SetBallPosition(ball.id, 100, 200, 300);
    ball.miniBalls[0].x = 999;
    ball.miniCapsules[0].ax = 999;
    ball.miniBoxes[0].c0 = 999;
    assert.deepEqual(Array.from(sphere.mNewPos), [11, 22, 33]);
    assert.deepEqual(Array.from(capsule.mHemisphereA), [9, 18, 27]);
    assert.deepEqual(Array.from(box.m_boxShape.m_corners[0]), [10, 20, 30]);
});

test("MiniBox copies caller vectors before reentrant spatial callbacks", () =>
{
    const park = new Park(), ball = parent(park);
    const corner = vec3d.fromValues(1, 2, 3), x = vec3d.fromValues(4, 0, 0);
    const y = vec3d.fromValues(0, 5, 0), z = vec3d.fromValues(0, 0, 6);
    const insert = park.InsertStaticCollidableInBoxes.bind(park);
    let nested = false;
    park.InsertStaticCollidableInBoxes = shape =>
    {
        if (!nested)
        {
            nested = true;
            assert.equal(ball.miniBoxes[0].id, 0n); // Descriptor ID commits after insertion returns.
            ball.PyAddMiniBox(11, 12, 13, 2, 0, 0, 0, 3, 0, 0, 0, 4);
        }
        insert(shape);
    };
    ball.AddMiniBox(corner, x, y, z);
    corner.fill(100); x.fill(100); y.fill(100); z.fill(100);
    assert.deepEqual(Array.from(ball.miniBoxes[0].mCorner), [1, 2, 3]);
    assert.deepEqual(Array.from(ball.miniBoxes[1].mCorner), [11, 12, 13]);
    const count = vec3d._pool.length;
    park.InsertStaticCollidableInBoxes = () => { throw Error("insert"); };
    assert.throws(() => ball.PyAddMiniBox(1, 2, 3, 1, 0, 0, 0, 1, 0, 0, 0, 1), /insert/);
    assert.equal(vec3d._pool.length, count);
    assert.equal(ball.miniBoxes[2].id, 0n); // Appended descriptor survives failed attachment.
});

test("nested Python MiniBox calls keep distinct borrowed vectors and return them after a nested throw", () =>
{
    const park = new Park(), ball = parent(park);
    const insert = park.InsertStaticCollidableInBoxes.bind(park);
    let nested = false, fail = false;
    park.InsertStaticCollidableInBoxes = shape =>
    {
        if (!nested)
        {
            nested = true;
            ball.PyAddMiniBox(11, 12, 13, 2, 0, 0, 0, 3, 0, 0, 0, 4);
        }
        else if (fail) throw Error("nested insert");
        insert(shape);
    };
    ball.PyAddMiniBox(1, 2, 3, 4, 0, 0, 0, 5, 0, 0, 0, 6);
    for (const [index, expected] of [[0, [1, 2, 3]], [1, [11, 12, 13]]])
    {
        const mini = ball.miniBoxes[index];
        assert.deepEqual(Array.from(mini.mCorner), expected);
        assert.deepEqual(Array.from(park.mOrientedBoxes.get(mini.id).m_boxShape.m_corners[0]), expected);
    }
    const count = vec3d._pool.length;
    assert.ok(count >= 8);
    nested = false; fail = true;
    assert.throws(() => ball.PyAddMiniBox(1, 2, 3, 4, 0, 0, 0, 5, 0, 0, 0, 6), /nested insert/);
    assert.equal(vec3d._pool.length, count);
});

test("dedicated MiniBall creation selects class and sets owner/mode before insertion", () =>
{
    for (const master of [false, true])
    {
        const events = [], park = new Park(null, { SendEvent(ball, event, method, flags, format, oldMode, mode)
        { events.push([event, ball.mMode, mode]); return true; } });
        park.isMaster = master;
        const insert = park.InsertBallInBoxes.bind(park);
        park.InsertBallInBoxes = ball =>
        {
            assert.equal(ball.constructor, master ? Ball : ClientBall);
            assert.equal(ball.mOwnerId, 9007199254740993n);
            assert.equal(ball.mMode, Ball.DSTBALLMODE.DSTBALL_MINIBALL);
            assert.equal(ball.mTimeFactor, 0);
            insert(ball);
        };
        const ball = park.AddMiniball(9007199254740993n, -1, -2, 3, 4, 5);
        assert.equal(ball.id, -1073741825n);
        assert.deepEqual([ball.mMass, ball.mRadius, ball.mAgility, ball.mMaxVel, ball.mSpeedFraction], [0, 0, 0, 0, 0]);
        assert.deepEqual([ball.isFree, ball.isGlobal, ball.isMassive, ball.isInteractive, ball.isSpaceJunk], [false, false, true, false, false]);
        assert.deepEqual(Array.from(ball.mOldPos), [3, 4, 5]);
        assert.deepEqual(Array.from(ball.mNewRot), [0, 0, 0, 1]);
        assert.deepEqual(Array.from(ball.mNewVel), [0, 0, 0]);
        assert.equal(events[0][0], "Destiny::Ball::DoModeChange");
        assert.equal(events[0][1], Ball.DSTBALLMODE.DSTBALL_STOP);
        assert.equal(events[0][2], Ball.DSTBALLMODE.DSTBALL_MINIBALL);
    }
});

test("generated MiniBall ID collision allocates a new object without ordinary AddBall cleanup", () =>
{
    const park = new Park(), prior = parent(park, -1073741825n), warnings = [];
    const error = console.error;
    console.error = (...args) => warnings.push(args);
    try
    {
        const ball = park.AddMiniball(99n, 1, 2, 1, 2, 3);
        assert.notEqual(ball, prior); assert.equal(ball.id, prior.id);
        assert.equal(park.GetBall(ball.id), ball);
        assert.equal(prior.mPark, park); // No invented cleanup of the displaced object.
        assert.equal(warnings.length, 1);
    }
    finally { console.error = error; }
});

test("free descriptors materialize in native family order and receive fresh IDs after toggling", () =>
{
    const park = new Park(), ball = parent(park, 99, true);
    attachAll(ball);
    assert.deepEqual(ids(ball), [0n, 0n, 0n]);
    assert.equal(park._balls.size, 1);
    park.SetBallFree(ball.id, false);
    const original = ids(ball);
    assert.deepEqual(original, [-1073741825n, -1073741826n, -1073741827n]);
    const lists = [ball.miniBalls, ball.miniCapsules, ball.miniBoxes];
    park.SetBallFree(ball.id, true);
    assert.deepEqual(ids(ball), original);
    assert.equal(park.GetBall(original[0]), null);
    assert.equal(park.mCapsules.has(original[1]), false);
    assert.equal(park.mOrientedBoxes.has(original[2]), false);
    park.SetBallFree(ball.id, false);
    assert.deepEqual(ids(ball), [-1073741828n, -1073741829n, -1073741830n]);
    assert.deepEqual([ball.miniBalls, ball.miniCapsules, ball.miniBoxes], lists);
});

test("free transition samples the park clock after child cleanup callbacks", () =>
{
    let park;
    park = new Park(null, { SendEvent(value, event)
    {
        if (event === "Destiny::Ball::DoFinalCleanup") { park.time = 50000000n; park.tickInterval = 500; }
        return true;
    } });
    const ball = parent(park);
    ball.AddMiniBall(0, 0, 0, 2);
    park.SetBallFree(ball.id, true);
    assert.equal(ball.mNewTime, 45000000n);
});

test("MiniBall removal sends the native stop-mode event before final cleanup", () =>
{
    // Source: destiny/src/Ballpark.cpp:4642,5475-5495; destiny/src/Ball.cpp:905-938.
    const events = [], park = new Park(null, { SendEvent(ball, event, name, flags, format, previous, next)
    { events.push([ball.id, event, previous, next]); return true; } });
    const ball = parent(park);
    ball.AddMiniBall(0, 0, 0, 2);
    const id = ball.miniBalls[0].id;
    events.length = 0;
    park.RemoveBall(id);
    assert.deepEqual(events, [[id, "Destiny::Ball::DoModeChange", Ball.DSTBALLMODE.DSTBALL_MINIBALL,
        Ball.DSTBALLMODE.DSTBALL_STOP], [id, "Destiny::Ball::DoFinalCleanup", undefined, undefined]]);
});

test("repeated bulk attachment leaves previous actual colliders alive", () =>
{
    const park = new Park(), ball = parent(park);
    attachAll(ball);
    const first = ids(ball);
    ball.AddMiniBalls(); ball.AddMiniCapsules(); ball.AddMiniBoxes();
    const second = ids(ball);
    assert.notDeepEqual(first, second);
    assert.ok(park.GetBall(first[0])); assert.ok(park.mCapsules.has(first[1])); assert.ok(park.mOrientedBoxes.has(first[2]));
    ball.RemoveMiniBalls(); ball.RemoveMiniCapsules(); ball.RemoveMiniBoxes();
    assert.deepEqual(ids(ball), second);
    assert.equal(park.GetBall(second[0]), null);
    assert.ok(park.GetBall(first[0]));
});

test("bulk attachment captures initial list length across an insertion callback", () =>
{
    const park = new Park(), ball = parent(park, 99, true);
    ball.AddMiniBall(1, 2, 3, 2);
    const insert = park.InsertBallInBoxes.bind(park);
    park.InsertBallInBoxes = value =>
    {
        if (value.mMode === Ball.DSTBALLMODE.DSTBALL_MINIBALL)
        {
            const descriptor = new MiniBall(); descriptor.radius = 3;
            ball.miniBalls.Insert(-1, descriptor);
        }
        insert(value);
    };
    park.SetBallFree(ball.id, false);
    assert.equal(ball.miniBalls.length, 2);
    assert.equal(ball.miniBalls[1].id, 0n);
});

test("fixed delayed-parent removal clears descriptors immediately and removes children in reverse order", () =>
{
    const park = new Park(), ball = parent(park);
    attachAll(ball); attachAll(ball);
    const expected = [ball.miniBalls[1].id, ball.miniBalls[0].id, ball.miniCapsules[1].id,
        ball.miniCapsules[0].id, ball.miniBoxes[1].id, ball.miniBoxes[0].id], removed = [];
    const originals = new Map();
    for (const name of ["RemoveBall", "RemoveCapsule", "RemoveOrientedBox"])
    {
        const original = Park.prototype[name]; originals.set(name, original);
        Park.prototype[name] = function(id, delay = 0)
        { if (id !== ball.id) { assert.equal(delay, 0); removed.push(id); } return original.call(this, id, delay); };
    }
    try { park.RemoveBall(ball.id, 5); }
    finally { for (const [name, original] of originals) Park.prototype[name] = original; }
    assert.deepEqual(removed, expected);
    assert.deepEqual([ball.miniBalls.length, ball.miniCapsules.length, ball.miniBoxes.length], [0, 0, 0]);
    assert.equal(park.GetBall(ball.id), ball);
    assert.ok(ball.isMoribund);
    assert.equal(park._balls.size, 1);
    assert.equal(park.mCapsules.size, 0); assert.equal(park.mOrientedBoxes.size, 0);
});

test("free-parent removal and ClearAll retain descriptors on externally held handles", () =>
{
    for (const operation of ["RemoveBall", "ClearAll"])
    {
        const park = new Park(), ball = parent(park, 99, operation === "RemoveBall");
        attachAll(ball);
        park[operation](ball.id);
        assert.deepEqual([ball.miniBalls.length, ball.miniCapsules.length, ball.miniBoxes.length], [1, 1, 1]);
        assert.equal(ball.mPark, null);
        assert.equal(park._balls.size, 0);
    }
});

test("parent removal rechecks freedom between mini families after child cleanup callbacks", () =>
{
    let ball;
    const park = new Park(null, { SendEvent(value, event)
    {
        if (event === "Destiny::Ball::DoFinalCleanup" && value !== ball) ball.isFree = true;
        return true;
    } });
    ball = parent(park);
    attachAll(ball);
    const capsuleId = ball.miniCapsules[0].id, boxId = ball.miniBoxes[0].id;
    park.RemoveBall(ball.id);
    assert.deepEqual([ball.miniBalls.length, ball.miniCapsules.length, ball.miniBoxes.length], [0, 1, 1]);
    assert.ok(park.mCapsules.has(capsuleId)); assert.ok(park.mOrientedBoxes.has(boxId));
});

test("mini removal during evolution retains the native undrained oriented-box queue", () =>
{
    const park = new Park(), ball = parent(park);
    attachAll(ball);
    const [sphere, capsule, box] = ids(ball);
    park.inEvolve = true;
    park.RemoveBall(ball.id);
    assert.equal(ball.miniBoxes.length, 0);
    assert.ok(park.GetBall(sphere).isMoribund);
    assert.ok(park.mCapsules.get(capsule).isMoribund);
    assert.ok(park.mOrientedBoxes.get(box).isMoribund);
    park.inEvolve = false;
    park.currentTime += 10;
    park.BringOutTheDeads();
    assert.equal(park.GetBall(sphere), null);
    assert.equal(park.mCapsules.has(capsule), false);
    assert.ok(park.mOrientedBoxes.has(box));
});

test("detached-mini callbacks share one global across parks and subclasses", () =>
{
    // Source: destiny/python/destiny/test/ballpark/test_callbacks.py:193-210.
    const first = new Park(), second = new Park(), received = [];
    first.SetBallNotInParkCallback(function (ball) { assert.equal(this, undefined); received.push(ball); });
    const a = new Ball(), b = new ClientBall();
    a.AddMiniBall(1, 1, 1, 1); b.AddMiniBall(1, 1, 1, 1);
    assert.deepEqual(received, [a, b]);
    assert.equal(a.miniBalls.length, 1);
    parent(first).AddMiniBall(1, 1, 1, 1);
    assert.equal(received.length, 2);
    second.ClearAll(); // No destructor-equivalent reset is invented here.
    a.AddMiniCapsule(1, 0, 0, 2, 0, 0, 1);
    assert.equal(received.length, 3);
    second.SetBallNotInParkCallback(null);
    a.AddMiniBall(1, 1, 1, 1);
    assert.equal(received.length, 3);
});

test("free detached parents skip callbacks, while throwing callbacks retain appended descriptors", () =>
{
    const park = new Park(), ball = new Ball();
    park.SetBallNotInParkCallback(() => { throw Error("detached"); });
    ball.isFree = true;
    attachAll(ball);
    ball.isFree = false;
    assert.throws(() => ball.AddMiniBall(1, 2, 3, 4), /detached/);
    assert.equal(ball.miniBalls.length, 2);
    for (const value of [false, 0, {}])
    {
        park.SetBallNotInParkCallback(value);
        assert.throws(() => ball.RegisterBallNotInPark(), TypeError);
    }
});

test("native SetMode emits exit-warp before mode-change and stores only after callbacks", () =>
{
    const events = [], park = new Park(null, {
        PostEvent(owner, event, name, format, id, flag) { events.push([event, id, flag]); return false; },
        SendEvent(ball, event, name, flags, format, previous, next)
        { assert.equal(ball.mMode, previous); events.push([event, previous, next]); return true; },
        PyError() { events.push("error"); }
    });
    const ball = parent(park), mode = Ball.DSTBALLMODE;
    ball.mMode = mode.DSTBALL_WARP;
    ball.SetMode(mode.DSTBALL_STOP);
    assert.deepEqual(events, [["Destiny::OnExitWarp", ball.id, 0], "error",
        ["Destiny::Ball::DoModeChange", mode.DSTBALL_WARP, mode.DSTBALL_STOP]]);
    ball.SetMode(mode.DSTBALL_STOP);
    assert.equal(events.length, 3);
});

for (const freeDescriptors of [false, true]) test(`donor legacy MiniBall contact, moving descriptors=${freeDescriptors}`, () =>
{
    // Source: destiny/python/destiny/test/ballpark/evolve/test_minis.py:90-131.
    const park = new Park(), fixed = park.AddBall(1, 0, 0, 0, false, false, false, false, false,
        100, 0, 0, 0, 0, 0, 0, 0);
    fixed.AddMiniBall(100, 0, 0, 10);
    const ball = moving(park, 2, 200, 0, -30, 10);
    if (freeDescriptors)
    {
        ball.AddMiniBall(4, 0, 4, 3); ball.AddMiniBall(0, 0, 5, 2); ball.AddMiniBall(-4, 0, 4, 3);
    }
    park.GotoPoint(ball.id, 200, 0, 0);
    for (let tick = 0; tick < 20; ++tick)
    {
        park.Evolve();
        near(ball.x, 200); near(ball.y, 0);
        assert.ok((freeDescriptors ? 1.01 : 1.1) * ball.z < (freeDescriptors ? -17 : -20));
    }
});

test("donor iterative fixed parent remains a main-sphere target after MiniBall attachment", () =>
{
    // Source: destiny/python/destiny/test/ballpark/evolve/test_iterative_collision.py:307-329.
    const config = settings.Get(); config.useIterativeCollision = true; settings.Apply(config);
    const park = new Park(), a = moving(park, 1, 0, 0, -4), b = moving(park, 2, 0, 0, 4);
    park.SetBallFree(b.id, false);
    b.AddMiniBall(0, 0, 10, 2);
    park.GotoDirection(a.id, 0, 0, 1);
    for (let tick = 0; tick < 50; ++tick)
    {
        park.Evolve();
        near(a.x, 0); near(a.y, 0); assert.ok(a.z < 0.5);
    }
    assert.deepEqual(Array.from(b.mNewPos), [0, 0, 4]);
});
