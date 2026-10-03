import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { CjsSchema } from "@carbonenginejs/runtime/schema";
import { CjsDestinySettingsConfiguration as Configuration, CjsDestinyGlobalSettings as GlobalSettings,
    CjsBallparkController, settings } from "@carbonenginejs/server/destiny";
import { is_dynamical_orientation_enabled, enable_dynamical_orientation,
    disable_dynamical_orientation, reset_settings_to_default, enable_new_orbit
} from "@carbonenginejs/server/destiny/_util/settings";

// Source: destiny/python/destiny/test/test_configure.py:11-55
// Source: destiny/src/Settings.cpp:13-65
afterEach(() => settings.Reset());

test("TestConfigure: initial settings match defaults", () =>
{
    const config = new Configuration(), defaults = settings.GetDefault();
    assert.equal(config.collisionMaxIterations, defaults.collisionMaxIterations);
    assert.equal(config.useIterativeCollision, defaults.useIterativeCollision);
    assert.deepEqual(values(config), [20n, false, false, false, false]);
});

test("TestConfigure: configure", () =>
{
    const config = settings.GetDefault();
    config.collisionMaxIterations = 123;
    assert.equal(settings.Apply(config), undefined);
    assert.equal(settings.Get().collisionMaxIterations, 123n);
});

test("TestConfigure: reset", () =>
{
    const config = settings.GetDefault();
    config.collisionMaxIterations = 123;
    settings.Apply(config);
    assert.equal(settings.Reset(), undefined);
    assert.equal(settings.Get().collisionMaxIterations, settings.GetDefault().collisionMaxIterations);
});

for (const flag of ["useDynamicalOrientation", "disableDynamicalOrientationForMissiles", "useNewOrbit"])
{
    test(`TestConfigure: enable ${flag}`, () =>
    {
        const config = settings.GetDefault();
        assert.equal(config[flag], false);
        config[flag] = true;
        settings.Apply(config);
        assert.equal(settings.Get()[flag], true);
    });
}

function values(config)
{
    return [config.collisionMaxIterations, config.useIterativeCollision,
        config.useDynamicalOrientation, config.disableDynamicalOrientationForMissiles, config.useNewOrbit];
}

test("configuration copies all fields and snapshots never retain global ownership", () =>
{
    const config = settings.GetDefault();
    config.collisionMaxIterations = 0;
    config.useIterativeCollision = config.useDynamicalOrientation = true;
    config.disableDynamicalOrientationForMissiles = config.useNewOrbit = true;
    settings.Apply(config);
    const a = settings.Get(), b = settings.Get();
    assert.notEqual(a, b);
    assert.deepEqual(values(a), [0n, true, true, true, true]);
    config.useNewOrbit = a.useNewOrbit = false;
    assert.equal(settings.Get().useNewOrbit, true);
    const defaults = settings.GetDefault();
    assert.notEqual(defaults, settings.GetDefault());
    assert.deepEqual(values(defaults), [20n, false, false, false, false]);
    assert.deepEqual(values(new Configuration()), values(defaults));
    settings.Reset();
    assert.equal(b.useNewOrbit, true);
});

test("every GlobalSettings instance shares globals and the Blue aliases", () =>
{
    const other = new GlobalSettings(), config = other.GetDefaultConfiguration();
    config.useNewOrbit = true;
    other.ApplyConfiguration(config);
    assert.equal(settings.Get().useNewOrbit, true);
    assert.deepEqual(values(other.GetConfiguration()), values(settings.Get()));
    other.ResetConfiguration();
    assert.equal(settings.Get().useNewOrbit, false);
    assert.equal(other.Configure, undefined, "stale donor description is not a method");
});

test("native configuration cast accepts constructed subclasses but rejects spoofed records", () =>
{
    class Derived extends Configuration
    {
        get useNewOrbit() { throw new Error("Native Apply must read backing storage"); }
    }
    const config = new Derived();
    config.m_useNewOrbit = true;
    settings.Apply(config);
    for (const value of [null, {}, Object.create(Configuration.prototype), undefined, 0])
    {
        assert.throws(() => settings.Apply(value), /not a SettingsConfiguration/);
        assert.equal(settings.Get().useNewOrbit, true);
    }
});

test("Windows64 size_t binding accepts the full uint64 domain without recommendation clamps", () =>
{
    const config = new Configuration();
    for (const [input, expected] of [[0, 0n], [1, 1n], [9, 9n], [false, 0n], [true, 1n],
        [9007199254740993n, 9007199254740993n], [18446744073709551615n, 18446744073709551615n]])
    {
        config.collisionMaxIterations = input;
        settings.Apply(config);
        assert.equal(settings.Get().collisionMaxIterations, expected);
    }
    for (const input of [-1, -1n, 18446744073709551616n, 2 ** 53, 1.5, NaN, Infinity, "20", {}, null])
    {
        assert.throws(() => { config.collisionMaxIterations = input; });
        assert.equal(config.collisionMaxIterations, 18446744073709551615n);
    }
});

test("native boolean binding accepts integers instead of generic truthiness", () =>
{
    const config = new Configuration();
    for (const flag of ["useIterativeCollision", "useDynamicalOrientation", "disableDynamicalOrientationForMissiles", "useNewOrbit"])
    {
        for (const [input, expected] of [[true, true], [false, false], [-1, true], [0, false], [2n, true], [0n, false]])
        {
            config[flag] = input;
            assert.equal(config[flag], expected);
        }
        for (const input of [1.5, "1", "", [], {}, null, NaN, Infinity, 2147483648n, -2147483649n])
        {
            assert.throws(() => { config[flag] = input; });
            assert.equal(config[flag], false);
        }
    }
});

test("native utility functions preserve other globals and reset defaults", () =>
{
    enable_new_orbit();
    assert.equal(is_dynamical_orientation_enabled(), false);
    enable_dynamical_orientation();
    assert.equal(is_dynamical_orientation_enabled(), true);
    assert.equal(settings.Get().useNewOrbit, true);
    disable_dynamical_orientation();
    assert.equal(is_dynamical_orientation_enabled(), false);
    assert.equal(settings.Get().useNewOrbit, true);
    reset_settings_to_default();
    assert.deepEqual(values(settings.Get()), [20n, false, false, false, false]);
});

test("iterative and dynamical settings select supported evolution paths", () =>
{
    const park = new CjsBallparkController();
    const ball = park.AddBall(1, 13000000, 2, 10, true, false, true, false, false,
        0, 0, 0, 0, 1, 0, 0.9, 0.95);
    const config = settings.Get();
    config.useIterativeCollision = true;
    settings.Apply(config);
    park.Evolve();
    assert.equal(park.currentTime, 1);
    assert.ok(ball.y > 0);
    assert.ok(ball.vy < 1);
    const position = ball.y, velocity = ball.vy;
    config.useIterativeCollision = false;
    config.useDynamicalOrientation = true;
    config.disableDynamicalOrientationForMissiles = true;
    settings.Apply(config);
    park.EvolveBehaviorForBall(ball);
    assert.deepEqual([park.currentTime, ball.y, ball.vy, ball.isFree], [1, position, velocity, true]);
    park.EvolveStop(ball); // Native stop damping is disabled, even outside full evolution.
    assert.equal(ball.vy, velocity);
    park.Evolve();
    assert.equal(park.currentTime, 2);
    assert.ok(ball.mNewRot.every(Number.isFinite));
});

test("settings metadata records native identities and Blue aliases without simulation hydration", () =>
{
    assert.ok(CjsSchema.getField(Configuration, "collisionMaxIterations"));
    assert.ok(CjsSchema.getField(Configuration, "useNewOrbit"));
    assert.equal(CjsSchema.getSchema(Configuration).modelledOn, "SettingsConfiguration");
    assert.equal(CjsSchema.getSchema(GlobalSettings).modelledOn, "GlobalSettings");
    for (const field of ["collisionMaxIterations", "useIterativeCollision", "useDynamicalOrientation",
        "disableDynamicalOrientationForMissiles", "useNewOrbit"])
    {
        assert.deepEqual(CjsSchema.getField(Configuration, field).edit, { read: true, write: true });
    }
    for (const [alias, original] of [["Apply", "ApplyConfiguration"], ["Get", "GetConfiguration"],
        ["GetDefault", "GetDefaultConfiguration"], ["Reset", "ResetConfiguration"]])
    {
        assert.equal(CjsSchema.getMethod(GlobalSettings, alias).carbon.originalName, original);
    }
});
