import assert from "node:assert/strict";
import test from "node:test";
import { CjsBallparkController as Park, CjsDestinyBall as Ball, settings } from "@carbonenginejs/server";
import { CjsDestinyCapsule as Capsule, CjsDestinyOrientedBox as Box } from "@carbonenginejs/server/destiny/geometry";

// Source: destiny/src/Capsule.cpp:11-581; destiny/src/OrientedBox.cpp:6-322
// Source-derived direct shape fixtures; not full donor Python collision trajectories.
const close = (a, b, epsilon = 1e-12) => assert.ok(Math.abs(a - b) <= epsilon * Math.max(1, Math.abs(b)), `${a} != ${b}`);
const vector = (a, b) => a.forEach((v, q) => close(v, b[q]));
const capsule = (a = [0, 0, 0], b = [0, 0, 2], radius = 1) =>
{
    const shape = new Capsule();
    shape.Initialize(7n, 3n, ...a, ...b, radius);
    return shape;
};
const box = () =>
{
    const shape = new Box();
    shape.Initialize(8n, 3n, 0, 0, 0, 2, 0, 0, 0, 2, 0, 0, 0, 2);
    return shape;
};
const out = () => ({ normal: [11, 12, 13], timeOfImpact: 99 });
const movingBall = () =>
{
    const ball = new Ball();
    ball.mMass = 2; ball.mAgility = 1; ball.mRadius = 1; ball.isFree = true;
    ball.mTimeFactor = Math.exp(-1.5);
    ball.mNewPos.fill(0);
    return ball;
};
const park = () =>
{
    const value = new Park(); value.mFriction = 3;
    return value;
};

for (const [name, p0, p1, time, normal] of [
    ["cylinder", [3, 0, 1], [0, 0, 1], 1 / 3, [1, 0, 0]],
    ["cap", [0, 0, -3], [0, 0, 0], 1 / 3, [0, 0, -1]],
    ["oblique cap", [3, 0, -1], [0, 0, -1], (3 - Math.sqrt(3)) / 3, [Math.sqrt(3) / 2, 0, -0.5]],
    ["axis overlap", [0, 0, 1], [0, 0, 1], 0, [0, 0, 0]],
    ["tangent overlap", [2, 0, 1], [2, 0, 1], 0, [1, 0, 0]]
]) test(`Capsule query: ${name}`, () =>
{
    const hit = out();
    assert.equal(capsule().CheckCollision(p0, p1, 1, hit), true);
    close(hit.timeOfImpact, time); vector(hit.normal, normal);
});

test("Capsule misses preserve outputs; degenerate axis chooses the native fallback normal", () =>
{
    const hit = out();
    assert.equal(capsule().CheckCollision([3, 0, -3], [3, 0, 5], 1, hit), false);
    assert.deepEqual(hit, out());
    assert.equal(capsule([0, 0, 0], [0, 0, 0]).CheckCollision([0, 0, 0], [0, 0, 0], 1, hit), true);
    assert.deepEqual(hit, { normal: [0, 0, 1], timeOfImpact: 0 });
});

test("Capsule cylinder normal can alias the cached axis without changing RHS evaluation", () =>
{
    const shape = capsule([0, 0, 0], [2, 2, 0], 0.25);
    const hit = { normal: shape.mAB, timeOfImpact: -1 };
    assert.equal(shape.CheckCollision([1, 0, 0], [1, 1, 0], 0.25, hit), true);
    close(hit.timeOfImpact, 1 - Math.SQRT1_2);
    vector(hit.normal, [Math.SQRT1_2, -Math.SQRT1_2, 0]);
});

test("Capsule Blue endpoint writes retain cached axis and center; radius rounds before bounding sum", () =>
{
    const shape = capsule([1e12 + 0.1, 0, 0], [1e12 + 0.1, 0, 16777217], 0.3);
    const old = [...shape.mNewPos];
    assert.equal(shape.mRadius, Math.fround(0.3));
    assert.equal(shape.GetBoundingRadius(), Math.fround(8388608 + Math.fround(0.3)));
    shape.bz = 5; shape.ax = 3;
    assert.deepEqual(shape.mAB, [0, 0, 16777217]);
    assert.deepEqual(shape.mNewPos, old);
    assert.notDeepEqual(shape.GetCenter([0, 0, 0]), old);
    shape.radius = 0.1;
    assert.equal(shape.radius, Math.fround(0.1));
    shape.id = 9007199254740993n;
    assert.equal(shape.mId, 9007199254740993n);
});

test("OrientedBox queries use AABB rejection, sweep fraction and normalized overlap normal", () =>
{
    const shape = box(), hit = out();
    assert.equal(shape.GetBoundingRadius(), Math.fround(Math.sqrt(3)));
    assert.deepEqual(shape.GetCenter([0, 0, 0]), [1, 1, 1]);
    assert.equal(shape.CheckCollision([-3, 1, 1], [1, 1, 1], 1, hit), true);
    close(hit.timeOfImpact, 0.5); vector(hit.normal, [-1, 0, 0]);
    assert.equal(shape.CheckCollision([0.5, 1, 1], [0.5, 1, 1], 1, hit), true);
    close(hit.timeOfImpact, 0); vector(hit.normal, [-1, 0, 0]);
    const miss = out();
    assert.equal(shape.CheckCollision([20, 20, 20], [21, 21, 21], 1, miss), false);
    assert.deepEqual(miss, out());
});

test("OrientedBox rotated edges retain world-space center, AABB and collision normal", () =>
{
    const shape = new Box(), hit = out();
    shape.Initialize(8n, 3n, 10, 20, 30, 0, 2, 0, -2, 0, 0, 0, 0, 2);
    assert.deepEqual(shape.GetCenter([0, 0, 0]), [9, 21, 31]);
    assert.deepEqual(shape.mAABB.mLowCorner, [8, 20, 30]);
    assert.deepEqual(shape.mAABB.mHighCorner, [10, 22, 32]);
    assert.equal(shape.CheckCollision([13, 21, 31], [9, 21, 31], 1, hit), true);
    close(hit.timeOfImpact, 0.5); vector(hit.normal, [1, 0, 0]);
});

for (const [name, make, force] of [["Capsule", capsule, 2.125], ["OrientedBox", box, 6.375]])
test(`${name} overlap response, equal-time strength, later-time overwrite and duplicate IDs`, () =>
{
    const shape = make(), ball = movingBall(); shape.mPark = park();
    const position = [4, 5, 6], velocity = [0, 0, 0], normal = [2, 0, 0];
    shape.ReactToCollision(ball, position, velocity, 2, normal, 0);
    vector(ball.mLastC, [force, 0, 0]); vector(normal, [1, 0, 0]);
    assert.deepEqual(position, [4, 5, 6]);
    ball.mLastC = [100, 0, 0];
    shape.ReactToCollision(ball, position, velocity, 2, [2, 0, 0], 0);
    assert.deepEqual(Array.from(ball.mLastC), [100, 0, 0]);
    ball.mLastCollision = 0.75;
    shape.ReactToCollision(ball, position, velocity, 2, [2, 0, 0], 0);
    vector(ball.mLastC, [force, 0, 0]);
    assert.equal(ball.mLastCollision, 0);
    assert.deepEqual(ball.mCollisions, [shape.mId, shape.mId, shape.mId]);
});

test("Only Capsule suppresses positive-time response to outward acceleration", () =>
{
    for (const [shape, count] of [[capsule(), 0], [box(), 1]])
    {
        shape.mPark = park(); const ball = movingBall(); ball.mLastG = [1, 0, 0];
        const normal = [2, 0, 0], p = [1, 2, 3], v = [-4, 0, 0];
        shape.ReactToCollision(ball, p, v, 2, normal, 0.5);
        vector(normal, [1, 0, 0]); assert.equal(ball.mCollisions.length, count);
        if (!count) { assert.deepEqual(p, [1, 2, 3]); assert.deepEqual(v, [-4, 0, 0]); }
    }
});

test("Both shape responses reproduce reflected exponential velocity and speculative position", () =>
{
    for (const shape of [capsule(), box()])
    {
        shape.mPark = park(); const ball = movingBall(); ball.mNewVel = [4, 2, 0];
        const p = [0, 0, 0], v = [...ball.mNewVel], half = Math.exp(-0.75), full = Math.exp(-1.5);
        shape.ReactToCollision(ball, p, v, 2, [1, 0, 0], 0.5);
        vector(v, [-4 * full, 2 * full, 0]);
        vector(p, [4 / 1.5 * (1 - half) ** 2, 2 / 1.5 * (1 - full), 0]);
        vector(ball.mLastC, [-0.85 * 2 * 4 * full * 3 / (2 * (1 - full)), 0, 0]);
        assert.deepEqual(Array.from(ball.mNewVel), [4, 2, 0]); assert.deepEqual(Array.from(ball.mNewPos), [0, 0, 0]);
        const unchanged = [...p];
        shape.ReactToCollision(ball, p, v, 2, [2, 0, 0], -1);
        assert.deepEqual(p, unchanged); assert.equal(ball.mCollisions.length, 1);
    }
});

test("Legacy Capsule uses endpoint velocity for roots and endpoint state on parallel cap contact", () =>
{
    const shape = capsule(), engine = park(), ball = movingBall(); shape.mPark = engine;
    ball.mNewPos = [3, 0, 1]; ball.mNewVel = [-4, 0, 0];
    let contact;
    shape.ReactToCollision = (owner, p, v, mass, normal, time) => { contact = { p: [...p], v: [...v], normal: [...normal], time }; };
    // Velocity -4 differs deliberately from displacement -2: native cylinder root is 1/4.
    shape.HandleCollisionNonIteratively(ball, [3, 0, 1], [1, 0, 1], 2, [-4, 0, 0]);
    close(contact.time, 0.25); assert.deepEqual(contact.p, [3, 0, 1]);
    assert.deepEqual(contact.v, [-4, 0, 0]); assert.deepEqual(contact.normal, [3, 0, 0]);
    shape.HandleCollisionNonIteratively(ball, [0, 0, -3], [0, 0, 0], 2, [0, 0, 2]);
    close(contact.time, 1 / 3); assert.deepEqual(contact.p, [0, 0, 0]);
    assert.deepEqual(contact.v, [0, 0, 2]); assert.deepEqual(contact.normal, [0, 0, -3]);
});

test("Legacy Capsule zero-axis divisions retain native nonfinite roots and no impact", () =>
{
    const shape = capsule([0, 0, 0], [0, 0, 0]), ball = movingBall(); shape.mPark = park();
    shape.HandleCollisionNonIteratively(ball, [0, 0, 0], [1, 0, 0], 2, [1, 0, 0]);
    assert.equal(ball.mCollisions.length, 0);
    assert.deepEqual(Array.from(ball.mLastC), [0, 0, 0]);
});

test("Fractional Integrate agrees with analytic drag and composes across substeps", () =>
{
    // Source: destiny/src/Ballpark.cpp:751-777. Independent exponential drag solution.
    const engine = park(), p = [1, 2, 3], v = [4, 5, 6], a = [7, 8, 9];
    const initial = [...p], velocity = [...v], duration = 0.25, decay = Math.exp(-1.5 * duration);
    engine.Integrate(p, v, a, 2, 3, 99, duration);
    for (let q = 0; q < 3; ++q)
    {
        const terminal = a[q] * 2 / 3;
        close(v[q], terminal + (velocity[q] - terminal) * decay);
        close(p[q], initial[q] + terminal * duration + (velocity[q] - terminal) * (1 - decay) / 1.5);
    }
    engine.Integrate(p, v, a, 2, 3, 99, 0.75);
    const wholeP = [...initial], wholeV = [...velocity];
    engine.Integrate(wholeP, wholeV, a, 2, 3, Math.exp(-1.5), 1);
    vector(p, wholeP); vector(v, wholeV);
    engine.Integrate(p, v, a, 0, 0, NaN, 0);
    vector(p, wholeP); vector(v, wholeV);
});

test("Integrate retains the native full-tick cache, small-friction branch and zero-friction singularity", () =>
{
    const engine = park(), p = [0, 0, 0], v = [6, 0, 0];
    engine.Integrate(p, v, [0, 0, 0], 2, 3, 0.5, 1);
    vector(p, [2, 0, 0]); vector(v, [3, 0, 0]);
    const tinyP = [2, 0, 0], tinyV = [3, 0, 0];
    engine.Integrate(tinyP, tinyV, [0, 0, 0], 1, 1e-12, Math.exp(-1e-12), 1);
    close(tinyP[0], 5); close(tinyV[0], 3 * Math.exp(-1e-12));
    engine.Integrate(p, v, [0, 0, 0], 2, 0, 1, 1);
    assert.ok(p.every(Number.isNaN)); assert.ok(v.every(Number.isNaN));
});

test("Capsule and OrientedBox CollideWithBall retain different speculative starting states", () =>
{
    const config = settings.GetDefaultConfiguration(); config.useIterativeCollision = true;
    settings.ApplyConfiguration(config);
    try
    {
        for (const shape of [capsule(), box()])
        {
            shape.mPark = park(); const ball = movingBall();
            ball.mNewPos = [-3, 1, 1]; ball.mNewVel = [8, 0, 0];
            const initial = [...ball.mNewPos], predicted = [...initial], v = [...ball.mNewVel];
            shape.mPark.Integrate(predicted, v, ball.mLastG, 2, 3, ball.mTimeFactor, 1);
            let called = false;
            shape.ReactToCollision = (owner, p, velocity) =>
            {
                called = true; assert.equal(owner, ball);
                vector(p, shape.mId === 7n ? predicted : initial);
                vector(velocity, shape.mId === 7n ? v : ball.mNewVel);
            };
            shape.CollideWithBall(ball); assert.equal(called, true);
            assert.deepEqual(ball.mNewPos, initial);
            ball.isFree = false; called = false;
            shape.CollideWithBall(ball); assert.equal(called, false);
        }
    }
    finally { settings.ApplyConfiguration(settings.GetDefaultConfiguration()); }
});

test("Real shape memberships support cleanup and master bubble restoration", () =>
{
    for (const shape of [capsule(), box()])
    {
        const engine = park(); engine.isMaster = true; shape.mPark = engine;
        const base = engine.mPartition.GetBox(shape.GetBoundingRadius(), shape.mNewPos);
        shape.InsertInBoxes(base, engine.mPartition.GetTopmost(base), 17);
        assert.ok(shape.mBoxes.length > 0);
        assert.equal(engine.mPartition.GetTopmost(shape.mMyBox).mBubble, 17);
        for (const cell of shape.mBoxes) assert.ok(cell.mStaticCollidables.includes(shape));
        const previous = [...shape.mBoxes];
        shape.InsertInBoxes(shape.mMyBox, null, 99);
        assert.deepEqual(shape.mBoxes, previous);
        assert.equal(engine.mPartition.GetTopmost(shape.mMyBox).mBubble, 17);
        shape.DeleteFromBoxes(); assert.equal(shape.mBoxes.length, 0); assert.equal(shape.mMyBox, null);
    }
});

test("Capsule sampling retains nonpositive-radius memberships and rejects stalled float subtraction", () =>
{
    const shape = capsule(), engine = park(); shape.mPark = engine;
    shape.InsertInBoxes(engine.mPartition.GetBox(2, shape.mNewPos), null, 0);
    const old = [...shape.mBoxes]; shape.radius = 0;
    shape.InsertInBoxes(engine.mPartition.GetBox(2, [1000, 1000, 1000]), null, 0);
    assert.deepEqual(shape.mBoxes, old);
    const thin = capsule([0, 0, 0], [16777216, 0, 0], 0.25); thin.mPark = park();
    assert.throws(() => thin.InsertInBoxes(thin.mPark.mPartition.GetBox(thin.GetBoundingRadius(), thin.mNewPos), null, 0), /cannot advance/);
});

test("Capsule native sampling does not add a final endpoint neighborhood", () =>
{
    const shape = capsule([478.5, 240, 240], [480, 240, 240]), engine = park(); shape.mPark = engine;
    shape.InsertInBoxes(engine.mPartition.GetBox(shape.GetBoundingRadius(), shape.mNewPos), null, 0);
    assert.equal(shape.mBoxes.length, 1);
    assert.equal(shape.mBoxes[0].lo[0], 0);
    assert.equal(shape.mBoxes[0].hi[0], 480);
    // The far cap crosses x=480, but the source loop samples only A for length<diameter.
    assert.equal(shape.CheckCollision([481, 240, 240], [481, 240, 240], 0.1, out()), true);
    shape.DeleteFromBoxes();
});

test("OrientedBox top-level oversized bounds insert all 27 cells", () =>
{
    const shape = new Box(), engine = park(), width = engine.mPartition.mLevelWidth[0];
    shape.Initialize(8n, 3n, -width, -width, -width, width * 2, 0, 0, 0, width * 2, 0, 0, 0, width * 2);
    shape.mPark = engine;
    shape.InsertInBoxes(engine.mPartition.GetBox(shape.GetBoundingRadius(), shape.mNewPos), null, 0);
    assert.equal(shape.mMyBox.mLevel, 0); assert.equal(shape.mBoxes.length, 27);
    assert.equal(new Set(shape.mBoxes.map(cell => `${cell.mKey.ix},${cell.mKey.iy},${cell.mKey.iz}`)).size, 27);
    shape.DeleteFromBoxes();
});
