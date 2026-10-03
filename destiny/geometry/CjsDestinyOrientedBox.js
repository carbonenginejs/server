import { meta } from "@carbonenginejs/runtime/schema";
import { vec3 } from "@carbonenginejs/runtime/math/vec3";
import { CjsDestinyBall } from "../CjsDestinyBall.js";
import { CjsDestinyStaticCollidable } from "../partition/CjsDestinyStaticCollidable.js";
import { CjsDestinyBoxShape } from "./BoxShape/CjsDestinyBoxShape.js";
import { CjsDestinyAABB } from "./CjsDestinyAABB.js";

// Source: destiny/src/OrientedBox.h:11-39; destiny/src/OrientedBox.cpp:6-322
// Source: destiny/src/OrientedBox_Blue.cpp:11-29
/** Carbon static oriented-box geometry, partition memberships and collision response. */
@meta.define({ className: "CjsDestinyOrientedBox", modelledOn: "OrientedBox" })
export class CjsDestinyOrientedBox extends CjsDestinyStaticCollidable
{
    m_boxShape = new CjsDestinyBoxShape();
    mAABB = new CjsDestinyAABB();
    // JS placeholders for native uninitialized primitives; Initialize supplies the radius.
    mBoundingRadius = NaN;
    mMod = [NaN, NaN, NaN];

    /**
     * Builds corners, float bounding radius and axis-aligned broad-phase bounds.
     * Adaptation: checked BigInt IDs and f64 arrays replace native typed values.
     *
     * @param {bigint|number} theID Shape ID.
     * @param {bigint|number} parentObjectId Parent ball ID.
     * @param {number} c0 Corner X.
     * @param {number} c1 Corner Y.
     * @param {number} c2 Corner Z.
     * @param {number} x0 Local X edge X.
     * @param {number} x1 Local X edge Y.
     * @param {number} x2 Local X edge Z.
     * @param {number} y0 Local Y edge X.
     * @param {number} y1 Local Y edge Y.
     * @param {number} y2 Local Y edge Z.
     * @param {number} z0 Local Z edge X.
     * @param {number} z1 Local Z edge Y.
     * @param {number} z2 Local Z edge Z.
     * @returns {void} Rebuilds derived geometry only.
     */
    @meta.adapted
    Initialize(theID, parentObjectId, c0, c1, c2, x0, x1, x2, y0, y1, y2, z0, z1, z2)
    {
        this.mId = CjsDestinyBall._toInt64(theID);
        this.mParentBallId = CjsDestinyBall._toInt64(parentObjectId);
        this.m_boxShape = new CjsDestinyBoxShape([c0, c1, c2], [x0, x1, x2], [y0, y1, y2], [z0, z1, z2]);
        this.mBoundingRadius = Math.fround(this.m_boxShape.GetBoundingRadius());
        this.GetCenter(this.mNewPos);
        vec3.copy(this.mOldPos, this.mNewPos);
        const corners = this.m_boxShape.m_corners;
        this.mAABB = new CjsDestinyAABB(corners[0], corners[0]);
        for (let i = 1; i < corners.length; ++i) this.mAABB.Update(corners[i]);
    }

    /**
     * Recomputes the native float radius from box geometry.
     *
     * @returns {number} Float32 bounding radius.
     */
    @meta.implemented
    GetBoundingRadius()
    {
        return Math.fround(this.m_boxShape.GetBoundingRadius());
    }

    /**
     * Returns the box center; explicit output replaces C++ value return.
     *
     * @param {number[]} out Destination center.
     * @returns {number[]} Supplied destination.
     */
    @meta.adapted
    GetCenter(out)
    {
        return this.m_boxShape.GetCenter(out);
    }

    /**
     * Queries a swept sphere, retaining native partial writes on narrow-phase misses.
     * Adaptation: an output record replaces normal/time reference parameters.
     *
     * @param {number[]} p0 Start position.
     * @param {number[]} p1 End position.
     * @param {number} radius Native float sphere radius.
     * @param {{normal: number[], timeOfImpact: number}} out Collision outputs.
     * @returns {boolean} Whether the sphere intersects.
     */
    @meta.adapted
    CheckCollision(p0, p1, radius, out)
    {
        radius = Math.fround(radius);
        if (this.mAABB.CanExcludeCollision(p0, p1, radius)) return false;
        const hit = { collisionPoint: [0, 0, 0], collisionTime: out.timeOfImpact, normal: out.normal };
        const collision = this.m_boxShape.CollideWithSphere(p0, radius, vec3.subtract([0, 0, 0], p1, p0), hit);
        out.timeOfImpact = hit.collisionTime;
        if (collision)
        {
            const length = Math.sqrt(vec3.dot(out.normal, out.normal));
            if (length > 1e-10) vec3.scale(out.normal, out.normal, 1 / length);
            else vec3.set(out.normal, 0, 0, 1);
        }
        return collision;
    }

    /**
     * Predicts a free ball and applies native box response, retaining penetration depth.
     * Adaptation: f64 local arrays preserve C++ value copies independently of Ball state.
     *
     * @param {CjsDestinyBall} ball Candidate ball.
     * @returns {void} Updates collision acceleration and IDs on contact.
     */
    @meta.adapted
    CollideWithBall(ball)
    {
        if (!ball.isFree) return;
        const p0 = [...ball.mNewPos], p1 = [...p0], vp1 = [...ball.mNewVel];
        const m1 = ball.mMass * ball.mAgility, park = this.mPark;
        park.Integrate(p1, vp1, ball.mLastG, m1, park.mFriction, ball.mTimeFactor, park.dt);
        if (this.mAABB.CanExcludeCollision(p0, p1, ball.mRadius)) return;
        const hit = { collisionPoint: [0, 0, 0], collisionTime: -1, normal: [0, 0, 0] };
        if (this.m_boxShape.CollideWithSphere(p0, ball.mRadius, vec3.subtract([0, 0, 0], p1, p0), hit))
        {
            vec3.copy(vp1, ball.mNewVel);
            this.ReactToCollision(ball, p0, vp1, m1, hit.normal, hit.collisionTime);
        }
    }

    /**
     * Reflects at impact or ejects an overlapping sphere and retains the strongest equal-time force.
     * Adaptation: component arithmetic and f64 arrays replace native vector operators.
     *
     * @param {CjsDestinyBall} ball Collision-state owner.
     * @param {number[]} ballPosition Mutable local position.
     * @param {number[]} ballVelocity Mutable local velocity.
     * @param {number} m1 Effective mass.
     * @param {number[]} normal Mutable normal with penetration depth before normalization.
     * @param {number} timeOfImpact Tick fraction, or -1 for no collision.
     * @returns {void} Appends the shape ID even when an equal-time force is weaker.
     */
    @meta.adapted
    ReactToCollision(ball, ballPosition, ballVelocity, m1, normal, timeOfImpact)
    {
        if (timeOfImpact === -1) return;
        const depth = Math.sqrt(vec3.dot(normal, normal));
        if (depth !== 0) vec3.scale(normal, normal, 1 / depth);
        const acceleration = [0, 0, 0], park = this.mPark, k = park.mFriction, dt = park.dt;
        if (timeOfImpact > 0)
        {
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
            const normalComp = vec3.dot(ball.mLastG, normal), tmp = 1 / (m1 + dt * k);
            for (let q = 0; q < 3; ++q)
                acceleration[q] = ((depth + 1) / (dt * tmp * m1) * normal[q] - ball.mNewVel[q]) * (1 / dt) - normalComp * normal[q];
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
     * Rebuilds memberships using the longest AABB width and native neighbor ordering.
     * Adaptation: BigInt indices and arrays replace native keys and fixed local arrays.
     *
     * @param {Object} box1 Proposed cell, replaced by the AABB-selected cell.
     * @param {Object} top Previous top cell, reacquired after removals.
     * @param {number} newBubbleId Master bubble ID to restore.
     * @returns {void} Same-key/same-modifier calls retain memberships.
     */
    @meta.adapted
    InsertInBoxes(box1, top, newBubbleId)
    {
        const partition = this.mPark.mPartition, radius = this.mAABB.GetLongestWidth() / 2;
        box1 = partition.GetBox(radius, this.mNewPos);
        const mod = [0, 0, 0];
        for (let q = 0; q < 3; ++q)
        {
            if (box1.lo[q] - this.mAABB.mLowCorner[q] > 0) mod[q] = -1;
            else if (box1.hi[q] - this.mAABB.mHighCorner[q] < 0) mod[q] = 1;
        }
        if (this.mMyBox && box1.mKey.Equals(this.mMyBox.mKey)
            && mod.every((value, q) => value === this.mMod[q])) return;
        this.DeleteFromBoxes();
        this.mMod.splice(0, 3, ...mod);
        box1 = partition.GetBox(radius, this.mNewPos);
        const { ix, iy, iz } = box1.mKey, level = box1.mLevel;
        this.InsertInBox(box1);
        if (this.mPark.isMaster)
        {
            top = partition.GetTopmost(box1);
            top.mBubble = newBubbleId;
        }
        this.SetBoxActive(13, true);
        this.mMyBox = box1;
        if (level === 0 && Math.fround(this.mBoundingRadius * 2) > partition.mLevelWidth[0])
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
            for (const axes of [[0], [1], [2], [0, 1], [0, 2], [1, 2], [0, 1, 2]])
            {
                if (axes.some(q => mod[q] === 0)) continue;
                const offset = [0, 0, 0];
                for (const q of axes) offset[q] = mod[q];
                this.InsertInBox(partition.GetBox(ix + BigInt(offset[0]), iy + BigInt(offset[1]), iz + BigInt(offset[2]), level));
                this.SetBoxActive(13 + offset[0] + 3 * offset[1] + 9 * offset[2], true);
            }
        }
    }

    /**
     * Reads the Blue shape identity.
     * @returns {bigint} Native signed ID.
     */
    @meta.type.int64
    @meta.implemented
    get id() { return this.mId; }

    /**
     * Assigns identity; checked BigInt replaces native integer conversion.
     * @param {bigint|number} value Shape ID.
     * @returns {void} Does not reindex owning collections.
     */
    @meta.adapted
    set id(value) { this.mId = CjsDestinyBall._toInt64(value); }

    /**
     * Reads the Blue owner reference.
     * @returns {Object|null} Owning park.
     */
    @meta.implemented
    get park() { return this.mPark; }

    /**
     * Reads the only native Blue corner component.
     * @returns {number} Corner A X component.
     */
    @meta.type.float64
    @meta.implemented
    get corner_x() { return this.m_boxShape.m_corners[0][0]; }
}
