import { meta } from "@carbonenginejs/runtime/schema";
import { CjsDestinyPartitionable } from "./partition/CjsDestinyPartitionable.js";
import { CjsDestinyBox } from "./partition/CjsDestinyBox.js";
import { CjsDestinyBoxSortComparer } from "./partition/SortedSets/CjsDestinyBoxSortComparer.js";

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

    mNewPos = [1e10, 1e10, 1e10];
    mNewVel = [0, 0, 0];
    mOldVel = [0, 0, 0];
    mGoto = [0, 0, 0];
    mLastG = [0, 0, 0];
    mLastC = [0, 0, 0];
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
     * @returns {number} Current bubble ID or -1.
     */
    @meta.type.int32
    @meta.implemented
    get newBubbleId()
    {
        return this.mNewBubble;
    }

    /**
     * Exposes the native read-only Blue previous-bubble alias.
     *
     * @returns {number} Previous bubble ID or -1.
     */
    @meta.type.int32
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

    @meta.type.boolean
    isFree = false;
    @meta.type.boolean
    isGlobal = false;
    @meta.type.boolean
    isMassive = false;
    @meta.type.boolean
    isSpaceJunk = false;
    @meta.type.boolean
    isCloaked = false;

    /**
     * Reads mId through id.
     * Adaptation: a JS accessor exposes native storage without duplicating the Blue scalar value.
     *
     * @returns {bigint} Current native value.
     */
    @meta.type.int64
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
     * @returns {number} Current native value.
     */
    @meta.type.float64
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
     * @returns {number} Current native value.
     */
    @meta.type.float32
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
     * @returns {number} Current native value.
     */
    @meta.type.float32
    @meta.adapted
    get maxVelocity()
    {
        return this.mMaxVel;
    }

    /**
     * Writes mMaxVel through maxVelocity.
     * Adaptation: a JS accessor exposes native storage without duplicating the Blue scalar value.
     *
     * @param {number} value New native value.
     * @returns {void} Updates the shared storage.
     */
    @meta.adapted
    set maxVelocity(value)
    {
        this.mMaxVel = value;
    }

    /**
     * Reads mAgility through agility.
     * Adaptation: a JS accessor exposes native storage without duplicating the Blue scalar value.
     *
     * @returns {number} Current native value.
     */
    @meta.type.float32
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
     * @returns {number} Current native value.
     */
    @meta.type.float32
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
     * @returns {number} Current native value.
     */
    @meta.type.enum("DSTBALLMODE")
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
     * @returns {bigint} Current native value.
     */
    @meta.type.int64
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
     * @returns {number} Current native value.
     */
    @meta.type.float32
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
     * @returns {number} Current native value.
     */
    @meta.type.float64
    @meta.adapted
    get x()
    {
        return this.mNewPos[0];
    }

    /**
     * Writes mNewPos[0] through x.
     * Adaptation: a JS accessor exposes native storage without duplicating the Blue scalar value.
     *
     * @param {number} value New native value.
     * @returns {void} Updates the shared storage.
     */
    @meta.adapted
    set x(value)
    {
        this.mNewPos[0] = value;
    }

    /**
     * Reads mNewPos[1] through y.
     * Adaptation: a JS accessor exposes native storage without duplicating the Blue scalar value.
     *
     * @returns {number} Current native value.
     */
    @meta.type.float64
    @meta.adapted
    get y()
    {
        return this.mNewPos[1];
    }

    /**
     * Writes mNewPos[1] through y.
     * Adaptation: a JS accessor exposes native storage without duplicating the Blue scalar value.
     *
     * @param {number} value New native value.
     * @returns {void} Updates the shared storage.
     */
    @meta.adapted
    set y(value)
    {
        this.mNewPos[1] = value;
    }

    /**
     * Reads mNewPos[2] through z.
     * Adaptation: a JS accessor exposes native storage without duplicating the Blue scalar value.
     *
     * @returns {number} Current native value.
     */
    @meta.type.float64
    @meta.adapted
    get z()
    {
        return this.mNewPos[2];
    }

    /**
     * Writes mNewPos[2] through z.
     * Adaptation: a JS accessor exposes native storage without duplicating the Blue scalar value.
     *
     * @param {number} value New native value.
     * @returns {void} Updates the shared storage.
     */
    @meta.adapted
    set z(value)
    {
        this.mNewPos[2] = value;
    }

    /**
     * Reads mNewVel[0] through vx.
     * Adaptation: a JS accessor exposes native storage without duplicating the Blue scalar value.
     *
     * @returns {number} Current native value.
     */
    @meta.type.float64
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
     * @returns {number} Current native value.
     */
    @meta.type.float64
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
     * @returns {number} Current native value.
     */
    @meta.type.float64
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
     * @returns {number} Current native value.
     */
    @meta.type.float64
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
     * @returns {number} Current native value.
     */
    @meta.type.float64
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
     * @returns {number} Current native value.
     */
    @meta.type.float64
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
    @meta.ours
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
    @meta.ours
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
    @meta.ours
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
    @meta.ours
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
    @meta.ours
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
    @meta.ours
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
    @meta.ours
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
    @meta.ours
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
    @meta.ours
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
    @meta.ours
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
    @meta.ours
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
    @meta.ours
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
    @meta.ours
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
    @meta.ours
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
    @meta.ours
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
    @meta.ours
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
    @meta.ours
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
    @meta.ours
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
    @meta.ours
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
    @meta.ours
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
    @meta.ours
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
    @meta.ours
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
    @meta.ours
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
    @meta.ours
    set _followers(value)
    {
        this.mFollowers = value;
    }

}
