import { meta, blue, type } from "@carbonenginejs/runtime/schema";
import { BlueList } from "@carbonenginejs/runtime/blue";
import { CjsDestinyMiniBall } from "./CjsDestinyMiniBall.js";
import { CjsDestinyMiniCapsule } from "./CjsDestinyMiniCapsule.js";
import { CjsDestinyMiniBox } from "./CjsDestinyMiniBox.js";
import { vec3d } from "./math/vec3d.js";
import { ProximitySensor } from "./ProximitySensor.js";
import { CjsDestinyPartitionable } from "./partition/CjsDestinyPartitionable.js";
import { CjsDestinyBox } from "./partition/CjsDestinyBox.js";
import { CjsDestinyBoxSortComparer } from "./partition/SortedSets/CjsDestinyBoxSortComparer.js";

import { vec3 } from "@carbonenginejs/runtime/math/vec3";
import { quat } from "@carbonenginejs/runtime/math/quat";
import { mat4 } from "@carbonenginejs/runtime/math/mat4";
import { g_useDynamicalOrientation } from "./Settings/CjsDestinyGlobalSettings.js";

const f32 = Math.fround;
const boxComparer = new CjsDestinyBoxSortComparer();

// Source: blueexposure/include/BlueTypes.h
// Source: destiny/src/Ball.h
// Source: destiny/src/Ball.cpp
// Source: destiny/src/Ball_Blue.cpp
// Source: destiny/src/IDstConstants.h
// Source: destiny/src/Ball.cpp:228-238,812-863,2354-2526
/**
 * Temporary movement/spatial subset of Carbon Ball. Native vectors own state;
 * Blue scalar accessors retain the existing movement surface with f64 precision.
 * Controller setters own changes to physical parameters and cached drag.
 * Adaptation: Ball and Partitionable's shadowed mPark/mHandled fields share
 * one logical JS slot; native object layout and duplicate base storage are not exposed.
 * This class does not register the complete destiny.Ball identity.
 */
@meta.define({ className: "CjsDestinyBall", modelledOn: "Ball" })
export class CjsDestinyBall extends CjsDestinyPartitionable
{
    mSensor = new ProximitySensor();

    mHasProximity = false;

    mNotificationRange = 0;

    mWithinRange = false;

    mTrackingPtr = null;

    mTrackingRange = 0;

    mWithinTrackingRange = false;

    mMiniBalls = new BlueList(CjsDestinyMiniBall);

    mMiniCapsules = new BlueList(CjsDestinyMiniCapsule);

    mMiniBoxes = new BlueList(CjsDestinyMiniBox);

    mFormationID = -1;

    mFormationSlots = 0;

    mMaxAngVel = 1;

    mRoll = 0;

    mRotAgility = f32(0.9);

    mNewRot = quat.create();

    mOldRot = quat.create();

    mNewAngVel = vec3.create();

    mOldAngVel = vec3.create();

    mTorque = vec3.create();

    mNewYaw = 0;
    mOldYaw = 0;
    mNewPitch = 0;
    mOldPitch = 0;
    mNewRoll = 0;
    mOldRoll = 0;
    mNewRollSpeed = 0;
    mOldRollSpeed = 0;
    mYawDelta = 0;

    /**
     * Reads the physical angular speed limit from native backing storage.
     * Adaptation: a JS accessor represents the Blue float field.
     * Source: destiny/src/Ball_Blue.cpp:58-63.
     * Blue row: Ball_Blue.cpp:59 MAP_ATTRIBUTE READWRITE | NOTIFY | PERSIST.
     * @returns {number} Current physical angular speed limit.
     */
    @blue.notify
    @blue.readwrite
    @blue.persist
    @type.float32
    @meta.adapted
    get maxAngularVelocity()
    {
        return this.mMaxAngVel;
    }

    /**
     * Writes the physical angular speed limit, then notifies an attached park.
     * Adaptation: direct dispatch replaces the angular branch of native
     * OnModified, without schema mutation machinery. Store-before-notify keeps
     * the new field value even when the controller rejects it.
     * Source: destiny/src/Ball.cpp:1506-1584; blueexposure/BluePyWrap.cpp:932-945.
     * @param {number} value New value, narrowed to native float32.
     * @returns {void} Mutates the field and runs its attached-park side effects.
     */
    @meta.adapted
    set maxAngularVelocity(value)
    {
        this.mMaxAngVel = f32(value);
        if (this.mPark) this.mPark.SetMaxAngularSpeed(this.mId, this.mMaxAngVel);
    }

    /**
     * Reads the rotational agility from native backing storage.
     * Adaptation: a JS accessor represents the Blue float field.
     * Source: destiny/src/Ball_Blue.cpp:317-323.
     * Blue row: Ball_Blue.cpp:319 MAP_ATTRIBUTE READWRITE | NOTIFY | PERSIST.
     * @returns {number} Current rotational agility.
     */
    @blue.notify
    @blue.readwrite
    @blue.persist
    @type.float32
    @meta.adapted
    get RotationalAgility()
    {
        return this.mRotAgility;
    }

    /**
     * Writes the rotational agility, then notifies an attached park.
     * Adaptation: direct dispatch replaces the angular branch of native
     * OnModified, without schema mutation machinery. Store-before-notify keeps
     * the new field value even when the controller rejects it.
     * Source: destiny/src/Ball.cpp:1506-1584; blueexposure/BluePyWrap.cpp:932-945.
     * @param {number} value New value, narrowed to native float32.
     * @returns {void} Mutates the field and runs its attached-park side effects.
     */
    @meta.adapted
    set RotationalAgility(value)
    {
        this.mRotAgility = f32(value);
        if (this.mPark) this.mPark.SetBallAngularAgility(this.mId, this.mRotAgility);
    }

    /**
     * Reads the angular velocity component in radians per second from native backing storage.
     * Adaptation: a JS accessor represents the Blue float field.
     * Source: destiny/src/Ball_Blue.cpp:219-241.
     * Blue row: Ball_Blue.cpp:221 MAP_ATTRIBUTE READWRITE | NOTIFY | PERSIST.
     * @returns {number} Current angular velocity component in radians per second.
     */
    @blue.notify
    @blue.readwrite
    @blue.persist
    @type.float32
    @meta.adapted
    get wx()
    {
        return this.mNewAngVel[0];
    }

    /**
     * Writes the angular velocity component in radians per second, then notifies an attached park.
     * Adaptation: direct dispatch replaces the angular branch of native
     * OnModified, without schema mutation machinery. Store-before-notify keeps
     * the new field value even when the controller rejects it.
     * Source: destiny/src/Ball.cpp:1506-1584; blueexposure/BluePyWrap.cpp:932-945.
     * @param {number} value New value, narrowed to native float32.
     * @returns {void} Mutates the field and runs its attached-park side effects.
     */
    @meta.adapted
    set wx(value)
    {
        this.mNewAngVel[0] = f32(value);
        if (this.mPark) this.mPark.SetBallAngularVelocity(this.mId, this.mNewAngVel[0], this.mNewAngVel[1], this.mNewAngVel[2]);
    }

    /**
     * Reads the angular velocity component in radians per second from native backing storage.
     * Adaptation: a JS accessor represents the Blue float field.
     * Source: destiny/src/Ball_Blue.cpp:219-241.
     * Blue row: Ball_Blue.cpp:229 MAP_ATTRIBUTE READWRITE | NOTIFY | PERSIST.
     * @returns {number} Current angular velocity component in radians per second.
     */
    @blue.notify
    @blue.readwrite
    @blue.persist
    @type.float32
    @meta.adapted
    get wy()
    {
        return this.mNewAngVel[1];
    }

    /**
     * Writes the angular velocity component in radians per second, then notifies an attached park.
     * Adaptation: direct dispatch replaces the angular branch of native
     * OnModified, without schema mutation machinery. Store-before-notify keeps
     * the new field value even when the controller rejects it.
     * Source: destiny/src/Ball.cpp:1506-1584; blueexposure/BluePyWrap.cpp:932-945.
     * @param {number} value New value, narrowed to native float32.
     * @returns {void} Mutates the field and runs its attached-park side effects.
     */
    @meta.adapted
    set wy(value)
    {
        this.mNewAngVel[1] = f32(value);
        if (this.mPark) this.mPark.SetBallAngularVelocity(this.mId, this.mNewAngVel[0], this.mNewAngVel[1], this.mNewAngVel[2]);
    }

    /**
     * Reads the angular velocity component in radians per second from native backing storage.
     * Adaptation: a JS accessor represents the Blue float field.
     * Source: destiny/src/Ball_Blue.cpp:219-241.
     * Blue row: Ball_Blue.cpp:237 MAP_ATTRIBUTE READWRITE | NOTIFY | PERSIST.
     * @returns {number} Current angular velocity component in radians per second.
     */
    @blue.notify
    @blue.readwrite
    @blue.persist
    @type.float32
    @meta.adapted
    get wz()
    {
        return this.mNewAngVel[2];
    }

    /**
     * Writes the angular velocity component in radians per second, then notifies an attached park.
     * Adaptation: direct dispatch replaces the angular branch of native
     * OnModified, without schema mutation machinery. Store-before-notify keeps
     * the new field value even when the controller rejects it.
     * Source: destiny/src/Ball.cpp:1506-1584; blueexposure/BluePyWrap.cpp:932-945.
     * @param {number} value New value, narrowed to native float32.
     * @returns {void} Mutates the field and runs its attached-park side effects.
     */
    @meta.adapted
    set wz(value)
    {
        this.mNewAngVel[2] = f32(value);
        if (this.mPark) this.mPark.SetBallAngularVelocity(this.mId, this.mNewAngVel[0], this.mNewAngVel[1], this.mNewAngVel[2]);
    }

    /**
     * Reads the rotation quaternion component from native backing storage.
     * Adaptation: a JS accessor represents the Blue float field.
     * Source: destiny/src/Ball_Blue.cpp:243-273.
     * Blue row: Ball_Blue.cpp:245 MAP_ATTRIBUTE READWRITE | NOTIFY | PERSIST.
     * @returns {number} Current rotation quaternion component.
     */
    @blue.notify
    @blue.readwrite
    @blue.persist
    @type.float32
    @meta.adapted
    get rx()
    {
        return this.mNewRot[0];
    }

    /**
     * Writes the rotation quaternion component, then notifies an attached park.
     * Adaptation: direct dispatch replaces the angular branch of native
     * OnModified, without schema mutation machinery. Store-before-notify keeps
     * the new field value even when the controller rejects it.
     * Source: destiny/src/Ball.cpp:1506-1584; blueexposure/BluePyWrap.cpp:932-945.
     * @param {number} value New value, narrowed to native float32.
     * @returns {void} Mutates the field and runs its attached-park side effects.
     */
    @meta.adapted
    set rx(value)
    {
        this.mNewRot[0] = f32(value);
        if (this.mPark) this.mPark.SetBallRotation(this.mId, this.mNewRot[0], this.mNewRot[1], this.mNewRot[2], this.mNewRot[3]);
    }

    /**
     * Reads the rotation quaternion component from native backing storage.
     * Adaptation: a JS accessor represents the Blue float field.
     * Source: destiny/src/Ball_Blue.cpp:243-273.
     * Blue row: Ball_Blue.cpp:253 MAP_ATTRIBUTE READWRITE | NOTIFY | PERSIST.
     * @returns {number} Current rotation quaternion component.
     */
    @blue.notify
    @blue.readwrite
    @blue.persist
    @type.float32
    @meta.adapted
    get ry()
    {
        return this.mNewRot[1];
    }

    /**
     * Writes the rotation quaternion component, then notifies an attached park.
     * Adaptation: direct dispatch replaces the angular branch of native
     * OnModified, without schema mutation machinery. Store-before-notify keeps
     * the new field value even when the controller rejects it.
     * Source: destiny/src/Ball.cpp:1506-1584; blueexposure/BluePyWrap.cpp:932-945.
     * @param {number} value New value, narrowed to native float32.
     * @returns {void} Mutates the field and runs its attached-park side effects.
     */
    @meta.adapted
    set ry(value)
    {
        this.mNewRot[1] = f32(value);
        if (this.mPark) this.mPark.SetBallRotation(this.mId, this.mNewRot[0], this.mNewRot[1], this.mNewRot[2], this.mNewRot[3]);
    }

    /**
     * Reads the rotation quaternion component from native backing storage.
     * Adaptation: a JS accessor represents the Blue float field.
     * Source: destiny/src/Ball_Blue.cpp:243-273.
     * Blue row: Ball_Blue.cpp:261 MAP_ATTRIBUTE READWRITE | NOTIFY | PERSIST.
     * @returns {number} Current rotation quaternion component.
     */
    @blue.notify
    @blue.readwrite
    @blue.persist
    @type.float32
    @meta.adapted
    get rz()
    {
        return this.mNewRot[2];
    }

    /**
     * Writes the rotation quaternion component, then notifies an attached park.
     * Adaptation: direct dispatch replaces the angular branch of native
     * OnModified, without schema mutation machinery. Store-before-notify keeps
     * the new field value even when the controller rejects it.
     * Source: destiny/src/Ball.cpp:1506-1584; blueexposure/BluePyWrap.cpp:932-945.
     * @param {number} value New value, narrowed to native float32.
     * @returns {void} Mutates the field and runs its attached-park side effects.
     */
    @meta.adapted
    set rz(value)
    {
        this.mNewRot[2] = f32(value);
        if (this.mPark) this.mPark.SetBallRotation(this.mId, this.mNewRot[0], this.mNewRot[1], this.mNewRot[2], this.mNewRot[3]);
    }

    /**
     * Reads the rotation quaternion component from native backing storage.
     * Adaptation: a JS accessor represents the Blue float field.
     * Source: destiny/src/Ball_Blue.cpp:243-273.
     * Blue row: Ball_Blue.cpp:269 MAP_ATTRIBUTE READWRITE | NOTIFY | PERSIST.
     * @returns {number} Current rotation quaternion component.
     */
    @blue.notify
    @blue.readwrite
    @blue.persist
    @type.float32
    @meta.adapted
    get rw()
    {
        return this.mNewRot[3];
    }

    /**
     * Writes the rotation quaternion component, then notifies an attached park.
     * Adaptation: direct dispatch replaces the angular branch of native
     * OnModified, without schema mutation machinery. Store-before-notify keeps
     * the new field value even when the controller rejects it.
     * Source: destiny/src/Ball.cpp:1506-1584; blueexposure/BluePyWrap.cpp:932-945.
     * @param {number} value New value, narrowed to native float32.
     * @returns {void} Mutates the field and runs its attached-park side effects.
     */
    @meta.adapted
    set rw(value)
    {
        this.mNewRot[3] = f32(value);
        if (this.mPark) this.mPark.SetBallRotation(this.mId, this.mNewRot[0], this.mNewRot[1], this.mNewRot[2], this.mNewRot[3]);
    }

    /**
     * Snaps physical orientation to velocity and stops angular motion.
     * Adaptation: factory-owned float32 state and class scratch replace native
     * values; gl quaternion products reverse Carbon operands. Runtime matrix
     * arithmetic uses JS double intermediates with float32 stored results.
     * Source: destiny/src/Ball.cpp:290-333. The boolean fabs condition and
     * degenerate opposite-heading quaternion are deliberately preserved.
     * @returns {void} Updates both rotation samples unless velocity is too small.
     */
    @meta.adapted
    SnapOrientation()
    {
        if (!(vec3.squaredLength(this.mNewVel) > 1e-12)) return;
        const { vec3_0, vec3_1, quat_0, quat_1, mat4_0 } = CjsDestinyBall.scratch;
        vec3.copy(vec3_0, this.mNewVel);
        const length = f32(Math.sqrt(f32(f32(f32(vec3_0[0] * vec3_0[0]) + f32(vec3_0[1] * vec3_0[1])) + f32(vec3_0[2] * vec3_0[2]))));
        if (length < 1e-12) quat.identity(quat_0);
        else
        {
            const cosine = f32(vec3_0[2] / length);
            // Native std::min/max select their first operand for unordered NaN.
            const capped = cosine < 1 ? cosine : 1;
            const angle = f32(Math.acos(-1 < capped ? capped : -1));
            // Keep the cross products: 0 * Infinity produces native NaNs when
            // a finite double velocity overflows during conversion to float.
            vec3.set(vec3_1, 0, 0, 1);
            vec3.cross(vec3_1, vec3_1, vec3_0);
            CjsDestinyBall._rotationQuaternion(quat_0, vec3_1[0], vec3_1[1], vec3_1[2], angle);
            quat.conjugate(quat_1, quat_0);
            mat4.fromQuat(mat4_0, quat_1);
            vec3.set(vec3_0, 0, 1, 0);
            CjsDestinyBall._transformCoord(vec3_0, vec3_0, mat4_0);
            const roll = vec3_0[2] < f32(0.99) ? f32(Math.atan2(-vec3_0[0], vec3_0[1])) : 0;
            mat4.fromQuat(mat4_0, quat_0);
            vec3.set(vec3_1, 0, 0, 1);
            CjsDestinyBall._transformCoord(vec3_1, vec3_1, mat4_0);
            CjsDestinyBall._rotationQuaternion(quat_1, vec3_1[0], vec3_1[1], vec3_1[2], roll);
            // Carbon newRot *= rollQuaternion: heading first, roll second.
            quat.multiply(quat_0, quat_1, quat_0);
        }
        quat.copy(this.mNewRot, quat_0);
        quat.copy(this.mOldRot, quat_0);
        vec3.zero(this.mNewAngVel);
        vec3.zero(this.mOldAngVel);
    }

    /**
     * Rotates a direction by physical or legacy orientation, without normalization.
     * Adaptation: caller-owned float32 vector replaces the native reference and
     * matrix scratch preserves native behavior for nonunit and zero quaternions.
     * Source: destiny/src/Ball.cpp:2191-2203.
     * @param {Float32Array} value In/out direction in the ball's frame.
     * @returns {void} Writes the direction in the world frame.
     */
    @meta.adapted
    GetRotatedVector(value)
    {
        const { quat_0, mat4_0, vec3_0 } = CjsDestinyBall.scratch;
        if (g_useDynamicalOrientation) quat.copy(quat_0, this.mNewRot);
        else quat.fromYawPitchRoll(quat_0, f32(this.mNewYaw), f32(this.mNewPitch), f32(this.mNewRoll));
        mat4.fromQuat(mat4_0, quat_0);
        CjsDestinyBall._transformCoord(vec3_0, value, mat4_0);
        vec3.copy(value, vec3_0);
    }

    /**
     * Calculates relative, radial, transversal and angular motion from committed state.
     * Adaptation: caller-owned out fields replace native reference arguments; scalar
     * doubles replace stack vectors. Unrequested or singular outputs remain untouched.
     * Source: destiny/src/Ball.cpp:161-222; destiny/src/Ball.h:365-375.
     * @param {CjsDestinyBall|null} target Ball measured relative to this ball.
     * @param {boolean} calcRelative Calculate relative velocity.
     * @param {boolean} calcRadial Also calculate radial velocity and surface distance.
     * @param {boolean} calcTransversal Also calculate transversal speed.
     * @param {boolean} calcAngular Also calculate angular speed, compensating dynamic spin.
     * @param {object} out Owned relVel vector and radVel, shortDist, transVel, angVel scalars.
     * @returns {object} The supplied output record, possibly only partially updated.
     */
    @meta.adapted
    CalculateRelativeVelocities(target, calcRelative, calcRadial, calcTransversal, calcAngular, out)
    {
        if (!target) return out;
        if (calcAngular) calcTransversal = true;
        if (calcTransversal) calcRadial = true;
        if (calcRadial) calcRelative = true;
        if (!calcRelative) return out;
        vec3.subtract(out.relVel, target.mNewVel, this.mNewVel);
        if (!calcRadial) return out;
        let x = target.mNewPos[0] - this.mNewPos[0], y = target.mNewPos[1] - this.mNewPos[1], z = target.mNewPos[2] - this.mNewPos[2];
        const dist = Math.sqrt(x * x + y * y + z * z);
        if (dist === 0) return out;
        const shortDist = (dist - target.mRadius) - this.mRadius;
        out.shortDist = shortDist < 0 ? 0 : shortDist;
        const reciprocal = 1 / dist;
        x *= reciprocal; y *= reciprocal; z *= reciprocal;
        out.radVel = out.relVel[0] * x + out.relVel[1] * y + out.relVel[2] * z;
        if (!calcTransversal) return out;
        let tx = out.relVel[0] - out.radVel * x, ty = out.relVel[1] - out.radVel * y, tz = out.relVel[2] - out.radVel * z;
        out.transVel = Math.sqrt(tx * tx + ty * ty + tz * tz);
        if (calcAngular)
        {
            if (g_useDynamicalOrientation)
            {
                const wx = this.mNewAngVel[0], wy = this.mNewAngVel[1], wz = this.mNewAngVel[2];
                tx -= (wy * z - wz * y) * dist;
                ty -= (wz * x - wx * z) * dist;
                tz -= (wx * y - wy * x) * dist;
                out.angVel = Math.sqrt(tx * tx + ty * ty + tz * tz) / dist;
            }
            else out.angVel = out.transVel / dist;
        }
        return out;
    }

    /**
     * Evolves Carbon's velocity-directed, mass-damped legacy orientation.
     * Adaptation: scalar components replace temporary Vector3d objects. Detached
     * reporting uses the native shared callback through a direct JS function.
     * Source: destiny/src/Ball.cpp:335-460.
     * @param {boolean} [snap=false] Bypass damping and clear roll state.
     * @returns {void} Updates native old/new angles and roll speed.
     */
    @meta.adapted
    CalculateYawPitchRoll(snap = false)
    {
        if (!this.mPark)
        {
            this.mNewYaw = this.mNewPitch = this.mNewRoll = 0;
            this.RegisterBallNotInPark();
            return;
        }
        this.mOldPitch = this.mNewPitch;
        this.mOldYaw = this.mNewYaw;
        this.mOldRoll = this.mNewRoll;
        this.mOldRollSpeed = this.mNewRollSpeed;
        let massModifier = this.mMass / this.mPark.mFriction;
        massModifier = massModifier !== 0 ? 100 / massModifier : 100;
        const vx = this.mNewVel[0], vy = this.mNewVel[1], vz = this.mNewVel[2];
        const vel2 = vx * vx + vy * vy + vz * vz;
        let x = this.mGoto[0] - this.mNewPos[0];
        let y = this.mGoto[1] - this.mNewPos[1];
        let z = this.mGoto[2] - this.mNewPos[2];
        if (vel2 !== 0)
        {
            let dx = 0, dy = 0, dz = 0;
            if (this.IsWarpish())
            {
                // Native quirk: proper warp leaves this direction zero before goto bias.
                // Source: destiny/src/Ball.cpp:381-397.
                if (this.IsAligningForWarp())
                {
                    if (this.mCollisions.length === 0) { dx = x; dy = y; dz = z; }
                    else { dx = vx; dy = vy; dz = vz; }
                }
                else if (massModifier < 1 && this.mPark.currentTime !== this.mEffectStamp)
                    massModifier = Math.min(1, massModifier * Math.min(15, (this.mPark.currentTime - this.mEffectStamp) * 2));
            }
            else { dx = vx; dy = vy; dz = vz; }
            if (this.mMode !== CjsDestinyBall.DSTBALLMODE.DSTBALL_MISSILE && !snap)
            {
                const length = Math.sqrt(x * x + y * y + z * z);
                if (length !== 0)
                {
                    x *= 1 / length;
                    y *= 1 / length;
                    z *= 1 / length;
                }
                const speed = Math.sqrt(vel2) * 0.3;
                x = dx + speed * x;
                y = dy + speed * y;
                z = dz + speed * z;
            }
            else
            {
                x = dx; y = dy; z = dz;
            }
        }
        this.mNewYaw = Math.atan2(x, z);
        const radius = Math.sqrt(x * x + y * y + z * z);
        this.mNewPitch = radius > 0 ? -Math.asin(Math.min(1, Math.max(-1, y / radius))) : 0;
        this.mOldYaw %= 2 * Math.PI;
        this.mOldPitch %= 2 * Math.PI;
        this.mNewYaw = CjsDestinyBall._modulo2pi(this.mOldYaw, this.mNewYaw);
        this.mNewPitch = CjsDestinyBall._modulo2pi(this.mOldPitch, this.mNewPitch);
        if (snap)
        {
            this.mNewRoll = this.mOldRoll = this.mNewRollSpeed = this.mOldRollSpeed = this.mYawDelta = 0;
            return;
        }
        const tmp = 1 / (1 + massModifier * 0.5);
        this.mNewYaw = (this.mOldYaw + massModifier * 0.5 * this.mNewYaw) * tmp;
        this.mNewPitch = (this.mOldPitch + massModifier * 0.5 * this.mNewPitch) * tmp;
        this.mYawDelta = Math.asin(Math.sin(this.mNewYaw - this.mOldYaw));
        this.mNewRollSpeed += this.mYawDelta * this.mPark.mRollSpeedAcceleration;
        this.mNewRollSpeed += this.mOldRollSpeed * this.mPark.mRollSpeedDecay * this.mPark.dt;
        this.mNewRollSpeed = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this.mNewRollSpeed));
        this.mNewRoll += this.mNewRollSpeed * this.mPark.mRollAcceleration * this.mPark.dt;
        this.mNewRoll += this.mOldRoll * this.mPark.mRollDecay * this.mPark.dt;
        this.mNewRoll = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this.mNewRoll));
    }



    /**
     * Clears owned membership links and native neighbor activity without removing occupants.
     * Adaptation: arrays replace the native set and fixed-size arrays.
     *
     * @returns {void} Resets the base cell, 27 flags and three modifiers.
     */
    @meta.adapted
    ClearBoxes()
    {
        this.mBoxes.length = 0;
        this.mMyBox = null;
        this.mActiveBoxes.fill(false);
        this.mMod.fill(-2);
    }

    /**
     * Removes this ball from every sorted membership before clearing its links.
     *
     * @returns {void} Empty cells and ancestors may be released synchronously.
     */
    @meta.implemented
    DeleteFromBoxes()
    {
        for (const box of this.mBoxes) box.RemoveBall(this);
        this.ClearBoxes();
    }

    /**
     * Adds both sides of a cell membership in native key order.
     * Adaptation: comparator-aware arrays replace std::set.
     *
     * @param {CjsDestinyBox|null} box Cell to join.
     * @returns {void} Null and equivalent memberships are ignored.
     */
    @meta.adapted
    InsertInBox(box)
    {
        if (!box) return;
        box.AddBall(this);
        CjsDestinyBox._insert(this.mBoxes, box, boxComparer);
    }

    /**
     * Bounds movement using native cached drag, current speed and cruise speed.
     * Adaptation: explicit f64 components replace Vector3d.Length without changing arithmetic.
     *
     * @param {number} dt Time interval to cover.
     * @returns {number} Physical radius plus native maximum possible displacement.
     */
    @meta.adapted
    GetInflatedRadius(dt)
    {
        if (!this.isFree) return this.mRadius;
        const m = this.mMass * this.mAgility;
        const a = this.mPark.mFriction * this.mSpeedFraction * this.mMaxVel / m;
        const v = Math.sqrt(this.mNewVel[0] * this.mNewVel[0]
            + this.mNewVel[1] * this.mNewVel[1] + this.mNewVel[2] * this.mNewVel[2]);
        const k = this.mPark.mFriction;
        const maxPossSpeed = (m * a - (m * a - v * k) * this.mTimeFactor) / k;
        return this.mRadius + dt * maxPossSpeed;
    }

    /**
     * Returns the native physical radius.
     *
     * @returns {number} Current float radius.
     */
    @meta.implemented
    GetBoundingRadius()
    {
        return this.mRadius;
    }

    /**
     * Assigns one native neighbor-activity flag.
     *
     * @param {number} boxId Native neighbor index from 0 through 26.
     * @param {boolean} isActive Activity value.
     * @returns {void} Mutates the flag in place.
     */
    @meta.implemented
    SetBoxActive(boxId, isActive)
    {
        this.mActiveBoxes[boxId] = isActive;
    }

    /**
     * Rebuilds native swept-radius memberships, restoring a master top-cell bubble.
     * Adaptation: Number vectors and comparator-aware arrays replace native containers;
     * BigInt retains exact cell indices and console supplies the probe log channel.
     *
     * @param {CjsDestinyBox} box1 Proposed base cell.
     * @param {CjsDestinyBox} top Previous top cell, recomputed after removal on masters.
     * @param {number} newBubbleId Bubble identifier to restore.
     * @returns {void} Retains memberships when the key and modifiers are unchanged.
     */
    @meta.adapted
    InsertInBoxes(box1, top, newBubbleId)
    {
        const inflatedRadius = this.GetInflatedRadius(this.mPark.dt);
        const mod = [0, 0, 0];
        for (let q = 0; q < 3; ++q)
        {
            if (box1.lo[q] + inflatedRadius - this.mNewPos[q] > 0) mod[q] = -1;
            else if (box1.hi[q] - inflatedRadius - this.mNewPos[q] < 0) mod[q] = 1;
        }
        if (this.mPark.mProbe === this.mId)
            console.warn("Ball::InsertInBoxes", this.mMyBox, box1, mod);
        if (this.mMyBox && box1.mKey.Equals(this.mMyBox.mKey)
            && mod[0] === this.mMod[0] && mod[1] === this.mMod[1] && mod[2] === this.mMod[2]) return;

        this.DeleteFromBoxes();
        this.mMod[0] = mod[0];
        this.mMod[1] = mod[1];
        this.mMod[2] = mod[2];
        const partition = this.mPark.mPartition;
        box1 = partition.GetBox(inflatedRadius, this.mNewPos);
        const { ix, iy, iz } = box1.mKey, level = box1.mLevel;
        this.InsertInBox(box1);
        if (this.mPark.isMaster)
        {
            top = partition.GetTopmost(box1);
            top.mBubble = newBubbleId;
        }
        this.SetBoxActive(13, true);
        this.mMyBox = box1;
        if (level === 0 && Math.fround(this.mRadius * 2) > partition.mLevelWidth[0])
        {
            for (let x = -1; x < 2; ++x)
                for (let y = -1; y < 2; ++y)
                    for (let z = -1; z < 2; ++z)
                    {
                        if (x === 0 && y === 0 && z === 0) continue;
                        this.InsertInBox(partition.GetBox(ix + BigInt(x), iy + BigInt(y), iz + BigInt(z), 0));
                        this.SetBoxActive(13 + x + 3 * y + 9 * z, true);
                    }
        }
        else
        {
            // Native insertion order is x, y, z, xy, xz, yz, xyz.
            for (const axes of [[0], [1], [2], [0, 1], [0, 2], [1, 2], [0, 1, 2]])
            {
                if (axes.some(axis => mod[axis] === 0)) continue;
                const offset = [0, 0, 0];
                for (const axis of axes) offset[axis] = mod[axis];
                this.InsertInBox(partition.GetBox(ix + BigInt(offset[0]), iy + BigInt(offset[1]), iz + BigInt(offset[2]), level));
                this.SetBoxActive(13 + offset[0] + 3 * offset[1] + 9 * offset[2], true);
            }
        }
    }

    mNewPos = vec3d.fromValues(1e10, 1e10, 1e10);

    mNewVel = vec3d.create();

    mOldVel = vec3d.create();

    mGoto = vec3d.create();

    mLastG = vec3d.create();

    mLastC = vec3d.create();

    mLastCollision = -1;
    mCollisions = [];
    mMass = 0;
    mRadius = 0;
    mMaxVel = 0;
    mAgility = 1;
    mSpeedFraction = 1;
    mMode = CjsDestinyBall.DSTBALLMODE.DSTBALL_STOP;
    mFollowId = 0n;
    mFollowRange = 10;
    mOwnerId = 0n;
    mHarmonic = -1n;
    mCorporationID = -1;
    mAllianceID = -1;
    mTimeFactor = 1;
    mInDeadBubble = false;

    /**
     * Exposes the native read-only Blue current-bubble alias.
     *
     * Blue row: Ball_Blue.cpp:418 MAP_ATTRIBUTE READ.
     * @returns {number} Current bubble ID or -1.
     */
    @blue.read
    @type.int32
    @meta.implemented
    get newBubbleId()
    {
        return this.mNewBubble;
    }

    /**
     * Exposes the native read-only Blue previous-bubble alias.
     *
     * Blue row: Ball_Blue.cpp:427 MAP_ATTRIBUTE READ.
     * @returns {number} Previous bubble ID or -1.
     */
    @blue.read
    @type.int32
    @meta.implemented
    get oldBubbleId()
    {
        return this.mOldBubble;
    }
    mFollowPtr = null;
    mFollowers = new Set();
    mActiveBoxes = Array(27).fill(false);
    mMod = [-2, -2, -2];
    mNewTime = 0n;
    mOldTime = 0n;

    @type.boolean
    isFree = false;
    @type.boolean
    isGlobal = false;
    @type.boolean
    isMassive = false;
    @type.boolean
    isSpaceJunk = false;
    _isCloaked = 0;

    /**
     * Reads the numeric cloak mode, including non-enumerated native byte values.
     * Adaptation: a JS accessor exposes the byte backing field without schema coercion.
     * Source: destiny/src/Ball.h:113; destiny/src/Ball.cpp:69.
     * Blue row: Ball_Blue.cpp:107 MAP_ATTRIBUTE READWRITE | NOTIFY | PERSIST.
     * @returns {number} Unsigned byte; zero means uncloaked.
     */
    @blue.notify
    @blue.readwrite
    @blue.persist
    @type.uint8
    @meta.adapted
    get isCloaked() { return this._isCloaked; }

    /**
     * Stores a Blue-style byte without executing cloak command effects.
     * Adaptation: explicit JS conversion accepts booleans as Python integers and
     * masks native-long values to uint8. Values outside the selected signed-int32
     * long domain throw rather than reproducing Python's pending overflow error.
     * No schema machinery is used.
     * Source: destiny/src/Ball_Blue.cpp:106-113.
     * Source: blueexposure/BlueVariable.cpp:945-953.
     * @param {number|boolean} value Native-long value; true stores normal mode 1.
     * @returns {void} Does not change sensors, massiveness or follower commands.
     */
    @meta.adapted
    set isCloaked(value)
    {
        if (typeof value === "boolean") value = Number(value);
        if (!Number.isInteger(value) || value < -2147483648 || value > 2147483647)
            throw new RangeError("Cloak property input must fit native signed long");
        this._isCloaked = value & 255;
    }

    /**
     * Reads mId through id.
     * Adaptation: a JS accessor exposes native storage without duplicating the Blue scalar value.
     *
     * Blue row: Ball_Blue.cpp:19 MAP_ATTRIBUTE READ | PERSIST.
     * @returns {bigint} Current native value.
     */
    @blue.read
    @blue.persist
    @type.int64
    @meta.adapted
    get id()
    {
        return this.mId;
    }

    /**
     * Writes mId through id.
     * Adaptation: a JS accessor exposes native storage without duplicating the Blue scalar value.
     *
     * @param {bigint} value New native value.
     * @returns {void} Updates the shared storage.
     */
    @meta.adapted
    set id(value)
    {
        this.mId = value;
    }

    /**
     * Reads mMass through mass.
     * Adaptation: a JS accessor exposes native storage without duplicating the Blue scalar value.
     *
     * Blue row: Ball_Blue.cpp:29 MAP_ATTRIBUTE READWRITE | NOTIFY | PERSIST.
     * @returns {number} Current native value.
     */
    @blue.notify
    @blue.readwrite
    @blue.persist
    @type.float64
    @meta.adapted
    get mass()
    {
        return this.mMass;
    }

    /**
     * Writes mMass through mass.
     * Adaptation: a JS accessor exposes native storage without duplicating the Blue scalar value.
     *
     * @param {number} value New native value.
     * @returns {void} Updates the shared storage.
     */
    @meta.adapted
    set mass(value)
    {
        this.mMass = value;
    }

    /**
     * Reads mRadius through radius.
     * Adaptation: a JS accessor exposes native storage without duplicating the Blue scalar value.
     *
     * Blue row: Ball_Blue.cpp:39 MAP_ATTRIBUTE READWRITE | NOTIFY | PERSIST.
     * @returns {number} Current native value.
     */
    @blue.notify
    @blue.readwrite
    @blue.persist
    @type.float32
    @meta.adapted
    get radius()
    {
        return this.mRadius;
    }

    /**
     * Writes mRadius through radius.
     * Adaptation: a JS accessor exposes native storage without duplicating the Blue scalar value.
     *
     * @param {number} value New native value.
     * @returns {void} Updates the shared storage.
     */
    @meta.adapted
    set radius(value)
    {
        this.mRadius = value;
    }

    /**
     * Reads mMaxVel through maxVelocity.
     * Adaptation: a JS accessor exposes native storage without duplicating the Blue scalar value.
     *
     * Blue row: Ball_Blue.cpp:49 MAP_ATTRIBUTE READWRITE | NOTIFY | PERSIST.
     * @returns {number} Current native value.
     */
    @blue.notify
    @blue.readwrite
    @blue.persist
    @type.float32
    @meta.adapted
    get maxVelocity()
    {
        return this.mMaxVel;
    }

    /**
     * Writes mMaxVel through maxVelocity, narrowing to the native float.
     * Adaptation: a JS accessor performs the conversion made by Blue's float member.
     * Source: destiny/src/Ball.h:126; destiny/src/Ball_Blue.cpp:48-54.
     *
     * @param {number} value New native value.
     * @returns {void} Updates the shared storage.
     */
    @meta.adapted
    set maxVelocity(value)
    {
        this.mMaxVel = f32(value);
    }

    /**
     * Reads mAgility through agility.
     * Adaptation: a JS accessor exposes native storage without duplicating the Blue scalar value.
     *
     * @returns {number} Current native value.
     */
    @meta.property()
    @type.float32
    @meta.adapted
    get agility()
    {
        return this.mAgility;
    }

    /**
     * Writes mAgility through agility.
     * Adaptation: a JS accessor exposes native storage without duplicating the Blue scalar value.
     *
     * @param {number} value New native value.
     * @returns {void} Updates the shared storage.
     */
    @meta.adapted
    set agility(value)
    {
        this.mAgility = value;
    }

    /**
     * Reads mSpeedFraction through speedFraction.
     * Adaptation: a JS accessor exposes native storage without duplicating the Blue scalar value.
     *
     * Blue row: Ball_Blue.cpp:327 MAP_ATTRIBUTE READWRITE | NOTIFY | PERSIST.
     * @returns {number} Current native value.
     */
    @blue.notify
    @blue.readwrite
    @blue.persist
    @type.float32
    @meta.adapted
    get speedFraction()
    {
        return this.mSpeedFraction;
    }

    /**
     * Writes mSpeedFraction through speedFraction.
     * Adaptation: a JS accessor exposes native storage without duplicating the Blue scalar value.
     *
     * @param {number} value New native value.
     * @returns {void} Updates the shared storage.
     */
    @meta.adapted
    set speedFraction(value)
    {
        this.mSpeedFraction = value;
    }

    /**
     * Reads mMode through mode.
     * Adaptation: a JS accessor exposes native storage without duplicating the Blue scalar value.
     *
     * Blue row: Ball_Blue.cpp:336 MAP_ATTRIBUTE_WITH_CHOOSER READ | ENUM | PERSIST.
     * @returns {number} Current native value.
     */
    @blue.read
    @blue.persist
    @type.enum("DSTBALLMODE")
    @meta.adapted
    get mode()
    {
        return this.mMode;
    }

    /**
     * Writes mMode through mode.
     * Adaptation: a JS accessor exposes native storage without duplicating the Blue scalar value.
     *
     * @param {number} value New native value.
     * @returns {void} Updates the shared storage.
     */
    @meta.adapted
    set mode(value)
    {
        this.mMode = value;
    }

    /**
     * Reads mFollowId through followId.
     * Adaptation: a JS accessor exposes native storage without duplicating the Blue scalar value.
     *
     * Blue row: Ball_Blue.cpp:376 MAP_ATTRIBUTE READ | PERSIST.
     * @returns {bigint} Current native value.
     */
    @blue.read
    @blue.persist
    @type.int64
    @meta.adapted
    get followId()
    {
        return this.mFollowId;
    }

    /**
     * Writes mFollowId through followId.
     * Adaptation: a JS accessor exposes native storage without duplicating the Blue scalar value.
     *
     * @param {bigint} value New native value.
     * @returns {void} Updates the shared storage.
     */
    @meta.adapted
    set followId(value)
    {
        this.mFollowId = value;
    }

    /**
     * Reads mFollowRange through followRange.
     * Adaptation: a JS accessor exposes native storage without duplicating the Blue scalar value.
     *
     * Blue row: Ball_Blue.cpp:386 MAP_ATTRIBUTE READ | PERSIST.
     * @returns {number} Current native value.
     */
    @blue.read
    @blue.persist
    @type.float32
    @meta.adapted
    get followRange()
    {
        return this.mFollowRange;
    }

    /**
     * Writes mFollowRange through followRange.
     * Adaptation: a JS accessor exposes native storage without duplicating the Blue scalar value.
     *
     * @param {number} value New native value.
     * @returns {void} Updates the shared storage.
     */
    @meta.adapted
    set followRange(value)
    {
        this.mFollowRange = value;
    }

    /**
     * Reads mNewPos[0] through x.
     * Adaptation: a JS accessor exposes native storage without duplicating the Blue scalar value.
     *
     * Blue row: Ball_Blue.cpp:157 MAP_ATTRIBUTE READWRITE | NOTIFY | PERSIST.
     * @returns {number} Current native value.
     */
    @blue.notify
    @blue.readwrite
    @blue.persist
    @type.float64
    @meta.adapted
    get x()
    {
        return this.mNewPos[0];
    }

    /**
     * Writes X, then notifies the attached park to update position and membership.
     * Adaptation: owner-prototype dispatch replaces Blue OnModified without schema APIs.
     * Store-before-notify preserves the new coordinate if the park rejects the update.
     * Source: destiny/src/Ball.cpp:1526-1537; destiny/src/Ball_Blue.cpp:155-183.
     * @param {number} value New native value.
     * @returns {void} Updates the shared storage.
     */
    @meta.adapted
    set x(value)
    {
        this.mNewPos[0] = value;
        if (this.mPark) CjsDestinyBall.ballparkPrototype.SetBallPosition.call(this.mPark,
            this.mId, this.mNewPos[0], this.mNewPos[1], this.mNewPos[2]);
    }

    /**
     * Reads mNewPos[1] through y.
     * Adaptation: a JS accessor exposes native storage without duplicating the Blue scalar value.
     *
     * Blue row: Ball_Blue.cpp:167 MAP_ATTRIBUTE READWRITE | NOTIFY | PERSIST.
     * @returns {number} Current native value.
     */
    @blue.notify
    @blue.readwrite
    @blue.persist
    @type.float64
    @meta.adapted
    get y()
    {
        return this.mNewPos[1];
    }

    /**
     * Writes Y, then notifies the attached park to update position and membership.
     * Adaptation: owner-prototype dispatch replaces Blue OnModified without schema APIs.
     * Store-before-notify preserves the new coordinate if the park rejects the update.
     * Source: destiny/src/Ball.cpp:1526-1537; destiny/src/Ball_Blue.cpp:155-183.
     * @param {number} value New native value.
     * @returns {void} Updates the shared storage.
     */
    @meta.adapted
    set y(value)
    {
        this.mNewPos[1] = value;
        if (this.mPark) CjsDestinyBall.ballparkPrototype.SetBallPosition.call(this.mPark,
            this.mId, this.mNewPos[0], this.mNewPos[1], this.mNewPos[2]);
    }

    /**
     * Reads mNewPos[2] through z.
     * Adaptation: a JS accessor exposes native storage without duplicating the Blue scalar value.
     *
     * Blue row: Ball_Blue.cpp:178 MAP_ATTRIBUTE READWRITE | NOTIFY | PERSIST.
     * @returns {number} Current native value.
     */
    @blue.notify
    @blue.readwrite
    @blue.persist
    @type.float64
    @meta.adapted
    get z()
    {
        return this.mNewPos[2];
    }

    /**
     * Writes Z, then notifies the attached park to update position and membership.
     * Adaptation: owner-prototype dispatch replaces Blue OnModified without schema APIs.
     * Store-before-notify preserves the new coordinate if the park rejects the update.
     * Source: destiny/src/Ball.cpp:1526-1537; destiny/src/Ball_Blue.cpp:155-183.
     * @param {number} value New native value.
     * @returns {void} Updates the shared storage.
     */
    @meta.adapted
    set z(value)
    {
        this.mNewPos[2] = value;
        if (this.mPark) CjsDestinyBall.ballparkPrototype.SetBallPosition.call(this.mPark,
            this.mId, this.mNewPos[0], this.mNewPos[1], this.mNewPos[2]);
    }

    /**
     * Reads mNewVel[0] through vx.
     * Adaptation: a JS accessor exposes native storage without duplicating the Blue scalar value.
     *
     * Blue row: Ball_Blue.cpp:189 MAP_ATTRIBUTE READWRITE | NOTIFY | PERSIST.
     * @returns {number} Current native value.
     */
    @blue.notify
    @blue.readwrite
    @blue.persist
    @type.float64
    @meta.adapted
    get vx()
    {
        return this.mNewVel[0];
    }

    /**
     * Writes mNewVel[0] through vx.
     * Adaptation: a JS accessor exposes native storage without duplicating the Blue scalar value.
     *
     * @param {number} value New native value.
     * @returns {void} Updates the shared storage.
     */
    @meta.adapted
    set vx(value)
    {
        this.mNewVel[0] = value;
    }

    /**
     * Reads mNewVel[1] through vy.
     * Adaptation: a JS accessor exposes native storage without duplicating the Blue scalar value.
     *
     * Blue row: Ball_Blue.cpp:200 MAP_ATTRIBUTE READWRITE | NOTIFY | PERSIST.
     * @returns {number} Current native value.
     */
    @blue.notify
    @blue.readwrite
    @blue.persist
    @type.float64
    @meta.adapted
    get vy()
    {
        return this.mNewVel[1];
    }

    /**
     * Writes mNewVel[1] through vy.
     * Adaptation: a JS accessor exposes native storage without duplicating the Blue scalar value.
     *
     * @param {number} value New native value.
     * @returns {void} Updates the shared storage.
     */
    @meta.adapted
    set vy(value)
    {
        this.mNewVel[1] = value;
    }

    /**
     * Reads mNewVel[2] through vz.
     * Adaptation: a JS accessor exposes native storage without duplicating the Blue scalar value.
     *
     * Blue row: Ball_Blue.cpp:211 MAP_ATTRIBUTE READWRITE | NOTIFY | PERSIST.
     * @returns {number} Current native value.
     */
    @blue.notify
    @blue.readwrite
    @blue.persist
    @type.float64
    @meta.adapted
    get vz()
    {
        return this.mNewVel[2];
    }

    /**
     * Writes mNewVel[2] through vz.
     * Adaptation: a JS accessor exposes native storage without duplicating the Blue scalar value.
     *
     * @param {number} value New native value.
     * @returns {void} Updates the shared storage.
     */
    @meta.adapted
    set vz(value)
    {
        this.mNewVel[2] = value;
    }

    /**
     * Reads mGoto[0] through gotoX.
     * Adaptation: a JS accessor exposes native storage without duplicating the Blue scalar value.
     *
     * Blue row: Ball_Blue.cpp:347 MAP_ATTRIBUTE READWRITE | NOTIFY | PERSIST.
     * @returns {number} Current native value.
     */
    @blue.notify
    @blue.readwrite
    @blue.persist
    @type.float64
    @meta.adapted
    get gotoX()
    {
        return this.mGoto[0];
    }

    /**
     * Writes mGoto[0] through gotoX.
     * Adaptation: a JS accessor exposes native storage without duplicating the Blue scalar value.
     *
     * @param {number} value New native value.
     * @returns {void} Updates the shared storage.
     */
    @meta.adapted
    set gotoX(value)
    {
        this.mGoto[0] = value;
    }

    /**
     * Reads mGoto[1] through gotoY.
     * Adaptation: a JS accessor exposes native storage without duplicating the Blue scalar value.
     *
     * Blue row: Ball_Blue.cpp:357 MAP_ATTRIBUTE READWRITE | NOTIFY | PERSIST.
     * @returns {number} Current native value.
     */
    @blue.notify
    @blue.readwrite
    @blue.persist
    @type.float64
    @meta.adapted
    get gotoY()
    {
        return this.mGoto[1];
    }

    /**
     * Writes mGoto[1] through gotoY.
     * Adaptation: a JS accessor exposes native storage without duplicating the Blue scalar value.
     *
     * @param {number} value New native value.
     * @returns {void} Updates the shared storage.
     */
    @meta.adapted
    set gotoY(value)
    {
        this.mGoto[1] = value;
    }

    /**
     * Reads mGoto[2] through gotoZ.
     * Adaptation: a JS accessor exposes native storage without duplicating the Blue scalar value.
     *
     * Blue row: Ball_Blue.cpp:367 MAP_ATTRIBUTE READWRITE | NOTIFY | PERSIST.
     * @returns {number} Current native value.
     */
    @blue.notify
    @blue.readwrite
    @blue.persist
    @type.float64
    @meta.adapted
    get gotoZ()
    {
        return this.mGoto[2];
    }

    /**
     * Writes mGoto[2] through gotoZ.
     * Adaptation: a JS accessor exposes native storage without duplicating the Blue scalar value.
     *
     * @param {number} value New native value.
     * @returns {void} Updates the shared storage.
     */
    @meta.adapted
    set gotoZ(value)
    {
        this.mGoto[2] = value;
    }

    /**
     * Reads mOldPos[0] through _oldX.
     * The existing JS movement helper aliases native storage; no second value is retained.
     *
     * @returns {number} Current native value.
     */
    get _oldX()
    {
        return this.mOldPos[0];
    }

    /**
     * Writes mOldPos[0] through _oldX.
     * The existing JS movement helper aliases native storage; no second value is retained.
     *
     * @param {number} value New native value.
     * @returns {void} Updates the shared storage.
     */
    set _oldX(value)
    {
        this.mOldPos[0] = value;
    }

    /**
     * Reads mOldPos[1] through _oldY.
     * The existing JS movement helper aliases native storage; no second value is retained.
     *
     * @returns {number} Current native value.
     */
    get _oldY()
    {
        return this.mOldPos[1];
    }

    /**
     * Writes mOldPos[1] through _oldY.
     * The existing JS movement helper aliases native storage; no second value is retained.
     *
     * @param {number} value New native value.
     * @returns {void} Updates the shared storage.
     */
    set _oldY(value)
    {
        this.mOldPos[1] = value;
    }

    /**
     * Reads mOldPos[2] through _oldZ.
     * The existing JS movement helper aliases native storage; no second value is retained.
     *
     * @returns {number} Current native value.
     */
    get _oldZ()
    {
        return this.mOldPos[2];
    }

    /**
     * Writes mOldPos[2] through _oldZ.
     * The existing JS movement helper aliases native storage; no second value is retained.
     *
     * @param {number} value New native value.
     * @returns {void} Updates the shared storage.
     */
    set _oldZ(value)
    {
        this.mOldPos[2] = value;
    }

    /**
     * Reads mOldVel[0] through _oldVx.
     * The existing JS movement helper aliases native storage; no second value is retained.
     *
     * @returns {number} Current native value.
     */
    get _oldVx()
    {
        return this.mOldVel[0];
    }

    /**
     * Writes mOldVel[0] through _oldVx.
     * The existing JS movement helper aliases native storage; no second value is retained.
     *
     * @param {number} value New native value.
     * @returns {void} Updates the shared storage.
     */
    set _oldVx(value)
    {
        this.mOldVel[0] = value;
    }

    /**
     * Reads mOldVel[1] through _oldVy.
     * The existing JS movement helper aliases native storage; no second value is retained.
     *
     * @returns {number} Current native value.
     */
    get _oldVy()
    {
        return this.mOldVel[1];
    }

    /**
     * Writes mOldVel[1] through _oldVy.
     * The existing JS movement helper aliases native storage; no second value is retained.
     *
     * @param {number} value New native value.
     * @returns {void} Updates the shared storage.
     */
    set _oldVy(value)
    {
        this.mOldVel[1] = value;
    }

    /**
     * Reads mOldVel[2] through _oldVz.
     * The existing JS movement helper aliases native storage; no second value is retained.
     *
     * @returns {number} Current native value.
     */
    get _oldVz()
    {
        return this.mOldVel[2];
    }

    /**
     * Writes mOldVel[2] through _oldVz.
     * The existing JS movement helper aliases native storage; no second value is retained.
     *
     * @param {number} value New native value.
     * @returns {void} Updates the shared storage.
     */
    set _oldVz(value)
    {
        this.mOldVel[2] = value;
    }

    /**
     * Reads mLastG[0] through _lastGx.
     * The existing JS movement helper aliases native storage; no second value is retained.
     *
     * @returns {number} Current native value.
     */
    get _lastGx()
    {
        return this.mLastG[0];
    }

    /**
     * Writes mLastG[0] through _lastGx.
     * The existing JS movement helper aliases native storage; no second value is retained.
     *
     * @param {number} value New native value.
     * @returns {void} Updates the shared storage.
     */
    set _lastGx(value)
    {
        this.mLastG[0] = value;
    }

    /**
     * Reads mLastG[1] through _lastGy.
     * The existing JS movement helper aliases native storage; no second value is retained.
     *
     * @returns {number} Current native value.
     */
    get _lastGy()
    {
        return this.mLastG[1];
    }

    /**
     * Writes mLastG[1] through _lastGy.
     * The existing JS movement helper aliases native storage; no second value is retained.
     *
     * @param {number} value New native value.
     * @returns {void} Updates the shared storage.
     */
    set _lastGy(value)
    {
        this.mLastG[1] = value;
    }

    /**
     * Reads mLastG[2] through _lastGz.
     * The existing JS movement helper aliases native storage; no second value is retained.
     *
     * @returns {number} Current native value.
     */
    get _lastGz()
    {
        return this.mLastG[2];
    }

    /**
     * Writes mLastG[2] through _lastGz.
     * The existing JS movement helper aliases native storage; no second value is retained.
     *
     * @param {number} value New native value.
     * @returns {void} Updates the shared storage.
     */
    set _lastGz(value)
    {
        this.mLastG[2] = value;
    }

    /**
     * Reads mTimeFactor through _timeFactor.
     * The existing JS movement helper aliases native storage; no second value is retained.
     *
     * @returns {number} Current native value.
     */
    get _timeFactor()
    {
        return this.mTimeFactor;
    }

    /**
     * Writes mTimeFactor through _timeFactor.
     * The existing JS movement helper aliases native storage; no second value is retained.
     *
     * @param {number} value New native value.
     * @returns {void} Updates the shared storage.
     */
    set _timeFactor(value)
    {
        this.mTimeFactor = value;
    }

    /**
     * Reads mFollowPtr through _followPtr.
     * The existing JS movement helper aliases native storage; no second value is retained.
     *
     * @returns {CjsDestinyBall|null} Current native value.
     */
    get _followPtr()
    {
        return this.mFollowPtr;
    }

    /**
     * Writes mFollowPtr through _followPtr.
     * The existing JS movement helper aliases native storage; no second value is retained.
     *
     * @param {CjsDestinyBall|null} value New native value.
     * @returns {void} Updates the shared storage.
     */
    set _followPtr(value)
    {
        this.mFollowPtr = value;
    }

    /**
     * Reads mFollowers through _followers.
     * The existing JS movement helper aliases native storage; no second value is retained.
     *
     * @returns {Set<bigint>} Current native value.
     */
    get _followers()
    {
        return this.mFollowers;
    }

    /**
     * Writes mFollowers through _followers.
     * The existing JS movement helper aliases native storage; no second value is retained.
     *
     * @param {Set<bigint>} value New native value.
     * @returns {void} Updates the shared storage.
     */
    set _followers(value)
    {
        this.mFollowers = value;
    }

    /**
     * Reads the owned native MiniBall descriptor list.
     * Adaptation: runtime BlueList replaces RootParentLock ownership; the list remains mutable.
     * Source: destiny/src/Ball.h:170-175; destiny/src/Ball_Blue.cpp:444-452.
     * @returns {BlueList<CjsDestinyMiniBall>} Descriptors, not materialized Ball objects.
     */
    @meta.adapted
    get miniBalls() { return this.mMiniBalls; }

    /**
     * Reads the owned native MiniCapsule descriptor list.
     * Adaptation: runtime BlueList replaces RootParentLock ownership; the list remains mutable.
     * Source: destiny/src/Ball_Blue.cpp:453-460.
     * @returns {BlueList<CjsDestinyMiniCapsule>} Local descriptors, independent of world copies.
     */
    @meta.adapted
    get miniCapsules() { return this.mMiniCapsules; }

    /**
     * Reads the owned native MiniBox descriptor list.
     * Adaptation: runtime BlueList replaces RootParentLock ownership; the list remains mutable.
     * Source: destiny/src/Ball_Blue.cpp:461-468.
     * @returns {BlueList<CjsDestinyMiniBox>} Local descriptors, independent of world copies.
     */
    @meta.adapted
    get miniBoxes() { return this.mMiniBoxes; }

    /**
     * Materializes every MiniBall descriptor when this parent is fixed.
     * Source: destiny/src/Ball.cpp:1634-1652.
     * @returns {void} Retains descriptors and replaces their IDs after each creation.
     */
    @meta.implemented
    AddMiniBalls()
    {
        if (this.isFree) return;
        const size = this.mMiniBalls.GetSize();
        for (let i = 0; i < size; ++i) this.AddActualMiniball(this.mMiniBalls.GetAt(i));
    }

    /**
     * Removes descriptor-named MiniBall objects in forward list order.
     * Source: destiny/src/Ball.cpp:1654-1665.
     * @returns {void} Does not clear descriptors or reset their IDs.
     */
    @meta.implemented
    RemoveMiniBalls()
    {
        const size = this.mMiniBalls.GetSize();
        for (let i = 0; i < size; ++i) this.mPark.RemoveBall(this.mMiniBalls.GetAt(i).mId);
    }

    /**
     * Creates a fixed MiniBall translated by the parent's current position only.
     * Adaptation: JS references replace native pointers and shared callback state.
     * Source: destiny/src/Ball.cpp:1667-1686.
     * @param {CjsDestinyMiniBall} b Local descriptor; its ID changes after insertion returns.
     * @returns {void} Free parents do nothing; repeated calls leave prior colliders alive.
     */
    @meta.adapted
    AddActualMiniball(b)
    {
        if (this.isFree) return;
        if (!this.mPark) { this.RegisterBallNotInPark(); return; }
        const ball = this.mPark.AddMiniball(this.mId, this.mMass, b.mRadius,
            this.mNewPos[0] + b.mPos[0], this.mNewPos[1] + b.mPos[1], this.mNewPos[2] + b.mPos[2]);
        b.mId = ball.mId;
    }

    /**
     * Appends a local MiniBall descriptor, then attaches it if the parent is fixed.
     * Adaptation: GC replaces native allocation/Unlock; radius narrows to native float32.
     * Source: destiny/src/Ball.cpp:1688-1709.
     * @param {number} x Local center X.
     * @param {number} y Local center Y.
     * @param {number} z Local center Z.
     * @param {number} r Descriptor radius; the actual Ball clamps negative values.
     * @returns {void} The descriptor is accessible through miniBalls.
     */
    @blue.method
    @meta.adapted
    AddMiniBall(x, y, z, r)
    {
        const b = new CjsDestinyMiniBall();
        vec3.set(b.mPos, x, y, z);
        b.mRadius = f32(r);
        this.mMiniBalls.Insert(-1, b);
        if (!this.isFree) this.AddActualMiniball(b);
    }

    /**
     * Materializes every MiniCapsule descriptor when this parent is fixed.
     * Source: destiny/src/Ball.cpp:1711-1728.
     * @returns {void} Retains descriptors and replaces IDs after creation.
     */
    @meta.implemented
    AddMiniCapsules()
    {
        if (this.isFree) return;
        const size = this.mMiniCapsules.GetSize();
        for (let i = 0; i < size; ++i) this.AddActualMinicapsule(this.mMiniCapsules.GetAt(i));
    }

    /**
     * Removes descriptor-named capsules in forward list order.
     * Source: destiny/src/Ball.cpp:1730-1741.
     * @returns {void} Does not clear descriptors or reset IDs.
     */
    @meta.implemented
    RemoveMiniCapsules()
    {
        const size = this.mMiniCapsules.GetSize();
        for (let i = 0; i < size; ++i) this.mPark.RemoveCapsule(this.mMiniCapsules.GetAt(i).mId);
    }

    /**
     * Creates a capsule from translated endpoints without applying parent rotation.
     * Adaptation: direct JS arguments replace vector fields and native pointers.
     * Source: destiny/src/Ball.cpp:1743-1767.
     * @param {CjsDestinyMiniCapsule} c Descriptor whose saved parent ID is passed through.
     * @returns {void} Updates the descriptor ID after world insertion.
     */
    @meta.adapted
    AddActualMinicapsule(c)
    {
        if (this.isFree) return;
        if (!this.mPark) { this.RegisterBallNotInPark(); return; }
        const capsule = this.mPark.AddCapsule(-1n, c.mParentBallID,
            this.mNewPos[0] + c.mHemisphereA[0], this.mNewPos[1] + c.mHemisphereA[1], this.mNewPos[2] + c.mHemisphereA[2],
            this.mNewPos[0] + c.mHemisphereB[0], this.mNewPos[1] + c.mHemisphereB[1], this.mNewPos[2] + c.mHemisphereB[2], c.mRadius);
        c.mId = capsule.mId;
    }

    /**
     * Appends a local capsule descriptor, attaching it immediately for fixed parents.
     * Adaptation: GC replaces native allocation/Unlock; radius narrows to float32.
     * This C++ entry point has no positive-radius check; PyAddMiniCapsule does.
     * Source: destiny/src/Ball.cpp:1769-1796.
     * @param {number} ax First endpoint local X.
     * @param {number} ay First endpoint local Y.
     * @param {number} az First endpoint local Z.
     * @param {number} bx Second endpoint local X.
     * @param {number} by Second endpoint local Y.
     * @param {number} bz Second endpoint local Z.
     * @param {number} r Native descriptor radius.
     * @returns {void} Appends to miniCapsules before attempting attachment.
     */
    @meta.adapted
    AddMiniCapsule(ax, ay, az, bx, by, bz, r)
    {
        const c = new CjsDestinyMiniCapsule();
        c.mParentBallID = this.mId;
        vec3.set(c.mHemisphereA, ax, ay, az);
        vec3.set(c.mHemisphereB, bx, by, bz);
        c.mRadius = f32(r);
        this.mMiniCapsules.Insert(-1, c);
        if (!this.isFree) this.AddActualMinicapsule(c);
    }

    /**
     * Appends a box descriptor from the four native Vector3d arguments.
     * Adaptation: copies caller-owned vector views into retained factory storage;
     * GC replaces native allocation/Unlock. PyAddMiniBox accepts the scalar form.
     * Source: destiny/src/Ball.cpp:1798-1821.
     * @param {Float64Array|number[]} corner Local corner.
     * @param {Float64Array|number[]} localX First edge vector.
     * @param {Float64Array|number[]} localY Second edge vector.
     * @param {Float64Array|number[]} localZ Third edge vector.
     * @returns {void} Appends to miniBoxes before attempting attachment.
     */
    @meta.adapted
    AddMiniBox(corner, localX, localY, localZ)
    {
        const b = new CjsDestinyMiniBox();
        b.mParentBallID = this.mId;
        vec3.copy(b.mCorner, corner);
        vec3.copy(b.mLocalX, localX);
        vec3.copy(b.mLocalY, localY);
        vec3.copy(b.mLocalZ, localZ);
        this.mMiniBoxes.Insert(-1, b);
        if (!this.isFree) this.AddActualMiniBox(b);
    }

    /**
     * Materializes every MiniBox descriptor when the parent is fixed.
     * Source: destiny/src/Ball.cpp:1823-1840.
     * @returns {void} Retains descriptors and overwrites their IDs after insertion.
     */
    @meta.implemented
    AddMiniBoxes()
    {
        if (this.isFree) return;
        const size = this.mMiniBoxes.GetSize();
        for (let i = 0; i < size; ++i) this.AddActualMiniBox(this.mMiniBoxes.GetAt(i));
    }

    /**
     * Removes descriptor-named oriented boxes in forward list order.
     * Source: destiny/src/Ball.cpp:1842-1853.
     * @returns {void} Does not clear descriptors or reset IDs.
     */
    @meta.implemented
    RemoveMiniBoxes()
    {
        const size = this.mMiniBoxes.GetSize();
        for (let i = 0; i < size; ++i) this.mPark.RemoveOrientedBox(this.mMiniBoxes.GetAt(i).mId);
    }

    /**
     * Creates an oriented box using a translated corner and unchanged local axes.
     * Adaptation: direct JS arguments replace native vector fields and pointers.
     * Source: destiny/src/Ball.cpp:1855-1879.
     * @param {CjsDestinyMiniBox} b Descriptor whose parent ID is retained.
     * @returns {void} Updates its ID after world insertion; free parents do nothing.
     */
    @meta.adapted
    AddActualMiniBox(b)
    {
        if (this.isFree) return;
        if (!this.mPark) { this.RegisterBallNotInPark(); return; }
        const box = this.mPark.AddOrientedBox(-1n, b.mParentBallID,
            b.mCorner[0] + this.mNewPos[0], b.mCorner[1] + this.mNewPos[1], b.mCorner[2] + this.mNewPos[2],
            b.mLocalX[0], b.mLocalX[1], b.mLocalX[2], b.mLocalY[0], b.mLocalY[1], b.mLocalY[2],
            b.mLocalZ[0], b.mLocalZ[1], b.mLocalZ[2]);
        b.mId = box.mId;
    }

    /**
     * Applies the Python MiniBall entry point using typed JS scalar arguments.
     * Adaptation: direct arguments and undefined return replace tuple parsing/Py_None.
     * Source: destiny/src/Ball.cpp:2129-2141.
     * @param {number} x Local center X.
     * @param {number} y Local center Y.
     * @param {number} z Local center Z.
     * @param {number} r Native float radius.
     * @returns {void} Delegates to AddMiniBall.
     */
    @meta.adapted
    PyAddMiniBall(x, y, z, r) { this.AddMiniBall(x, y, z, f32(r)); }

    /**
     * Applies the Python entry point's positive-radius check before appending.
     * Adaptation: typed JS arguments replace tuple parsing; RangeError represents ValueError.
     * Source: destiny/src/Ball.cpp:2143-2166.
     * @param {number} ax First local endpoint X.
     * @param {number} ay First local endpoint Y.
     * @param {number} az First local endpoint Z.
     * @param {number} bx Second local endpoint X.
     * @param {number} by Second local endpoint Y.
     * @param {number} bz Second local endpoint Z.
     * @param {number} r Radius checked after float32 narrowing.
     * @returns {void} Delegates to the unchecked native entry point.
     * @throws {RangeError} If the narrowed radius is nonpositive; native NaN passes.
     */
    @meta.adapted
    PyAddMiniCapsule(ax, ay, az, bx, by, bz, r)
    {
        r = f32(r);
        if (r <= 0) throw new RangeError("Radius must be positive");
        this.AddMiniCapsule(ax, ay, az, bx, by, bz, r);
    }

    /**
     * Adapts the Python scalar box entry point to four native vector arguments.
     * Adaptation: typed JS arguments replace tuple parsing; pooled f64 values
     * replace C++ stack vectors and remain borrowed until nested attachment returns.
     * Source: destiny/src/Ball.cpp:2168-2189.
     * @param {number} c0 Local corner X.
     * @param {number} c1 Local corner Y.
     * @param {number} c2 Local corner Z.
     * @param {number} x0 First edge X.
     * @param {number} x1 First edge Y.
     * @param {number} x2 First edge Z.
     * @param {number} y0 Second edge X.
     * @param {number} y1 Second edge Y.
     * @param {number} y2 Second edge Z.
     * @param {number} z0 Third edge X.
     * @param {number} z1 Third edge Y.
     * @param {number} z2 Third edge Z.
     * @returns {void} Appends through the native AddMiniBox method.
     */
    @meta.adapted
    PyAddMiniBox(c0, c1, c2, x0, x1, x2, y0, y1, y2, z0, z1, z2)
    {
        const vec3d_0 = vec3d.alloc(), vec3d_1 = vec3d.alloc(), vec3d_2 = vec3d.alloc(), vec3d_3 = vec3d.alloc();
        try
        {
            vec3.set(vec3d_0, c0, c1, c2); vec3.set(vec3d_1, x0, x1, x2);
            vec3.set(vec3d_2, y0, y1, y2); vec3.set(vec3d_3, z0, z1, z2);
            this.AddMiniBox(vec3d_0, vec3d_1, vec3d_2, vec3d_3);
        }
        finally
        {
            vec3d.unalloc(vec3d_3); vec3d.unalloc(vec3d_2); vec3d.unalloc(vec3d_1); vec3d.unalloc(vec3d_0);
        }
    }

    /**
     * Tests whether the ball is aligning or travelling in the native warp mode.
     * Source: destiny/src/Ball.cpp:1885-1888.
     * @returns {boolean} Whether its mode is WARP.
     */
    @meta.implemented
    IsWarpish() { return this.mMode === CjsDestinyBall.DSTBALLMODE.DSTBALL_WARP; }

    /**
     * Tests the native negative alignment-counter phase.
     * Source: destiny/src/Ball.cpp:1890-1893.
     * @returns {boolean} Whether the ball is in WARP with a negative effect stamp.
     */
    @meta.implemented
    IsAligningForWarp() { return this.IsWarpish() && this.mEffectStamp < 0; }

    /**
     * Tests the native proper-warp phase after alignment.
     * Source: destiny/src/Ball.cpp:1895-1898.
     * @returns {boolean} Whether WARP has a nonnegative start stamp.
     */
    @meta.implemented
    IsWarping() { return this.IsWarpish() && !this.IsAligningForWarp(); }

    /**
     * Checks native heading/speed thresholds or the strict alignment-tick timeout.
     * Adaptation: double scalar locals replace stack Vector3d values, preserving
     * zero-length normalization and avoiding float32 storage.
     * Source: destiny/src/Ball.cpp:1900-1923; destiny/src/Ball.h:23.
     * @returns {boolean} Whether an aligning ball may begin proper warp.
     */
    @meta.adapted
    IsAlignedForWarp()
    {
        if (!this.IsAligningForWarp()) return false;
        let x = this.mGoto[0] - this.mNewPos[0], y = this.mGoto[1] - this.mNewPos[1], z = this.mGoto[2] - this.mNewPos[2];
        let vx = this.mNewVel[0], vy = this.mNewVel[1], vz = this.mNewVel[2];
        const speed2 = vx * vx + vy * vy + vz * vz;
        let norm = Math.sqrt(x * x + y * y + z * z);
        if (norm !== 0) { norm = 1 / norm; x *= norm; y *= norm; z *= norm; }
        norm = Math.sqrt(speed2);
        if (norm !== 0) { norm = 1 / norm; vx *= norm; vy *= norm; vz *= norm; }
        if (Math.abs(1 - (vx * x + vy * y + vz * z)) < 0.01 && speed2 > 0.5625 * this.mMaxVel * this.mMaxVel) return true;
        return Math.abs(this.mEffectStamp) > 180;
    }

    /**
     * Activates a periodic sensor, retaining elapsed time unless shuffled.
     * Adaptation: Python defaults are accepted by the JS core; a Destiny-local
     * floatrand adapter replaces the process CRT RNG. Native status codes remain.
     * Source: destiny/src/Ball.cpp:244-261; Ball.h:31-40.
     * @param {number} range Float32 surface range; radius plus range must not be negative.
     * @param {number} [period=2] Period in seconds.
     * @param {number|boolean} [shuffle=0] Nonzero randomizes initial elapsed time.
     * @param {boolean} [onlyInteractives=false] Restrict candidates to interactive balls.
     * @returns {number} Zero on activation, minus one on rejected combined radius.
     */
    @meta.adapted
    AddProximitySensor(range, period = 2, shuffle = 0, onlyInteractives = false)
    {
        range = f32(range);
        if (f32(this.mRadius + range) < 0) return -1;
        this.mSensor.balls.clear();
        this.mSensor.range = range;
        this.mSensor.period = period;
        this.mSensor.active = true;
        this.mSensor.onlyInteractives = Boolean(onlyInteractives);
        if (shuffle) this.mSensor.elapsed = CjsDestinyBall.floatrand(0, period);
        this.UpdateProximityStatus();
        return 0;
    }

    /**
     * Registers any active proximity function without replacing an existing ID entry.
     * Adaptation: JS Map preserves insertion order instead of native unordered order.
     * A detached call throws at park access, matching the absence of a native guard.
     * Source: destiny/src/Ball.cpp:266-277.
     * @returns {void} Updates mHasProximity and the owning park's registration.
     */
    @meta.adapted
    UpdateProximityStatus()
    {
        if (this.mTrackingRange !== 0 || this.mNotificationRange !== 0 || this.mSensor.active)
        {
            this.mHasProximity = true;
            if (!this.mPark.mProximityBalls.has(this.mId)) this.mPark.mProximityBalls.set(this.mId, this);
        }
        else
        {
            this.mHasProximity = false;
            this.mPark.mProximityBalls.delete(this.mId);
        }
    }

    /**
     * Disables the sensor without clearing its timing or remembered contacts.
     * Source: destiny/src/Ball.cpp:284-288.
     * @returns {void} Other proximity functions can keep the ball registered.
     */
    @meta.implemented
    RemoveProximitySensor()
    {
        this.mSensor.active = false;
        this.UpdateProximityStatus();
    }

    /**
     * Checks destination notification, target tracking and the active sensor in order.
     * Adaptation: retained JS references replace native pointer lifetimes; detached
     * entry invokes the existing host callback. The entry host survives callback
     * detachment, as native global PyOS does. There is no mid-callback recheck.
     * Source: destiny/src/Ball.cpp:494-517.
     * @returns {void} Moribund entry skips every proximity function.
     */
    @meta.adapted
    CheckForProximity()
    {
        if (!this.mPark) { this.RegisterBallNotInPark(); return; }
        if (this.isMoribund) return;
        const pyOS = this.mPark._pyOS;
        this.CheckForProximity_NotificationRange(pyOS);
        this.CheckForProximity_TargetTracking(pyOS);
        if (this.mSensor.active) this.CheckForProximity_Sensor();
    }

    /**
     * Emits transitions across the native strict destination/follow-range boundaries.
     * Adaptation: scalar double locals replace vectors and injected PyOS replaces
     * global dispatch. Zero notification range retains the previous within flag.
     * Source: destiny/src/Ball.cpp:520-594.
     * @param {object|null} [pyOS] Entry host retained across callback detachment.
     * @returns {void} Commits mWithinRange before sending DoRange.
     */
    @meta.adapted
    CheckForProximity_NotificationRange(pyOS = this.mPark && this.mPark._pyOS)
    {
        if (this.mNotificationRange === 0) return;
        let inside = false;
        if (this.mMode === CjsDestinyBall.DSTBALLMODE.DSTBALL_GOTO)
        {
            const x = this.mNewPos[0] - this.mGoto[0], y = this.mNewPos[1] - this.mGoto[1], z = this.mNewPos[2] - this.mGoto[2];
            const limit = this.mNotificationRange + this.mRadius;
            inside = x * x + y * y + z * z < limit * limit;
        }
        else if (this.mMode === CjsDestinyBall.DSTBALLMODE.DSTBALL_FOLLOW
            || this.mMode === CjsDestinyBall.DSTBALLMODE.DSTBALL_MISSILE
            || this.mMode === CjsDestinyBall.DSTBALLMODE.DSTBALL_ORBIT)
        {
            const other = this.mFollowPtr;
            const x = this.mNewPos[0] - other.mNewPos[0], y = this.mNewPos[1] - other.mNewPos[1], z = this.mNewPos[2] - other.mNewPos[2];
            const length2 = x * x + y * y + z * z;
            const high = other.mRadius + this.mFollowRange + this.mNotificationRange + this.mRadius;
            let low = high - 2 * this.mNotificationRange;
            if (low < 0) low = 0;
            inside = length2 < high * high && length2 > low * low;
        }
        if (inside === this.mWithinRange) return;
        this.mWithinRange = inside;
        if (pyOS && !pyOS.SendEvent(this, "Destiny::Ball::DoRange", "DoRange", null, "(i)", Number(this.mWithinRange))) pyOS.PyError();
    }

    /**
     * Emits strict target-distance transitions using only this ball's radius.
     * Adaptation: scalar double arithmetic and injected PyOS replace native values.
     * Disabled tracking retains its prior within flag and captured target pointer.
     * Source: destiny/src/Ball.cpp:595-640.
     * @param {object|null} [pyOS] Entry host retained across callback detachment.
     * @returns {void} Commits mWithinTrackingRange before DoTargetTracking.
     */
    @meta.adapted
    CheckForProximity_TargetTracking(pyOS = this.mPark && this.mPark._pyOS)
    {
        if (!(this.mTrackingRange >= 0.00001) || !this.mTrackingPtr) return;
        const other = this.mTrackingPtr;
        const x = this.mNewPos[0] - other.mNewPos[0], y = this.mNewPos[1] - other.mNewPos[1], z = this.mNewPos[2] - other.mNewPos[2];
        const limit = this.mTrackingRange + this.mRadius;
        const inside = x * x + y * y + z * z < limit * limit;
        if (inside === this.mWithinTrackingRange) return;
        this.mWithinTrackingRange = inside;
        if (pyOS && !pyOS.SendEvent(this, "Destiny::Ball::DoTargetTracking", "DoTargetTracking", null, "(i)", Number(inside))) pyOS.PyError();
    }

    /**
     * Scans candidates with a temporarily enlarged radius, then emits enter/leave events.
     * Adaptation: owned arrays survive callback reentry; Map/Set replace unordered
     * native containers. Scalar velocity snapshots and finally restore temporary
     * state after JS exceptions using the captured park. The host is captured for
     * this scan, replacing native global PyOS. Static candidates are not consumed.
     * Source: destiny/src/Ball.cpp:642-775.
     * @returns {void} Drops elapsed overshoot and restores geometry before events.
     */
    @meta.adapted
    CheckForProximity_Sensor()
    {
        const park = this.mPark, pyOS = park._pyOS;
        this.mSensor.elapsed += park.dt;
        if (this.mSensor.elapsed < this.mSensor.period) return;
        this.mSensor.elapsed = 0;
        const radius = this.mRadius, vx = this.mNewVel[0], vy = this.mNewVel[1], vz = this.mNewVel[2];
        const uni = [], uniStat = [];
        vec3.zero(this.mNewVel);
        try
        {
            park.SetBallRadius(this, f32(this.mRadius + this.mSensor.range));
            park.mPartition.GetProximityCandidates(this, uni, uniStat, park.isMaster);
        }
        finally
        {
            vec3.set(this.mNewVel, vx, vy, vz);
            park.SetBallRadius(this, radius);
        }
        if (this.mSensor.balls.size > 0)
        {
            const nearby = new Set();
            for (const ball of uni) nearby.add(ball.mId);
            for (const id of this.mSensor.balls.keys())
            {
                if (id === this.mId || nearby.has(id)) continue;
                this.mSensor.balls.delete(id);
                if (pyOS && !pyOS.SendEvent(this, "Destiny::Ball::DoProximity", "DoProximity", null, "Li", id, 0)) pyOS.PyError();
                if (!this.mSensor.active) break;
            }
        }
        // Native quirk: a vanished-contact callback can disable the sensor, but
        // one candidate is still processed before the loop's trailing active check.
        for (const ball of uni)
        {
            if (this.isMoribund) break;
            if (ball.mId === this.mId || ball.isMoribund) continue;
            const present = this.mSensor.balls.has(ball.mId);
            const x = this.mNewPos[0] - ball.mNewPos[0], y = this.mNewPos[1] - ball.mNewPos[1], z = this.mNewPos[2] - ball.mNewPos[2];
            const range = f32(f32(this.mSensor.range + ball.mRadius) + this.mRadius);
            if (x * x + y * y + z * z > range * range)
            {
                if (present)
                {
                    this.mSensor.balls.delete(ball.mId);
                    if (pyOS && !pyOS.SendEvent(this, "Destiny::Ball::DoProximity", "DoProximity", null, "Li", ball.mId, 0)) pyOS.PyError();
                }
            }
            else if (!present)
            {
                this.mSensor.balls.insert(ball.mId, 0n);
                if (pyOS && !pyOS.SendEvent(this, "Destiny::Ball::DoProximity", "DoProximity", null, "Li", ball.mId, 1)) pyOS.PyError();
            }
            if (!this.mSensor.active) break;
        }
    }

    /**
     * Binds optional Python sensor arguments and discards the native status code.
     * Adaptation: JS defaults and explicit arity/byte checks replace tuple parsing.
     * Source: destiny/src/Ball.cpp:2243-2263.
     * @param {number} range Float32 sensor range.
     * @param {number} [period=2] Period in seconds.
     * @param {number|boolean} [shuffle=0] Signed-int32 shuffle flag.
     * @param {number|boolean} [onlyInteractives=0] Unsigned-byte filter flag.
     * @returns {void} Native rejection is not returned by the Python binding.
     */
    @meta.adapted
    PyAddProximitySensor(range, period = 2, shuffle = 0, onlyInteractives = 0)
    {
        if (arguments.length < 1 || arguments.length > 4) throw new TypeError("PyAddProximitySensor requires 1 to 4 arguments");
        if (typeof shuffle === "boolean") shuffle = Number(shuffle);
        if (typeof onlyInteractives === "boolean") onlyInteractives = Number(onlyInteractives);
        if (!Number.isInteger(shuffle) || shuffle < -2147483648 || shuffle > 2147483647
            || !Number.isInteger(onlyInteractives) || onlyInteractives < 0 || onlyInteractives > 255)
            throw new RangeError("Sensor flags exceed native integer storage");
        this.AddProximitySensor(range, period, shuffle, onlyInteractives !== 0);
    }

    /**
     * Dispatches the initial number of queued collisions without clearing the list.
     * Adaptation: the attached park's injected PyOS replaces global native dispatch;
     * detached balls have no bridge. Collider IDs and force are read again for each
     * event, while appended entries wait until the next call. Host errors propagate.
     * Source: destiny/src/Ball.cpp:468-488.
     * @returns {void} Collision callbacks own damage, explosion and removal policy.
     */
    @meta.adapted
    DispatchCollisions()
    {
        const size = this.mCollisions.length, pyOS = this.mPark && this.mPark._pyOS;
        if (!pyOS) return;
        for (let i = 0; i < size; ++i)
            if (!pyOS.SendEvent(this, "Destiny::Ball::DoCollision", "DoCollision", null, "Lddd",
                this.mCollisions[i], this.mLastC[0], this.mLastC[1], this.mLastC[2])) pyOS.PyError();
    }

    /**
     * Reads the native readonly effect counter, also used as warp start/alignment state.
     * Source: destiny/src/Ball_Blue.cpp:407-414.
     * Blue row: Ball_Blue.cpp:408 MAP_ATTRIBUTE READ | PERSIST.
     * @returns {number} Native simulation counter value.
     */
    @blue.read
    @blue.persist
    @type.int32
    @meta.implemented
    get effectStamp() { return this.mEffectStamp; }

    /**
     * Reads the native owner identity, repurposed as an integer warp factor.
     * Adaptation: signed-int64 BigInt preserves the native storage exactly.
     * Source: destiny/src/Ball_Blue.cpp:395-405.
     * Blue row: Ball_Blue.cpp:398 MAP_ATTRIBUTE READWRITE | PERSIST.
     * @returns {bigint} Native owner/factor bits.
     */
    @blue.readwrite
    @blue.persist
    @type.int64
    @meta.adapted
    get ownerId() { return this.mOwnerId; }

    /**
     * Writes the native owner field without additional notifications.
     * Adaptation: safe Number inputs normalize to checked signed-int64 BigInt.
     * @param {bigint|number} value Owner identity or warp factor.
     * @returns {void} Updates the shared native backing field.
     */
    @meta.adapted
    set ownerId(value) { this.mOwnerId = CjsDestinyBall._toInt64(value); }

    /**
     * Reads the native readonly Blue byte view of the signed-char formation identity.
     * Adaptation: masks the backing char to reproduce Blue's unsigned field read.
     * Source: destiny/src/Ball_Blue.cpp:436-442.
     * @returns {number} Formation byte, including 255 for the native -1 sentinel.
     */
    @blue.read
    @type.uint8
    @meta.adapted
    get formationID() { return this.mFormationID & 255; }

    /**
     * Reserves the first unused slot in the leader's current formation.
     * Adaptation: a 16-bit Number mask replaces std::bitset; JS arrays own vectors.
     * Source: destiny/src/Ball.cpp:2275-2306.
     * @returns {number} Slot index or native -1 for unavailable/invalid formations.
     */
    @blue.method
    @meta.adapted
    ReserveFormationSlot()
    {
        if (this.mFormationID === -1 || !this.mPark) return -1;
        if (this.mFormationID > this.mPark.mFormations.length - 1) return -1;
        const count = this.mPark.mFormations[this.mFormationID].length;
        if (count > 16) return -1;
        for (let i = 0; i < count; ++i)
        {
            if (this.mFormationSlots & (1 << i)) continue;
            this.mFormationSlots |= 1 << i;
            return i;
        }
        return -1;
    }

    /**
     * Clears one reserved slot when the native formation-size check permits it.
     * Adaptation: BigInt reproduces the uint64 size_t comparison, including empty
     * formation underflow. RangeError replaces std::bitset::reset out_of_range.
     * Source: destiny/src/Ball.cpp:2324-2351.
     * @param {number|bigint} slot Native size_t slot; a negative integer wraps unsigned.
     * @returns {void} Does not stop or unlink followers occupying the slot.
     */
    @blue.method
    @meta.adapted
    FreeFormationSlot(slot)
    {
        if (this.mFormationID === -1 || !this.mPark) return;
        if (this.mFormationID > this.mPark.mFormations.length - 1) return;
        const count = this.mPark.mFormations[this.mFormationID].length;
        const index = BigInt.asUintN(64, BigInt(slot));
        if (index > BigInt.asUintN(64, BigInt(count) - 1n)) return;
        if (index >= 16n) throw new RangeError("Formation bitset index is out of range");
        this.mFormationSlots &= ~(1 << Number(index));
    }

    /**
     * Reads the native collision harmonic used by field filtering.
     * Adaptation: signed-int64 BigInt preserves the complete native value.
     * Source: destiny/src/Ball_Blue.cpp:126-134.
     * Blue row: Ball_Blue.cpp:127 MAP_ATTRIBUTE READWRITE | NOTIFY | PERSIST.
     * @returns {bigint} Current collision harmonic.
     */
    @blue.notify
    @blue.readwrite
    @blue.persist
    @type.int64
    @meta.adapted
    get harmonic() { return this.mHarmonic; }

    /**
     * Stores harmonic and notifies the park with field disabled, even if unchanged.
     * Adaptation: checked BigInt and direct dispatch replace Blue storage/OnModified.
     * Source: destiny/src/Ball.cpp:1511-1512,1617-1620.
     * @param {bigint|number} value Signed-int64 harmonic.
     * @returns {void} An attached FIELD ball is stopped by its notification.
     */
    @meta.adapted
    set harmonic(value)
    {
        this.mHarmonic = CjsDestinyBall._toInt64(value);
        if (this.mPark) this.mPark.SetBallHarmonic(this.mId, this.mHarmonic, this.mCorporationID, this.mAllianceID, false);
    }

    /**
     * Reads the native corporation used by field filtering.
     * Source: destiny/src/Ball_Blue.cpp:136-144.
     * Blue row: Ball_Blue.cpp:137 MAP_ATTRIBUTE READWRITE | NOTIFY | PERSIST.
     * @returns {number} Signed-int32 corporation value.
     */
    @blue.notify
    @blue.readwrite
    @blue.persist
    @type.int32
    @meta.implemented
    get corporationID() { return this.mCorporationID; }

    /**
     * Stores corporation and invokes the native non-field notification branch.
     * Adaptation: checked JS storage and direct dispatch replace Blue OnModified.
     * Source: destiny/src/Ball.cpp:1511-1512,1621-1624.
     * @param {number} value Signed-int32 corporation value.
     * @returns {void} Detached balls store without notifying a park.
     */
    @meta.adapted
    set corporationID(value)
    {
        if (!Number.isInteger(value) || value < -2147483648 || value > 2147483647)
            throw new RangeError("Corporation ID must fit native int32");
        this.mCorporationID = value;
        if (this.mPark) this.mPark.SetBallHarmonic(this.mId, this.mHarmonic, this.mCorporationID, this.mAllianceID, false);
    }

    /**
     * Reads the native alliance used by field filtering.
     * Source: destiny/src/Ball_Blue.cpp:146-154.
     * Blue row: Ball_Blue.cpp:147 MAP_ATTRIBUTE READWRITE | NOTIFY | PERSIST.
     * @returns {number} Signed-int32 alliance value.
     */
    @blue.notify
    @blue.readwrite
    @blue.persist
    @type.int32
    @meta.implemented
    get allianceID() { return this.mAllianceID; }

    /**
     * Stores alliance and invokes the native non-field notification branch.
     * Adaptation: checked JS storage and direct dispatch replace Blue OnModified.
     * Source: destiny/src/Ball.cpp:1511-1512,1625-1628.
     * @param {number} value Signed-int32 alliance value.
     * @returns {void} Detached balls store without notifying a park.
     */
    @meta.adapted
    set allianceID(value)
    {
        if (!Number.isInteger(value) || value < -2147483648 || value > 2147483647)
            throw new RangeError("Alliance ID must fit native int32");
        this.mAllianceID = value;
        if (this.mPark) this.mPark.SetBallHarmonic(this.mId, this.mHarmonic, this.mCorporationID, this.mAllianceID, false);
    }

    /**
     * Invokes Carbon's process-global detached-ball callback when one is registered.
     * Adaptation: shared JS backing avoids a Ball-to-Ballpark module cycle; the
     * park exposes the native static name. JS exceptions propagate instead of
     * remaining as an unchecked CPython error. Callback return values are ignored.
     * Source: destiny/src/Ball.cpp:144-155.
     * @returns {void} No action when the callback is null or undefined.
     */
    @meta.adapted
    RegisterBallNotInPark()
    {
        const callback = CjsDestinyBall._ballNotInParkCallback;
        if (callback !== null && callback !== undefined) callback(this);
    }

    /**
     * Sends mode-change events before storing the new native movement mode.
     * Adaptation: the attached park's injected PyOS supplies native events; a
     * detached ball has no global PyOS bridge. Host exceptions propagate in JS.
     * Source: destiny/src/Ball.cpp:905-938.
     * @param {number} mode Native DSTBALLMODE value.
     * @returns {void} Equal modes store again without emitting events.
     */
    @meta.adapted
    SetMode(mode)
    {
        const pyOS = this.mPark && this.mPark._pyOS;
        if (mode !== this.mMode && pyOS)
        {
            if (mode !== CjsDestinyBall.DSTBALLMODE.DSTBALL_WARP && this.mMode === CjsDestinyBall.DSTBALLMODE.DSTBALL_WARP)
                if (!pyOS.PostEvent(this.mPark, "Destiny::OnExitWarp", "OnExitWarp", "Li", this.mId, 0)) pyOS.PyError();
            if (!pyOS.SendEvent(this, "Destiny::Ball::DoModeChange", "DoModeChange", null, "ii", this.mMode, mode)) pyOS.PyError();
        }
        this.mMode = mode;
    }

    /**
     * Supplies the native sensor-shuffle helper with a JavaScript random fraction.
     * Adaptation: Math.random replaces platform CRT rand/RAND_MAX; sequences and
     * the upper-endpoint distribution differ. Replace this helper in deterministic
     * host tests rather than treating it as Destiny's unrelated Random class.
     * Source: destiny/src/Ball.cpp:19-22.
     * @param {number} a Lower interpolation endpoint.
     * @param {number} b Upper interpolation endpoint.
     * @returns {number} Interpolated value with the original arithmetic order.
     */
    @meta.adapted
    static floatrand(a, b) { return a + Math.random() * (b - a); }

    /**
     * Converts a native signed-int64 primitive without losing identity or time precision.
     * JS adaptation: Number cannot represent the whole ID/Be::Time domain. This
     * internal binding helper accepts BigInt or safe integer Numbers, rejects
     * coercible strings/booleans and overflow, and never wraps signed arithmetic.
     * It replaces native typed/Python integer conversion, not simulation schema APIs.
     *
     * @param {bigint|number} value Native ID or 100ns timestamp value.
     * @returns {bigint} Exact signed-int64 value.
     * @throws {RangeError} If the value is not an exact signed-int64 input.
     */
    static _toInt64(value)
    {
        if (typeof value === "number" && Number.isSafeInteger(value)) value = BigInt(value);
        if (typeof value !== "bigint" || value < -9223372036854775808n || value > 9223372036854775807n)
        {
            throw new RangeError("Native int64 values must be signed-int64 BigInts or safe integers");
        }
        return value;
    }



    /**
     * Selects Carbon's nearest equivalent target angle, retaining strict tie rules.
     * Adaptation: caller wraps its first angle in place; JS returns the second value.
     * Source: destiny/src/Ball.cpp:777-808.
     * @param {number} a First angle, already reduced modulo two pi.
     * @param {number} b Target angle.
     * @returns {number} Wrapped target nearest to a.
     */
    @meta.adapted
    static _modulo2pi(a, b)
    {
        const tau = 2 * Math.PI;
        b %= tau;
        if (Math.abs(b - a) < Math.abs(b + tau - a))
            return Math.abs(b - a) < Math.abs(b - tau - a) ? b : b - tau;
        return Math.abs(b + tau - a) < Math.abs(b - tau - a) ? b + tau : b - tau;
    }

    /**
     * Retains native homogeneous division for orientation direction transforms.
     * Runtime transformMat4 changes zero/NaN divisors to one. This scalar adapter
     * preserves Carbon's zero result for zero divisors and propagation of NaNs,
     * including float32 intermediate sums; output is written after every input read.
     * Source: math/include/Matrix_inline.h:560-578.
     * @param {Float32Array} out Caller-owned result, possibly aliasing value.
     * @param {Float32Array} value Direction or coordinate to transform.
     * @param {Float32Array} matrix Native-layout matrix.
     * @returns {Float32Array} The supplied output.
     */
    @meta.adapted
    static _transformCoord(out, value, matrix)
    {
        const x = value[0], y = value[1], z = value[2];
        const norm = f32(f32(f32(f32(matrix[3] * x) + f32(matrix[7] * y)) + f32(matrix[11] * z)) + matrix[15]);
        if (norm === 0) return vec3.zero(out);
        const ox = f32(f32(f32(f32(x * matrix[0]) + f32(y * matrix[4])) + f32(z * matrix[8])) + matrix[12]);
        const oy = f32(f32(f32(f32(x * matrix[1]) + f32(y * matrix[5])) + f32(z * matrix[9])) + matrix[13]);
        const oz = f32(f32(f32(f32(x * matrix[2]) + f32(y * matrix[6])) + f32(z * matrix[10])) + matrix[14]);
        return vec3.set(out, ox / norm, oy / norm, oz / norm);
    }

    /**
     * Stages native float32 products and sums for branch-sensitive vector dots.
     * Runtime dot uses double intermediates, which can postpone native overflow.
     * Source: math/include/Vector3_inline.h:163-166.
     * @param {Float32Array} a First float vector.
     * @param {Float32Array} b Second float vector.
     * @returns {number} Native float32 dot product.
     */
    @meta.adapted
    static _dotVector3(a, b)
    {
        return f32(f32(f32(a[0] * b[0]) + f32(a[1] * b[1])) + f32(a[2] * b[2]));
    }

    /**
     * Computes native float length, including overflow before the square root.
     * Runtime length computes squared length in double precision; this adapter
     * retains native branch decisions for large finite float components.
     * Source: math/include/Vector3_inline.h:169-178.
     * @param {Float32Array} value Native float vector.
     * @returns {number} Float32 length, possibly nonfinite.
     */
    @meta.adapted
    static _lengthVector3(value)
    {
        return f32(Math.sqrt(CjsDestinyBall._dotVector3(value, value)));
    }

    /**
     * Normalizes using Carbon's largest-component scaling before float32 length.
     * Runtime normalize uses an unscaled double squared length. This local adapter
     * retains the donor's zero and nonfinite behavior without changing runtime.
     * Source: math/include/Vector3_inline.h:181-192.
     * @param {Float32Array} out Caller-owned output, possibly value itself.
     * @param {Float32Array} value Input direction.
     * @returns {Float32Array} The supplied output after all input reads.
     */
    @meta.adapted
    static _normalizeVector3(out, value)
    {
        let x = value[0], y = value[1], z = value[2];
        const ax = Math.abs(x), ay = Math.abs(y), az = Math.abs(z);
        const xy = ax < ay ? ay : ax, largest = xy < az ? az : xy;
        const divisor = largest !== 0 ? largest : 1;
        const inverse = f32(1 / divisor);
        x = f32(x * inverse); y = f32(y * inverse); z = f32(z * inverse);
        let length = f32(Math.sqrt(f32(f32(f32(x * x) + f32(y * y)) + f32(z * z))));
        if (length !== 0) length = f32(1 / length);
        return vec3.set(out, x * length, y * length, z * length);
    }

    /**
     * Adapts native axis normalization and axis-angle construction.
     * Runtime setAxisAngle requires a normalized axis; these scalar steps preserve
     * Carbon's largest-component scaling, zero-axis result and float32 boundaries.
     * Source: math/include/Vector3_inline.h:181-192; math/include/Quaternion_inline.h:232-242.
     * @param {Float32Array} out Caller-owned quaternion, possibly aliased with input.
     * @param {number} x Axis X component.
     * @param {number} y Axis Y component.
     * @param {number} z Axis Z component.
     * @param {number} angle Native float32 angle in radians.
     * @returns {Float32Array} The supplied output, written after reading inputs.
     */
    @meta.adapted
    static _rotationQuaternion(out, x, y, z, angle)
    {
        const largest = Math.max(Math.abs(x), Math.abs(y), Math.abs(z));
        const inverse = f32(1 / (largest || 1));
        x = f32(x * inverse); y = f32(y * inverse); z = f32(z * inverse);
        let length = f32(Math.sqrt(f32(f32(f32(x * x) + f32(y * y)) + f32(z * z))));
        if (length !== 0) length = f32(1 / length);
        x = f32(x * length); y = f32(y * length); z = f32(z * length);
        const half = f32(angle / 2), sine = f32(Math.sin(half));
        return quat.set(out, f32(sine * x), f32(sine * y), f32(sine * z), f32(Math.cos(half)));
    }

    // JS module-cycle adaptation; Ballpark.s_ballNotInParkCallback forwards here.
    static _ballNotInParkCallback = null;

    /**
     * Native Ballpark owner installed when its module initializes. Importing that
     * class here creates a Ball -> Ballpark -> ClientBall extends Ball ESM cycle.
     * Position OnModified uses this reference to retain nonvirtual native dispatch.
     * Source: destiny/src/Ball.cpp:1526-1537; destiny/src/Ball.h:103.
     */
    static ballparkPrototype = null;

    static scratch = {
        vec3_0: vec3.create(), vec3_1: vec3.create(),
        quat_0: quat.create(), quat_1: quat.create(), mat4_0: mat4.create()
    };

    static DSTBALLMODE = Object.freeze({
        DSTBALL_GOTO: 0,
        DSTBALL_FOLLOW: 1,
        DSTBALL_STOP: 2,
        DSTBALL_WARP: 3,
        DSTBALL_ORBIT: 4,
        DSTBALL_MISSILE: 5,
        DSTBALL_MUSHROOM: 6,
        DSTBALL_BOID: 7,
        DSTBALL_TROLL: 8,
        DSTBALL_MINIBALL: 9,
        DSTBALL_FIELD: 10,
        DSTBALL_RIGID: 11,
        DSTBALL_FORMATION: 12
    });
}
