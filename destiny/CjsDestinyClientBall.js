import { meta } from "@carbonenginejs/runtime/schema";
import { vec3 } from "@carbonenginejs/runtime/math/vec3";
import { quat } from "@carbonenginejs/runtime/math/quat";
import { vec3d } from "./math/vec3d.js";
import { CjsDestinyBall } from "./CjsDestinyBall.js";
import { g_useDynamicalOrientation } from "./Settings/CjsDestinyGlobalSettings.js";

// Source: destiny/src/Ball.h:395-604
// Source: destiny/src/Ball.cpp:33-59,865-901,951-1116,1208-1457
/** Carbon ClientBall position curves and legacy damped rotation curves. */
@meta.define({ className: "CjsDestinyClientBall", modelledOn: "ClientBall" })
export class CjsDestinyClientBall extends CjsDestinyBall
{
    mLastYaw = 0;
    mLastPitch = 0;
    mLastRoll = 0;
    mYawSpeed = 0;
    mPitchSpeed = 0;
    mCenterDist = -1;
    mPosUpdateTime = 0n;
    mRotUpdateTime = 0n;
    mLastRot = quat.create();
    mLastPos = vec3d.create();
    mLastVel = vec3d.create();
    mDeltaPos = vec3d.create();
    mIntAcc = vec3d.create();
    mElapsed = 0;
    mLastTick = -1;
    mShowBoxes = false;
    mProcessingImpact = false;

    /**
     * Evolves native yaw/pitch/roll and snaps the cached quaternion when requested.
     * Adaptation: runtime quaternion construction uses float32 input angles/output;
     * its scalar intermediates use JavaScript double precision.
     * @param {boolean} [snap=false] Bypass the native angle damping.
     * @returns {void} Updates orientation state in place.
     */
    @meta.adapted
    CalculateYawPitchRoll(snap = false)
    {
        super.CalculateYawPitchRoll(snap);
        if (snap)
        {
            this.mLastYaw = this.mNewYaw;
            this.mLastPitch = this.mNewPitch;
            quat.fromYawPitchRoll(this.mLastRot, Math.fround(this.mLastYaw),
                Math.fround(this.mLastPitch), Math.fround(this.mLastRoll));
        }
    }

    /**
     * Starts a new interpolation interval without resetting continuous positions.
     * Adaptation: dynamical orientation remains explicitly unsupported.
     * @returns {void} Initializes first-sample state and resets elapsed time per tick.
     */
    @meta.adapted
    InforceContinuity()
    {
        if (!this.mPark) return;
        if (g_useDynamicalOrientation) throw new Error("ClientBall dynamical orientation is not implemented");
        if (this.mLastTick !== this.mPark.currentTime)
        {
            if (this.mLastTick === -1)
            {
                vec3.copy(this.mLastPos, this.mOldPos);
                vec3.copy(this.mLastVel, this.mOldVel);
            }
            vec3.add(this.mIntAcc, this.mLastC, this.mLastG);
            this.mLastTick = this.mPark.currentTime;
            this.mElapsed = 0;
        }
    }

    /**
     * Applies Carbon's two-tick rendering delay on the same Blue-start clock.
     * Adaptation: safe Number ticks normalize to BigInt; Number never means seconds.
     * @param {number|bigint} time Elapsed 100ns ticks since the scene's Blue startup.
     * @returns {bigint} Shifted ticks, or unchanged ticks when detached.
     */
    @meta.adapted
    GetShiftedTime(time)
    {
        time = CjsDestinyBall._toInt64(time);
        return this.mPark ? time - BigInt(2 * this.mPark.tickInterval) * 10000n : time;
    }

    /**
     * Samples absolute double-precision motion using the park's fractional integrator.
     * Adaptation: output follows time, and scratch storage is reused. Warp and
     * partition debug dispatch throw until their native implementations are ported.
     * Detached-ball reporting uses console instead of a Python callback.
     * @param {number|bigint} time Scene clock in elapsed 100ns ticks.
     * @param {Float64Array} out Caller-owned absolute position.
     * @returns {Float64Array} The supplied output.
     */
    @meta.adapted
    InterpolatedPosition(time, out)
    {
        time = CjsDestinyBall._toInt64(time);
        if (!this.mPark)
        {
            console.warn("ClientBall is not in a ballpark", this.mId);
            return vec3.set(out, 0, -3.4028234663852886e38, 0);
        }
        const shiftedTime = this.GetShiftedTime(time);
        if (shiftedTime <= this.mPosUpdateTime) return vec3.copy(out, this.mLastPos);
        if (this.mOldTime === this.mNewTime)
        {
            vec3.copy(this.mLastPos, this.mNewPos);
            this.mPosUpdateTime = shiftedTime;
            return vec3.copy(out, this.mLastPos);
        }
        if (this.mMode === CjsDestinyBall.DSTBALLMODE.DSTBALL_WARP)
            throw new Error("ClientBall warp interpolation is not implemented");
        if (this.mShowBoxes) throw new Error("ClientBall partition debug dispatch is not implemented");
        this.InforceContinuity();
        const shouldUpdateDist = this.mElapsed === 0 || this.mCenterDist < 0;
        const timeStepFraction = Number(shiftedTime - this.mOldTime) / 10000000;
        if (this.mPosUpdateTime === 0n) this.mPosUpdateTime = shiftedTime;
        this.mElapsed += Number(shiftedTime - this.mPosUpdateTime) / 10000000;
        vec3.copy(this.mDeltaPos, this.mLastPos);
        vec3.copy(this.mLastPos, this.mOldPos);
        vec3.copy(this.mLastVel, this.mOldVel);
        this.mPark.CalculateBallPositionVelocity(this, timeStepFraction, this.mLastPos, this.mLastVel);
        vec3.subtract(this.mDeltaPos, this.mLastPos, this.mDeltaPos);
        this.mPosUpdateTime = shiftedTime;
        if (shouldUpdateDist && this.mId !== this.mPark.mEgo)
        {
            const { vec3d_1 } = CjsDestinyClientBall.scratch;
            this.mPark.GetReferencePoint(time, vec3d_1);
            if (vec3.squaredLength(vec3d_1) > 0) this.mCenterDist = vec3.distance(this.mLastPos, vec3d_1);
        }
        return vec3.copy(out, this.mLastPos);
    }

    /**
     * Updates either native renderer curve into caller-owned storage.
     * Adaptation: JavaScript selects the native overload by output length, 3 or 4.
     * @param {number|bigint} time Scene clock in elapsed 100ns ticks, never seconds.
     * @param {Float32Array} out Position vector or rotation quaternion.
     * @returns {Float32Array} The supplied output without allocating a result.
     */
    @meta.adapted
    Update(time, out)
    {
        return this.GetValueAt(time, out);
    }

    /**
     * Samples float32 position relative to the park reference, or native rotation.
     * Adaptation: time-first and output-length dispatch replace C++ overloads;
     * safe Number/BigInt ticks share the scene epoch. Seconds overloads are not exposed.
     * Missing-park reporting uses console instead of Python callbacks.
     * @param {number|bigint} time Scene clock in elapsed 100ns ticks.
     * @param {Float32Array} out Length-three position or length-four quaternion.
     * @returns {Float32Array} The supplied output.
     */
    @meta.adapted
    GetValueAt(time, out)
    {
        time = CjsDestinyBall._toInt64(time);
        if (out.length === 4) return this._GetRotationAt(time, out);
        if (out.length !== 3) throw new RangeError("ClientBall output must be a vec3 or quaternion");
        if (!this.mPark)
        {
            console.warn("ClientBall is not in a ballpark", this.mId);
            return vec3.set(out, 0, -3.4028234663852886e38, 0);
        }
        const ego = this.mPark.GetEgo();
        if (this === ego)
        {
            this.mCenterDist = 0;
            return vec3.set(out, 0, 0, 0);
        }
        if (!ego)
        {
            console.error("ClientBall has no valid ego");
            return vec3.set(out, 0, -3.4028234663852886e38, 0);
        }
        const { vec3d_0 } = CjsDestinyClientBall.scratch;
        this.mPark.GetReferencePoint(time, vec3d_0);
        if (this.isFree) this.InterpolatedPosition(time, this.mLastPos);
        const position = this.isFree ? this.mLastPos : this.mNewPos;
        let x = Math.fround(position[0] - vec3d_0[0]);
        let y = Math.fround(position[1] - vec3d_0[1]);
        let z = Math.fround(position[2] - vec3d_0[2]);
        if (!this.isFree && time - this.mPosUpdateTime > 10000000n)
        {
            if (vec3.squaredLength(vec3d_0) > 0)
                this.mCenterDist = Math.fround(Math.sqrt(Math.fround(
                    Math.fround(Math.fround(x * x) + Math.fround(y * y)) + Math.fround(z * z))));
            this.mPosUpdateTime = this.GetShiftedTime(time);
        }
        if (this.isGlobal)
        {
            x = Math.fround(x / this.mPark.mSomeWeirdHackToFixSomething);
            y = Math.fround(y / this.mPark.mSomeWeirdHackToFixSomething);
            z = Math.fround(z / this.mPark.mSomeWeirdHackToFixSomething);
        }
        return vec3.set(out, x, y, z);
    }

    /**
     * Returns native last velocity, or leaves quaternion derivative output untouched.
     * Adaptation: output length selects the C++ overload and Number ticks are accepted.
     * Velocity is absolute mLastVel, not relative ego velocity. Detached reporting
     * uses console instead of the native Python callback.
     * @param {number|bigint} time Scene clock in elapsed 100ns ticks.
     * @param {Float32Array} out Length-three velocity or length-four unchanged output.
     * @returns {Float32Array} The supplied output.
     */
    @meta.adapted
    GetValueDotAt(time, out)
    {
        time = CjsDestinyBall._toInt64(time);
        if (out.length === 4) return out;
        if (out.length !== 3) throw new RangeError("ClientBall output must be a vec3 or quaternion");
        if (!this.mPark)
        {
            console.warn("ClientBall is not in a ballpark", this.mId);
            return vec3.set(out, 0, 0, 0);
        }
        this.InterpolatedPosition(time, this.mLastPos);
        return vec3.set(out, Math.fround(this.mLastVel[0]), Math.fround(this.mLastVel[1]), Math.fround(this.mLastVel[2]));
    }

    /**
     * Implements the native tick quaternion overload's cache and legacy damping.
     * Adaptation: an internal method disambiguates the C++ overload. Runtime
     * quaternion helpers retain float32 results with JS double intermediates.
     * Dynamical orientation and impact rotation fail explicitly until ported.
     * @param {bigint} time Checked ticks on the scene epoch.
     * @param {Float32Array} out Caller-owned quaternion.
     * @returns {Float32Array} The supplied output.
     */
    @meta.adapted
    _GetRotationAt(time, out)
    {
        if (!this.mPark)
        {
            console.warn("ClientBall is not in a ballpark", this.mId);
            return quat.set(out, 0, 0, 0, -1);
        }
        const shiftedTime = this.GetShiftedTime(time);
        if (shiftedTime <= this.mRotUpdateTime) return quat.copy(out, this.mLastRot);
        if (!this.isFree)
        {
            quat.set(this.mLastRot, 0, 0, 0, -1);
            this.mRotUpdateTime = shiftedTime;
            return quat.copy(out, this.mLastRot);
        }
        if (this.mNewTime === this.mOldTime) return quat.copy(out, this.mLastRot);
        if (this.mProcessingImpact) throw new Error("ClientBall impact rotation is not implemented");
        this.InforceContinuity();
        if (this.mRotUpdateTime === 0n) this.mRotUpdateTime = shiftedTime;
        const dT = Number(shiftedTime - this.mRotUpdateTime) / 10000000;
        const fraction = Number(shiftedTime - this.mOldTime) / Number(this.mNewTime - this.mOldTime);
        this.mLastYaw %= 2 * Math.PI;
        this.mLastPitch %= 2 * Math.PI;
        const yaw = CjsDestinyBall._modulo2pi(this.mLastYaw, this.mOldYaw + fraction * this.mYawDelta);
        const pitch = CjsDestinyBall._modulo2pi(this.mLastPitch, this.mOldPitch + fraction * (this.mNewPitch - this.mOldPitch));
        const roll = this.mOldRoll + fraction * (this.mNewRoll - this.mOldRoll);
        const friction = this.mMode === CjsDestinyBall.DSTBALLMODE.DSTBALL_MISSILE ? 10 : 0.9;
        this.mYawSpeed = this.mLastYaw;
        this.mPitchSpeed = this.mLastPitch;
        const tmp = 1 / (1 + friction * dT);
        this.mLastYaw = (this.mLastYaw + friction * dT * yaw) * tmp;
        this.mLastPitch = (this.mLastPitch + 1.3 * friction * dT * pitch) / (1 + 1.3 * friction * dT);
        this.mLastRoll = (this.mLastRoll + friction * dT * roll) * tmp;
        this.mYawSpeed = (this.mLastYaw - this.mYawSpeed) * (1 / dT);
        this.mPitchSpeed = (this.mLastPitch - this.mPitchSpeed) * (1 / dT);
        quat.fromYawPitchRoll(this.mLastRot, Math.fround(this.mLastYaw), Math.fround(this.mLastPitch), Math.fround(this.mLastRoll));
        this.mRotUpdateTime = shiftedTime;
        return quat.copy(out, this.mLastRot);
    }

    static scratch = { vec3d_0: vec3d.create(), vec3d_1: vec3d.create() };
}
