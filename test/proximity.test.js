import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { CjsBallparkController as Park, CjsDestinyBall as Ball, settings } from "@carbonenginejs/server";
import { vec3 } from "@carbonenginejs/runtime/math/vec3";

// Source: destiny/python/destiny/test/ballpark/test_callbacks.py:7-183.
// Source: destiny/src/Ball.cpp:244-288,494-775; destiny/src/Ballpark.cpp:5822-5867.
afterEach(() => { settings.Reset(); Park.s_ballNotInParkCallback = null; });
const Mode = Ball.DSTBALLMODE;
function add(park, id, x = 0, free = true, radius = 0)
{
    return park.AddBall(id, 13e6, radius, 0, free, false, false, false, false,
        x, 0, 0, 0, 0, 0, 0.9, 0.95);
}
function setup()
{
    const park = new Park(), sensor = add(park, 3, 0, false), target = add(park, 4), events = [];
    park._pyOS = { SendEvent(ball, event, name, flags, format, ...args)
    {
        if (["DoProximity", "DoRange", "DoTargetTracking"].includes(name))
        {
            assert.equal(event, `Destiny::Ball::${name}`); assert.equal(flags, null);
            assert.equal(format, name === "DoProximity" ? "Li" : "(i)");
            events.push([name, ...args]);
        }
        return true;
    }, PyError() { assert.fail("unexpected PyError"); } };
    return { park, sensor, target, events };
}

test("proximity preserves callback order after moribund changes and reports failed dispatch", () =>
{
    const { park, sensor, target } = setup(), calls = [];
    park.GotoPoint(sensor.id, 1, 0, 0);
    park.SetNotificationRange(sensor.id, 10);
    park.SetTargetTracking(sensor.id, target.id, 10);
    sensor.AddProximitySensor(10, 0);
    park._pyOS = {
        SendEvent(ball, event, name)
        {
            calls.push(name);
            if (name === "DoRange") ball.isMoribund = true;
            return false;
        },
        PyError() { calls.push("PyError"); }
    };
    sensor.CheckForProximity();
    assert.deepEqual(calls, ["DoRange", "PyError", "DoTargetTracking", "PyError"]);
    assert.equal(sensor.mWithinRange, true);
    assert.equal(sensor.mWithinTrackingRange, true);
    assert.equal(sensor.mSensor.balls.size, 0);
});

test("notification callback detachment retains the host for the following tracking event", () =>
{
    const { park, sensor, target } = setup(), calls = [];
    park.GotoPoint(sensor.id, 1, 0, 0);
    park.SetNotificationRange(sensor.id, 10);
    park.SetTargetTracking(sensor.id, target.id, 10);
    park._pyOS = {
        SendEvent(ball, event, name)
        {
            calls.push(name);
            if (name === "DoRange") park.ClearAll();
            return true;
        },
        PyError() { assert.fail("unexpected PyError"); }
    };
    sensor.CheckForProximity();
    assert.equal(sensor.mPark, null);
    assert.deepEqual(calls, ["DoRange", "DoTargetTracking"]);
});

test("donor periodic sensor waits two ticks and resets elapsed rather than carrying overshoot", () =>
{
    const { park, sensor, target, events } = setup(); sensor.AddProximitySensor(10, 2);
    park.Evolve(); assert.deepEqual(events, []); park.Evolve();
    assert.deepEqual(events, [["DoProximity", target.id, 1]]);
    sensor.mSensor.elapsed = 10; park.Evolve(); assert.equal(sensor.mSensor.elapsed, 0);
});

for (const scenario of ["inside", "fixed", "inert", "removed", "outside", "edge", "leave"])
test(`donor sensor callback fixture: ${scenario}`, () =>
{
    const { park, sensor, target, events } = setup();
    sensor.AddProximitySensor(10, 0, false, scenario === "inert");
    if (scenario === "fixed") park.SetBallFree(target.id, false);
    if (scenario === "removed") park.RemoveProximitySensor(sensor.id);
    if (scenario === "outside" || scenario === "edge") park.SetBallPosition(target.id, scenario === "edge" ? 10 : 11, 0, 0);
    park.Evolve();
    const expected = ["inside", "edge", "leave"].includes(scenario) ? [["DoProximity", target.id, 1]] : [];
    if (scenario === "leave")
    {
        park.SetBallPosition(target.id, 11, 0, 0); park.Evolve(); expected.push(["DoProximity", target.id, 0]);
    }
    assert.deepEqual(events, expected);
});

for (const scenario of ["inside", "edge", "outside", "stopped", "leave"])
test(`donor destination notification fixture: ${scenario}`, () =>
{
    const { park, sensor, events } = setup();
    if (scenario === "edge") sensor.radius = 1;
    if (scenario !== "stopped") park.GotoPoint(sensor.id, scenario === "edge" ? 11 : scenario === "outside" ? 100 : 1, 0, 0);
    park.SetNotificationRange(sensor.id, 10); park.Evolve();
    const expected = ["inside", "leave"].includes(scenario) ? [["DoRange", 1]] : [];
    if (scenario === "leave") { sensor.x += 100; park.Evolve(); expected.push(["DoRange", 0]); }
    assert.deepEqual(events, expected);
});

for (const scenario of ["inside", "edge", "outside", "leave"])
test(`donor target tracking fixture: ${scenario}`, () =>
{
    const { park, sensor, target, events } = setup();
    target.x = scenario === "edge" ? 10 : scenario === "outside" ? 11 : 0;
    park.SetTargetTracking(sensor.id, target.id, 10); park.Evolve();
    const expected = ["inside", "leave"].includes(scenario) ? [["DoTargetTracking", 1]] : [];
    if (scenario === "leave") { target.x += 100; park.Evolve(); expected.push(["DoTargetTracking", 0]); }
    assert.deepEqual(events, expected);
});

test("sensor setup preserves elapsed, rejection state, and non-replacing registration", () =>
{
    const { park, sensor } = setup(); sensor.radius = 10; sensor.mSensor.elapsed = 1.5;
    assert.equal(sensor.AddProximitySensor(-10, 2), 0); assert.equal(sensor.mSensor.elapsed, 1.5);
    sensor.mSensor.balls.set(99n, 4n);
    assert.equal(sensor.AddProximitySensor(-11, 9), -1);
    assert.equal(sensor.mSensor.period, 2); assert.equal(sensor.mSensor.balls.get(99n), 4n);
    sensor.RemoveProximitySensor(); assert.equal(sensor.mSensor.balls.get(99n), 4n);
    assert.equal(park.mProximityBalls.has(sensor.id), false);
    const stale = new Ball(); stale.mId = sensor.id; park.mProximityBalls.set(sensor.id, stale);
    sensor.AddProximitySensor(10); assert.equal(park.mProximityBalls.get(sensor.id), stale);
    const detached = new Ball();
    assert.throws(() => detached.AddProximitySensor(5), TypeError);
    assert.equal(detached.mSensor.active, true); assert.equal(detached.mHasProximity, true);
});

test("shuffle helper can supply deterministic scheduling without changing runtime", () =>
{
    const { sensor } = setup(), random = Ball.floatrand; let calls = 0;
    Ball.floatrand = (a, b) => { calls++; assert.equal(a, 0); assert.equal(b, 8); return 3; };
    try
    {
        sensor.AddProximitySensor(5, 8, 1); assert.equal(sensor.mSensor.elapsed, 3);
        sensor.AddProximitySensor(5, 8, 0); assert.equal(calls, 1); assert.equal(sensor.mSensor.elapsed, 3);
    }
    finally { Ball.floatrand = random; }
});

test("tracking cancellation retains registration and within flag; missing target preserves state", () =>
{
    const { park, sensor, target } = setup(); park.SetTargetTracking(sensor.id, target.id, 10);
    sensor.CheckForProximity_TargetTracking(); assert.equal(sensor.mWithinTrackingRange, true);
    park.SetTargetTracking(sensor.id, 999, 20); assert.equal(sensor.mTrackingPtr, target);
    park.SetTargetTracking(sensor.id, 0, 10);
    assert.equal(sensor.mTrackingPtr, null); assert.equal(sensor.mTrackingRange, 0);
    assert.equal(sensor.mWithinTrackingRange, true); assert.equal(sensor.mHasProximity, true);
    assert.equal(park.mProximityBalls.get(sensor.id), sensor);
    park.SetNotificationRange(sensor.id, 0); assert.equal(sensor.mHasProximity, false);
    park.SetNotificationRange(sensor.id, NaN); assert.equal(sensor.mHasProximity, true);
});

test("follow notification is an open annulus and tracking ignores target radius", () =>
{
    const { park, sensor, target, events } = setup(); sensor.mMode = Mode.DSTBALL_FOLLOW;
    sensor.mFollowPtr = target; sensor.mFollowRange = 10; target.radius = 2; sensor.radius = 1;
    park.SetNotificationRange(sensor.id, 3); // lower=10, upper=16
    for (const x of [10, 11, 16, 15, 0]) { target.x = x; sensor.CheckForProximity_NotificationRange(); }
    assert.deepEqual(events, [["DoRange", 1], ["DoRange", 0], ["DoRange", 1], ["DoRange", 0]]);
    events.length = 0; target.radius = 1000; target.x = 12;
    park.SetTargetTracking(sensor.id, target.id, 10); sensor.CheckForProximity_TargetTracking();
    assert.deepEqual(events, []);
});

test("sensor threshold uses left-associated float32 sums, while boundary remains inclusive", () =>
{
    const { park, sensor, target, events } = setup(); sensor.radius = target.radius = 1;
    sensor.AddProximitySensor(16777216, 0);
    park.SetBallRadius = (ball, radius) => { ball.mRadius = Math.fround(radius); };
    park.mPartition.GetProximityCandidates = (ball, uni) => { uni.push(target); };
    target.x = 16777217; sensor.CheckForProximity_Sensor(); assert.deepEqual(events, []);
    target.x = 16777216; sensor.CheckForProximity_Sensor(); assert.deepEqual(events, [["DoProximity", target.id, 1]]);
});

test("temporary sensor geometry restores before callbacks and after failed query", () =>
{
    const { park, sensor, target } = setup(); sensor.radius = 2; vec3.set(sensor.mNewVel, 3, 4, 5);
    sensor.AddProximitySensor(10, 0);
    let enlarged = false;
    park.mPartition.GetProximityCandidates = (ball, uni) =>
    {
        assert.equal(ball.radius, 12); assert.deepEqual(Array.from(ball.mNewVel), [0, 0, 0]);
        enlarged = true; uni.push(target);
    };
    park._pyOS.SendEvent = () =>
    {
        assert.equal(sensor.radius, 2); assert.deepEqual(Array.from(sensor.mNewVel), [3, 4, 5]); return true;
    };
    sensor.CheckForProximity_Sensor(); assert.ok(enlarged);
    park.mPartition.GetProximityCandidates = () => { throw Error("query failure"); };
    assert.throws(() => sensor.CheckForProximity_Sensor(), /query failure/);
    assert.equal(sensor.radius, 2); assert.deepEqual(Array.from(sensor.mNewVel), [3, 4, 5]);
});

test("vanished contact disabling still permits one candidate; self and moribund entries persist", () =>
{
    const { park, sensor, target, events } = setup(); sensor.AddProximitySensor(10, 0);
    const dead = add(park, 5); dead.isMoribund = true;
    sensor.mSensor.balls.set(sensor.id, 0n); sensor.mSensor.balls.set(dead.id, 0n); sensor.mSensor.balls.set(99n, 0n);
    park.mPartition.GetProximityCandidates = (ball, uni) => { uni.push(dead, target); };
    const send = park._pyOS.SendEvent;
    park._pyOS.SendEvent = (...args) =>
    {
        send(...args);
        if (args[5] === 99n) { assert.equal(sensor.mSensor.balls.has(99n), false); sensor.RemoveProximitySensor(); }
        return true;
    };
    sensor.CheckForProximity_Sensor();
    assert.deepEqual(events, [["DoProximity", 99n, 0], ["DoProximity", target.id, 1]]);
    assert.ok(sensor.mSensor.balls.has(sensor.id)); assert.ok(sensor.mSensor.balls.has(dead.id));
});

test("registry snapshot defers additions; dead bubbles force one populated scan then clear", () =>
{
    const { park, sensor, target } = setup(); sensor.AddProximitySensor(10, 100);
    let checks = 0, targetChecks = 0;
    sensor.CheckForProximity = () =>
    {
        checks++; target.AddProximitySensor(1); target.CheckForProximity = () => { targetChecks++; };
    };
    park.HandleProximities(); assert.equal(checks, 1); assert.equal(targetChecks, 0);
    park.HandleProximities(); assert.equal(targetChecks, 1);
    park.InDeadBubble = () => true; sensor.mSensor.balls.set(99n, 0n);
    park.HandleProximities(); assert.equal(checks, 3); assert.equal(sensor.mSensor.elapsed, 100);
    assert.equal(sensor.mSensor.balls.size, 0); park.HandleProximities(); assert.equal(checks, 3);
});

test("proximity executes after petrification, before counter advance, under deletion semaphore", () =>
{
    const { park, sensor, target } = setup(); park.SetBallTroll(target.id, 1); park.currentTime = 1;
    park.SetNotificationRange(sensor.id, 10);
    sensor.CheckForProximity = () =>
    {
        assert.equal(target.mode, Mode.DSTBALL_RIGID); assert.equal(park.currentTime, 1); assert.equal(park.inEvolve, true);
        throw Error("proximity host failure");
    };
    assert.throws(() => park.Evolve(), /proximity host failure/); assert.equal(park.inEvolve, false);
});

test("removal/ClearAll cleanup registration but retain target pointers and detached callbacks", () =>
{
    const { park, sensor, target } = setup(); park.SetTargetTracking(sensor.id, target.id, 10);
    park.RemoveBall(target.id); assert.equal(sensor.mTrackingPtr, target);
    park.RemoveBall(sensor.id); assert.equal(park.mProximityBalls.size, 0);
    let notified = null; Park.s_ballNotInParkCallback = ball => { notified = ball; };
    sensor.CheckForProximity(); assert.equal(notified, sensor);
    const other = add(park, 9); other.AddProximitySensor(1); park.ClearAll();
    assert.equal(park.mProximityBalls.size, 0); assert.equal(other.mHasProximity, true);
});

test("sensor callback recursion owns independent candidate arrays", () =>
{
    const { park, sensor, target, events } = setup(), third = add(park, 5);
    sensor.AddProximitySensor(10, 0); let depth = 0;
    park.mPartition.GetProximityCandidates = (ball, uni) => { if (!depth) uni.push(target, third); else uni.push(target); };
    const send = park._pyOS.SendEvent;
    park._pyOS.SendEvent = (...args) =>
    {
        send(...args); if (!depth && args[5] === target.id) { depth++; sensor.CheckForProximity_Sensor(); depth--; }
        return true;
    };
    sensor.CheckForProximity_Sensor(); assert.deepEqual(events, [["DoProximity", target.id, 1], ["DoProximity", third.id, 1]]);
});

test("Python sensor defaults discard failure and validate arity/flags", () =>
{
    const { park, sensor } = setup();
    assert.equal(sensor.PyAddProximitySensor(-1), undefined); assert.equal(sensor.mSensor.active, false);
    park.PyAddProximitySensor(sensor.id, 5); assert.equal(sensor.mSensor.period, 2);
    park.PyRemoveProximitySensor(sensor.id); assert.equal(sensor.mSensor.active, false);
    for (const run of [() => sensor.PyAddProximitySensor(), () => park.PyAddProximitySensor(3),
        () => park.PyRemoveProximitySensor(), () => park.PySetNotificationRange(3), () => park.PySetTargetTracking(3, 4)])
        assert.throws(run, TypeError);
    assert.throws(() => park.PyAddProximitySensor(999, 5, 2, 0, 256), RangeError);
    assert.throws(() => sensor.PyAddProximitySensor(5, 2, 1.5), RangeError);
});
