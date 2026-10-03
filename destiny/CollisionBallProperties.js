import { meta } from "@carbonenginejs/runtime/schema";
import { vec3 } from "@carbonenginejs/runtime/math/vec3";
import { quat } from "@carbonenginejs/runtime/math/quat";
import { vec3d } from "./math/vec3d.js";
import { BallLocation } from "./CollisionStructures.js";
import { CjsDestinyBall } from "./CjsDestinyBall.js";
import { g_useDynamicalOrientation } from "./Settings/CjsDestinyGlobalSettings.js";

const f32 = Math.fround;

// Source: destiny/src/CollisionBallProperties.h
// Source: destiny/src/CollisionBallProperties.cpp
/**
 * Native ordered collision history and fractional physical-state sampling.
 * Adaptation: records retain their owned math storage in an instance-local pool
 * instead of reserving a C++ vector capacity. Times are undefined until Initialize
 * because native construction leaves them indeterminate. Removed records must
 * not be retained by callers; reused slots are reset as freshly constructed values.
 */
@meta.define({ className: "CollisionBallProperties", carbon: "CollisionBallProperties" })
export class CollisionBallProperties
{
    m_fuzzyDelta = 1e-4;
    m_ball = null;
    m_locations = [];
    m_maxTime = undefined;
    m_tStart = undefined;
    m_tEnd = undefined;
    m_tau = -1;
    _locationPool = [];

    /**
     * Replaces history with the current ball state and an integrated endpoint.
     * Adaptation: pooled temporary force replaces native Vector3d addition;
     * float intermediates retain the native angular time-constant calculation.
     * Surviving angular slots and m_tau remain untouched when orientation is off.
     * Source: destiny/src/CollisionBallProperties.cpp:15-52.
     * @param {CjsDestinyBall} ball Attached ball, borrowed for subsequent integration.
     * @param {number} tEnd End of this history interval in seconds.
     * @returns {void} Invalidates history without returning previous colliders.
     */
    @meta.adapted
    Initialize(ball, tEnd)
    {
        this.m_ball = ball;
        this.m_maxTime = tEnd;
        this.m_tStart = 0;
        this.m_tEnd = tEnd;
        if (g_useDynamicalOrientation)
            this.m_tau = f32(f32(f32(f32(ball.mMass) * ball.mAgility) * ball.mRotAgility) / f32(ball.mPark.mFriction));
        CollisionBallProperties._resizeLocations(this, 2);
        const first = this.m_locations[0], last = this.m_locations[1];
        first.time = 0;
        first.collider = -1n;
        vec3.copy(first.p, ball.mNewPos);
        vec3.copy(first.v, ball.mNewVel);
        last.time = tEnd;
        last.collider = -1n;
        vec3.copy(last.p, first.p);
        vec3.copy(last.v, first.v);
        const vec3d_0 = vec3d.alloc();
        try
        {
            vec3.add(vec3d_0, ball.mLastG, ball.mLastC);
            ball.mPark.Integrate(last.p, last.v, vec3d_0, ball.mMass * ball.mAgility,
                ball.mPark.mFriction, ball.mTimeFactor, tEnd);
        }
        finally { vec3d.unalloc(vec3d_0); }
        if (g_useDynamicalOrientation)
        {
            quat.copy(first.rot, ball.mNewRot);
            vec3.copy(first.omega, ball.mNewAngVel);
            quat.copy(last.rot, first.rot);
            vec3.copy(last.omega, first.omega);
            // Native quirk: elapsed seconds are passed as ApplyTorque's fraction,
            // which multiplies by park.dt again (Ballpark.cpp:1936-1942).
            ball.mPark.ApplyTorque(last.rot, last.omega, ball.mTorque, ball.mRoll, this.m_tau, f32(this.m_tEnd));
        }
    }

    /**
     * Inserts an impact, invalidating strictly later collisions in reverse order.
     * Adaptation: the returned array owns [time, BigInt ID] pairs, replacing a
     * value-returned vector; nested invalidations cannot overwrite that array.
     * Checked BigInt normalization preserves one representation of the native ID.
     * Source: destiny/src/CollisionBallProperties.cpp:55-117.
     * @param {CollisionImpact} impact Applied linear/angular changes and collision time.
     * @returns {Array<Array<number|bigint>>} Later collisions, newest first; caller owns the result.
     */
    @meta.adapted
    AddImpact(impact)
    {
        const invalidated = [];
        if (this.m_tEnd <= impact.timeOfImpact) return invalidated;
        const collider = CjsDestinyBall._toInt64(impact.collider);
        let index = this.m_locations.length;
        for (; index > 0; --index)
        {
            const location = this.m_locations[index - 1];
            if (impact.timeOfImpact >= location.time) break;
            if (location.collider !== -1n) invalidated.push([location.time, location.collider]);
        }
        CollisionBallProperties._resizeLocations(this, index + 1);
        const current = this.m_locations[index], ball = this.m_ball;
        current.collider = collider;
        current.time = impact.timeOfImpact;
        if (index === 0)
        {
            vec3.copy(current.p, ball.mNewPos);
            vec3.add(current.v, ball.mNewVel, impact.velocityChange);
            if (g_useDynamicalOrientation)
            {
                quat.copy(current.rot, ball.mNewRot);
                vec3.add(current.omega, ball.mNewAngVel, impact.angularVelocityChange);
            }
        }
        else
        {
            const previous = this.m_locations[index - 1];
            vec3.copy(current.p, previous.p);
            vec3.copy(current.v, previous.v);
            const vec3d_0 = vec3d.alloc();
            try
            {
                vec3.add(vec3d_0, ball.mLastG, ball.mLastC);
                ball.mPark.Integrate(current.p, current.v, vec3d_0, ball.mMass * ball.mAgility,
                    ball.mPark.mFriction, ball.mTimeFactor, current.time - previous.time);
            }
            finally { vec3d.unalloc(vec3d_0); }
            vec3.add(current.v, current.v, impact.velocityChange);
            if (g_useDynamicalOrientation)
            {
                quat.copy(current.rot, previous.rot);
                vec3.copy(current.omega, previous.omega);
                ball.mPark.ApplyTorque(current.rot, current.omega, ball.mTorque, ball.mRoll,
                    this.m_tau, f32(current.time - previous.time));
                vec3.add(current.omega, current.omega, impact.angularVelocityChange);
            }
        }
        this.m_tEnd = impact.timeOfImpact;
        return invalidated;
    }

    /**
     * Removes the first fuzzy-matching impact and reports later collisions in order.
     * Adaptation: returns owned [time, BigInt ID] pairs and normalizes the native ID.
     * Native bug: found starts true, so a missing match still resets index zero.
     * Source: destiny/src/CollisionBallProperties.cpp:120-165, especially126.
     * @param {number} time Collision time in seconds.
     * @param {bigint|number} collider Signed-int64 collision identity.
     * @returns {Array<Array<number|bigint>>} Later collisions in chronological order.
     */
    @meta.adapted
    RemoveImpact(time, collider)
    {
        collider = CjsDestinyBall._toInt64(collider);
        const invalidated = [];
        let index = 0;
        for (let i = 0; i < this.m_locations.length; ++i)
        {
            const location = this.m_locations[i];
            if (location.collider === collider && Math.abs(location.time - time) < this.m_fuzzyDelta)
            {
                index = i;
                break;
            }
        }
        if (index === 0)
        {
            const first = this.m_locations[0];
            first.collider = -1n;
            vec3.copy(first.v, this.m_ball.mNewVel);
            if (g_useDynamicalOrientation) vec3.copy(first.omega, this.m_ball.mNewAngVel);
        }
        for (let i = index + 1; i < this.m_locations.length; ++i)
        {
            const location = this.m_locations[i];
            if (location.collider !== -1n) invalidated.push([location.time, location.collider]);
        }
        CollisionBallProperties._resizeLocations(this, index > 0 ? index : 1);
        this.CalculateEnd();
        return invalidated;
    }

    /**
     * Appends and integrates a final location only when the current tail is earlier.
     * Adaptation: stable JS records avoid native vector reference invalidation;
     * pooled force storage is balanced even if integration throws.
     * Source: destiny/src/CollisionBallProperties.cpp:168-195.
     * @returns {void} Updates search times only when an endpoint is appended.
     */
    @meta.adapted
    CalculateEnd()
    {
        const previous = this.m_locations[this.m_locations.length - 1];
        if (!(this.m_maxTime > previous.time)) return;
        CollisionBallProperties._resizeLocations(this, this.m_locations.length + 1);
        const current = this.m_locations[this.m_locations.length - 1], ball = this.m_ball;
        current.time = this.m_maxTime;
        vec3.copy(current.p, previous.p);
        vec3.copy(current.v, previous.v);
        const vec3d_0 = vec3d.alloc();
        try
        {
            vec3.add(vec3d_0, ball.mLastG, ball.mLastC);
            ball.mPark.Integrate(current.p, current.v, vec3d_0, ball.mMass * ball.mAgility,
                ball.mPark.mFriction, ball.mTimeFactor, this.m_maxTime - previous.time);
        }
        finally { vec3d.unalloc(vec3d_0); }
        if (g_useDynamicalOrientation)
        {
            quat.copy(current.rot, previous.rot);
            vec3.copy(current.omega, previous.omega);
            ball.mPark.ApplyTorque(current.rot, current.omega, ball.mTorque, ball.mRoll,
                this.m_tau, f32(this.m_maxTime - previous.time));
        }
        this.m_tEnd = this.m_maxTime;
        this.m_tStart = previous.time;
    }

    /**
     * Checks the penultimate location's fuzzy window for an already involved collider.
     * Adaptation: checked BigInt input replaces the native int64 argument.
     * Source: destiny/src/CollisionBallProperties.cpp:198-213.
     * @param {bigint|number} colliderID Collider to find.
     * @param {number} timeOfImpact Fraction of the current search interval, not absolute time.
     * @returns {boolean} Whether this near-start collision should be ignored.
     */
    @meta.adapted
    IgnoreCollision(colliderID, timeOfImpact)
    {
        colliderID = CjsDestinyBall._toInt64(colliderID);
        if (this.m_locations.length < 2 || timeOfImpact > this.m_fuzzyDelta) return false;
        let index = this.m_locations.length - 2;
        const lowerBound = this.m_locations[index].time - this.m_fuzzyDelta;
        for (; index >= 0; --index)
        {
            const location = this.m_locations[index];
            if (location.time < lowerBound) break;
            if (location.collider === colliderID) return true;
        }
        return false;
    }

    /**
     * Finds the segment preceding the first location within the fuzzy boundary.
     * Source: destiny/src/CollisionBallProperties.cpp:216-227.
     * @param {number} time Sample time in seconds; extrapolation is permitted.
     * @returns {number} Native zero-based index, including zero for an empty history.
     */
    @meta.implemented
    FindLocationsIndex(time)
    {
        let index = 0;
        while (index < this.m_locations.length && this.m_locations[index].time + this.m_fuzzyDelta < time) ++index;
        if (index !== 0) --index;
        return index;
    }

    /**
     * Samples position and velocity with the native inclusive integration threshold.
     * Adaptation: independent pooled values protect output aliases and reentrant
     * integrator calls; caller outputs are written after all computation.
     * Source: destiny/src/CollisionBallProperties.cpp:230-244.
     * @param {Float64Array|number[]} position Caller-owned position output.
     * @param {Float64Array|number[]} velocity Caller-owned velocity output.
     * @param {number} time Sample time in seconds, not clamped to the history.
     * @returns {void} Writes the two outputs; all temporary vectors are returned.
     */
    @meta.adapted
    CalculatePosition(position, velocity, time)
    {
        const location = this.m_locations[this.FindLocationsIndex(time)];
        const delta = time - location.time, ball = this.m_ball;
        const vec3d_0 = vec3d.alloc(), vec3d_1 = vec3d.alloc(), vec3d_2 = vec3d.alloc();
        try
        {
            vec3.copy(vec3d_0, location.p);
            vec3.copy(vec3d_1, location.v);
            if (Math.abs(delta) >= this.m_fuzzyDelta)
            {
                vec3.add(vec3d_2, ball.mLastG, ball.mLastC);
                ball.mPark.Integrate(vec3d_0, vec3d_1, vec3d_2, ball.mMass * ball.mAgility,
                    ball.mPark.mFriction, ball.mTimeFactor, delta);
            }
            vec3.copy(position, vec3d_0);
            vec3.copy(velocity, vec3d_1);
        }
        finally
        {
            vec3d.unalloc(vec3d_0);
            vec3d.unalloc(vec3d_1);
            vec3d.unalloc(vec3d_2);
        }
    }

    /**
     * Samples angular state with the native strict integration threshold.
     * Adaptation: pooled outputs are copied back last, including on aliasing;
     * elapsed seconds remain the native ApplyTorque fraction without correction.
     * Source: destiny/src/CollisionBallProperties.cpp:247-259.
     * @param {Float32Array} rotation Caller-owned quaternion output.
     * @param {Float32Array} omega Caller-owned angular velocity output.
     * @param {number} time Sample time in seconds, with native extrapolation.
     * @returns {void} Writes angular state and releases temporary storage.
     */
    @meta.adapted
    CalculateRotation(rotation, omega, time)
    {
        const location = this.m_locations[this.FindLocationsIndex(time)];
        const delta = time - location.time, ball = this.m_ball;
        const quat_0 = quat.alloc(), vec3_0 = vec3.alloc();
        try
        {
            quat.copy(quat_0, location.rot);
            vec3.copy(vec3_0, location.omega);
            if (Math.abs(delta) > this.m_fuzzyDelta)
                ball.mPark.ApplyTorque(quat_0, vec3_0, ball.mTorque, ball.mRoll, this.m_tau, f32(delta));
            quat.copy(rotation, quat_0);
            vec3.copy(omega, vec3_0);
        }
        finally
        {
            quat.unalloc(quat_0);
            vec3.unalloc(vec3_0);
        }
    }

    /**
     * Models std::vector resize and default reconstruction with retained JS storage.
     * Ours: JavaScript arrays have no reserve or value-construction operation.
     * Existing entries survive unchanged; regrown entries reset every native field.
     * @param {CollisionBallProperties} owner History whose storage is resized.
     * @param {number} size New number of live records.
     * @returns {void} Keeps discarded records private for later reuse.
     */
    @meta.ours
    static _resizeLocations(owner, size)
    {
        while (owner.m_locations.length > size) owner._locationPool.push(owner.m_locations.pop());
        while (owner.m_locations.length < size)
        {
            const location = owner._locationPool.pop() || new BallLocation();
            location.time = -1;
            location.collider = -1n;
            vec3.zero(location.p);
            vec3.zero(location.v);
            vec3.zero(location.omega);
            quat.identity(location.rot);
            owner.m_locations.push(location);
        }
    }
}
