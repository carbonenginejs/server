import { meta } from "@carbonenginejs/runtime/schema";

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
    id = 0;
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
    followId = 0;
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
