import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { CjsDestinyBall as Ball, CjsDestinyClientBall as ClientBall, CjsBallparkController as Park, settings } from "@carbonenginejs/server";
import { vec3 } from "@carbonenginejs/runtime/math/vec3";
import { quat } from "@carbonenginejs/runtime/math/quat";
import { vec3d } from "../dist/destiny/math/vec3d.js";

// Source: destiny/src/Ball.cpp:161-222,1118-1191; Ballpark.cpp:5156-5217.
afterEach(() => settings.Reset());
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} != ${expected}`);
const output = () => ({ relVel: vec3d.fromValues(91, 92, 93), radVel: 94, shortDist: 95, transVel: 96, angVel: 97 });
function dynamic()
{
    const config = settings.Get(); config.useDynamicalOrientation = true; settings.Apply(config);
}
function pair(Type = Ball)
{
    const source = new Type(), target = new Type();
    vec3.set(source.mNewPos, 0, 0, 0);
    vec3.set(target.mNewPos, 10, 0, 0); vec3.set(target.mNewVel, 3, 4, 0);
    source.mRadius = 1; target.mRadius = 2;
    return { source, target };
}

for (let level = 0; level < 4; ++level)
{
    test(`authoritative relative motion propagates flag level ${level}`, () =>
    {
        const { source, target } = pair(), out = output();
        const flags = [false, false, false, false]; flags[level] = true;
        assert.equal(source.CalculateRelativeVelocities(target, ...flags, out), out);
        assert.deepEqual(Array.from(out.relVel), [3, 4, 0]);
        assert.equal(out.radVel, level >= 1 ? 3 : 94);
        assert.equal(out.shortDist, level >= 1 ? 7 : 95);
        assert.equal(out.transVel, level >= 2 ? 4 : 96);
        assert.equal(out.angVel, level >= 3 ? 0.4 : 97);
    });
}

test("relative null, disabled and coincident cases preserve native partial outputs", () =>
{
    for (const Type of [Ball, ClientBall])
    {
        const { source, target } = pair(Type), out = output(), before = output();
        source.CalculateRelativeVelocities(null, true, true, true, true, out);
        source.CalculateRelativeVelocities(target, false, false, false, false, out);
        assert.deepEqual(out, before);
    }
    const { source, target } = pair(), out = output();
    vec3.copy(target.mNewPos, source.mNewPos);
    source.CalculateRelativeVelocities(target, false, false, false, true, out);
    assert.deepEqual(out, { ...output(), relVel: vec3d.fromValues(3, 4, 0) });
    target.mNewPos[0] = 1;
    source.CalculateRelativeVelocities(target, false, true, false, false, out);
    assert.equal(out.shortDist, 0);
});

test("dynamic angular compensation preserves raw transversal speed and uses source spin", () =>
{
    dynamic();
    const { source, target } = pair(), out = output();
    vec3.set(source.mNewAngVel, 0, 0, 0.5); vec3.set(target.mNewAngVel, 100, 100, 100);
    source.CalculateRelativeVelocities(target, false, false, false, true, out);
    assert.equal(out.transVel, 4); assert.equal(out.angVel, 0.1);
    vec3.set(source.mNewAngVel, 0, 0, -0.5);
    source.CalculateRelativeVelocities(target, false, false, false, true, out);
    assert.equal(out.angVel, 0.9);
});

test("ClientBall samples the four native clock inputs in order with float32 subtraction", () =>
{
    const { source, target } = pair(ClientBall), out = output(), calls = [];
    source.mPark = { tickInterval: 1000 }; source.mOldTime = 10n;
    source.mPosUpdateTime = 20n; source.mRotUpdateTime = 30n; target.mPosUpdateTime = 40n;
    target.mOldTime = 99999999n; target.mRotUpdateTime = 99999999n;
    source.GetValueDotAt = (time, value) => { calls.push(["source", time]); vec3.set(value, 16777216, 0, 0); };
    target.GetValueDotAt = (time, value) => { calls.push(["target", time]); vec3.set(value, -1, 0, 0); };
    source.CalculateRelativeVelocities(target, true, false, false, false, out);
    assert.deepEqual(calls, [["source", 20000040n], ["target", 20000040n]]);
    assert.equal(out.relVel[0], -16777216); assert.equal(out.radVel, 94);
    calls.length = 0; source.mOldTime = 50; // Engine Number ticks share the same epoch.
    source.CalculateRelativeVelocities(target, true, false, false, false, out);
    assert.equal(calls[0][1], 20000050n);
    source.mOldTime = (1n << 63n) - 1n; calls.length = 0;
    assert.throws(() => source.CalculateRelativeVelocities(target, true, false, false, false, out), RangeError);
    assert.equal(calls.length, 0);
    source.mOldTime = 0n; source.mPark.tickInterval = 107375;
    source.CalculateRelativeVelocities(target, true, false, false, false, out);
    assert.equal(calls[0][1], 2147500040n, "documented widening avoids undefined native int32 offset overflow");
});

test("authoritative relative velocity keeps float64 precision", () =>
{
    const { source, target } = pair(), out = output();
    vec3.set(source.mNewVel, 1e10, 0, 0); vec3.set(target.mNewVel, 1e10 + 0.25, 0, 0);
    source.CalculateRelativeVelocities(target, true, false, false, false, out);
    assert.equal(out.relVel[0], 0.25);
});

test("coincident client caches update only relative velocity and never sample rotation", () =>
{
    dynamic();
    const { source, target } = pair(ClientBall), out = output();
    source.mPark = { tickInterval: 1000 };
    source.GetValueDotAt = (time, value) => vec3.set(value, 0, 0, 0);
    target.GetValueDotAt = (time, value) => vec3.set(value, 3, 4, 0);
    source.GetValueAt = () => { throw new Error("unexpected rotation sample"); };
    source.CalculateRelativeVelocities(target, false, false, false, true, out);
    assert.deepEqual(out, { ...output(), relVel: vec3d.fromValues(3, 4, 0) });
});

test("ClientBall uses actual cached curves and absolute cached positions for relative motion", () =>
{
    const { source, target } = pair(ClientBall), out = output();
    source.mPark = target.mPark = new Park();
    source.mPosUpdateTime = target.mPosUpdateTime = 10n;
    vec3.set(source.mLastPos, 1e10, 0, 0); vec3.set(target.mLastPos, 1e10 + 10, 0, 0);
    vec3.set(source.mLastVel, 0, 0, 0); vec3.set(target.mLastVel, 3, 4, 0);
    source.CalculateRelativeVelocities(target, false, false, false, true, out);
    assert.deepEqual(out, { relVel: vec3d.fromValues(3, 4, 0), radVel: 3, shortDist: 7, transVel: 4, angVel: 0.4 });
});

test("ClientBall pooled samples survive nested calls and release storage on sampling failures", () =>
{
    dynamic();
    const { source, target } = pair(ClientBall), nested = pair(ClientBall), out = output(), inner = output();
    source.mPark = nested.source.mPark = { tickInterval: 1000 };
    const live = new Set(), originals = [vec3.alloc, vec3.unalloc, quat.alloc, quat.unalloc];
    let peak = 0;
    for (const [type, alloc, unalloc] of [[vec3, originals[0], originals[1]], [quat, originals[2], originals[3]]])
    {
        type.alloc = () => { const value = alloc(); assert.ok(!live.has(value)); live.add(value); peak = Math.max(peak, live.size); value.fill(NaN); return value; };
        type.unalloc = value => { assert.ok(live.delete(value)); unalloc(value); };
    }
    try
    {
        nested.source.GetValueDotAt = (time, value) => vec3.set(value, 80, 90, 100);
        nested.target.GetValueDotAt = (time, value) => vec3.set(value, 81, 92, 103);
        source.GetValueDotAt = (time, value) =>
        {
            vec3.set(value, 0, 0, 0);
            nested.source.CalculateRelativeVelocities(nested.target, true, false, false, false, inner);
            vec3.set(source.mLastPos, 0, 0, 0);
        };
        target.GetValueDotAt = (time, value) => { vec3.set(value, 3, 4, 0); vec3.set(target.mLastPos, 10, 0, 0); };
        source.GetValueAt = (time, value) =>
        {
            assert.equal(value.length, 4); assert.equal(out.transVel, 4);
            vec3.set(source.mLastAngVel, 0, 0, 0.5);
            vec3.set(target.mLastPos, 1000, 1000, 1000); // Radial locals must survive this sample.
            return quat.identity(value);
        };
        source.CalculateRelativeVelocities(target, false, false, false, true, out);
        assert.equal(out.angVel, 0.1); assert.ok(peak >= 2); assert.equal(live.size, 0);
        source.GetValueAt = () => { throw new Error("rotation failed"); };
        assert.throws(() => source.CalculateRelativeVelocities(target, false, false, false, true, out), /rotation failed/);
        assert.equal(live.size, 0);
        target.GetValueDotAt = () => { throw new Error("velocity failed"); };
        assert.throws(() => source.CalculateRelativeVelocities(target, true, false, false, false, out), /velocity failed/);
        assert.equal(live.size, 0);
    }
    finally { [vec3.alloc, vec3.unalloc, quat.alloc, quat.unalloc] = originals; }
});

function parkPair(distance = 0)
{
    const park = new Park();
    for (const id of [1, 2]) park.AddBall(id, 1e6, 0, 0, false, false, false, false, false, id === 2 ? distance : 0, 0, 0, 0, 0, 0, 1, 1);
    return park;
}

// Source: destiny/python/destiny/test/ballpark/test_getters_and_setters.py:168-279.
for (const [label, distance, target, parameters, expected] of [
    ["coincident", 0, 2, [1, 1, 1, 1, 1], 0],
    ["self", 0, 1, [1, 1, 1, 1, 1], 0],
    ["full", 1, 2, [1, 1, 1, 1, 1], 1],
    ["unit falloff", 2, 2, [1, 1, 1, 1, 1], 0.5],
    ["some falloff", 2, 2, [1, 0.95, 1, 1, 1], 0.46392604883716854],
    ["combined", 2, 2, [0.5, 0.95, 0.6, 0.2, 0.7], 0.17762729659881724],
    ["unchanged early outputs", 0, 2, [42, 1, 3.14, 1, 1], 0]
])
{
    test(`donor accuracy fixture: ${label}`, () =>
    {
        const result = parkPair(distance).GetAccuracy(1, target, ...parameters);
        close(result[0], expected);
        assert.equal(result[1], distance === 0 ? parameters[0] : distance);
        assert.equal(result[2], distance === 0 ? parameters[2] : 0);
    });
}

test("accuracy early guards preserve references; arity requires all seven arguments", () =>
{
    const park = parkPair(10);
    for (const [src, dst, optimal, falloff, tracking, signature] of [[1, 1, 42, 1, 3, 1], [1, 99, 42, 1, 3, 1],
        [1, 2, -1, 1, 3, 1], [1, 2, 42, 0, 3, 1], [1, 2, 42, 1, 0, 1], [1, 2, 42, 1, 3, 0]])
    {
        const range = { value: optimal }, speed = { value: tracking };
        assert.equal(park.GetAccuracy(src, dst, range, falloff, speed, signature, 1), 0);
        assert.equal(range.value, optimal); assert.equal(speed.value, tracking);
    }
    assert.throws(() => park.GetAccuracy(1, 2, 1, 1, 1, 1), /7 arguments/);
    assert.throws(() => park.PyGetAccuracy(1, 2, 1, 1, 1, 1, 1, 1), /7 arguments/);
    assert.throws(() => park.PyGetAccuracy(1, 2, "1", 1, 1, 1, 1), /numeric/);
    const scalarPark = parkPair(1);
    assert.deepEqual(scalarPark.GetAccuracy(1, 2, true, true, true, true, true), [1, 1, 0]);
    assert.deepEqual(scalarPark.GetAccuracy(1, 2, 1n, 1n, 1n, 1n, 1n), [1, 1, 0]);
    assert.throws(() => scalarPark.GetAccuracy(1, 2, 1n << 1024n, 1, 1, 1, 1), /overflows double/);
});

test("accuracy combines falloff and angular motion, preserves reference alias order and ignores spin", () =>
{
    const park = parkPair(10), source = park.GetBall(1), target = park.GetBall(2);
    source.mRadius = 1; target.mRadius = 2; vec3.set(target.mNewVel, 3, 4, 0);
    const range = { value: 7 }, speed = { value: 0.4 };
    close(park.GetAccuracy(1, 2, range, 1, speed, 1, 1), 0.5);
    assert.equal(range.value, 7); assert.equal(speed.value, 0.4);
    dynamic(); vec3.set(source.mNewAngVel, 0, 0, 100);
    close(park.GetAccuracy(1, 2, 7, -1, -0.4, -1, 1)[0], 0.5);
    const shared = { value: 10 };
    park.GetAccuracy(1, 2, shared, 1, shared, 1, 1);
    assert.equal(shared.value, 0.4);
    source.mRadius = target.mRadius = 10;
    assert.equal(park.GetAccuracy(1, 2, 0, 1, 1, 1, 1)[1], 0);
});

test("accuracy preserves negative subtraction roundoff instead of clamping probability or tracking", () =>
{
    const park = parkPair(), target = park.GetBall(2);
    vec3.set(target.mNewPos, 1, 1, 1); vec3.set(target.mNewVel, 1, 1, 1);
    const result = park.GetAccuracy(1, 2, 10, 1, 1, 1, 1e8);
    close(result[0], 2.790062356961381); assert.ok(Number.isNaN(result[2]));
});
