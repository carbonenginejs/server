import { meta } from "@carbonenginejs/runtime/schema";
import { vec3 } from "@carbonenginejs/runtime/math/vec3";
import { CjsDestinyBall } from "../CjsDestinyBall.js";
import { CjsDestinyStaticCollidable } from "../partition/CjsDestinyStaticCollidable.js";
import { g_useIterativeCollision } from "../Settings/CjsDestinyGlobalSettings.js";
import { CollideTwoSpheres, Quadratic } from "./Collision.js";

// Source: destiny/src/Capsule.h:12-33; destiny/src/Capsule.cpp:11-581
// Source: destiny/src/Capsule_Blue.cpp:8-28
/** Carbon static capsule queries, sampled memberships and both response paths. */
@meta.define({ className: "CjsDestinyCapsule", modelledOn: "Capsule" })
export class CjsDestinyCapsule extends CjsDestinyStaticCollidable
{
    mHemisphereA = [0, 0, 0];
    mHemisphereB = [0, 0, 0];
    mAB = [0, 0, 0];
    // JS placeholder for the native uninitialized float; Initialize supplies it.
    mRadius = NaN;

    /**
     * Sets native endpoints, cached axis and center.
     * Adaptation: BigInt IDs, f64 arrays and explicit float rounding preserve typed values.
     *
     * @param {bigint|number} theID Shape ID.
     * @param {bigint|number} parentObjectId Parent ball ID.
     * @param {number} ax Endpoint A X.
     * @param {number} ay Endpoint A Y.
     * @param {number} az Endpoint A Z.
     * @param {number} bx Endpoint B X.
     * @param {number} by Endpoint B Y.
     * @param {number} bz Endpoint B Z.
     * @param {number} radius Float radius.
     * @returns {void} Rebuilds derived geometry without changing membership.
     */
    @meta.adapted
    Initialize(theID, parentObjectId, ax, ay, az, bx, by, bz, radius)
    {
        this.mId = CjsDestinyBall._toInt64(theID);
        this.mParentBallId = CjsDestinyBall._toInt64(parentObjectId);
        vec3.set(this.mHemisphereA, ax, ay, az);
        vec3.set(this.mHemisphereB, bx, by, bz);
        this.mRadius = Math.fround(radius);
        vec3.subtract(this.mAB, this.mHemisphereB, this.mHemisphereA);
        this.GetCenter(this.mNewPos);
        vec3.copy(this.mOldPos, this.mNewPos);
    }

    /**
     * Computes radius with native intermediate float rounding.
     * @returns {number} Float32 bounding sphere radius.
     */
    @meta.implemented
    GetBoundingRadius()
    {
        return Math.fround(Math.fround(Math.fround(Math.sqrt(vec3.dot(this.mAB, this.mAB))) * 0.5) + this.mRadius);
    }

    /**
     * Computes the endpoint midpoint; an output array replaces native value return.
     * @param {number[]} out Destination center.
     * @returns {number[]} Supplied destination.
     */
    @meta.adapted
    GetCenter(out)
    {
        return vec3.scale(out, vec3.add(out, this.mHemisphereA, this.mHemisphereB), 0.5);
    }

    /**
     * Tests the native bounding sphere, cylinder and hemispheres in source order.
     * Adaptation: f64 local arrays and a record replace vector values/output references.
     * Every miss leaves outputs unchanged; axial overlap retains the native zero normal.
     *
     * @param {number[]} p0 Start point.
     * @param {number[]} p1 End point.
     * @param {number} radius Native float sphere radius.
     * @param {{normal: number[], timeOfImpact: number}} out Contact outputs.
     * @returns {boolean} Whether the source test accepts contact.
     */
    @meta.adapted
    CheckCollision(p0, p1, radius, out)
    {
        radius = Math.fround(radius);
        const boundingRadius = this.GetBoundingRadius() + radius;
        const path = vec3.subtract([0, 0, 0], p1, p0), pathsq = vec3.dot(path, path);
        const separation = vec3.subtract([0, 0, 0], this.mNewPos, p0);
        const separationEnd = vec3.subtract([0, 0, 0], this.mNewPos, p1);
        const distanceToClosest = vec3.dot(separation, path);
        if ((distanceToClosest < 0 && boundingRadius * boundingRadius < vec3.dot(separation, separation))
            || (distanceToClosest > pathsq && boundingRadius * boundingRadius < vec3.dot(separationEnd, separationEnd))) return false;
        const distsq = pathsq * vec3.dot(separation, separation) - distanceToClosest * distanceToClosest;
        if (distsq > pathsq * boundingRadius * boundingRadius) return false;
        const sqLengthAB = vec3.dot(this.mAB, this.mAB);
        if (sqLengthAB < 1e-10)
        {
            const s = CollideTwoSpheres(p0, p1, this.mNewPos, this.mNewPos, boundingRadius);
            if (s >= 0)
            {
                out.timeOfImpact = s;
                for (let q = 0; q < 3; ++q) out.normal[q] = p0[q] + s * path[q] - this.mNewPos[q];
                const length = Math.sqrt(vec3.dot(out.normal, out.normal));
                if (length < 1e-10) vec3.set(out.normal, 0, 0, 1);
                else vec3.scale(out.normal, out.normal, 1 / length);
                return true;
            }
            return false;
        }
        const comparisonRadius = radius + this.mRadius, invSqLengthAB = 1 / sqLengthAB, lengthAB = Math.sqrt(sqLengthAB);
        const ao = vec3.subtract([0, 0, 0], p0, this.mHemisphereA);
        const paraAO = vec3.dot(ao, this.mAB) / lengthAB;
        const perpPath = [0, 0, 0], perpAO = [0, 0, 0];
        for (let q = 0; q < 3; ++q)
        {
            perpPath[q] = path[q] - vec3.dot(path, this.mAB) * this.mAB[q] * invSqLengthAB;
            perpAO[q] = ao[q] - vec3.dot(ao, this.mAB) * this.mAB[q] * invSqLengthAB;
        }
        const c = vec3.dot(perpAO, perpAO) - comparisonRadius * comparisonRadius;
        if (c <= 0)
        {
            if (paraAO >= 0 && paraAO <= lengthAB)
            {
                out.timeOfImpact = 0;
                vec3.copy(out.normal, perpAO);
                CjsDestinyCapsule._normalize(out.normal);
                return true;
            }
            const center = paraAO < 0 ? this.mHemisphereA : this.mHemisphereB;
            const s = CollideTwoSpheres(p0, p1, center, center, comparisonRadius);
            if (s >= 0)
            {
                out.timeOfImpact = s;
                for (let q = 0; q < 3; ++q) out.normal[q] = p0[q] + s * path[q] - center[q];
                CjsDestinyCapsule._normalize(out.normal);
                return true;
            }
            return false;
        }
        const a = vec3.dot(perpPath, perpPath);
        if (a < 1e-10) return false;
        const roots = { v1: 0, v2: 0 };
        if (!Quadratic(roots, a, 2 * vec3.dot(perpPath, perpAO), c)) return false;
        const s2 = roots.v2;
        if (s2 >= 0 && s2 <= 1)
        {
            const pc = [0, 0, 0];
            for (let q = 0; q < 3; ++q) pc[q] = p0[q] + s2 * path[q] - this.mHemisphereA[q];
            const pcHeight = vec3.dot(pc, this.mAB) / lengthAB;
            if (pcHeight >= 0 && pcHeight <= lengthAB)
            {
                out.timeOfImpact = s2;
                const pcDotAB = vec3.dot(pc, this.mAB);
                for (let q = 0; q < 3; ++q) out.normal[q] = pc[q] - pcDotAB * this.mAB[q] * invSqLengthAB;
                CjsDestinyCapsule._normalize(out.normal);
                return true;
            }
            const center = pcHeight < 0 ? this.mHemisphereA : this.mHemisphereB;
            const s = CollideTwoSpheres(p0, p1, center, center, comparisonRadius);
            if (s >= 0)
            {
                out.timeOfImpact = s;
                for (let q = 0; q < 3; ++q) out.normal[q] = p0[q] + s * path[q] - center[q];
                CjsDestinyCapsule._normalize(out.normal);
                return true;
            }
        }
        return false;
    }

    /**
     * Normalizes using native Vector3d's zero-length behavior and arithmetic order.
     * JS helper: vector operators are unavailable; retain native zero-length handling.
     * @param {number[]} value Mutable vector.
     * @returns {number[]} Supplied vector.
     */
    @meta.ours
    static _normalize(value)
    {
        const length = Math.sqrt(vec3.dot(value, value));
        if (length !== 0) vec3.scale(value, value, 1 / length);
        return value;
    }

    /**
     * Reproduces the legacy velocity-based cylinder roots and cap selection.
     * Adaptation: copies preserve native by-value arguments; output records replace roots.
     *
     * @param {CjsDestinyBall} ball Candidate ball.
     * @param {number[]} p0 Starting position, copied on entry.
     * @param {number[]} p1 Predicted position, copied on entry.
     * @param {number} m1 Effective mass.
     * @param {number[]} vp1 Predicted velocity, copied on entry.
     * @returns {void} Applies response when native root/cap selection finds contact.
     */
    @meta.adapted
    HandleCollisionNonIteratively(ball, p0, p1, m1, vp1)
    {
        p0 = [...p0]; p1 = [...p1]; vp1 = [...vp1];
        const rad = ball.mRadius + this.mRadius, radSq = rad * rad;
        const AO = vec3.subtract([0, 0, 0], p0, this.mHemisphereA), abSq = vec3.dot(this.mAB, this.mAB);
        const m = vec3.dot(this.mAB, vp1) / abSq, n = vec3.dot(this.mAB, AO) / abSq;
        const Q = [0, 0, 0], R = [0, 0, 0], normal = [0, 0, 0];
        for (let q = 0; q < 3; ++q)
        {
            Q[q] = vp1[q] - this.mAB[q] * m;
            R[q] = AO[q] - this.mAB[q] * n;
        }
        const a = vec3.dot(Q, Q), b = 2 * vec3.dot(Q, R), c = vec3.dot(R, R) - radSq;
        let s = -1, timeOfImpact = -1;
        if (a === 0)
        {
            for (const center of [this.mHemisphereA, this.mHemisphereB])
            {
                const capTime = CollideTwoSpheres(p0, p1, center, center, rad);
                if (capTime !== -1 && (timeOfImpact === -1 || capTime < timeOfImpact))
                {
                    timeOfImpact = capTime;
                    vec3.subtract(normal, p0, center);
                }
            }
            this.ReactToCollision(ball, p1, vp1, m1, normal, timeOfImpact);
            return;
        }
        const roots = { v1: 0, v2: 0 };
        if (!Quadratic(roots, a, b, c)) return;
        const s1 = roots.v1, s2 = roots.v2;
        if (s1 >= 0 && s1 <= 1) s = s1;
        if (s2 >= 0 && s2 <= 1 && s2 < s1) s = s2;
        else if (s === -1)
        {
            const t = vec3.dot(AO, this.mAB) / abSq;
            if (t >= 0 && t <= 1)
            {
                for (let q = 0; q < 3; ++q) normal[q] = p0[q] - (this.mHemisphereA[q] + t * this.mAB[q]);
                if (vec3.dot(normal, normal) < radSq)
                {
                    vec3.copy(vp1, ball.mNewVel);
                    this.ReactToCollision(ball, p0, vp1, m1, normal, 0);
                    return;
                }
            }
        }
        // Preserve the distinct second-root B-cap normal (p1 instead of p0).
        for (const [rootIndex, tK] of [s1 * m + n, s2 * m + n].entries())
        {
            if (tK < 0 || tK > 1)
            {
                const center = tK < 0 ? this.mHemisphereA : this.mHemisphereB;
                const capTime = CollideTwoSpheres(p0, p1, center, center, rad);
                if (capTime !== -1 && (timeOfImpact === -1 || capTime < timeOfImpact))
                {
                    timeOfImpact = capTime;
                    vec3.subtract(normal, rootIndex === 1 && tK > 1 ? p1 : p0, center);
                }
            }
            else if (s !== -1 && (timeOfImpact === -1 || s < timeOfImpact))
            {
                timeOfImpact = s;
                for (let q = 0; q < 3; ++q) normal[q] = AO[q] - (vec3.dot(AO, this.mAB) / abSq) * this.mAB[q];
                if (vec3.dot(normal, normal) < radSq) timeOfImpact = 0;
            }
        }
        vec3.copy(vp1, ball.mNewVel);
        this.ReactToCollision(ball, p0, vp1, m1, normal, timeOfImpact);
    }

    /**
     * Predicts a free ball and dispatches the native global collision mode.
     * Adaptation: local arrays preserve native value copies; the iterative branch
     * deliberately passes already integrated position/velocity to the response.
     *
     * @param {CjsDestinyBall} ball Candidate ball.
     * @returns {void} May record collision acceleration and IDs.
     */
    @meta.adapted
    CollideWithBall(ball)
    {
        if (!ball.isFree) return;
        const p0 = [...ball.mNewPos], p1 = [...p0], vp1 = [...ball.mNewVel];
        const m1 = ball.mMass * ball.mAgility, park = this.mPark;
        park.Integrate(p1, vp1, ball.mLastG, m1, park.mFriction, ball.mTimeFactor, park.dt);
        if (g_useIterativeCollision)
        {
            const hit = { normal: [0, 0, 0], timeOfImpact: -1 };
            if (this.CheckCollision(p0, p1, ball.mRadius, hit))
                this.ReactToCollision(ball, p1, vp1, m1, hit.normal, hit.timeOfImpact);
        }
        else this.HandleCollisionNonIteratively(ball, p0, p1, m1, vp1);
    }

    /**
     * Reflects or ejects a sphere using native capsule response and equal-time arbitration.
     * Adaptation: f64 component arithmetic replaces native vector expressions.
     *
     * @param {CjsDestinyBall} ball Collision-state owner.
     * @param {number[]} ballPosition Mutable local position.
     * @param {number[]} ballVelocity Mutable local velocity.
     * @param {number} m1 Effective mass.
     * @param {number[]} normal Mutable normal carrying center distance before normalization.
     * @param {number} timeOfImpact Tick fraction, or -1 for no collision.
     * @returns {void} Outward acceleration suppresses positive-time response only.
     */
    @meta.adapted
    ReactToCollision(ball, ballPosition, ballVelocity, m1, normal, timeOfImpact)
    {
        if (timeOfImpact === -1) return;
        const centerDistance = Math.sqrt(vec3.dot(normal, normal));
        CjsDestinyCapsule._normalize(normal);
        const acceleration = [0, 0, 0], park = this.mPark, k = park.mFriction, dt = park.dt;
        const normalComp = vec3.dot(ball.mLastG, normal);
        if (timeOfImpact > 0)
        {
            if (normalComp > 0) return;
            park.Integrate(ballPosition, ballVelocity, ball.mLastG, m1, k, ball.mTimeFactor, timeOfImpact * dt);
            const v1 = vec3.dot(ballVelocity, normal);
            for (let q = 0; q < 3; ++q) ballVelocity[q] -= 2 * v1 * normal[q];
            park.Integrate(ballPosition, ballVelocity, ball.mLastG, m1, k, ball.mTimeFactor, (1 - timeOfImpact) * dt);
            for (let q = 0; q < 3; ++q)
                acceleration[q] = -(-m1 * ball.mLastG[q] + ball.mTimeFactor * m1 * ball.mLastG[q]
                    - ball.mTimeFactor * ball.mNewVel[q] * k + ballVelocity[q] * k) * (1 / m1) * (1 / (ball.mTimeFactor - 1));
        }
        else
        {
            const tmp = 1 / (m1 + dt * k), dist = this.mRadius + ball.mRadius - centerDistance + 1;
            for (let q = 0; q < 3; ++q)
                acceleration[q] = (dist / (dt * tmp * m1) * normal[q] - ball.mNewVel[q]) * (1 / dt) - normalComp * normal[q];
        }
        const lastC = vec3.scale(acceleration, acceleration, 0.85);
        if (timeOfImpact === ball.mLastCollision)
        {
            if (vec3.dot(lastC, lastC) > vec3.dot(ball.mLastC, ball.mLastC)) vec3.copy(ball.mLastC, lastC);
        }
        else
        {
            vec3.copy(ball.mLastC, lastC);
            ball.mLastCollision = timeOfImpact;
        }
        ball.mCollisions.push(this.mId);
    }

    /**
     * Samples native sphere neighborhoods at diameter intervals along the capsule.
     * Adaptation: BigInt cell indices preserve int64 keys; explicit f32 rounding
     * preserves the remaining-length loop. A non-decreasing float step throws
     * instead of hanging indefinitely as the native loop can (Capsule.cpp:578-579).
     *
     * @param {Object} box1 Proposed bounding-radius cell.
     * @param {Object} top Previous top cell, reacquired after removal.
     * @param {number} newBubbleId Master bubble ID to restore.
     * @returns {void} Same-key and nonpositive-radius early returns retain membership.
     */
    @meta.adapted
    InsertInBoxes(box1, top, newBubbleId)
    {
        if (this.mMyBox && box1.mKey.Equals(this.mMyBox.mKey)) return;
        if (this.mRadius <= 0) return;
        this.DeleteFromBoxes();
        const partition = this.mPark.mPartition;
        box1 = partition.GetBox(this.mRadius, this.mNewPos);
        let boxA = partition.GetBox(this.mRadius, this.mHemisphereA);
        const level = boxA.mLevel;
        if (this.mPark.isMaster)
        {
            top = partition.GetTopmost(box1);
            top.mBubble = newBubbleId;
        }
        this.mMyBox = box1;
        const pos = [...this.mHemisphereA], direction = vec3.subtract([0, 0, 0], this.mHemisphereB, this.mHemisphereA);
        let length = Math.fround(Math.sqrt(vec3.dot(direction, direction)));
        CjsDestinyCapsule._normalize(direction);
        for (let q = 0; q < 3; ++q) direction[q] = direction[q] * this.mRadius * 2;
        const step = Math.fround(this.mRadius * 2);
        while (length >= 0)
        {
            if (Math.fround(length - step) === length)
                throw new RangeError("Capsule sampling cannot advance at native float32 precision");
            boxA = partition.GetBox(this.mRadius, pos);
            const { ix, iy, iz } = boxA.mKey, mod = [0, 0, 0];
            for (let q = 0; q < 3; ++q)
            {
                if (boxA.lo[q] + this.mRadius - pos[q] > 0) mod[q] = -1;
                else if (boxA.hi[q] - this.mRadius - pos[q] < 0) mod[q] = 1;
            }
            this.InsertInBox(partition.GetBox(ix, iy, iz, level));
            for (const axes of [[0], [1], [2], [0, 1], [0, 2], [1, 2], [0, 1, 2]])
            {
                if (axes.some(q => mod[q] === 0)) continue;
                const offset = [0, 0, 0];
                for (const q of axes) offset[q] = mod[q];
                this.InsertInBox(partition.GetBox(ix + BigInt(offset[0]), iy + BigInt(offset[1]), iz + BigInt(offset[2]), level));
            }
            // Native quirk (Capsule.cpp:493-580): no final B sample is forced,
            // so its cap can cross a cell absent from the sampled memberships.
            vec3.add(pos, pos, direction);
            length = Math.fround(length - step);
        }
    }

    /**
     * Reads the native Blue id component.
     * @returns {bigint} Stored value.
     */
    @meta.type.int64
    @meta.implemented
    get id() { return this.mId; }

    /**
     * Writes the Blue id component without refreshing geometry or membership.
     * Adaptation: checked BigInt replaces native signed-int64 conversion.
     * @param {bigint|number} value New value.
     * @returns {void} Stores only this component.
     */
    @meta.adapted
    set id(value) { this.mId = CjsDestinyBall._toInt64(value); }

    /**
     * Reads the native Blue ax component.
     * @returns {number} Stored value.
     */
    @meta.type.float64
    @meta.implemented
    get ax() { return this.mHemisphereA[0]; }

    /**
     * Writes the Blue ax component without refreshing geometry or membership.
     * Native raw endpoint writes leave the cached axis and center unchanged.
     * @param {number} value New value.
     * @returns {void} Stores only this component.
     */
    @meta.implemented
    set ax(value) { this.mHemisphereA[0] = value; }

    /**
     * Reads the native Blue ay component.
     * @returns {number} Stored value.
     */
    @meta.type.float64
    @meta.implemented
    get ay() { return this.mHemisphereA[1]; }

    /**
     * Writes the Blue ay component without refreshing geometry or membership.
     * Native raw endpoint writes leave the cached axis and center unchanged.
     * @param {number} value New value.
     * @returns {void} Stores only this component.
     */
    @meta.implemented
    set ay(value) { this.mHemisphereA[1] = value; }

    /**
     * Reads the native Blue az component.
     * @returns {number} Stored value.
     */
    @meta.type.float64
    @meta.implemented
    get az() { return this.mHemisphereA[2]; }

    /**
     * Writes the Blue az component without refreshing geometry or membership.
     * Native raw endpoint writes leave the cached axis and center unchanged.
     * @param {number} value New value.
     * @returns {void} Stores only this component.
     */
    @meta.implemented
    set az(value) { this.mHemisphereA[2] = value; }

    /**
     * Reads the native Blue bx component.
     * @returns {number} Stored value.
     */
    @meta.type.float64
    @meta.implemented
    get bx() { return this.mHemisphereB[0]; }

    /**
     * Writes the Blue bx component without refreshing geometry or membership.
     * Native raw endpoint writes leave the cached axis and center unchanged.
     * @param {number} value New value.
     * @returns {void} Stores only this component.
     */
    @meta.implemented
    set bx(value) { this.mHemisphereB[0] = value; }

    /**
     * Reads the native Blue by component.
     * @returns {number} Stored value.
     */
    @meta.type.float64
    @meta.implemented
    get by() { return this.mHemisphereB[1]; }

    /**
     * Writes the Blue by component without refreshing geometry or membership.
     * Native raw endpoint writes leave the cached axis and center unchanged.
     * @param {number} value New value.
     * @returns {void} Stores only this component.
     */
    @meta.implemented
    set by(value) { this.mHemisphereB[1] = value; }

    /**
     * Reads the native Blue bz component.
     * @returns {number} Stored value.
     */
    @meta.type.float64
    @meta.implemented
    get bz() { return this.mHemisphereB[2]; }

    /**
     * Writes the Blue bz component without refreshing geometry or membership.
     * Native raw endpoint writes leave the cached axis and center unchanged.
     * @param {number} value New value.
     * @returns {void} Stores only this component.
     */
    @meta.implemented
    set bz(value) { this.mHemisphereB[2] = value; }

    /**
     * Reads the native Blue radius component.
     * @returns {number} Stored value.
     */
    @meta.type.float32
    @meta.implemented
    get radius() { return this.mRadius; }

    /**
     * Writes the Blue radius component without refreshing geometry or membership.
     * Adaptation: explicit float32 rounding replaces the native float assignment.
     * @param {number} value New value.
     * @returns {void} Stores only this component.
     */
    @meta.adapted
    set radius(value) { this.mRadius = Math.fround(value); }

    /**
     * Reads the native Blue owner reference.
     * @returns {Object|null} Owning park.
     */
    @meta.implemented
    get park() { return this.mPark; }

}
