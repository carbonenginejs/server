import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { CjsBallparkController as Park, CjsDestinyBall as Ball, settings } from "@carbonenginejs/server";
import { vec3 } from "@carbonenginejs/runtime/math/vec3";

const Mode = Ball.DSTBALLMODE;
afterEach(() => settings.Reset());
const near = (a, b, epsilon = 1e-7) => assert.ok(Math.abs(a - b) <= epsilon, `${a} != ${b}`);
function space(park, id, x = 0)
{
    return park.AddBall(id, 13e6, 2, 10, true, false, true, false, false,
        x, 0, 0, 0, 0, 0, 0.9, 0.95);
}
function setup()
{
    const park = new Park(), target = space(park, 1, 1e6), owner = space(park, 2);
    const collider = space(park, 3, 2000); park.SetBallRadius(collider.id, 1900);
    const missile = space(park, 4);
    park.SetMaxSpeed(missile.id, 300); park.SetBallAgility(missile.id, 0.01);
    park.SetBallMass(missile.id, 1e4);
    return { park, target, owner, collider, missile };
}

for (const iterative of [false, true]) for (const variant of ["stationary", "moving", "aimed", "massive"])
test(`donor missile twenty-tick ${variant}, iterative=${iterative}`, () =>
{
    // Source: destiny/python/destiny/test/ballpark/evolve/test_missile.py:34-119.
    const config = settings.Get(); config.useIterativeCollision = iterative; settings.Apply(config);
    const { park, target, owner, collider, missile } = setup();
    if (variant === "moving") owner.vz = 10;
    const aimed = variant === "aimed" || variant === "massive";
    park.LaunchMissile(missile.id, target.id, owner.id, aimed, variant === "massive");
    owner.vz = 0;
    near(missile.vx, aimed ? 1 : 0); near(missile.vy, 0);
    near(missile.vz, aimed ? 0 : variant === "moving" ? 160 : -150);
    assert.ok(missile.isMassive, "donor helper starts massive; launch false retains the flag");
    for (let tick = 0; tick < 20; ++tick) park.Evolve();
    near(missile.vx, missile.maxVelocity * missile.speedFraction, variant === "stationary" ? 0.005 : 0.00005);
    near(missile.vy, 0, aimed ? 0.00005 : 0.5); near(missile.vz, 0, aimed ? 0.00005 : 0.5);
    assert.deepEqual([collider.x, collider.y, collider.z], [2000, 0, 0]);
    if (variant === "aimed") assert.ok(missile.x > collider.x);
});

test("native launch velocity fixtures and absolute owner positioning", () =>
{
    // Source: destiny/python/destiny/test/ballpark/test_movement_controls.py:284-343.
    const { park, target, owner, missile } = setup();
    park.SetBallPosition(owner.id, 50, 60, 70); park.SetMaxSpeed(owner.id, 1234);
    park.LaunchMissile(missile.id, target.id, owner.id, false, false);
    assert.deepEqual([missile.x, missile.y, missile.z], [50, 60, 70]);
    assert.equal(missile.ownerId, owner.id); near(missile.vz, -1234);
    park.SetMaxSpeed(owner.id, 10); owner.vx = 100;
    park.LaunchMissile(missile.id, target.id, owner.id, false, false);
    assert.deepEqual([missile.vx, missile.vy, missile.vz], [250, 0, 0]);
    park.SetBallPosition(owner.id, 0, 0, 0);
    park.LaunchMissile(missile.id, target.id, owner.id, true, true);
    assert.deepEqual([missile.vx, missile.vy, missile.vz], [1, 0, 0]);
    assert.equal(missile.followId, target.id); assert.equal(missile.mode, Mode.DSTBALL_MISSILE);
});

test("launch flag bytes are required; aimed is exact one and false massive preserves state", () =>
{
    const { park, target, owner, missile } = setup();
    park.SetBallMassive(missile.id, false);
    park.LaunchMissile(missile.id, target.id, owner.id, 2, 0);
    near(missile.vz, -150); assert.equal(missile.isMassive, false);
    park.LaunchMissile(missile.id, target.id, owner.id, 1, 255);
    assert.equal(missile.vx, 1); assert.ok(missile.isMassive);
    park.LaunchMissile(missile.id, target.id, owner.id, 255, 0);
    near(missile.vz, -150); assert.ok(missile.isMassive);
    for (const bad of [-1, 256, 0.5, NaN, "1"])
        assert.throws(() => park.LaunchMissile(missile.id, target.id, owner.id, bad, 0), RangeError);
    assert.throws(() => park.LaunchMissile(missile.id, target.id, owner.id), TypeError);
    assert.throws(() => park.LaunchMissile(missile.id, target.id, owner.id, 1, 0, 0), TypeError);
    assert.throws(() => park.LaunchMissile(missile.id, -1, 999, 0, 0), RangeError);
    assert.throws(() => park.LaunchMissile(missile.id, target.id, -9223372036854775808n, 0, 0), RangeError);
    park.SetBallMassive(999, true);
});

test("missing launch participants do not create balls, free them, or reject inEvolve", () =>
{
    const { park, target, owner, missile } = setup();
    park.inEvolve = true;
    park.LaunchMissile(missile.id, target.id, 999, true, true);
    assert.equal(missile.mode, Mode.DSTBALL_STOP); assert.equal(missile.vx, 0);
    const counter = park.mLocalHiCnt;
    park.LaunchMissile(-1, target.id, owner.id, true, true);
    assert.equal(park.GetBall(-1), null); assert.equal(park.mLocalHiCnt, counter);
    park.SetBallFree(missile.id, false);
    park.LaunchMissile(missile.id, target.id, owner.id, true, false);
    assert.equal(missile.isFree, false); assert.equal(missile.mode, Mode.DSTBALL_MISSILE);
});

test("missing target fallback uses captured owner maxVelocity; cloak stops launch after setters", () =>
{
    const { park, target, owner, missile } = setup();
    owner.vy = 10;
    park.LaunchMissile(missile.id, 999, owner.id, true, false);
    assert.equal(missile.mode, Mode.DSTBALL_GOTO); assert.equal(missile.vy, 160);
    park.Stop(missile); park.SetMaxSpeed(owner.id, 0);
    park.LaunchMissile(missile.id, 999, owner.id, true, false);
    assert.equal(missile.mode, Mode.DSTBALL_STOP); assert.equal(missile.vy, 160);
    target.isCloaked = true;
    park.GotoPoint(missile.id, 100, 200, 300);
    park.SetBallPosition(owner.id, 8, 9, 10);
    park.LaunchMissile(missile.id, target.id, owner.id, true, true);
    assert.deepEqual([missile.x, missile.y, missile.z], [8, 9, 10]);
    assert.equal(missile.vy, 160); assert.equal(missile.mode, Mode.DSTBALL_GOTO);
});

test("signed defender owner lookup differs from target skip and collision identity", () =>
{
    const { park, target, owner, missile } = setup();
    park.LaunchMissile(missile.id, target.id, -owner.id, 1, 0);
    assert.equal(missile.ownerId, -owner.id); assert.equal(missile.followId, target.id);
    park.LaunchMissile(missile.id, owner.id, owner.id, 1, 0);
    assert.equal(missile.mode, Mode.DSTBALL_GOTO, "equal signed owner/target skips target lookup");
    park.LaunchMissile(missile.id, owner.id, -owner.id, 1, 0);
    assert.equal(missile.mode, Mode.DSTBALL_MISSILE); assert.equal(missile.followId, owner.id);
    assert.deepEqual([missile.vx, missile.vy, missile.vz], [0, 0, 0], "aimed coincident direction stays zero");
});

test("MissileFollow guard order and callback-visible native fields", () =>
{
    // Source: destiny/src/Ballpark.cpp:3798-3872.
    const { park, target, owner, missile } = setup();
    park.GotoPoint(missile.id, 10, 0, 0);
    park.MissileFollow(missile.id, 999, owner.id); assert.equal(missile.mode, Mode.DSTBALL_GOTO);
    target.isMoribund = true;
    park.MissileFollow(missile.id, target.id, owner.id); assert.equal(missile.mode, Mode.DSTBALL_GOTO);
    target.isMoribund = false; target.isCloaked = true;
    park.MissileFollow(missile.id, target.id, owner.id); assert.equal(missile.mode, Mode.DSTBALL_STOP);
    target.isCloaked = false; target.mNewBubble = missile.mNewBubble + 1;
    park.GotoPoint(missile.id, 10, 0, 0);
    park.MissileFollow(missile.id, target.id, owner.id); assert.equal(missile.mode, Mode.DSTBALL_STOP);
    target.mNewBubble = missile.mNewBubble;
    missile.radius = 1; target.radius = 2; missile.vx = 3; missile.vy = 4;
    park.currentTime = 9;
    park._pyOS = { SendEvent(value, event, name, flags, format, oldMode, mode)
    {
        assert.equal(oldMode, Mode.DSTBALL_STOP); assert.equal(mode, Mode.DSTBALL_MISSILE);
        assert.equal(value.mode, Mode.DSTBALL_STOP); assert.equal(value.ownerId, owner.id);
        assert.equal(value.followId, target.id); assert.equal(value.followRange, -3);
        assert.equal(value.effectStamp, 9); assert.equal(value.speedFraction, 1);
        assert.equal(target.mFollowers.has(value.id), false); return true;
    } };
    park.MissileFollow(missile.id, target.id, owner.id);
    assert.ok(target.mFollowers.has(missile.id));
    near(missile.gotoX, 6e15, 1); near(missile.gotoY, 8e15, 1);
});

test("MissileFollow raw equal IDs preserve state, missing owner is tolerated, Python rejects negative target", () =>
{
    const { park, target, owner, missile } = setup();
    park.GotoPoint(missile.id, 10, 0, 0);
    for (const [id, dst, own] of [[missile.id, missile.id, owner.id],
        [missile.id, target.id, missile.id], [missile.id, target.id, target.id]])
    {
        park.MissileFollow(id, dst, own); assert.equal(missile.mode, Mode.DSTBALL_GOTO);
    }
    const warn = console.warn; console.warn = () => {};
    try { park.MissileFollow(missile.id, target.id, 999); }
    finally { console.warn = warn; }
    assert.equal(missile.ownerId, 999n); assert.equal(missile.mode, Mode.DSTBALL_MISSILE);
    const negative = space(park, -2, 500);
    park.MissileFollow(missile.id, negative.id, owner.id);
    assert.equal(missile.followId, negative.id);
    assert.throws(() => park.PyMissileFollow(missile.id, negative.id, owner.id), RangeError);
});

test("missile launch interval is inclusive 800ms; pursuit predicts target motion and retains float radius residual", () =>
{
    const { park, target, owner, missile } = setup();
    park.SetBallPosition(target.id, 30, 40, 0); vec3.set(target.mNewVel, 1, -2, 3);
    park.SetMaxSpeed(missile.id, 10); missile.radius = 16777216; target.radius = 1;
    missile.vx = 0; park.currentTime = 10;
    park.MissileFollow(missile.id, target.id, owner.id);
    assert.equal(missile.followRange, -16777216, "Ballpark.cpp:3861 float sum rounds before negation");
    assert.deepEqual(Array.from(missile.mGoto), [0, 0, 0]);
    park.tickInterval = 200; park.currentTime = 14;
    park.EvolveMissile(missile); assert.deepEqual(Array.from(missile.mGoto), [0, 0, 0]);
    park.currentTime = 15; park.EvolveMissile(missile);
    near(missile.gotoX, 34.4); near(missile.gotoY, 29.2); near(missile.gotoZ, 15);
    missile.mFollowRange = -16777217;
    park.EvolveMissile(missile);
    assert.deepEqual(Array.from(missile.mGoto), [35, 30, 15]);
    park.SetMaxSpeed(missile.id, 0); park.EvolveMissile(missile);
    assert.ok(Array.from(missile.mGoto).every(value => !Number.isFinite(value)));
    vec3.copy(missile.mNewPos, target.mNewPos); park.EvolveMissile(missile);
    assert.deepEqual(Array.from(missile.mGoto), [30, 40, 0], "coincident override discards NaN prediction");
    missile.radius = 3e38; target.radius = 3e38;
    park.MissileFollow(missile.id, target.id, owner.id); park.currentTime += 5;
    park.EvolveMissile(missile);
    assert.deepEqual(Array.from(missile.mGoto), [-Infinity, NaN, NaN],
        "native Vector3d(1,0,0)*r retains zero-times-infinity components");
});

test("GotoThrust missile bypass and zero-length-underflow normalization match native", () =>
{
    const park = new Park(), ball = space(park, 1);
    park.SetBallMass(ball.id, 1e6); park.SetBallAgility(ball.id, 1); park.SetSpeedFraction(ball.id, 1);
    park.GotoThrust(ball, 1, 0, 0); near(ball.mLastG[0], 0.001);
    park.GotoThrust(ball, 1, 0, 0, true); near(ball.mLastG[0], 10);
    park.GotoThrust(ball, 1e-200, 0, 0, true);
    assert.equal(ball.mLastG[0], 1e-199, "Vector3d normalization leaves computed-zero length unchanged");
});

test("launch snapshots survive nested setter callbacks and reread target lookup", () =>
{
    const { park, target, owner, missile } = setup();
    const oldPosition = park.SetBallPosition; let replaced = null;
    park.SetBallPosition = function(id, x, y, z)
    {
        oldPosition.call(this, id, x, y, z);
        owner.mNewPos.fill(999); owner.mNewVel.fill(999);
        // Replacement creates a different pointer while preserving launch's captured one.
        this._balls.delete(target.id);
        replaced = space(this, target.id, 500);
    };
    park.LaunchMissile(missile.id, target.id, owner.id, 1, 0);
    assert.deepEqual([missile.x, missile.y, missile.z], [0, 0, 0]);
    assert.deepEqual([missile.vx, missile.vy, missile.vz], [1, 0, 0]);
    assert.equal(missile.mFollowPtr, replaced);
});

test("launch rotation scratch is pooled across reentry and exceptions", () =>
{
    const { park, target, owner, missile } = setup();
    let depth = 0, outer = null, nested = null;
    owner.GetRotatedVector = out =>
    {
        if (depth === 0)
        {
            outer = out; depth++;
            park.LaunchMissile(missile.id, target.id, owner.id, 0, 0);
            depth--; assert.notEqual(outer, nested);
            vec3.set(out, 2, 0, 0);
        }
        else { nested = out; vec3.set(out, 0, 0, -1); }
    };
    park.LaunchMissile(missile.id, target.id, owner.id, 0, 0);
    assert.equal(missile.vx, 300, "rotated local direction is widened without renormalizing");
    const alloc = vec3.alloc, unalloc = vec3.unalloc; let borrowed = 0;
    vec3.alloc = () => { borrowed++; return alloc(); };
    vec3.unalloc = value => { borrowed--; return unalloc(value); };
    owner.GetRotatedVector = () => { throw Error("rotation failed"); };
    try { assert.throws(() => park.LaunchMissile(missile.id, target.id, owner.id, 0, 0), /rotation failed/); }
    finally { vec3.alloc = alloc; vec3.unalloc = unalloc; }
    assert.equal(borrowed, 0);
});

test("target removal preserves missile velocity direction as non-massive GOTO", () =>
{
    const { park, target, owner, missile } = setup();
    park.LaunchMissile(missile.id, target.id, owner.id, 1, 0);
    park.RemoveBall(target.id);
    assert.equal(missile.mode, Mode.DSTBALL_GOTO); assert.equal(missile.isMassive, false);
    assert.equal(missile.followId, 0n); assert.equal(missile.mFollowPtr, null);
    assert.equal(missile.gotoX, 1e17); assert.equal(missile.vx, 1);
});
