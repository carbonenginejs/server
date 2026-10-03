import { meta } from "@carbonenginejs/runtime/schema";
import { vec3 } from "@carbonenginejs/runtime/math/vec3";
import { quat } from "@carbonenginejs/runtime/math/quat";
import { vec3d } from "./math/vec3d.js";
import { CjsDestinyBall } from "./CjsDestinyBall.js";
import { g_useDynamicalOrientation, g_useIterativeCollision } from "./Settings/CjsDestinyGlobalSettings.js";

const f32 = Math.fround;

// Source: destiny/src/Ball.h:395-604
// Source: destiny/src/Ball.cpp:33-59,865-901,951-1116,1208-1457
// Source: destiny/src/Ball.cpp:1469-1487,1927-1935,2000-2124
// Source: destiny/src/Ball_Blue.cpp:538-616
/** Carbon ClientBall motion curves, legacy orientation and derived impact rotation. */
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
    mBoxList = Array(27).fill(0);
    mProcessingImpact = false;
    mLastSpeed = quat.create();
    mLastAngVel = vec3.create();
    mInvInertiaTensor = -1;
    mMaxAngularVelocity = f32(0.5 * f32(Math.PI));
    mMaxAngle = f32(0.25);
    mImpactRotation = quat.create();
    mCurrentVelocityInfluence = 1;
    // Native scalar is uninitialized until the first growth-phase ProcessImpact.
    mImpactRotationDeterioration = NaN;
    mImpactVelocityAtImpact = quat.create();
    mImpactVelocity = quat.create();
    mImpactVelocityGoal = quat.create();
    mRotationAtVelocityPeak = quat.create();
    mVelocityAtVelocityPeak = quat.create();
    mVelocityGoalAtVelocityPeak = quat.create();
    mSpeedModifier = 10;
    mMinimumAngularVelocity = f32(0.01);

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
     * Adaptation: separate class scratch composes the native quaternion derivative.
     * @returns {void} Initializes first-sample state and resets elapsed time per tick.
     */
    @meta.adapted
    InforceContinuity()
    {
        if (!this.mPark) return;
        if (this.mLastTick !== this.mPark.currentTime)
        {
            if (this.mLastTick === -1)
            {
                vec3.copy(this.mLastPos, this.mOldPos);
                vec3.copy(this.mLastVel, this.mOldVel);
                if (g_useDynamicalOrientation)
                {
                    quat.copy(this.mLastRot, this.mOldRot);
                    const { quat_0, quat_1 } = CjsDestinyClientBall.scratch;
                    quat.scale(quat_0, this.mLastRot, 0.5);
                    quat.set(quat_1, this.mOldAngVel[0], this.mOldAngVel[1], this.mOldAngVel[2], 0);
                    // Carbon 0.5 * rotation * omega: gl reverses the product.
                    quat.multiply(this.mLastSpeed, quat_1, quat_0);
                }
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
     * Adaptation: output follows time, and scratch storage is reused. Warp
     * sampling throws until its native implementation is ported.
     * Detached-ball reporting invokes the shared native callback as a JS function.
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
            this.RegisterBallNotInPark();
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
        if (this.mShowBoxes) this.DispatchPartition();
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
     * Missing-park reporting invokes the shared native callback as a JS function.
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
            this.RegisterBallNotInPark();
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
        // Partition events may synchronously sample another ball using this scratch.
        const referenceX = vec3d_0[0], referenceY = vec3d_0[1], referenceZ = vec3d_0[2];
        if (this.isFree) this.InterpolatedPosition(time, this.mLastPos);
        const position = this.isFree ? this.mLastPos : this.mNewPos;
        let x = Math.fround(position[0] - referenceX);
        let y = Math.fround(position[1] - referenceY);
        let z = Math.fround(position[2] - referenceZ);
        if (!this.isFree && time - this.mPosUpdateTime > 10000000n)
        {
            if (referenceX * referenceX + referenceY * referenceY + referenceZ * referenceZ > 0)
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
     * invokes the shared native callback as a JS function.
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
            this.RegisterBallNotInPark();
            return vec3.set(out, 0, 0, 0);
        }
        this.InterpolatedPosition(time, this.mLastPos);
        return vec3.set(out, Math.fround(this.mLastVel[0]), Math.fround(this.mLastVel[1]), Math.fround(this.mLastVel[2]));
    }

    /**
     * Implements the native tick quaternion overload's cache and legacy damping.
     * Adaptation: an internal method disambiguates the C++ overload. Runtime
     * quaternion helpers retain float32 results with JS double intermediates.
     * Dynamic sampling integrates from old physical samples and bypasses impact rotation.
     * @param {bigint} time Checked ticks on the scene epoch.
     * @param {Float32Array} out Caller-owned quaternion.
     * @returns {Float32Array} The supplied output.
     */
    @meta.adapted
    _GetRotationAt(time, out)
    {
        if (!this.mPark)
        {
            this.RegisterBallNotInPark();
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
        this.InforceContinuity();
        if (this.mRotUpdateTime === 0n) this.mRotUpdateTime = shiftedTime;
        const dT = Number(shiftedTime - this.mRotUpdateTime) / 10000000;
        const fraction = Number(shiftedTime - this.mOldTime) / Number(this.mNewTime - this.mOldTime);
        if (g_useDynamicalOrientation)
        {
            vec3.copy(this.mLastAngVel, this.mOldAngVel);
            quat.copy(this.mLastRot, this.mOldRot);
            if (g_useIterativeCollision)
                this.mPark.CalculateBallRotationVelocity(this, fraction, this.mLastRot, this.mLastAngVel);
            else
            {
                const tau = f32(f32(f32(f32(this.mMass) * this.mAgility) * this.mRotAgility) / f32(this.mPark.mFriction));
                this.mPark.ApplyTorque(this.mLastRot, this.mLastAngVel, this.mTorque, this.mRoll, tau, f32(fraction));
            }
            const { quat_0, quat_1 } = CjsDestinyClientBall.scratch;
            quat.scale(quat_0, this.mLastRot, 0.5);
            quat.set(quat_1, this.mLastAngVel[0], this.mLastAngVel[1], this.mLastAngVel[2], 0);
            // Carbon 0.5 * rotation * omega: gl reverses the product.
            quat.multiply(this.mLastSpeed, quat_1, quat_0);
            this.mRotUpdateTime = shiftedTime;
            return quat.copy(out, this.mLastRot);
        }
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
        if (this.mProcessingImpact) this.ProcessImpact(f32(dT));
        this.mRotUpdateTime = shiftedTime;
        return quat.copy(out, this.mLastRot);
    }

    /**
     * Preserves Carbon's intentional curve-set compatibility no-op.
     * Source: destiny/src/Ball.h:516.
     * @param {number} time Unused curve-set time in seconds.
     * @returns {void} No state changes.
     */
    @meta.implemented
    UpdateValue(time)
    {
    }

    /**
     * Samples the position curve, then returns Carbon's cached positional delta.
     * Adaptation: time precedes output and the native void method returns out.
     * Ego, fixed and detached paths retain stale delta when GetValueAt does not
     * interpolate; no fallback delta is invented.
     * Source: destiny/src/Ball.cpp:1194-1200.
     * @param {number|bigint} time Scene clock in elapsed 100ns ticks.
     * @param {Float32Array} out Caller-owned three-component delta.
     * @returns {Float32Array} The supplied output, rounded to float32.
     */
    @meta.adapted
    GetDelta(time, out)
    {
        this.GetValueAt(time, out);
        return vec3.set(out, f32(this.mDeltaPos[0]), f32(this.mDeltaPos[1]), f32(this.mDeltaPos[2]));
    }

    /**
     * Delegates native reference lookup, leaving detached output unchanged.
     * Adaptation: time-first JS order and checked Number-to-BigInt tick conversion.
     * Source: destiny/src/Ball.cpp:1927-1935.
     * @param {number|bigint} time Scene clock in elapsed 100ns ticks.
     * @param {Float64Array} out Caller-owned absolute reference point.
     * @returns {Float64Array} The supplied output.
     */
    @meta.adapted
    GetReferencePoint(time, out)
    {
        time = CjsDestinyBall._toInt64(time);
        if (this.mPark) this.mPark.GetReferencePoint(time, out);
        return out;
    }

    /**
     * Returns native finite-difference acceleration, or preserves quaternion output.
     * Adaptation: output length selects the native overload; Number ticks are
     * checked but do not trigger interpolation. Detached reporting uses the shared JS callback.
     * Source: destiny/src/Ball.cpp:1469-1487; destiny/src/Ball.h:552-560.
     * @param {number|bigint} time Scene ticks, unused by the native calculation.
     * @param {Float32Array} out Three-component acceleration or unchanged quaternion.
     * @returns {Float32Array} The supplied output.
     */
    @meta.adapted
    GetValueDoubleDotAt(time, out)
    {
        CjsDestinyBall._toInt64(time);
        if (out.length === 4) return out;
        if (out.length !== 3) throw new RangeError("ClientBall output must be a vec3 or quaternion");
        if (!this.mPark)
        {
            this.RegisterBallNotInPark();
            return vec3.set(out, 0, 0, 0);
        }
        const inverseTime = 1 / this.mPark.dt;
        const x = f32((this.mNewVel[0] - this.mOldVel[0]) * inverseTime);
        const y = f32((this.mNewVel[1] - this.mOldVel[1]) * inverseTime);
        const z = f32((this.mNewVel[2] - this.mOldVel[2]) * inverseTime);
        return vec3.set(out, x, y, z);
    }

    /**
     * Reports native partition debug geometry relative to the sampled position.
     * Adaptation: the park's optional PyOS bridge replaces Python delivery; the
     * persistent integer list replaces its reusable PyList. With no bridge there
     * are no subscribers. The host must consume the list before a later dispatch.
     * Source: destiny/src/Ball.cpp:1951-1974.
     * @returns {void} Sends the native DoPartition event when a bridge is attached.
     */
    @meta.adapted
    DispatchPartition()
    {
        for (let i = 0; i < 27; ++i) this.mBoxList[i] = Number(this.mActiveBoxes[i]);
        const park = this.mPark, box = this.mMyBox;
        if (park._pyOS && !park._pyOS.SendEvent(this, "Destiny::Ball::DoPartition", "DoPartition", null, "fffffffO",
            box.lo[0] - this.mLastPos[0], box.lo[1] - this.mLastPos[1], box.lo[2] - this.mLastPos[2],
            box.hi[0] - this.mLastPos[0], box.hi[1] - this.mLastPos[1], box.hi[2] - this.mLastPos[2],
            this.mRadius + park.dt * vec3.length(this.mNewVel), this.mBoxList)) park._pyOS.PyError();
    }

    /**
     * Returns native partition debug geometry relative to the current endpoint.
     * Adaptation: the exposed Blue spelling replaces PyGetPartitionBoxes; an owned
     * JS tuple/list replaces Py_BuildValue and its newly allocated flag list.
     * Source: destiny/src/Ball.cpp:1979-1995.
     * @returns {Array} Low/high coordinates, inflated radius and 27 integer flags.
     */
    @meta.blue.method
    @meta.adapted
    GetPartitionBoxes()
    {
        const box = this.mMyBox;
        const flags = this.mActiveBoxes.map(Number);
        return [box.lo[0] - this.mNewPos[0], box.lo[1] - this.mNewPos[1], box.lo[2] - this.mNewPos[2],
            box.hi[0] - this.mNewPos[0], box.hi[1] - this.mNewPos[1], box.hi[2] - this.mNewPos[2],
            this.mRadius + this.mPark.dt * vec3.length(this.mNewVel), flags];
    }

    /**
     * Adds Carbon's visual angular impulse about a local offset from the center.
     * Adaptation: float32 argument/scalar boundaries are explicit; class scratch
     * replaces stack vectors. Runtime quaternion multiplication reverses Carbon's
     * row-vector operands and uses JS double intermediates with float32 outputs.
     * Source: destiny/src/Ball.cpp:2000-2037.
     * @param {Float32Array} impactForce Impulse vector in the same frame as pos.
     * @param {Float32Array} pos Offset from the center, not an absolute world position.
     * @returns {void} Starts or retargets derived impact rotation without changing physics.
     */
    @meta.blue.method
    @meta.adapted
    ApplyImpulsiveForceAtPosition(impactForce, pos)
    {
        if (this.mInvInertiaTensor < 0)
            this.mInvInertiaTensor = f32(5 / f32(f32(2 * f32(this.mMass)) * this.GetBoundingRadius()));
        const px = f32(pos[0]), py = f32(pos[1]), pz = f32(pos[2]);
        const fx = f32(impactForce[0]), fy = f32(impactForce[1]), fz = f32(impactForce[2]);
        const { vec3_0, quat_0 } = CjsDestinyClientBall.scratch;
        vec3.set(vec3_0, f32(f32(py * fz) - f32(pz * fy)),
            f32(f32(pz * fx) - f32(px * fz)), f32(f32(px * fy) - f32(py * fx)));
        vec3.scale(vec3_0, vec3_0, this.mInvInertiaTensor);
        const length = f32(Math.sqrt(f32(f32(f32(vec3_0[0] * vec3_0[0])
            + f32(vec3_0[1] * vec3_0[1])) + f32(vec3_0[2] * vec3_0[2]))));
        const angularVelocity = f32(length * f32(0.05));
        if (angularVelocity < this.mMinimumAngularVelocity) return;
        CjsDestinyClientBall._rotationQuaternion(quat_0, vec3_0[0], vec3_0[1], vec3_0[2],
            this.mMaxAngularVelocity < angularVelocity ? this.mMaxAngularVelocity : angularVelocity);
        // Carbon (row-vector): goal * newVelocity; goal is applied first.
        quat.multiply(this.mImpactVelocityGoal, quat_0, this.mImpactVelocityGoal);
        if (this.mImpactVelocityGoal[3] !== 0)
        {
            const goal = this.mImpactVelocityGoal;
            const angle = f32(f32(Math.acos(goal[3])) * 2);
            CjsDestinyClientBall._rotationQuaternion(goal, goal[0], goal[1], goal[2],
                this.mMaxAngularVelocity < angle ? this.mMaxAngularVelocity : angle);
        }
        this.mCurrentVelocityInfluence = 1;
        this.mProcessingImpact = true;
        quat.copy(this.mImpactVelocityAtImpact, this.mImpactVelocity);
    }

    /**
     * Evolves native impact growth, counter-rotation and the nonlinear angle cap.
     * Adaptation: float32 scalar stages are explicit; native quaternion helpers
     * retain their threshold/zero behavior using local static adapters and scratch.
     * The growth and recovery branches are independent and may run in one call.
     * Source: destiny/src/Ball.cpp:2039-2084.
     * @param {number} dt Elapsed seconds, converted to native float32.
     * @returns {void} Composes impact onto the current legacy orientation.
     */
    @meta.adapted
    ProcessImpact(dt)
    {
        dt = f32(dt);
        if (this.mCurrentVelocityInfluence > 0)
        {
            let deterioration = f32(f32(f32(f32(this.mSpeedModifier * this.mInvInertiaTensor)
                * f32(this.mMass)) * f32(dt * dt)) * this.mMaxVel);
            // std::min(.08, std::max(value, .002)) selects .08 for NaN.
            deterioration = deterioration < f32(0.002) ? f32(0.002) : deterioration;
            deterioration = deterioration < f32(0.08) ? deterioration : f32(0.08);
            const remaining = f32(this.mCurrentVelocityInfluence - deterioration);
            this.mCurrentVelocityInfluence = remaining > 0 ? remaining : 0;
            const influence = f32(f32(Math.sin(f32(f32(f32(Math.PI) / 2)
                * f32(this.mCurrentVelocityInfluence - 1)))) + 1);
            CjsDestinyClientBall._slerp(this.mImpactVelocity, this.mImpactVelocityGoal, this.mImpactVelocityAtImpact, influence);
            this.ApplyAngularVelocityToRotation(dt);
            quat.copy(this.mVelocityAtVelocityPeak, this.mImpactVelocity);
            quat.copy(this.mVelocityGoalAtVelocityPeak, this.mImpactVelocityGoal);
            quat.copy(this.mRotationAtVelocityPeak, this.mImpactRotation);
            this.mImpactRotationDeterioration = 1;
        }
        if (this.mCurrentVelocityInfluence === 0)
        {
            let deterioration = f32(f32(f32(this.mInvInertiaTensor * f32(this.mMass)) * f32(dt * dt)) * this.mMaxVel);
            deterioration = deterioration < f32(0.002) ? f32(0.002) : deterioration;
            deterioration = deterioration < f32(0.08) ? deterioration : f32(0.08);
            const remaining = f32(this.mImpactRotationDeterioration - deterioration);
            this.mImpactRotationDeterioration = remaining > 0 ? remaining : 0;
            const influence = f32(f32(f32(Math.cos(f32(f32(Math.PI)
                * f32(f32(f32(0.9) * this.mImpactRotationDeterioration) - 1)))) + 1) * f32(0.5));
            const { quat_1 } = CjsDestinyClientBall.scratch;
            quat.identity(quat_1);
            CjsDestinyClientBall._slerp(this.mImpactVelocityGoal, quat_1, this.mVelocityGoalAtVelocityPeak, influence);
            CjsDestinyClientBall._slerp(this.mImpactVelocity, quat_1, this.mVelocityAtVelocityPeak, influence);
            CjsDestinyClientBall._slerp(this.mImpactRotation, quat_1, this.mRotationAtVelocityPeak, influence);
        }
        this.mProcessingImpact = this.mImpactRotationDeterioration !== 0;
        CjsDestinyClientBall._normalizeQuaternion(this.mImpactRotation, this.mImpactRotation);
        let angle = f32(f32(Math.acos(this.mImpactRotation[3])) * 2);
        angle = f32(f32(angle * this.mMaxAngle) / f32(angle + this.mMaxAngle));
        CjsDestinyClientBall._rotationQuaternion(this.mImpactRotation, this.mImpactRotation[0],
            this.mImpactRotation[1], this.mImpactRotation[2], angle);
        CjsDestinyClientBall._normalizeQuaternion(this.mImpactRotation, this.mImpactRotation);
        // Carbon (row-vector): lastRot * impactRotation; base rotation is applied first.
        quat.multiply(this.mLastRot, this.mImpactRotation, this.mLastRot);
    }

    /**
     * Integrates native impact angular velocity into its rotation accumulator.
     * Adaptation: reusable quaternion scratch replaces the stack value; native
     * product operands reverse for runtime math. Zero normalization stays nonfinite.
     * Source: destiny/src/Ball.cpp:2086-2100.
     * @param {number} dt Elapsed seconds, converted to native float32.
     * @returns {void} Updates the derived impact quaternion only.
     */
    @meta.adapted
    ApplyAngularVelocityToRotation(dt)
    {
        dt = f32(dt);
        CjsDestinyClientBall._normalizeQuaternion(this.mImpactVelocity, this.mImpactVelocity);
        if (this.mImpactVelocity[3] !== 1)
        {
            const { quat_0 } = CjsDestinyClientBall.scratch;
            const angle = f32(f32(Math.acos(this.mImpactVelocity[3])) * 2);
            CjsDestinyClientBall._rotationQuaternion(quat_0, this.mImpactVelocity[0],
                this.mImpactVelocity[1], this.mImpactVelocity[2], f32(angle * dt));
            // Carbon (row-vector): impactRotation * deltaAngle; accumulator first.
            quat.multiply(this.mImpactRotation, quat_0, this.mImpactRotation);
            CjsDestinyClientBall._normalizeQuaternion(this.mImpactRotation, this.mImpactRotation);
        }
    }

    /**
     * Gets native nonnegative surface distance, with its positive-ego-ID guard.
     * Missing ego lookup leaves the ball map unchanged, as native MapOfBalls does.
     * Source: destiny/src/Ball.cpp:2102-2112.
     * @returns {number} Surface separation or zero for detached/invalid/self ego.
     */
    @meta.adapted
    GetSurfaceDistance()
    {
        if (!this.mPark || this.mPark.mEgo <= 0n) return 0;
        const ego = this.mPark.GetBall(this.mPark.mEgo);
        if (!ego || ego === this) return 0;
        return Math.max(this.GetCenterDistance() - this.mRadius - ego.mRadius, 0);
    }

    /**
     * Gets native cached distance or the current endpoint distance before caching.
     * Adaptation: runtime vec3 distance replaces Vector3d.Length. An uncached
     * detached call throws at the native null access.
     * Source: destiny/src/Ball.cpp:2115-2124.
     * @returns {number} Nonnegative center separation without populating the cache.
     */
    @meta.adapted
    GetCenterDistance()
    {
        if (this.mCenterDist < 0 && this.mPark.mEgo !== 0n)
        {
            const ego = this.mPark.GetBall(this.mPark.mEgo);
            if (ego) return ego === this ? 0 : vec3.distance(this.mNewPos, ego.mNewPos);
        }
        return Math.max(this.mCenterDist, 0);
    }

    /**
     * Reads Carbon's native partition visualization flag.
     * @returns {boolean} Whether interpolated position dispatches partition geometry.
     */
    @meta.type.boolean
    @meta.implemented
    get showBoxes()
    {
        return this.mShowBoxes;
    }

    /**
     * Writes Carbon's native partition visualization flag.
     * Adaptation: Boolean coercion represents the native boolean assignment.
     * @param {boolean} value New visibility flag.
     * @returns {void} Stores the flag without dispatching immediately.
     */
    @meta.adapted
    set showBoxes(value)
    {
        this.mShowBoxes = Boolean(value);
    }

    /**
     * Reads Carbon's native Blue centerDist property.
     * @returns {number} Distance supplied by GetCenterDistance.
     */
    @meta.type.float64
    @meta.implemented
    get centerDist()
    {
        return this.GetCenterDistance();
    }

    /**
     * Reads Carbon's native Blue surfaceDist property.
     * @returns {number} Distance supplied by GetSurfaceDistance.
     */
    @meta.type.float64
    @meta.implemented
    get surfaceDist()
    {
        return this.GetSurfaceDistance();
    }

    /**
     * Reads Carbon's native Blue maxAngle parameter.
     * @returns {number} Stored float32 value.
     */
    @meta.type.float32
    @meta.implemented
    get maxAngle()
    {
        return this.mMaxAngle;
    }

    /**
     * Writes Carbon's native Blue maxAngle parameter without validation or recomputation.
     * Adaptation: explicit rounding preserves the native float assignment.
     * @param {number} value New parameter value.
     * @returns {void} Stores the native field.
     */
    @meta.adapted
    set maxAngle(value)
    {
        this.mMaxAngle = f32(value);
    }

    /**
     * Reads Carbon's native Blue maxAngularVelocity parameter.
     * @returns {number} Stored float32 value.
     */
    @meta.type.float32
    @meta.implemented
    get maxAngularVelocity()
    {
        return this.mMaxAngularVelocity;
    }

    /**
     * Writes Carbon's native Blue maxAngularVelocity parameter without validation or recomputation.
     * Adaptation: explicit rounding preserves the native float assignment.
     * @param {number} value New parameter value.
     * @returns {void} Stores the native field.
     */
    @meta.adapted
    set maxAngularVelocity(value)
    {
        this.mMaxAngularVelocity = f32(value);
    }

    /**
     * Reads Carbon's native Blue speedModifier parameter.
     * @returns {number} Stored float32 value.
     */
    @meta.type.float32
    @meta.implemented
    get speedModifier()
    {
        return this.mSpeedModifier;
    }

    /**
     * Writes Carbon's native Blue speedModifier parameter without validation or recomputation.
     * Adaptation: explicit rounding preserves the native float assignment.
     * @param {number} value New parameter value.
     * @returns {void} Stores the native field.
     */
    @meta.adapted
    set speedModifier(value)
    {
        this.mSpeedModifier = f32(value);
    }

    /**
     * Reads Carbon's native Blue minimumAngularVelocity parameter.
     * @returns {number} Stored float32 value.
     */
    @meta.type.float32
    @meta.implemented
    get minimumAngularVelocity()
    {
        return this.mMinimumAngularVelocity;
    }

    /**
     * Writes Carbon's native Blue minimumAngularVelocity parameter without validation or recomputation.
     * Adaptation: explicit rounding preserves the native float assignment.
     * @param {number} value New parameter value.
     * @returns {void} Stores the native field.
     */
    @meta.adapted
    set minimumAngularVelocity(value)
    {
        this.mMinimumAngularVelocity = f32(value);
    }

    /**
     * Preserves native unguarded quaternion normalization for the impact accumulator.
     * Runtime normalize guards zero; Carbon's reciprocal length instead yields NaNs.
     * Source: math/include/Quaternion_inline.h:165-181.
     * @param {Float32Array} out Destination, possibly the same vector as value.
     * @param {Float32Array} value Native float quaternion.
     * @returns {Float32Array} The supplied output.
     */
    @meta.adapted
    static _normalizeQuaternion(out, value)
    {
        const x = value[0], y = value[1], z = value[2], w = value[3];
        const length = f32(Math.sqrt(f32(f32(f32(f32(x * x) + f32(y * y)) + f32(z * z)) + f32(w * w))));
        return quat.scale(out, value, f32(1 / length));
    }

    /**
     * Preserves Carbon's impact slerp threshold and unnormalized linear branch.
     * Runtime slerp uses another threshold; this adapter calculates native weights
     * and writes caller storage without a temporary quaternion or clamping the dot.
     * Source: math/include/Quaternion_inline.h:244-267.
     * @param {Float32Array} out Destination, possibly either input.
     * @param {Float32Array} a First native quaternion.
     * @param {Float32Array} b Second native quaternion.
     * @param {number} t Float32 interpolation weight.
     * @returns {Float32Array} The supplied output.
     */
    @meta.adapted
    static _slerp(out, a, b, t)
    {
        let epsilon = 1, first = f32(1 - t), second = t;
        let dot = f32(f32(f32(f32(a[0] * b[0]) + f32(a[1] * b[1])) + f32(a[2] * b[2])) + f32(a[3] * b[3]));
        if (dot < 0)
        {
            epsilon = -1;
            dot = -dot;
        }
        if (f32(1 - dot) > f32(0.001))
        {
            const theta = f32(Math.acos(dot)), denominator = f32(Math.sin(theta));
            first = f32(f32(Math.sin(f32(theta * first))) / denominator);
            second = f32(f32(Math.sin(f32(theta * second))) / denominator);
        }
        for (let i = 0; i < 4; ++i) out[i] = f32(f32(first * a[i]) + f32(f32(epsilon * second) * b[i]));
        return out;
    }

    static scratch = {
        vec3d_0: vec3d.create(), vec3d_1: vec3d.create(),
        vec3_0: vec3.create(), quat_0: quat.create(), quat_1: quat.create()
    };
}
