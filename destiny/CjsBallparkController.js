import { meta } from "@carbonenginejs/runtime/schema";
import { CjsDestinyBall } from "./CjsDestinyBall.js";

const Mode = CjsDestinyBall.DSTBALLMODE;
const AU = 0.1495978707e12;
const ORBITAL_PRECESSION = 0.001;

// Source: destiny/src/Ballpark.h
// Source: destiny/src/Ballpark.cpp
// Source: destiny/src/Settings.h
// Source: destiny/src/Thunkers.cpp
/**
 * Temporary, single-region Ballpark movement subset. Evolve advances one second,
 * matching the donor default. Legacy orbit and non-dynamical orientation settings
 * are fixed for this first pass. No collision, bubble, wire or gameplay processing.
 */
@meta.define({ className: "CjsBallparkController", modelledOn: "Ballpark" })
export class CjsBallparkController
{
    @meta.type.int32
    time = 0;

    _balls = new Map();
    _friction = 1000000;
    _dt = 1;

    /**
     * Adds or updates a ball using Carbon's positional argument order.
     * Adaptation: explicit safe-integer IDs, finite scalar inputs and immediate
     * single-region membership. Re-adding keeps object identity and follower links.
     * JS Numbers cannot represent all native int64 IDs without loss.
     *
     * @param {number} objectId Safe-integer ball identity.
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
        if (!Number.isSafeInteger(objectId))
        {
            throw new RangeError("Ball IDs must be safe integers");
        }
        if (![mass, radius, maxVel, x, y, z, vx, vy, vz, agility, speedFraction].every(Number.isFinite)
            || ![radius, maxVel, agility, speedFraction].map(Math.fround).every(Number.isFinite))
        {
            throw new RangeError("Ball parameters must be finite and fit their native scalar types");
        }

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
        ball.followId = 0;
        ball.followRange = 10;
        ball.mode = Mode.DSTBALL_STOP;
        this.SetBallTimeFactor(ball);
        return ball;
    }

    /**
     * Returns the ball or null, without inserting a missing ID into the map.
     *
     * @param {number} id Safe-integer ball identity.
     * @returns {CjsDestinyBall|null} Live ball, or null when absent.
     */
    @meta.blue.method
    @meta.adapted
    GetBall(id)
    {
        return this._balls.get(id) ?? null;
    }

    /**
     * Adaptation: immediate removal; no delayed network tombstone or bubble cleanup.
     *
     * @param {number} id Safe-integer ball identity.
     * @returns {void} No return value.
     */
    @meta.blue.method
    @meta.adapted
    RemoveBall(id)
    {
        const ball = this.GetBall(id);
        if (!ball) return;
        this.Stop(id);
        for (const followerId of ball._followers)
        {
            this.Stop(followerId);
        }
        ball.isMoribund = true;
        this._balls.delete(id);
    }

    /**
     * Adaptation: clears this movement subset and detaches outstanding ball handles.
     *
     * @returns {void} No return value.
     */
    @meta.blue.method
    @meta.adapted
    ClearAll()
    {
        for (const id of this._balls.keys()) this.RemoveBall(id);
    }

    /**
     * Advances one native default tick. Forces are evaluated for every ball before
     * any position changes. Adaptation: no collision forces, timestamps, orientation,
     * bubbles or notifications. Invalid mobile mass and unsupported modes fail
     * before changing the tick, rather than silently simulating another behavior.
     *
     * @returns {void} No return value.
     */
    @meta.blue.method
    @meta.adapted
    Evolve()
    {
        for (const ball of this._balls.values())
        {
            if (!ball.isFree || ball.isMoribund) continue;
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
        for (const ball of this._balls.values())
        {
            if (ball.isFree && !ball.isMoribund) this.EvolveBehaviorForBall(ball);
        }
        for (const ball of this._balls.values())
        {
            if (ball.isFree && !ball.isMoribund) this.Integrate(ball);
        }
        this.time++;
    }

    /**
     * Adaptation: four supported modes, writing scalar mLastG components in place.
     *
     * @param {CjsDestinyBall} ball Ball whose existing state is read or updated.
     * @returns {void} No return value.
     */
    @meta.blue.method
    @meta.adapted
    EvolveBehaviorForBall(ball)
    {
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
                this.EvolveOrbit(ball, this.time);
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
     * Adaptation: the source-default legacy orbit is the only enabled orbit.
     *
     * @param {CjsDestinyBall} ball Ball whose existing state is read or updated.
     * @param {number} currentTime Native integer tick counter.
     * @returns {void} No return value.
     */
    @meta.blue.method
    @meta.adapted
    EvolveOrbit(ball, currentTime)
    {
        this.EvolveOldStyleOrbit(ball, currentTime);
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
        const phi2 = (ball.id & 0xffff) + currentTime * ORBITAL_PRECESSION;
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
        ball.vy = (ball.vy - 0.07 * ball.vy) * 0.9345794392523364485981308411215;
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
     * @param {number} id Safe-integer ball identity.
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
     * @param {number} id Safe-integer ball identity.
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
     * @param {number} id Safe-integer ball identity.
     * @param {number} targetId Target ball identity.
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
        if (!ball || !target || id === targetId || target.isMoribund
            || target.isCloaked || !Number.isFinite(range)) return;
        this.Stop(id);
        ball.followId = targetId;
        ball._followPtr = target;
        ball.followRange = range;
        ball.mode = Mode.DSTBALL_FOLLOW;
        target._followers.add(id);
    }

    /**
     * Adaptation: single region, native float range and target validity checks.
     *
     * @param {number} id Safe-integer ball identity.
     * @param {number} targetId Target ball identity.
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
        if (!ball || !target || id === targetId || target.isMoribund
            || target.isCloaked || !Number.isFinite(range)) return;
        this.Stop(id);
        ball.followId = targetId;
        ball._followPtr = target;
        ball.followRange = range;
        ball.mode = Mode.DSTBALL_ORBIT;
        target._followers.add(id);
    }

    /**
     * Adaptation: ID overload; no formation slots/network state. Velocity is retained.
     *
     * @param {number} id Safe-integer ball identity.
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
            ball._followPtr._followers.delete(id);
            ball._followPtr = null;
            ball.followId = 0;
            ball.followRange = 0;
        }
        ball.mode = Mode.DSTBALL_STOP;
    }

    /**
     * Adaptation: scalar old/new positions, finite input guard, no partition update.
     *
     * @param {number} id Safe-integer ball identity.
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
     * Adaptation: scalar old/new velocities, finite input guard, no orientation update.
     *
     * @param {number} id Safe-integer ball identity.
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
        ball.vx = ball._oldVx = x;
        ball.vy = ball._oldVy = y;
        ball.vz = ball._oldVz = z;
    }

    /**
     * Adaptation: finite mass guard before recomputing cached drag.
     *
     * @param {number} id Safe-integer ball identity.
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
     * @param {number} id Safe-integer ball identity.
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
     * @param {number} id Safe-integer ball identity.
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
     * @param {number} id Safe-integer ball identity.
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
     *
     * @param {number} id Safe-integer ball identity.
     * @param {number} fraction Requested fraction of maximum speed.
     * @returns {void} No return value.
     */
    @meta.blue.method
    @meta.implemented
    SetSpeedFraction(id, fraction)
    {
        const ball = this.GetBall(id);
        fraction = Math.fround(fraction);
        if (!ball || !Number.isFinite(fraction)) return;
        ball.speedFraction = Math.min(1, Math.max(0, fraction));
    }

    /**
     * Adaptation: updates movement participation without collision mini-shapes or boxes.
     *
     * @param {number} id Safe-integer ball identity.
     * @param {boolean} isFree Whether the ball can move.
     * @returns {void} No return value.
     */
    @meta.blue.method
    @meta.adapted
    SetBallFree(id, isFree)
    {
        const ball = this.GetBall(id);
        if (!ball || ball.isFree === Boolean(isFree)) return;
        ball.isFree = Boolean(isFree);
        if (!ball.isFree)
        {
            this.Stop(id);
            this.SetBallVelocity(id, 0, 0, 0);
            ball._lastGx = ball._lastGy = ball._lastGz = 0;
        }
    }
}
