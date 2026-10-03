import { meta } from "@carbonenginejs/runtime/schema";
import { IBlueEvents } from "@carbonenginejs/runtime/blue";
import { CjsDestinyBall } from "./CjsDestinyBall.js";

import { g_useIterativeCollision, g_useDynamicalOrientation, g_useNewOrbit,
    g_disableDynamicalOrientationForMissiles } from "./Settings/CjsDestinyGlobalSettings.js";

const Mode = CjsDestinyBall.DSTBALLMODE;
const AU = 0.1495978707e12;
const ORBITAL_PRECESSION = 0.001;

// Source: destiny/src/Ballpark.h
// Source: destiny/src/Ballpark.cpp
// Source: destiny/src/Settings.h
// Source: destiny/src/Thunkers.cpp
/**
 * Temporary, single-region Ballpark movement subset with native clock phases.
 * The cached evolution step defaults to one second. Native global settings select
 * legacy/new orbit. Dynamical orientation, collision, bubbles and wire are unported.
 */
@meta.define({ className: "CjsBallparkController", modelledOn: "Ballpark" })
@meta.blue.inherit(IBlueEvents)
export class CjsBallparkController
{
    static scratch = {
        orbitalNormal: { orbitalVector: [0, 0, 0], toVector: [0, 0, 0], dist: 0 }
    };

    mTime = 0n;
    mLocalCnt = -1n;
    mLocalHiCnt = -1073741824n;
    @meta.type.int32
    currentTime = 0;
    @meta.type.int32
    tickInterval = 1000;
    @meta.type.boolean
    isMaster = false;

    mHaveTicks = false;
    mFirstTime = true;
    inEvolve = false;
    moribundBalls = new Set();
    mMoribundBallRemovalCount = 7;
    mMoribundBallRemovalBuffer = 2;
    _blueOS = null;
    _pyOS = null;

    /**
     * Supplies the native BeOS and PyOS boundaries explicitly instead of globals.
     * Adaptation: no native lock object, CPython interpreter or automatic timer is
     * created. With no PyOS bridge there are no Python event subscribers. Native
     * timestamps are BigInts; safe integer Number inputs are accepted at boundaries.
     *
     * @param {IBlueOS|null} [blueOS=null] Host with RegisterForTicks/UnregisterForTicks; required by Start.
     * @param {Object|null} [pyOS=null] Optional native-shaped SendEvent/PyError bridge. SendEvent reports handler errors as false.
     * @returns {CjsBallparkController} An initially paused, empty simulation.
     */
    constructor(blueOS = null, pyOS = null)
    {
        this._blueOS = blueOS;
        this._pyOS = pyOS;
    }

    /**
     * Reads the exact native mTime value in 100ns units.
     * Adaptation: BigInt represents signed-int64 timestamps without Number rounding.
     *
     * @returns {bigint} Last simulation timestamp, separate from currentTime.
     */
    @meta.type.int64
    @meta.adapted
    get time()
    {
        return this.mTime;
    }

    /**
     * Writes native mTime through a checked JavaScript integer boundary.
     * Adaptation: safe Number inputs normalize to BigInt; invalid or overflowing
     * values throw instead of acquiring an already-rounded timestamp.
     *
     * @param {bigint|number} value Signed-int64 timestamp in 100ns units.
     * @returns {void} No return value.
     */
    @meta.adapted
    set time(value)
    {
        this.mTime = CjsDestinyBall._toInt64(value);
    }

    /**
     * Reads native mHaveTicks, independently of direct Evolve/OnTick calls.
     *
     * @returns {boolean} Whether Start has registered this park with its host.
     */
    @meta.type.boolean
    @meta.implemented
    get isRunning()
    {
        return this.mHaveTicks;
    }

    /**
     * Registers for native Destiny::Tick delivery, once per Start/Pause cycle.
     * Adaptation: the injected Blue host replaces native BeOS; no timer is owned here.
     *
     * @returns {void} No return value.
     * @throws {Error} If no Blue host was supplied.
     */
    @meta.blue.method
    @meta.adapted
    Start()
    {
        if (this.mHaveTicks) return;
        if (!this._blueOS) throw new Error("Start requires a Blue tick host");
        this._blueOS.RegisterForTicks(this, "Destiny::Tick");
        this.mHaveTicks = true;
    }

    /**
     * Unregisters native tick delivery without resetting clocks or first-tick state.
     * Adaptation: calls the injected Blue host. Direct Evolve/OnTick remain available.
     *
     * @returns {void} No return value.
     */
    @meta.blue.method
    @meta.adapted
    Pause()
    {
        if (!this.mHaveTicks) return;
        this._blueOS.UnregisterForTicks(this, "Destiny::Tick");
        this.mHaveTicks = false;
    }

    /**
     * Advances whole tick intervals with native first-tick and master catch-up rules.
     * Adaptation: the optional PyOS bridge replaces native Python event delivery;
     * a false SendEvent result is reported through PyError and evolution continues.
     * The host must catch handler exceptions and return false, as native PyOS does.
     * BigInt timestamps retain exact arithmetic. Invalid interval products, signed
     * clock overflow and catch-up counts outside native int32 are rejected.
     * Capsule cleanup, bubble activity and native profiling remain unported.
     *
     * @param {bigint|number} realTime Host real clock in 100ns units; unused by the donor.
     * @param {bigint|number} simTime Host simulation clock in 100ns units.
     * @param {*} cookie Registration cookie; unused by the donor.
     * @returns {void} No return value.
     */
    @meta.blue.method
    @meta.adapted
    OnTick(realTime, simTime, cookie)
    {
        simTime = CjsDestinyBall._toInt64(simTime);
        let lastDelta = CjsDestinyBall._toInt64(simTime - this.time);
        this.BringOutTheDeads();
        const interval = CjsBallparkController._tickTime(this.tickInterval);
        if (lastDelta < interval) return;
        this._dt = this.tickInterval * 0.001;
        // Native integer division: 5.9 intervals is still five, not a backlog reset.
        if (this.isMaster && lastDelta / interval > 5n)
        {
            lastDelta = interval;
        }
        if (this.mFirstTime)
        {
            this.Evolve(simTime);
            lastDelta = 0n;
            this.mFirstTime = false;
        }
        else
        {
            const count = lastDelta / interval;
            if (count > 2147483647n) throw new RangeError("Tick catch-up exceeds native int32");
            const intervals = Number(count);
            for (let i = 0; i < intervals; i++)
            {
                if (this._pyOS && !this._pyOS.SendEvent(this, "Destiny::DoPreTick",
                    "DoPreTick", null, "(i)", this.currentTime)) this._pyOS.PyError();
                this.Evolve(simTime - lastDelta);
                if (this._pyOS && !this._pyOS.SendEvent(this, "Destiny::DoPostTick",
                    "DoPostTick", null, "(i)", this.currentTime)) this._pyOS.PyError();
                lastDelta = CjsDestinyBall._toInt64(lastDelta - CjsBallparkController._tickTime(this.tickInterval));
            }
        }
        this.time = simTime - lastDelta;
    }

    /**
     * Shifts the simulation clock and nonzero ball timestamps, preserving zero sentinels.
     * Adaptation: checked BigInt arithmetic replaces native Be::Time; overflow is
     * rejected before mutating timestamps. ClientBall cache timestamps are unported.
     *
     * @param {bigint|number} timeDelta Signed clock adjustment in 100ns units.
     * @returns {void} No return value.
     */
    @meta.blue.method
    @meta.adapted
    AdjustTimes(timeDelta)
    {
        timeDelta = CjsDestinyBall._toInt64(timeDelta);
        const time = CjsDestinyBall._toInt64(this.time + timeDelta);
        for (const ball of this._balls.values())
        {
            if (ball.mNewTime !== 0n) CjsDestinyBall._toInt64(ball.mNewTime + timeDelta);
            if (ball.mOldTime !== 0n) CjsDestinyBall._toInt64(ball.mOldTime + timeDelta);
        }
        this.time = time;
        for (const ball of this._balls.values())
        {
            if (ball.mNewTime !== 0n) ball.mNewTime += timeDelta;
            if (ball.mOldTime !== 0n) ball.mOldTime += timeDelta;
        }
    }

    _balls = new Map();
    _friction = 1000000;
    _dt = 1;

    /**
     * Resolves native explicit IDs and master/replica local-allocation requests.
     * Adaptation: checked BigInt conversion replaces the native int64 argument;
     * exhausted counters throw before decrement rather than overflowing signed C++.
     * Allocation does not search for collisions with explicitly supplied IDs.
     *
     * @param {bigint|number} objectId Explicit ID or native allocation sentinel.
     * @returns {bigint} Resolved signed-int64 collision-object identity.
     */
    @meta.adapted
    GetIDForCollisionObject(objectId)
    {
        objectId = CjsDestinyBall._toInt64(objectId);
        if ((this.isMaster && objectId < 0n) || (!this.isMaster && objectId === -1n))
        {
            this.mLocalHiCnt = CjsDestinyBall._toInt64(this.mLocalHiCnt - 1n);
            return this.mLocalHiCnt;
        }
        if (this.isMaster && objectId === 0n)
        {
            this.mLocalCnt = CjsDestinyBall._toInt64(this.mLocalCnt - 1n);
            return this.mLocalCnt;
        }
        return objectId;
    }

    /**
     * Adds or updates a ball using Carbon's positional argument order.
     * Adaptation: checked BigInt IDs, finite scalar inputs and immediate
     * single-region membership. Re-adding a resolved ID keeps object identity and
     * follower links. Nonpositive IDs follow native master/replica allocation.
     *
     * @param {bigint|number} objectId Signed-int64 identity or allocation sentinel; Number inputs must be safe integers.
     * @param {number} mass Mass in kilograms.
     * @param {number} radius Radius in meters.
     * @param {number} maxVel Maximum speed in meters per second.
     * @param {boolean} isFree Whether the ball can move.
     * @param {boolean} isGlobal Native global-visibility flag.
     * @param {boolean} isMassive Native collision participation flag; currently retained as data.
     * @param {boolean} isInteractive Native interactive-population flag.
     * @param {boolean} isSpaceJunk Native space-junk flag.
     * @param {number} x Position component in meters.
     * @param {number} y Position component in meters.
     * @param {number} z Position component in meters.
     * @param {number} vx Velocity component in meters per second.
     * @param {number} vy Velocity component in meters per second.
     * @param {number} vz Velocity component in meters per second.
     * @param {number} agility Native positive mass/agility multiplier.
     * @param {number} speedFraction Initial fraction of maximum speed.
     * @returns {CjsDestinyBall} Created or updated live ball.
     * @throws {RangeError} If the ID or scalar inputs cannot be represented safely.
     */
    @meta.blue.method
    @meta.adapted
    AddBall(objectId, mass, radius, maxVel, isFree, isGlobal, isMassive,
        isInteractive, isSpaceJunk, x, y, z, vx, vy, vz, agility, speedFraction)
    {
        objectId = CjsDestinyBall._toInt64(objectId);
        if (![mass, radius, maxVel, x, y, z, vx, vy, vz, agility, speedFraction].every(Number.isFinite)
            || ![radius, maxVel, agility, speedFraction].map(Math.fround).every(Number.isFinite))
        {
            throw new RangeError("Ball parameters must be finite and fit their native scalar types");
        }

        objectId = this.GetIDForCollisionObject(objectId);
        let ball = this._balls.get(objectId);
        const created = !ball;
        if (created)
        {
            ball = new CjsDestinyBall();
            ball.id = objectId;
            this._balls.set(objectId, ball);
        }
        else
        {
            this.Stop(objectId);
        }
        ball.x = x;
        ball.y = y;
        ball.z = z;
        ball.vx = vx;
        ball.vy = vy;
        ball.vz = vz;
        if (created)
        {
            ball._oldX = x - this._dt * vx;
            ball._oldY = y - this._dt * vy;
            ball._oldZ = z - this._dt * vz;
            ball._oldVx = vx;
            ball._oldVy = vy;
            ball._oldVz = vz;
        }
        ball.mass = Math.max(0, mass);
        ball.radius = Math.fround(Math.max(0, radius));
        ball.maxVelocity = Math.fround(Math.max(0, maxVel));
        ball.agility = Math.fround(agility <= 0 ? 1 : agility);
        ball.speedFraction = Math.fround(Math.max(0, speedFraction));
        ball.isFree = Boolean(isFree);
        ball.isGlobal = Boolean(isGlobal);
        ball.isMassive = Boolean(isMassive);
        ball.isInteractive = Boolean(isInteractive);
        ball.isSpaceJunk = Boolean(isSpaceJunk);
        ball.isMoribund = false;
        this.moribundBalls.delete(ball);
        ball.mEffectStamp = 0;
        ball.followId = 0n;
        ball.followRange = 10;
        ball.mode = Mode.DSTBALL_STOP;
        this.SetBallTimeFactor(ball);
        return ball;
    }

    /**
     * Returns the ball or null, without inserting a missing ID into the map.
     * Adaptation: checked IDs normalize Number and BigInt inputs to one map key.
     *
     * @param {bigint|number} id Signed-int64 ball identity; Number inputs must be safe integers.
     * @returns {CjsDestinyBall|null} Live ball, or null when absent.
     */
    @meta.blue.method
    @meta.adapted
    GetBall(id)
    {
        return this._balls.get(CjsDestinyBall._toInt64(id)) ?? null;
    }

    /**
     * Detaches followers; interactive orbiters and missiles retain their velocity direction.
     * Adaptation: JS IDs and scalar velocities replace native map/vector arguments.
     * The copied Set replaces a native unordered set; invalid links are removed
     * without native logging. Missile steering itself remains unported.
     *
     * @param {CjsDestinyBall|null} ball Target whose incoming follower links are detached.
     * @returns {void} No return value.
     */
    @meta.adapted
    StopAllFollowers(ball)
    {
        if (!ball) return;
        for (const id of Array.from(ball._followers))
        {
            const follower = this.GetBall(id);
            if (!follower || follower.followId !== ball.id || follower._followPtr !== ball)
            {
                ball._followers.delete(id);
                continue;
            }
            if (follower.mode === Mode.DSTBALL_MISSILE
                || (follower.isInteractive && follower.mode === Mode.DSTBALL_ORBIT))
            {
                if (follower.mode === Mode.DSTBALL_MISSILE) follower.isMassive = false;
                this.GotoDirection(id, follower.vx, follower.vy, follower.vz);
            }
            else this.Stop(id);
        }
    }

    /**
     * Detaches follower orders, then removes the ball now or queues native delayed cleanup.
     * Adaptation: JS retains object references and uses an optional PyOS bridge for
     * DoFinalCleanup. Mini-shapes, collision caches, boxes and bubbles remain unported.
     *
     * @param {bigint|number} id Signed-int64 ball identity; Number inputs must be safe integers.
     * @param {number} [delay=0] Tick delay before buffered cleanup.
     * @returns {void} No return value.
     */
    @meta.blue.method
    @meta.adapted
    RemoveBall(id, delay = 0)
    {
        const ball = this.GetBall(id);
        if (!ball) return;
        this.Stop(id);
        this.StopAllFollowers(ball);
        ball.isMoribund = true;
        if (this.inEvolve || delay > 0)
        {
            ball.isMassive = false;
            ball.mEffectStamp = this.currentTime + delay;
            this.moribundBalls.add(ball);
            return;
        }
        if (this._pyOS && !this._pyOS.SendEvent(ball, "Destiny::Ball::DoFinalCleanup",
            "DoFinalCleanup", null, "()")) this._pyOS.PyError();
        this.moribundBalls.delete(ball);
        this._balls.delete(ball.id);
    }

    /**
     * Clears owned balls without final-cleanup events or changing the clocks.
     * Adaptation: clears JS references, including pending deletions, and detaches
     * outstanding handles; native owner/refcount teardown has no JS equivalent.
     *
     * @returns {void} No return value.
     */
    @meta.blue.method
    @meta.adapted
    ClearAll()
    {
        // ClearAll does not send per-ball final-cleanup events in Carbon.
        // JS handles remain live, so detach their follower links explicitly.
        for (const ball of this._balls.values())
        {
            this.Stop(ball.id);
            ball.isMoribund = true;
        }
        this._balls.clear();
        this.moribundBalls.clear();
        this.mLocalCnt = -1n;
        this.mLocalHiCnt = -1073741824n;
    }


    /**
     * Runs deferred cleanup before tick eligibility, unless evolution is active.
     * Adaptation: only balls exist in this subset; capsule cleanup is unported.
     *
     * @returns {void} No return value.
     */
    @meta.adapted
    BringOutTheDeads()
    {
        if (this.inEvolve) return;
        this.BringOutDeadBalls();
    }

    /**
     * Removes expired balls without a cap and buffered balls up to the configured limit (default seven).
     * Adaptation: a JS Set replaces the native unordered pointer set; selection
     * among equally eligible buffered balls follows insertion order. Invalid queue
     * records are discarded without native logging. Shape cleanup remains unported.
     *
     * @returns {void} No return value.
     */
    @meta.adapted
    BringOutDeadBalls()
    {
        let killCounter = 0;
        const toDelete = [];
        for (const ball of this.moribundBalls)
        {
            if (!ball || !ball.isMoribund || ball.mEffectStamp - this.currentTime < 0)
            {
                toDelete.push(ball);
            }
            else if (ball.mEffectStamp - this.currentTime - this.mMoribundBallRemovalBuffer < 0
                && killCounter < this.mMoribundBallRemovalCount)
            {
                toDelete.push(ball);
                killCounter++;
            }
        }
        for (const ball of toDelete)
        {
            if (ball && ball.isMoribund) this.RemoveBall(ball.id);
            this.moribundBalls.delete(ball);
        }
    }

    /**
     * Advances one cached simulation step and increments currentTime, not time.
     * Forces are evaluated before positions. Adaptation: the default timestamp of
     * zero follows the Python Evolve wrapper; no collision forces or orientation,
     * bubbles or notifications. Invalid mobile mass and unsupported modes fail
     * before changing the tick, rather than silently simulating another behavior.
     * JS exceptions release inEvolve with finally so callbacks cannot strand cleanup.
     * Timestamp conversion and signed-int64 initialization overflow are checked before movement.
     * Selected iterative collisions or dynamical orientation throw before movement
     * until those native algorithms are ported; configuration itself still accepts them.
     *
     * @param {bigint|number} [timestamp=0n] New ball timestamp in 100ns units; zero preserves ball timestamps.
     * @throws {RangeError} If a mobile mass/agility is invalid.
     * @throws {Error} If an active ball uses an unported mode.
     * @returns {void} No return value.
     */
    @meta.blue.method
    @meta.adapted
    Evolve(timestamp = 0n)
    {
        timestamp = CjsDestinyBall._toInt64(timestamp);
        if (g_useIterativeCollision) throw new Error("Iterative collision response is not implemented");
        for (const ball of this._balls.values())
        {
            if (!ball.isFree || ball.isMoribund) continue;
            if (g_useDynamicalOrientation && !DynamicalOrientationDisabledForBall(ball))
            {
                throw new Error("Dynamical orientation evolution is not implemented");
            }
            if (timestamp !== 0n && ball.mNewTime === 0n)
            {
                CjsDestinyBall._toInt64(timestamp - CjsBallparkController._tickTime(this.tickInterval));
            }
            if (!(ball.mass > 0) || !(ball.agility > 0)
                || !Number.isFinite(ball.mass * ball.agility))
            {
                throw new RangeError(`Mobile ball ${ball.id} requires positive finite mass and agility`);
            }
            if (ball.mode !== Mode.DSTBALL_STOP && ball.mode !== Mode.DSTBALL_GOTO
                && ball.mode !== Mode.DSTBALL_FOLLOW && ball.mode !== Mode.DSTBALL_ORBIT)
            {
                throw new Error(`Destiny mode ${ball.mode} is not implemented`);
            }
        }
        this.inEvolve = true;
        try
        {
            for (const ball of this._balls.values())
            {
                if (ball.isFree && !ball.isMoribund) this.EvolveBehaviorForBall(ball);
            }
            for (const ball of this._balls.values())
            {
                if (ball.isFree && !ball.isMoribund) this.Integrate(ball);
            }
            // Carbon completes integration for every ball before updating timestamps.
            if (timestamp !== 0n)
            {
                for (const ball of this._balls.values())
                {
                    if (!ball.isFree || ball.isMoribund) continue;
                    ball.mOldTime = ball.mNewTime === 0n
                        ? timestamp - CjsBallparkController._tickTime(this.tickInterval) : ball.mNewTime;
                    ball.mNewTime = timestamp;
                }
            }
            this.currentTime++;
        }
        finally
        {
            // JS callbacks can throw; never leave the deletion semaphore stuck.
            this.inEvolve = false;
        }
    }

    /**
     * Adaptation: four supported modes, writing scalar mLastG components in place.
     * The native dynamical thrust/torque branch throws until orientation is ported.
     *
     * @param {CjsDestinyBall} ball Ball whose existing state is read or updated.
     * @returns {void} No return value.
     */
    @meta.blue.method
    @meta.adapted
    EvolveBehaviorForBall(ball)
    {
        if (g_useDynamicalOrientation && !DynamicalOrientationDisabledForBall(ball))
        {
            throw new Error("Dynamical orientation thrust and torque are not implemented");
        }
        ball._lastGx = 0;
        ball._lastGy = 0;
        ball._lastGz = 0;
        switch (ball.mode)
        {
            case Mode.DSTBALL_GOTO:
                this.EvolveGoto(ball);
                break;
            case Mode.DSTBALL_FOLLOW:
                this.EvolveFollow(ball);
                break;
            case Mode.DSTBALL_ORBIT:
                this.EvolveOrbit(ball, this.currentTime);
                break;
            case Mode.DSTBALL_STOP:
                this.EvolveStop(ball);
                break;
            default:
                throw new Error(`Destiny mode ${ball.mode} is not implemented`);
        }
    }

    /**
     * Adaptation: mLastG output replaces the native Vector3d return.
     *
     * @param {CjsDestinyBall} ball Ball whose existing state is read or updated.
     * @returns {void} No return value.
     */
    @meta.blue.method
    @meta.adapted
    EvolveGoto(ball)
    {
        this.GotoThrust(ball, ball.gotoX, ball.gotoY, ball.gotoZ);
    }

    /**
     * Surface separation includes both radii; scalar output replaces Vector3d.
     *
     * @param {CjsDestinyBall} ball Ball whose existing state is read or updated.
     * @returns {void} No return value.
     */
    @meta.blue.method
    @meta.adapted
    EvolveFollow(ball)
    {
        const other = ball._followPtr;
        const dx = ball.x - other.x;
        const dy = ball.y - other.y;
        const dz = ball.z - other.z;
        const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
        const radius = ball.followRange + ball.radius + other.radius;
        ball.gotoX = other.x + (distance === 0 ? radius : dx * radius / distance);
        ball.gotoY = other.y + (distance === 0 ? 0 : dy * radius / distance);
        ball.gotoZ = other.z + (distance === 0 ? 0 : dz * radius / distance);
        this.GotoThrust(ball, ball.gotoX, ball.gotoY, ball.gotoZ);
    }

    /**
     * Selects the native legacy or new orbit from the live global setting.
     * Adaptation: each branch writes scalar mLastG output instead of returning Vector3d.
     *
     * @param {CjsDestinyBall} ball Ball whose existing state is read or updated.
     * @param {number} currentTime Native integer tick counter.
     * @returns {void} No return value.
     */
    @meta.blue.method
    @meta.adapted
    EvolveOrbit(ball, currentTime)
    {
        if (g_useNewOrbit) this.EvolveNewStyleOrbit(ball, currentTime);
        else this.EvolveOldStyleOrbit(ball, currentTime);
    }

    /**
     * Calculates the native precessing fallback plane from the park counter and ID.
     * Adaptation: caller-owned f64 Number output replaces the Vector3d return.
     *
     * @param {CjsDestinyBall} ball Ball whose low sixteen ID bits seed the plane.
     * @param {number[]} out Three-component destination for the orbital normal.
     * @returns {number[]} The supplied destination, truncated to seven decimals.
     */
    @meta.adapted
    DefaultOrbitalNormal(ball, out)
    {
        const phi1 = this.currentTime * ORBITAL_PRECESSION;
        const phi2 = Number(ball.id & 0xffffn) + this.currentTime * ORBITAL_PRECESSION;
        const x = Math.trunc(Math.cos(phi1) * Math.cos(phi2) * 1e7) / 1e7;
        const y = Math.trunc(Math.sin(phi2) * 1e7) / 1e7;
        const z = Math.trunc(Math.sin(phi1) * Math.cos(phi2) * 1e7) / 1e7;
        out[0] = x;
        out[1] = y;
        out[2] = z;
        return out;
    }

    /**
     * Finds the native orbital plane and predicted target direction and distance.
     * Adaptation: out combines the Vector3d return with native toVector/dist refs;
     * Number arrays preserve f64. Null/non-orbit leaves toVector/dist untouched.
     * The dynamical-heading fallback throws until native orientation is ported.
     *
     * @param {CjsDestinyBall|null} ball Orbiting ball, or null.
     * @param {{orbitalVector:number[],toVector:number[],dist:number}} out Caller-owned result storage.
     * @returns {Object} The supplied result record.
     */
    @meta.adapted
    GetOrbitalNormal(ball, out)
    {
        if (!ball || ball.mode !== Mode.DSTBALL_ORBIT)
        {
            out.orbitalVector[0] = out.orbitalVector[1] = out.orbitalVector[2] = 0;
            return out;
        }
        const other = ball._followPtr;
        let tx = other.x - ball.x, ty = other.y - ball.y, tz = other.z - ball.z;
        if (g_useNewOrbit)
        {
            tx += other.vx * this._dt;
            ty += other.vy * this._dt;
            tz += other.vz * this._dt;
        }
        const dist = Math.sqrt(tx * tx + ty * ty + tz * tz);
        if (dist > 0)
        {
            const inverse = 1 / dist;
            tx *= inverse; ty *= inverse; tz *= inverse;
        }
        else
        {
            tx = ty = 0; tz = 1;
        }
        let nx = ty * ball.vz - tz * ball.vy;
        let ny = tz * ball.vx - tx * ball.vz;
        let nz = tx * ball.vy - ty * ball.vx;
        const length2 = nx * nx + ny * ny + nz * nz;
        if (g_useNewOrbit && !(length2 > 1e-12) && g_useDynamicalOrientation)
        {
            throw new Error("GetOrbitalNormal dynamical heading fallback is not implemented");
        }
        out.toVector[0] = tx; out.toVector[1] = ty; out.toVector[2] = tz;
        out.dist = dist;
        if (!g_useNewOrbit || !(length2 > 1e-12))
        {
            this.DefaultOrbitalNormal(ball, out.orbitalVector);
        }
        else
        {
            const inverse = 1 / Math.sqrt(length2);
            nx *= inverse; ny *= inverse; nz *= inverse;
            out.orbitalVector[0] = nx;
            out.orbitalVector[1] = ny;
            out.orbitalVector[2] = nz;
        }
        return out;
    }

    /**
     * Follows the native exponential-spiral orbit trajectory and velocity target.
     * Adaptation: scalar f64 temporaries and mLastG output replace native vectors;
     * shared scratch is consumed before the thrust call and never returned.
     * The donor ignores currentTime here; its fallback plane reads park.currentTime.
     * The zero-speed 0/0 goto quirk at Ballpark.cpp:1174-1223 is retained.
     *
     * @param {CjsDestinyBall} ball Orbiting ball with a valid target link.
     * @param {number} currentTime Native argument, unused by this algorithm.
     * @returns {void} No return value; updates goto and mLastG scalar fields.
     */
    @meta.adapted
    EvolveNewStyleOrbit(ball, currentTime)
    {
        const cruiseVelocity = ball.speedFraction * ball.maxVelocity;
        const tau = (ball.mass * ball.agility) / this._friction;
        const maxThrust = cruiseVelocity / tau;
        const other = ball._followPtr;
        const r = ball.followRange + ball.radius + other.radius;
        const { orbitalNormal } = CjsBallparkController.scratch;
        this.GetOrbitalNormal(ball, orbitalNormal);
        const tx = orbitalNormal.toVector[0], ty = orbitalNormal.toVector[1], tz = orbitalNormal.toVector[2];
        const nx = orbitalNormal.orbitalVector[0], ny = orbitalNormal.orbitalVector[1], nz = orbitalNormal.orbitalVector[2];
        let dist = orbitalNormal.dist;
        let rx = ny * tz - nz * ty, ry = nz * tx - nx * tz, rz = nx * ty - ny * tx;
        const radialLength = Math.sqrt(rx * rx + ry * ry + rz * rz);
        if (radialLength !== 0)
        {
            const inverse = 1 / radialLength;
            rx *= inverse; ry *= inverse; rz *= inverse;
        }
        const currentSpeed = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy + ball.vz * ball.vz);
        // std::max/min retain the first operand when comparison with NaN is false.
        const maxSpeed = cruiseVelocity < currentSpeed ? currentSpeed : cruiseVelocity;
        let angle = 0.1 * (r - dist) / maxSpeed;
        if (angle < -1) angle = -1;
        if (angle > 1) angle = 1;
        if (dist < 0.1) dist = 0.1;
        const maxVelocity = Math.sqrt(dist * maxThrust);
        const estimatedVelocity = maxVelocity < maxSpeed ? maxVelocity : maxSpeed;
        const estimatedDistance = estimatedVelocity * this._dt;
        let px, py, pz, vx, vy, vz;
        if (Math.abs(angle) < 1e-10)
        {
            const t = estimatedDistance / dist;
            const pTo = dist * (1 - Math.cos(t)), pRadial = dist * Math.sin(t);
            px = tx * pTo + rx * pRadial;
            py = ty * pTo + ry * pRadial;
            pz = tz * pTo + rz * pRadial;
            const vRadial = Math.cos(t) * estimatedVelocity, vTo = Math.sin(t) * estimatedVelocity;
            vx = rx * vRadial + tx * vTo;
            vy = ry * vRadial + ty * vTo;
            vz = rz * vRadial + tz * vTo;
        }
        else
        {
            const factor = estimatedDistance * angle / dist / Math.sqrt(angle * angle + 1);
            const t = factor < -0.999 ? Math.log(0.001) / angle
                : (Math.abs(factor) > 1e-10 ? Math.log(1 + factor) / angle : factor / angle);
            const dexp = dist * Math.exp(angle * t);
            const pTo = dist - dexp * Math.cos(t), pRadial = dexp * Math.sin(t);
            px = tx * pTo + rx * pRadial;
            py = ty * pTo + ry * pRadial;
            pz = tz * pTo + rz * pRadial;
            const vTo = -angle * Math.cos(t) + Math.sin(t), vRadial = angle * Math.sin(t) + Math.cos(t);
            vx = tx * vTo + rx * vRadial;
            vy = ty * vTo + ry * vRadial;
            vz = tz * vTo + rz * vRadial;
            const length = Math.sqrt(vx * vx + vy * vy + vz * vz);
            if (length !== 0)
            {
                const inverse = 1 / length;
                vx *= inverse; vy *= inverse; vz *= inverse;
            }
            vx *= estimatedVelocity; vy *= estimatedVelocity; vz *= estimatedVelocity;
        }
        ball.gotoX = ball.x + px;
        ball.gotoY = ball.y + py;
        ball.gotoZ = ball.z + pz;
        this.GotoThrustFollow(ball, ball.gotoX, ball.gotoY, ball.gotoZ,
            vx + other.vx, vy + other.vy, vz + other.vz, 1);
    }

    /**
     * Computes native damped arrival thrust for slow new-orbit targets.
     * Adaptation: scalar target and mLastG fields replace Vector3d arguments/return.
     * The donor's exact 0.1 deadband and one-second cap thresholds are retained.
     *
     * @param {CjsDestinyBall} ball Ball whose current state is read.
     * @param {number} x Target X position in meters.
     * @param {number} y Target Y position in meters.
     * @param {number} z Target Z position in meters.
     * @returns {void} No return value; writes the thrust components.
     */
    @meta.adapted
    OrbitThrust(ball, x, y, z)
    {
        const f = this._friction / (ball.mass * ball.agility);
        const maxAccel = f * ball.speedFraction * ball.maxVelocity;
        if (maxAccel <= 0)
        {
            ball._lastGx = ball._lastGy = ball._lastGz = 0;
            return;
        }
        let ax = (x - ball.x) * f - ball.vx;
        let ay = (y - ball.y) * f - ball.vy;
        let az = (z - ball.z) * f - ball.vz;
        const tacc = Math.sqrt(ax * ax + ay * ay + az * az) / maxAccel;
        if (tacc > 1)
        {
            const inverse = 1 / tacc;
            ax *= inverse; ay *= inverse; az *= inverse;
        }
        if (tacc < 0.1) ax = ay = az = 0;
        ball._lastGx = ax; ball._lastGy = ay; ball._lastGz = az;
    }

    /**
     * Blends native position-derived and velocity-derived acceleration under a cap.
     * Adaptation: scalar targets/velocity and mLastG output replace native Vector3d.
     * Denominators retain native arithmetic, without epsilon or expm1 substitutions.
     *
     * @param {CjsDestinyBall} ball Ball whose existing state is read.
     * @param {number} x Target X position in meters.
     * @param {number} y Target Y position in meters.
     * @param {number} z Target Z position in meters.
     * @param {number} vx Desired X velocity in meters per second.
     * @param {number} vy Desired Y velocity in meters per second.
     * @param {number} vz Desired Z velocity in meters per second.
     * @param {number} weight Native relative weight of velocity-derived acceleration.
     * @returns {void} No return value; writes the thrust components.
     */
    @meta.adapted
    GotoThrustFollow(ball, x, y, z, vx, vy, vz, weight)
    {
        const speed = Math.sqrt(vx * vx + vy * vy + vz * vz);
        if (speed < 5e-2 * ball.maxVelocity * ball.speedFraction)
        {
            if (g_useNewOrbit && ball.mode === Mode.DSTBALL_ORBIT) this.OrbitThrust(ball, x, y, z);
            else this.GotoThrust(ball, x, y, z);
            return;
        }
        const f = this._friction / (ball.mass * ball.agility);
        const maxAccel = f * ball.speedFraction * ball.maxVelocity;
        if (maxAccel <= 0)
        {
            ball._lastGx = ball._lastGy = ball._lastGz = 0;
            return;
        }
        const tf = ball._timeFactor, inversePosition = 1 / (this._dt * f - (1 - tf));
        let ax = ((x - ball.x) * f - ball.vx * (1 - tf)) * f * inversePosition;
        let ay = ((y - ball.y) * f - ball.vy * (1 - tf)) * f * inversePosition;
        let az = ((z - ball.z) * f - ball.vz * (1 - tf)) * f * inversePosition;
        const inverseVelocity = 1 / (1 - tf);
        const avx = (vx - ball.vx * tf) * f * inverseVelocity;
        const avy = (vy - ball.vy * tf) * f * inverseVelocity;
        const avz = (vz - ball.vz * tf) * f * inverseVelocity;
        const inverseWeight = 1 / (1 + weight);
        ax = (ax + weight * avx) * inverseWeight;
        ay = (ay + weight * avy) * inverseWeight;
        az = (az + weight * avz) * inverseWeight;
        const accel = ax * ax + ay * ay + az * az;
        if (accel > maxAccel * maxAccel)
        {
            const factor = maxAccel / Math.sqrt(accel);
            ax *= factor; ay *= factor; az *= factor;
        }
        ball._lastGx = ax; ball._lastGy = ay; ball._lastGz = az;
    }

    /**
     * Source legacy orbit, including ID-dependent plane and seven-decimal
     * truncation. Adaptation: scalar mLastG output; a coincident, zero-radius
     * orbit has zero thrust instead of the donor's undefined 0/0 tangent
     * (bug in Ballpark.cpp:1287-1294).
     *
     * @param {CjsDestinyBall} ball Ball whose existing state is read or updated.
     * @param {number} currentTime Native integer tick counter.
     * @returns {void} No return value.
     */
    @meta.blue.method
    @meta.adapted
    EvolveOldStyleOrbit(ball, currentTime)
    {
        const other = ball._followPtr;
        const r = ball.followRange + ball.radius + other.radius;
        let tx = other.x - ball.x;
        let ty = other.y - ball.y;
        let tz = other.z - ball.z;
        const dist = Math.sqrt(tx * tx + ty * ty + tz * tz);
        if (dist > 0)
        {
            const inverse = 1 / dist;
            tx *= inverse;
            ty *= inverse;
            tz *= inverse;
        }
        const phi1 = currentTime * ORBITAL_PRECESSION;
        const phi2 = Number(ball.id & 0xffffn) + currentTime * ORBITAL_PRECESSION;
        const nx = Math.trunc(Math.cos(phi1) * Math.cos(phi2) * 1e7) / 1e7;
        const ny = Math.trunc(Math.sin(phi2) * 1e7) / 1e7;
        const nz = Math.trunc(Math.sin(phi1) * Math.cos(phi2) * 1e7) / 1e7;
        let rx = ny * tz - nz * ty;
        let ry = nz * tx - nx * tz;
        let rz = nx * ty - ny * tx;
        const radialLength = Math.sqrt(rx * rx + ry * ry + rz * rz);
        if (radialLength > 0)
        {
            const inverse = 1 / radialLength;
            rx *= inverse;
            ry *= inverse;
            rz *= inverse;
        }
        const toComp = dist * dist - r * r;
        if (toComp >= 0 && dist > 0)
        {
            const radComp = r * Math.sqrt(toComp) / dist;
            const toward = toComp / dist;
            tx = toward * tx + radComp * rx;
            ty = toward * ty + radComp * ry;
            tz = toward * tz + radComp * rz;
            const length = Math.sqrt(tx * tx + ty * ty + tz * tz);
            if (length > 0)
            {
                const inverse = 1 / length;
                tx *= inverse;
                ty *= inverse;
                tz *= inverse;
            }
        }
        const radialFactor = Math.trunc(Math.exp(-(r - dist) * (r - dist) / 40000) * 1e7) / 1e7;
        const cosine = -(tx * rx + ty * ry + tz * rz);
        const determinant = 1 + radialFactor * radialFactor * (cosine * cosine - 1);
        let transverse = radialFactor * cosine + (determinant > 0 ? Math.sqrt(determinant) : 0);
        transverse *= dist - r >= 0 ? 1 : -1;
        const cruiseVelocity = ball.speedFraction * ball.maxVelocity;
        const maxThrust = this._friction * cruiseVelocity / (ball.mass * ball.agility);
        ball._lastGx = (radialFactor * rx + transverse * tx) * maxThrust;
        ball._lastGy = (radialFactor * ry + transverse * ty) * maxThrust;
        ball._lastGz = (radialFactor * rz + transverse * tz) * maxThrust;
        ball.gotoX = ball.x + 10 * AU * ball._lastGx;
        ball.gotoY = ball.y + 10 * AU * ball._lastGy;
        ball.gotoZ = ball.z + 10 * AU * ball._lastGz;
    }

    /**
     * Preserves the vertical damping quirk in Ballpark.cpp:1339-1345 with
     * dynamical orientation disabled. X and Z receive only normal drag.
     *
     * @param {CjsDestinyBall} ball Ball whose existing state is read or updated.
     * @returns {void} No return value.
     */
    @meta.blue.method
    @meta.implemented
    EvolveStop(ball)
    {
        if (!g_useDynamicalOrientation)
        {
            ball.vy = (ball.vy - 0.07 * ball.vy) * 0.9345794392523364485981308411215;
        }
    }

    /**
     * Adaptation: f64 scalar target and mLastG output; missile mode is excluded.
     *
     * @param {CjsDestinyBall} ball Ball whose existing state is read or updated.
     * @param {number} x Position component in meters.
     * @param {number} y Position component in meters.
     * @param {number} z Position component in meters.
     * @returns {void} No return value.
     */
    @meta.blue.method
    @meta.adapted
    GotoThrust(ball, x, y, z)
    {
        const dx = x - ball.x;
        const dy = y - ball.y;
        const dz = z - ball.z;
        const length2 = dx * dx + dy * dy + dz * dz;
        const dist = ball.speedFraction * ball.maxVelocity * this._dt;
        let thrust = this._friction * ball.speedFraction * ball.maxVelocity / (ball.mass * ball.agility);
        if (length2 < dist * dist)
        {
            const coefficient = length2 / (dist * dist);
            thrust *= coefficient * coefficient;
        }
        const inverseLength = length2 === 0 ? 0 : 1 / Math.sqrt(length2);
        ball._lastGx = dx * inverseLength * thrust;
        ball._lastGy = dy * inverseLength * thrust;
        ball._lastGz = dz * inverseLength * thrust;
    }

    /**
     * Exact native drag integration at the fixed tick, including its small-k
     * branch. Adaptation: ball/scalar input and in-place old/new state, no collision
     * acceleration or fractional interpolation. Force evaluation already finished.
     *
     * @param {CjsDestinyBall} ball Ball whose existing state is read or updated.
     * @returns {void} No return value.
     */
    @meta.blue.method
    @meta.adapted
    Integrate(ball)
    {
        const m = ball.mass * ball.agility;
        const k = this._friction;
        const t = this._dt;
        const factor = ball._timeFactor;
        const k2 = k * k;
        const inverseK2 = 1 / k2;
        const inverseK = 1 / k;
        ball._oldX = ball.x;
        ball._oldY = ball.y;
        ball._oldZ = ball.z;
        ball._oldVx = ball.vx;
        ball._oldVy = ball.vy;
        ball._oldVz = ball.vz;
        if (k < 1e-10 * m * t)
        {
            ball.x = (m * (ball._lastGx * (-k * t) + k * (ball._lastGx * t + ball.vx * k / m * t)) + ball.x * k2) * inverseK2;
            ball.y = (m * (ball._lastGy * (-k * t) + k * (ball._lastGy * t + ball.vy * k / m * t)) + ball.y * k2) * inverseK2;
            ball.z = (m * (ball._lastGz * (-k * t) + k * (ball._lastGz * t + ball.vz * k / m * t)) + ball.z * k2) * inverseK2;
        }
        else
        {
            ball.x = (m * (m * ball._lastGx * (factor - 1) + k * (ball._lastGx * t + ball.vx - factor * ball.vx)) + ball.x * k2) * inverseK2;
            ball.y = (m * (m * ball._lastGy * (factor - 1) + k * (ball._lastGy * t + ball.vy - factor * ball.vy)) + ball.y * k2) * inverseK2;
            ball.z = (m * (m * ball._lastGz * (factor - 1) + k * (ball._lastGz * t + ball.vz - factor * ball.vz)) + ball.z * k2) * inverseK2;
        }
        ball.vx = (m * ball._lastGx - (m * ball._lastGx - ball.vx * k) * factor) * inverseK;
        ball.vy = (m * ball._lastGy - (m * ball._lastGy - ball.vy * k) * factor) * inverseK;
        ball.vz = (m * ball._lastGz - (m * ball._lastGz - ball.vz * k) * factor) * inverseK;
    }

    /**
     * Adaptation: ID overload only; same finite-target guard and restart at zero throttle.
     *
     * @param {bigint|number} id Signed-int64 ball identity; Number inputs must be safe integers.
     * @param {number} x Position component in meters.
     * @param {number} y Position component in meters.
     * @param {number} z Position component in meters.
     * @returns {void} No return value.
     */
    @meta.blue.method
    @meta.adapted
    GotoPoint(id, x, y, z)
    {
        const ball = this.GetBall(id);
        if (!ball || ![x, y, z].every(Number.isFinite)) return;
        this.Stop(id);
        ball.gotoX = x;
        ball.gotoY = y;
        ball.gotoZ = z;
        if (ball.speedFraction === 0) ball.speedFraction = 1;
        ball.mode = Mode.DSTBALL_GOTO;
    }

    /**
     * Adaptation: ID overload; keeps Carbon's distant target (1e17 units).
     *
     * @param {bigint|number} id Signed-int64 ball identity; Number inputs must be safe integers.
     * @param {number} x Direction component.
     * @param {number} y Direction component.
     * @param {number} z Direction component.
     * @returns {void} No return value.
     */
    @meta.blue.method
    @meta.adapted
    GotoDirection(id, x, y, z)
    {
        const ball = this.GetBall(id);
        if (!ball || ![x, y, z].every(Number.isFinite)) return;
        const length = Math.sqrt(x * x + y * y + z * z);
        const inverse = length === 0 ? 0 : 1 / length;
        this.GotoPoint(id, ball.x + x * inverse * 1e17, ball.y + y * inverse * 1e17, ball.z + z * inverse * 1e17);
    }

    /**
     * Adaptation: all balls share one region; native target validity checks retained.
     *
     * @param {bigint|number} id Signed-int64 ball identity; Number inputs must be safe integers.
     * @param {bigint|number} targetId Signed-int64 target identity; Number inputs must be safe integers.
     * @param {number} [range] Surface separation in meters.
     * @returns {void} No return value.
     */
    @meta.blue.method
    @meta.adapted
    FollowBall(id, targetId, range = 1)
    {
        const ball = this.GetBall(id);
        const target = this.GetBall(targetId);
        range = Math.fround(range);
        if (!ball || !target || ball === target || target.isMoribund
            || target.isCloaked || !Number.isFinite(range)) return;
        this.Stop(id);
        ball.followId = target.id;
        ball._followPtr = target;
        ball.followRange = range;
        ball.mode = Mode.DSTBALL_FOLLOW;
        target._followers.add(ball.id);
    }

    /**
     * Adaptation: single region, native float range and target validity checks.
     *
     * @param {bigint|number} id Signed-int64 ball identity; Number inputs must be safe integers.
     * @param {bigint|number} targetId Signed-int64 target identity; Number inputs must be safe integers.
     * @param {number} [range] Surface separation in meters.
     * @returns {void} No return value.
     */
    @meta.blue.method
    @meta.adapted
    Orbit(id, targetId, range = 1)
    {
        const ball = this.GetBall(id);
        const target = this.GetBall(targetId);
        range = Math.fround(range);
        if (!ball || !target || ball === target || target.isMoribund
            || target.isCloaked || !Number.isFinite(range)) return;
        this.Stop(id);
        ball.followId = target.id;
        ball._followPtr = target;
        ball.followRange = range;
        ball.mode = Mode.DSTBALL_ORBIT;
        target._followers.add(ball.id);
    }

    /**
     * Adaptation: ID overload; no formation slots/network state. Velocity is retained.
     *
     * @param {bigint|number} id Signed-int64 ball identity; Number inputs must be safe integers.
     * @returns {void} No return value.
     */
    @meta.blue.method
    @meta.adapted
    Stop(id)
    {
        const ball = this.GetBall(id);
        if (!ball) return;
        if (ball._followPtr)
        {
            ball._followPtr._followers.delete(ball.id);
            ball._followPtr = null;
            ball.followId = 0n;
            ball.followRange = 0;
        }
        ball.mode = Mode.DSTBALL_STOP;
    }

    /**
     * Adaptation: scalar old/new positions, finite input guard, no partition update.
     *
     * @param {bigint|number} id Signed-int64 ball identity; Number inputs must be safe integers.
     * @param {number} x Position component in meters.
     * @param {number} y Position component in meters.
     * @param {number} z Position component in meters.
     * @returns {void} No return value.
     */
    @meta.blue.method
    @meta.adapted
    SetBallPosition(id, x, y, z)
    {
        const ball = this.GetBall(id);
        if (!ball || ![x, y, z].every(Number.isFinite)) return;
        ball.x = ball._oldX = x;
        ball.y = ball._oldY = y;
        ball.z = ball._oldZ = z;
    }

    /**
     * Adaptation: scalar old/new velocities and finite input guard; selecting native
     * dynamical SnapOrientation throws before velocity mutation until it is ported.
     * Legacy heading output remains unported.
     *
     * @param {bigint|number} id Signed-int64 ball identity; Number inputs must be safe integers.
     * @param {number} x Velocity component in meters per second.
     * @param {number} y Velocity component in meters per second.
     * @param {number} z Velocity component in meters per second.
     * @returns {void} No return value.
     */
    @meta.blue.method
    @meta.adapted
    SetBallVelocity(id, x, y, z)
    {
        const ball = this.GetBall(id);
        if (!ball || ![x, y, z].every(Number.isFinite)) return;
        if (g_useDynamicalOrientation) throw new Error("Dynamical SnapOrientation is not implemented");
        ball.vx = ball._oldVx = x;
        ball.vy = ball._oldVy = y;
        ball.vz = ball._oldVz = z;
    }

    /**
     * Adaptation: finite mass guard before recomputing cached drag.
     *
     * @param {bigint|number} id Signed-int64 ball identity; Number inputs must be safe integers.
     * @param {number} mass Mass in kilograms.
     * @returns {void} No return value.
     */
    @meta.blue.method
    @meta.adapted
    SetBallMass(id, mass)
    {
        const ball = this.GetBall(id);
        if (!ball || !Number.isFinite(mass) || mass <= 0) return;
        ball.mass = mass;
        this.SetBallTimeFactor(ball);
    }

    /**
     * Adaptation: finite native f32 input guard; no spatial partition update.
     *
     * @param {bigint|number} id Signed-int64 ball identity; Number inputs must be safe integers.
     * @param {number} radius Radius in meters.
     * @returns {void} No return value.
     */
    @meta.blue.method
    @meta.adapted
    SetBallRadius(id, radius)
    {
        const ball = this.GetBall(id);
        radius = Math.fround(radius);
        if (!ball || !Number.isFinite(radius) || radius < 0) return;
        ball.radius = radius;
    }

    /**
     * Adaptation: finite native f32 input guard; no spatial partition update.
     *
     * @param {bigint|number} id Signed-int64 ball identity; Number inputs must be safe integers.
     * @param {number} speed Maximum speed in meters per second.
     * @returns {void} No return value.
     */
    @meta.blue.method
    @meta.adapted
    SetMaxSpeed(id, speed)
    {
        const ball = this.GetBall(id);
        speed = Math.fround(speed);
        if (!ball || !Number.isFinite(speed) || speed < 0) return;
        ball.maxVelocity = speed;
    }

    /**
     * Adaptation: finite native f32 input guard before recomputing cached drag.
     *
     * @param {bigint|number} id Signed-int64 ball identity; Number inputs must be safe integers.
     * @param {number} agility Native positive mass/agility multiplier.
     * @returns {void} No return value.
     */
    @meta.blue.method
    @meta.adapted
    SetBallAgility(id, agility)
    {
        const ball = this.GetBall(id);
        agility = Math.fround(agility);
        if (!ball || !Number.isFinite(agility) || agility <= 0) return;
        ball.agility = agility;
        this.SetBallTimeFactor(ball);
    }

    /**
     * Computes the native cached drag factor.
     *
     * @param {CjsDestinyBall} ball Ball whose existing state is read or updated.
     * @returns {void} No return value.
     */
    @meta.blue.method
    @meta.implemented
    SetBallTimeFactor(ball)
    {
        const mass = ball.mass * ball.agility;
        ball._timeFactor = mass <= 0 ? 0 : Math.exp(-this._friction * this._dt / mass);
    }

    /**
     * Native throttle clamp; f32 conversion models the native argument type.
     * Adaptation: GetBall checks and normalizes JavaScript ID inputs.
     *
     * @param {bigint|number} id Signed-int64 ball identity; Number inputs must be safe integers.
     * @param {number} fraction Requested fraction of maximum speed.
     * @returns {void} No return value.
     */
    @meta.blue.method
    @meta.adapted
    SetSpeedFraction(id, fraction)
    {
        const ball = this.GetBall(id);
        fraction = Math.fround(fraction);
        if (!ball || !Number.isFinite(fraction)) return;
        ball.speedFraction = Math.min(1, Math.max(0, fraction));
    }

    /**
     * Adaptation: updates movement participation without collision mini-shapes or boxes;
     * checked BigInt timestamp subtraction rejects signed overflow before changing the flag.
     * Disabling a ball with dynamical orientation throws before mutation because the
     * required SetBallVelocity/SnapOrientation path is unported.
     *
     * @param {bigint|number} id Signed-int64 ball identity; Number inputs must be safe integers.
     * @param {boolean} isFree Whether the ball can move.
     * @returns {void} No return value.
     */
    @meta.blue.method
    @meta.adapted
    SetBallFree(id, isFree)
    {
        const ball = this.GetBall(id);
        if (!ball || ball.isFree === Boolean(isFree)) return;
        if (!isFree && g_useDynamicalOrientation) throw new Error("Dynamical SnapOrientation is not implemented");
        const newTime = isFree ? CjsDestinyBall._toInt64(this.time - CjsBallparkController._tickTime(this.tickInterval)) : ball.mNewTime;
        ball.isFree = Boolean(isFree);
        if (ball.isFree)
        {
            ball.mNewTime = newTime;
        }
        else
        {
            this.Stop(id);
            this.SetBallVelocity(id, 0, 0, 0);
            ball._lastGx = ball._lastGy = ball._lastGz = 0;
        }
    }

    /**
     * Converts native int milliseconds to exact 100ns ticks for the private clock path.
     * JS adaptation: rejects nonpositive intervals and products outside signed int32;
     * the donor divides by this int product and supplies no portable overflow behavior.
     *
     * @param {number} interval Positive millisecond interval whose product fits native int32.
     * @returns {bigint} Exact interval in 100ns units.
     * @throws {RangeError} If interval arithmetic is outside the supported native domain.
     */
    @meta.ours
    static _tickTime(interval)
    {
        if (!Number.isInteger(interval) || interval <= 0 || interval > 214748)
        {
            throw new RangeError("Tick interval must be positive integer milliseconds with an int32 100ns product");
        }
        return BigInt(interval) * 10000n;
    }
}

/**
 * Applies the native missile-only exception to dynamical orientation.
 *
 * @param {CjsDestinyBall} ball Ball whose native movement mode is inspected.
 * @returns {boolean} Whether this ball bypasses dynamical orientation.
 */
function DynamicalOrientationDisabledForBall(ball)
{
    return g_disableDynamicalOrientationForMissiles && ball.mode === Mode.DSTBALL_MISSILE;
}
