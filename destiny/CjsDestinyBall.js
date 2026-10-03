import { meta } from "@carbonenginejs/runtime/schema";

// Source: blueexposure/include/BlueTypes.h
// Source: destiny/src/Ball.h
// Source: destiny/src/Ball.cpp
// Source: destiny/src/Ball_Blue.cpp
// Source: destiny/src/IDstConstants.h
/**
 * Temporary movement subset of Carbon Ball. Position/velocity use the Blue
 * scalar surface (JS Numbers retain Vector3d precision; runtime vec3 is f32).
 * Controller setters own changes to physical parameters and cached drag.
 * This class does not register the complete destiny.Ball identity.
 */
@meta.define({ className: "CjsDestinyBall", modelledOn: "Ball" })
export class CjsDestinyBall
{
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
    @meta.ours
    static _toInt64(value)
    {
        if (typeof value === "number" && Number.isSafeInteger(value)) value = BigInt(value);
        if (typeof value !== "bigint" || value < -9223372036854775808n || value > 9223372036854775807n)
        {
            throw new RangeError("Native int64 values must be signed-int64 BigInts or safe integers");
        }
        return value;
    }

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

    @meta.type.int64
    id = 0n;
    @meta.type.float64
    x = 0;
    @meta.type.float64
    y = 0;
    @meta.type.float64
    z = 0;
    @meta.type.float64
    vx = 0;
    @meta.type.float64
    vy = 0;
    @meta.type.float64
    vz = 0;
    @meta.type.float64
    mass = 0;
    @meta.type.float32
    radius = 0;
    @meta.type.float32
    maxVelocity = 0;
    @meta.type.float32
    agility = 1;
    @meta.type.float32
    speedFraction = 1;
    @meta.type.enum("DSTBALLMODE")
    mode = CjsDestinyBall.DSTBALLMODE.DSTBALL_STOP;
    @meta.type.int64
    followId = 0n;
    @meta.type.float32
    followRange = 10;
    @meta.type.float64
    gotoX = 0;
    @meta.type.float64
    gotoY = 0;
    @meta.type.float64
    gotoZ = 0;
    @meta.type.boolean
    isFree = false;
    @meta.type.boolean
    isGlobal = false;
    @meta.type.boolean
    isMassive = false;
    @meta.type.boolean
    isInteractive = false;
    @meta.type.boolean
    isSpaceJunk = false;
    @meta.type.boolean
    isCloaked = false;
    @meta.type.boolean
    isMoribund = false;

    // Native state timestamps and the mode/deletion stamp.
    mNewTime = 0n;
    mOldTime = 0n;
    mEffectStamp = 0;

    // Native mOldPos/mOldVel and mLastG, expanded into f64 scalars.
    _oldX = 0;
    _oldY = 0;
    _oldZ = 0;
    _oldVx = 0;
    _oldVy = 0;
    _oldVz = 0;
    _lastGx = 0;
    _lastGy = 0;
    _lastGz = 0;
    _timeFactor = 1;
    _followPtr = null;
    _followers = new Set();
}
