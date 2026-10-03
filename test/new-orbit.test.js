import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { CjsBallparkController, settings } from "@carbonenginejs/server/destiny";

// Source: destiny/python/destiny/test/ballpark/evolve/test_orbit.py:53-185
// Source: destiny/python/destiny/test/helpers.py:207-231
// Source: destiny/src/Ballpark.cpp:664-749,1134-1235,1428-1505
afterEach(() => settings.Reset());

function scene()
{
    const config = settings.GetDefault(); config.useNewOrbit = true; settings.Apply(config);
    const park = new CjsBallparkController();
    const target = park.AddBall(1, 13000000, 2, 10, true, false, true, false, false,
        0, 0, 0, 0, 0, 0, 0.9, 0.95);
    const ship = park.AddBall(2, 13000000, 2, 10, true, false, true, false, false,
        10, 0, 0, 0, 0, 0, 0.9, 0.95);
    return { park, target, ship };
}

function measures(ship, target, relative = false)
{
    const dx = ship.x - target.x, dy = ship.y - target.y, dz = ship.z - target.z;
    const vx = ship.vx - (relative ? target.vx : 0);
    const vy = ship.vy - (relative ? target.vy : 0);
    const vz = ship.vz - (relative ? target.vz : 0);
    return { distance: Math.sqrt(dx * dx + dy * dy + dz * dz),
        speed: Math.sqrt(vx * vx + vy * vy + vz * vz), dot: Math.abs(vx * dx + vy * dy + vz * dz) };
}

test("TestNewOrbit: stopped target, starting at the right distance", () =>
{
    const { park, ship, target } = scene();
    for (const range of [100, 500, 1000, 2000])
    {
        const expected = range + ship.radius + target.radius;
        park.SetBallPosition(2, expected, 0, 0);
        park.SetBallVelocity(2, 0, 0, 1);
        park.Orbit(2, 1, range);
        for (let i = 0; i < 100; i++)
        {
            park.Evolve();
            const { distance, speed, dot } = measures(ship, target);
            assert.ok(Math.abs(distance - expected) <= 20);
            assert.ok(dot < 0.2 * speed * distance);
        }
    }
});

test("TestNewOrbit: stopped target, starting outside", () =>
{
    const { park, ship, target } = scene();
    const expected = 1000 + ship.radius + target.radius;
    park.SetBallPosition(2, 1.5 * expected, 0, 0);
    park.SetBallVelocity(2, -1, 0, 1);
    park.Orbit(2, 1, 1000);
    let previous = ship.x, reached = false;
    for (let i = 0; i < 2000; i++)
    {
        park.Evolve();
        const { distance, speed, dot } = measures(ship, target);
        if (distance > expected + 10)
        {
            assert.ok(distance < previous);
            previous = distance;
            assert.ok(dot < 0.8 * speed * distance);
        }
        else
        {
            reached = true;
            assert.ok(Math.abs(distance - expected) <= 10);
        }
    }
    assert.equal(reached, true);
});

test("TestNewOrbit: stopped target, starting inside", () =>
{
    const { park, ship, target } = scene();
    const expected = 1000 + ship.radius + target.radius;
    park.SetBallPosition(2, 0.5 * expected, 0, 0);
    park.SetBallVelocity(2, 0, 0, 1);
    park.Orbit(2, 1, 1000);
    let previous = ship.x, reached = false;
    for (let i = 0; i < 2000; i++)
    {
        park.Evolve();
        const { distance, speed, dot } = measures(ship, target);
        if (distance < expected - 20)
        {
            assert.ok(distance > previous);
            previous = distance;
            assert.ok(dot < 0.85 * speed * distance);
        }
        else
        {
            reached = true;
            assert.ok(Math.abs(distance - expected) <= 20);
        }
    }
    assert.equal(reached, true);
});

test("TestNewOrbit: moving target, starting at the right distance", () =>
{
    const { park, ship, target } = scene();
    const expected = 2000 + ship.radius + target.radius;
    park.SetMaxSpeed(2, 200); park.SetMaxSpeed(1, 50);
    park.GotoDirection(1, 1, 1, 1);
    park.SetBallPosition(2, expected, 0, 0);
    park.SetBallVelocity(2, 0, 0, 1);
    park.Orbit(2, 1, 2000);
    for (let i = 0; i < 200; i++)
    {
        park.Evolve();
        const { distance, speed, dot } = measures(ship, target, true);
        assert.ok(Math.abs(distance - expected) <= 700);
        assert.ok(dot < 0.4 * speed * distance);
    }
});

test("GetOrbitalNormal preserves untouched outputs and uses predicted target velocity", () =>
{
    const { park, ship } = scene();
    const out = { orbitalVector: [9, 9, 9], toVector: [8, 7, 6], dist: 5 };
    park.GetOrbitalNormal(null, out);
    assert.deepEqual(out, { orbitalVector: [0, 0, 0], toVector: [8, 7, 6], dist: 5 });
    park.GetOrbitalNormal(ship, out);
    assert.deepEqual(out.toVector, [8, 7, 6]);
    park.Orbit(2, 1, 100);
    park.SetBallPosition(1, 13, 0, 0); park.SetBallVelocity(1, 0, 4, 0);
    park.SetBallVelocity(2, 0, 0, 2);
    park.GetOrbitalNormal(ship, out);
    assert.equal(out.dist, 5);
    assert.deepEqual(out.toVector, [0.6000000000000001, 0.8, 0]);
    assert.ok(Math.abs(out.orbitalVector[0] - 0.8) < 1e-15);
    assert.ok(Math.abs(out.orbitalVector[1] + 0.6) < 1e-15);
    assert.equal(out.orbitalVector[2], 0);
});

test("orbital fallback reads park counter, retains low ID bits and handles coincident centers", () =>
{
    const { park, ship } = scene();
    park.Orbit(2, 1, 100);
    park.currentTime = 7;
    park.EvolveNewStyleOrbit(ship, 123);
    const before = [ship.gotoX, ship.gotoY, ship.gotoZ, ship._lastGx, ship._lastGy, ship._lastGz];
    park.EvolveNewStyleOrbit(ship, 9999);
    assert.deepEqual([ship.gotoX, ship.gotoY, ship.gotoZ, ship._lastGx, ship._lastGy, ship._lastGz], before);
    park.SetBallPosition(2, 0, 0, 0);
    const out = { orbitalVector: [0, 0, 0], toVector: [0, 0, 0], dist: 0 };
    park.GetOrbitalNormal(ship, out);
    assert.equal(out.dist, 0);
    assert.deepEqual(out.toVector, [0, 0, 1]);
    const expected = [];
    park.DefaultOrbitalNormal(ship, expected);
    assert.deepEqual(out.orbitalVector, expected);
    assert.deepEqual(park.DefaultOrbitalNormal({ id: 9007199254740994n }, []), expected);
    const config = settings.Get(); config.useDynamicalOrientation = true; settings.Apply(config);
    park.GetOrbitalNormal(ship, out);
    assert.ok(out.orbitalVector.every(Number.isFinite));
});

test("OrbitThrust preserves exact native deadband and cap boundaries", () =>
{
    const { park, ship } = scene();
    park.SetBallPosition(2, 0, 0, 0);
    park.SetBallMass(2, 1000000); park.SetBallAgility(2, 1); park.SetSpeedFraction(2, 1);
    for (const [x, expected] of [[0.9, 0], [1, 1], [10, 10], [100, 10]])
    {
        park.OrbitThrust(ship, x, 0, 0);
        assert.equal(ship._lastGx, expected);
        assert.equal(ship._lastGy, 0);
        assert.equal(ship._lastGz, 0);
    }
    park.SetSpeedFraction(2, 0);
    park.OrbitThrust(ship, 100, 0, 0);
    assert.equal(ship._lastGx, 0);
});

test("GotoThrustFollow blends independent target constraints, caps, and selects fallback", () =>
{
    const { park, ship } = scene();
    park.SetBallPosition(2, 0, 0, 0);
    park.SetBallVelocity(2, 2, 0, 0);
    park.SetBallMass(2, 1000000); park.SetBallAgility(2, 1); park.SetSpeedFraction(2, 1);
    ship._timeFactor = 0.5;
    park.GotoThrustFollow(ship, 3, 0, 0, 4, 0, 0, 1);
    assert.equal(ship._lastGx, 5); // Position constraint=4; velocity constraint=6.
    park.GotoThrustFollow(ship, 1000, 0, 0, 1000, 0, 0, 1);
    assert.equal(ship._lastGx, 10);
    park.SetBallVelocity(2, 0, 0, 0);
    park.Orbit(2, 1, 10);
    park.GotoThrustFollow(ship, 1, 0, 0, 0, 0, 0, 1);
    assert.equal(ship._lastGx, 1);
    park.GotoThrustFollow(ship, 1, 0, 0, 0.5, 0, 0, 1);
    assert.equal(ship._lastGx, 1.5);
    settings.Reset();
    park.GotoThrustFollow(ship, 1, 0, 0, 0, 0, 0, 1);
    assert.equal(ship._lastGx, 0.001);
});

test("zero-speed exact-radius orbit retains native NaN goto with zero thrust", () =>
{
    const { park, ship } = scene();
    park.SetMaxSpeed(2, 0);
    park.Orbit(2, 1, 6);
    park.Evolve();
    assert.ok([ship.gotoX, ship.gotoY, ship.gotoZ].every(Number.isNaN));
    assert.deepEqual([ship._lastGx, ship._lastGy, ship._lastGz], [0, 0, 0]);
    assert.deepEqual([ship.x, ship.y, ship.z], [10, 0, 0]);
});

test("settings changes affect existing parks and select both native orbit methods", () =>
{
    const { park, ship } = scene();
    park.Orbit(2, 1, 100);
    const calls = [];
    park.EvolveNewStyleOrbit = () => calls.push("new");
    park.EvolveOldStyleOrbit = () => calls.push("old");
    park.EvolveOrbit(ship, 0);
    settings.Reset();
    park.EvolveOrbit(ship, 0);
    assert.deepEqual(calls, ["new", "old"]);
});

test("GetOrbitalNormal retains the legacy direction and aliased output assignment", () =>
{
    const { park, ship } = scene();
    park.Orbit(2, 1, 100);
    park.SetBallVelocity(1, 0, 4, 0);
    settings.Reset();
    const normal = park.DefaultOrbitalNormal(ship, []);
    const vector = [7, 8, 9];
    const out = { orbitalVector: vector, toVector: vector, dist: 0 };
    park.GetOrbitalNormal(ship, out);
    assert.equal(out.dist, 10); // Legacy direction does not predict target velocity.
    assert.deepEqual(vector, normal); // Native return assignment follows by-ref writes.
});

test("new-orbit nonfinite normalization and dynamic fallback preserve source branches", () =>
{
    const { park, ship } = scene();
    park.Orbit(2, 1, 6);
    const config = settings.Get(); config.useDynamicalOrientation = true; settings.Apply(config);
    ship.vx = NaN; // Direct internal probe of native nonfinite branch semantics.
    const out = { orbitalVector: [0, 0, 0], toVector: [0, 0, 0], dist: 0 };
    park.GetOrbitalNormal(ship, out);
    assert.ok(out.orbitalVector.every(Number.isFinite), "NaN velocity can fall back to a valid physical heading");
    ship.mNewRot[0] = NaN;
    park.GetOrbitalNormal(ship, out);
    assert.ok(out.orbitalVector.every(Number.isNaN), "second <= threshold keeps NaN in normalization");
    config.useDynamicalOrientation = false; settings.Apply(config);
    ship.vx = 0;
    park.GetOrbitalNormal = (_ball, result) =>
    {
        result.orbitalVector[0] = NaN; result.orbitalVector[1] = 1; result.orbitalVector[2] = 0;
        result.toVector[0] = 1; result.toVector[1] = result.toVector[2] = 0;
        result.dist = 10;
        return result;
    };
    park.EvolveNewStyleOrbit(ship, 0);
    assert.ok([ship.gotoX, ship.gotoY, ship.gotoZ].every(Number.isNaN));
});

test("new-orbit std::max retains cruise speed when current speed is NaN", () =>
{
    const { park, ship } = scene();
    park.Orbit(2, 1, 100);
    ship.vy = NaN; // Probe native unordered comparison; public velocity setters reject NaN.
    park.EvolveNewStyleOrbit(ship, 0);
    assert.ok([ship.gotoX, ship.gotoY, ship.gotoZ].every(Number.isFinite));
    assert.ok(Number.isNaN(ship._lastGy));
});
