import { meta } from "@carbonenginejs/runtime/schema";
import { IBlueEvents } from "@carbonenginejs/runtime/blue";
import { CjsDestinyBall } from "./CjsDestinyBall.js";
import { CjsDestinyClientBall } from "./CjsDestinyClientBall.js";
import { BallLocation, CollisionImpact, CollisionItem } from "./CollisionStructures.js";
import { CollisionBallProperties } from "./CollisionBallProperties.js";
import { CjsDestinyPartition } from "./partition/Partition/CjsDestinyPartition.js";
import { CjsDestinyCapsule } from "./geometry/CjsDestinyCapsule.js";
import { CjsDestinyOrientedBox } from "./geometry/CjsDestinyOrientedBox.js";
import { CollideTwoSpheres } from "./geometry/Collision.js";
import { vec3 } from "@carbonenginejs/runtime/math/vec3";
import { quat } from "@carbonenginejs/runtime/math/quat";
import { mat4 } from "@carbonenginejs/runtime/math/mat4";
import { vec3d } from "./math/vec3d.js";

import { g_useIterativeCollision, g_useDynamicalOrientation, g_useNewOrbit, g_collisionMaxIterations,
    g_disableDynamicalOrientationForMissiles } from "./Settings/CjsDestinyGlobalSettings.js";

const f32 = Math.fround;
const Mode = CjsDestinyBall.DSTBALLMODE;
const AU = 0.1495978707e12;
const ORBITAL_PRECESSION = 0.001;

// Source: destiny/src/Ballpark.h
// Source: destiny/src/Ballpark.cpp
// Source: destiny/src/Settings.h
// Source: destiny/src/Thunkers.cpp
/**
 * Temporary, single-region Ballpark movement subset with native clock phases.
 * The cached evolution step defaults to one second. Native global settings select
 * legacy/new orbit. Spatial membership and bubble activity are maintained;
 * legacy/iterative collision response and dynamic orientation are available;
 * proximity scanning is headless; wire replication remains unported.
 */
@meta.define({ className: "CjsBallparkController", modelledOn: "Ballpark" })
@meta.blue.inherit(IBlueEvents)
export class CjsBallparkController
{
    mWarpSpeed = 2;

    mFormations = [];

    mTime = 0n;
    mLocalCnt = -1n;
    mLocalHiCnt = -1073741824n;
    mEgo = 0n;
    mLastEgo = 0n;
    mLastEgoBall = null;
    mLastReferenceTime = -1n;
    mLastReference = vec3d.create();
    mOldReference = vec3d.create();
    mLastDelta = vec3d.create();
    mSomeWeirdHackToFixSomething = 1;
    mCollisionLocations = new Map();
    mProximityBalls = new Map();
    mPotentialCollisionBalls = new Map();
    mPotentialCollidables = new Map();
    mRollSpeedAcceleration = -3;
    mRollSpeedDecay = -0.9;
    mRollAcceleration = 1;
    mRollDecay = -0.5;
    @meta.type.int32
    currentTime = 0;
    @meta.type.int32
    tickInterval = 1000;
    @meta.type.boolean
    isMaster = false;

    mHaveTicks = false;
    mFirstTime = true;
    inEvolve = false;
    moribundBalls = new Set();
    moribundCapsules = new Set();
    moribundOrientedBoxes = new Set();
    mMoribundBallRemovalCount = 7;
    mMoribundBallRemovalBuffer = 2;
    _blueOS = null;
    _pyOS = null;

    /**
     * Supplies the native BeOS and PyOS boundaries explicitly instead of globals.
     * Adaptation: no native lock object, CPython interpreter or automatic timer is
     * created. With no PyOS bridge there are no Python event subscribers. Native
     * timestamps are BigInts; safe integer Number inputs are accepted at boundaries.
     *
     * @param {IBlueOS|null} [blueOS=null] Host with RegisterForTicks/UnregisterForTicks; required by Start.
     * @param {Object|null} [pyOS=null] Optional native-shaped SendEvent/PyError bridge. SendEvent reports handler errors as false.
     * @returns {CjsBallparkController} An initially paused, empty simulation.
     */
    constructor(blueOS = null, pyOS = null)
    {
        this._blueOS = blueOS;
        this._pyOS = pyOS;
    }

    /**
     * Reads the exact native mTime value in 100ns units.
     * Adaptation: BigInt represents signed-int64 timestamps without Number rounding.
     *
     * @returns {bigint} Last simulation timestamp, separate from currentTime.
     */
    @meta.type.int64
    @meta.adapted
    get time()
    {
        return this.mTime;
    }

    /**
     * Writes native mTime through a checked JavaScript integer boundary.
     * Adaptation: safe Number inputs normalize to BigInt; invalid or overflowing
     * values throw instead of acquiring an already-rounded timestamp.
     *
     * @param {bigint|number} value Signed-int64 timestamp in 100ns units.
     * @returns {void} No return value.
     */
    @meta.adapted
    set time(value)
    {
        this.mTime = CjsDestinyBall._toInt64(value);
    }

    /**
     * Reads native mHaveTicks, independently of direct Evolve/OnTick calls.
     *
     * @returns {boolean} Whether Start has registered this park with its host.
     */
    @meta.type.boolean
    @meta.implemented
    get isRunning()
    {
        return this.mHaveTicks;
    }

    /**
     * Registers for native Destiny::Tick delivery, once per Start/Pause cycle.
     * Adaptation: the injected Blue host replaces native BeOS; no timer is owned here.
     *
     * @returns {void} No return value.
     * @throws {Error} If no Blue host was supplied.
     */
    @meta.blue.method
    @meta.adapted
    Start()
    {
        if (this.mHaveTicks) return;
        if (!this._blueOS) throw new Error("Start requires a Blue tick host");
        this._blueOS.RegisterForTicks(this, "Destiny::Tick");
        this.mHaveTicks = true;
    }

    /**
     * Unregisters native tick delivery without resetting clocks or first-tick state.
     * Adaptation: calls the injected Blue host. Direct Evolve/OnTick remain available.
     *
     * @returns {void} No return value.
     */
    @meta.blue.method
    @meta.adapted
    Pause()
    {
        if (!this.mHaveTicks) return;
        this._blueOS.UnregisterForTicks(this, "Destiny::Tick");
        this.mHaveTicks = false;
    }

    /**
     * Advances whole tick intervals with native first-tick and master catch-up rules.
     * Adaptation: the optional PyOS bridge replaces native Python event delivery;
     * a false SendEvent result is reported through PyError and evolution continues.
     * The host must catch handler exceptions and return false, as native PyOS does.
     * BigInt timestamps retain exact arithmetic. Invalid interval products, signed
     * clock overflow and catch-up counts outside native int32 are rejected.
     * Native profiling remains unported.
     *
     * @param {bigint|number} realTime Host real clock in 100ns units; unused by the donor.
     * @param {bigint|number} simTime Host simulation clock in 100ns units.
     * @param {*} cookie Registration cookie; unused by the donor.
     * @returns {void} No return value.
     */
    @meta.blue.method
    @meta.adapted
    OnTick(realTime, simTime, cookie)
    {
        simTime = CjsDestinyBall._toInt64(simTime);
        let lastDelta = CjsDestinyBall._toInt64(simTime - this.time);
        this.BringOutTheDeads();
        const interval = CjsBallparkController._tickTime(this.tickInterval);
        if (lastDelta < interval) return;
        this.dt = this.tickInterval * 0.001;
        // Native integer division: 5.9 intervals is still five, not a backlog reset.
        if (this.isMaster && lastDelta / interval > 5n)
        {
            lastDelta = interval;
        }
        if (this.mFirstTime)
        {
            this.Evolve(simTime);
            lastDelta = 0n;
            this.mFirstTime = false;
        }
        else
        {
            const count = lastDelta / interval;
            if (count > 2147483647n) throw new RangeError("Tick catch-up exceeds native int32");
            const intervals = Number(count);
            for (let i = 0; i < intervals; i++)
            {
                if (this._pyOS && !this._pyOS.SendEvent(this, "Destiny::DoPreTick",
                    "DoPreTick", null, "(i)", this.currentTime)) this._pyOS.PyError();
                this.Evolve(simTime - lastDelta);
                if (this._pyOS && !this._pyOS.SendEvent(this, "Destiny::DoPostTick",
                    "DoPostTick", null, "(i)", this.currentTime)) this._pyOS.PyError();
                lastDelta = CjsDestinyBall._toInt64(lastDelta - CjsBallparkController._tickTime(this.tickInterval));
            }
        }
        this.time = simTime - lastDelta;
    }

    /**
     * Shifts the simulation clock and nonzero ball timestamps, preserving zero sentinels.
     * Adaptation: checked BigInt arithmetic replaces native Be::Time; overflow is
     * rejected before mutating timestamps. Exact constructor identity replaces the
     * native ClassType comparison without using simulation schema APIs. Client
     * sample caches shift even when zero; the reference cache retains native behavior.
     *
     * @param {bigint|number} timeDelta Signed clock adjustment in 100ns units.
     * @returns {void} No return value.
     */
    @meta.blue.method
    @meta.adapted
    AdjustTimes(timeDelta)
    {
        timeDelta = CjsDestinyBall._toInt64(timeDelta);
        const time = CjsDestinyBall._toInt64(this.time + timeDelta);
        for (const ball of this._balls.values())
        {
            if (ball.constructor === CjsDestinyClientBall)
            {
                CjsDestinyBall._toInt64(ball.mPosUpdateTime + timeDelta);
                CjsDestinyBall._toInt64(ball.mRotUpdateTime + timeDelta);
            }
            if (ball.mNewTime !== 0n) CjsDestinyBall._toInt64(ball.mNewTime + timeDelta);
            if (ball.mOldTime !== 0n) CjsDestinyBall._toInt64(ball.mOldTime + timeDelta);
        }
        this.time = time;
        for (const ball of this._balls.values())
        {
            if (ball.constructor === CjsDestinyClientBall)
            {
                ball.mPosUpdateTime += timeDelta;
                ball.mRotUpdateTime += timeDelta;
            }
            if (ball.mNewTime !== 0n) ball.mNewTime += timeDelta;
            if (ball.mOldTime !== 0n) ball.mOldTime += timeDelta;
        }
    }

    _balls = new Map();
    mPartition = new CjsDestinyPartition();
    mProbe = 0n;
    mBubbleId = 0;
    bubbles = new Map();
    bubbleInteractives = new Map();
    bubbleKeepAlives = new Map();
    bubbleKeepAliveBalls = new Set();
    mBubbleSubscriptions = new Map();
    mGlobals = new Map();
    mFreeBalls = new Map();
    mStaticCollidables = new Map();
    mCapsules = new Map();
    mOrientedBoxes = new Map();
    _freeBallIds = [];

    /**
     * Exposes the native read-only Blue subscription dictionary alias.
     * Adaptation: callers mutate a Map; assigning a replacement through this alias is disallowed.
     *
     * @returns {Map<number, *>} Live subscription map; values need not be truthy.
     */
    @meta.adapted
    get bubbleSubs()
    {
        return this.mBubbleSubscriptions;
    }
    mFriction = 1000000;
    dt = 1;

    /**
     * Clears tracking collections while retaining subscriptions and the bubble counter.
     * Adaptation: JS Maps/Sets and BigInt IDs replace Python containers and integer objects;
     * injected PyOS supplies events without native refcounts or allocation-error channels.
     *
     * @returns {void} Native result or collection mutation.
     */
    @meta.adapted
    ClearBubbles()
    {
        if (this.bubbles) this.bubbles.clear();
        this.bubbleInteractives.clear();
        this.bubbleKeepAlives.clear();
        this.bubbleKeepAliveBalls.clear();
    }

    /**
     * Acknowledges added entries and removes deleted entries, then empty bubbles.
     * Adaptation: JS Maps/Sets and BigInt IDs replace Python containers and integer objects;
     * injected PyOS supplies events without native refcounts or allocation-error channels.
     *
     * @returns {void} Native result or collection mutation.
     */
    @meta.adapted
    CopyBubbles()
    {
        if (!this.bubbles) return;
        for (const [id, bubble] of this.bubbles)
        {
            for (const [ballId, action] of bubble)
            {
                if (action === 1) bubble.set(ballId, 0);
                else if (action === -1) bubble.delete(ballId);
            }
            if (bubble.size === 0) this.bubbles.delete(id);
        }
    }

    /**
     * Adds an interactive object to a non-sentinel bubble.
     * Adaptation: JS Maps/Sets and BigInt IDs replace Python containers and integer objects;
     * injected PyOS supplies events without native refcounts or allocation-error channels.
     *
     * @param {CjsDestinyPartitionable} p Spatial object.
     * @param {number} inBubble Signed-int32 bubble ID.
     * @returns {void} Native result or collection mutation.
     */
    @meta.adapted
    IncreaseInteractiveCnt(p, inBubble)
    {
        if (!p.isInteractive || inBubble === -1) return;
        let entries = this.bubbleInteractives.get(inBubble);
        if (!entries) this.bubbleInteractives.set(inBubble, entries = new Set());
        entries.add(p.mId);
    }

    /**
     * Removes an interactive object and discards an empty membership set.
     * Adaptation: JS Maps/Sets and BigInt IDs replace Python containers and integer objects;
     * injected PyOS supplies events without native refcounts or allocation-error channels.
     *
     * @param {CjsDestinyPartitionable} p Spatial object.
     * @param {number} inBubble Signed-int32 bubble ID.
     * @returns {void} Native result or collection mutation.
     */
    @meta.adapted
    DecreaseInteractiveCnt(p, inBubble)
    {
        if (!p.isInteractive || inBubble === -1) return;
        const entries = this.bubbleInteractives.get(inBubble);
        if (!entries) return;
        entries.delete(p.mId);
        if (entries.size === 0) this.bubbleInteractives.delete(inBubble);
    }

    /**
     * Updates activity by adding first and removing second, even when IDs are equal.
     * Adaptation: JS Maps/Sets and BigInt IDs replace Python containers and integer objects;
     * injected PyOS supplies events without native refcounts or allocation-error channels.
     *
     * @param {CjsDestinyPartitionable} p Spatial object.
     * @param {number} oldBubble Previous bubble.
     * @param {number} newBubble Destination bubble.
     * @returns {void} Native result or collection mutation.
     */
    @meta.adapted
    UpdateInteractiveCnt(p, oldBubble, newBubble)
    {
        if (!p.isInteractive) return;
        this.IncreaseInteractiveCnt(p, newBubble);
        this.DecreaseInteractiveCnt(p, oldBubble);
    }

    /**
     * Adds a keep-alive ID to a non-sentinel bubble.
     * Adaptation: JS Maps/Sets and BigInt IDs replace Python containers and integer objects;
     * injected PyOS supplies events without native refcounts or allocation-error channels.
     *
     * @param {bigint} ballId Native signed-int64 identity.
     * @param {number} inBubble Signed-int32 bubble ID.
     * @returns {void} Native result or collection mutation.
     */
    @meta.adapted
    AddKeepAliveBall(ballId, inBubble)
    {
        if (inBubble === -1) return;
        let entries = this.bubbleKeepAlives.get(inBubble);
        if (!entries) this.bubbleKeepAlives.set(inBubble, entries = new Set());
        entries.add(ballId);
    }

    /**
     * Removes a keep-alive ID and discards its empty membership set.
     * Adaptation: JS Maps/Sets and BigInt IDs replace Python containers and integer objects;
     * injected PyOS supplies events without native refcounts or allocation-error channels.
     *
     * @param {bigint} ballId Native signed-int64 identity.
     * @param {number} inBubble Signed-int32 bubble ID.
     * @returns {void} Native result or collection mutation.
     */
    @meta.adapted
    RemoveKeepAliveBall(ballId, inBubble)
    {
        if (inBubble === -1) return;
        const entries = this.bubbleKeepAlives.get(inBubble);
        if (!entries) return;
        entries.delete(ballId);
        if (entries.size === 0) this.bubbleKeepAlives.delete(inBubble);
    }

    /**
     * Moves only IDs in the global automatic keep-alive set, adding before removing.
     * Adaptation: JS Maps/Sets and BigInt IDs replace Python containers and integer objects;
     * injected PyOS supplies events without native refcounts or allocation-error channels.
     *
     * @param {CjsDestinyPartitionable} p Spatial object.
     * @param {number} oldBubble Previous bubble.
     * @param {number} newBubble Destination bubble.
     * @returns {void} Native result or collection mutation.
     */
    @meta.adapted
    UpdateKeepAliveBalls(p, oldBubble, newBubble)
    {
        if (!this.bubbleKeepAliveBalls.has(p.mId)) return;
        this.AddKeepAliveBall(p.mId, newBubble);
        this.RemoveKeepAliveBall(p.mId, oldBubble);
    }

    /**
     * Changes interactive membership using the old flag while removing membership.
     * Adaptation: JS Maps/Sets and BigInt IDs replace Python containers and integer objects;
     * injected PyOS supplies events without native refcounts or allocation-error channels.
     *
     * @param {bigint|number} id Ball identity.
     * @param {boolean} flag New interaction flag.
     * @returns {void} Native result or collection mutation.
     */
    @meta.adapted
    SetBallInteractive(id, flag)
    {
        const ball = this.GetBall(id);
        if (!ball) return;
        if (flag && !ball.isInteractive)
        {
            ball.isInteractive = flag;
            this.IncreaseInteractiveCnt(ball, ball.mNewBubble);
        }
        else if (!flag && ball.isInteractive)
        {
            this.DecreaseInteractiveCnt(ball, ball.mNewBubble);
            ball.isInteractive = flag;
        }
        else ball.isInteractive = flag;
    }

    /**
     * Returns the master bubble interactive count; replicas always return zero.
     * Adaptation: JS Maps/Sets and BigInt IDs replace Python containers and integer objects;
     * injected PyOS supplies events without native refcounts or allocation-error channels.
     *
     * @param {CjsDestinyBall} ball Ball whose current bubble is queried.
     * @returns {number} Native result or collection mutation.
     */
    @meta.adapted
    GetInteractiveCnt(ball)
    {
        if (!this.isMaster) return 0;
        const entries = this.bubbleInteractives.get(ball.mNewBubble);
        return entries ? entries.size : 0;
    }

    /**
     * Checks master bubble activity; replicas and warping balls are always live.
     * Adaptation: JS Maps/Sets and BigInt IDs replace Python containers and integer objects;
     * injected PyOS supplies events without native refcounts or allocation-error channels.
     *
     * @param {CjsDestinyBall} ball Ball whose current bubble is queried.
     * @returns {boolean} Native result or collection mutation.
     */
    @meta.adapted
    InDeadBubble(ball)
    {
        if (!this.isMaster || ball.mMode === Mode.DSTBALL_WARP) return false;
        const interactive = this.bubbleInteractives.get(ball.mNewBubble);
        if (interactive && interactive.size) return false;
        const keepAlive = this.bubbleKeepAlives.get(ball.mNewBubble);
        return !(keepAlive && keepAlive.size);
    }

    /**
     * Records add/delete deltas, dispatches subscribed events, then updates activity counts.
     * Adaptation: JS Maps/Sets and BigInt IDs replace Python containers and integer objects;
     * injected PyOS supplies events without native refcounts or allocation-error channels.
     *
     * @param {CjsDestinyPartitionable} p Spatial object.
     * @returns {void} Native result or collection mutation.
     */
    @meta.adapted
    AddToBubble(p)
    {
        if (!this.bubbles) this.bubbles = new Map();
        const newBubbleId = p.mNewBubble, oldBubbleId = p.mOldBubble, ballId = p.mId;
        if (p.mNewBubble !== -1)
        {
            let bubble = this.bubbles.get(newBubbleId);
            if (!bubble) this.bubbles.set(newBubbleId, bubble = new Map());
            if (!bubble.has(ballId)) bubble.set(ballId, 1);
            else if (bubble.get(ballId) === -1) bubble.set(ballId, 0);
            if (this.mBubbleSubscriptions.has(newBubbleId) && this._pyOS
                && !this._pyOS.SendEvent(this, "Destiny::DoBubbleAdd", "DoBubbleAdd", null, "(iL)", p.mNewBubble, p.mId))
                this._pyOS.PyError();
        }
        if (p.mOldBubble !== -1)
        {
            const bubble = this.bubbles.get(oldBubbleId);
            if (bubble)
            {
                const action = bubble.get(ballId);
                if (action === 0) bubble.set(ballId, -1);
                else if (action === 1) bubble.delete(ballId);
                if (this.mBubbleSubscriptions.has(oldBubbleId) && this._pyOS
                    && !this._pyOS.SendEvent(this, "Destiny::DoBubbleDel", "DoBubbleDel", null, "(iL)", p.mOldBubble, p.mId))
                    this._pyOS.PyError();
            }
        }
        this.UpdateInteractiveCnt(p, p.mOldBubble, p.mNewBubble);
        this.UpdateKeepAliveBalls(p, p.mOldBubble, p.mNewBubble);
    }

    /**
     * Finds a causal region, records a transition, then rebuilds native neighborhood membership.
     * Adaptation: JS Maps/Sets and BigInt IDs replace Python containers and integer objects;
     * injected PyOS supplies events without native refcounts or allocation-error channels.
     * Signed bubble-counter overflow throws because the native increment has undefined behavior.
     *
     * @param {CjsDestinyPartitionable} p Spatial object.
     * @returns {void} Native result or collection mutation.
     */
    @meta.adapted
    InsertInBoxes(p)
    {
        let top = null, newBubbleId = -1;
        const box = this.mPartition.GetBox(p.GetInflatedRadius(this.dt), p.mNewPos);
        if (this.isMaster)
        {
            top = this.mPartition.GetTopmost(box);
            newBubbleId = top.mBubble;
            if (newBubbleId === -1)
            {
                p.DeleteFromBoxes();
                p.mMyBox = null;
                newBubbleId = top.NearbyBubbles();
                if (newBubbleId === -1)
                {
                    // Native long overflow is undefined; reject instead of inventing wrap semantics.
                    if (this.mBubbleId >= 2147483647) throw new RangeError("Bubble counter exceeds signed-int32 increment domain");
                    newBubbleId = this.mBubbleId++;
                }
                top.mBubble = newBubbleId;
            }
            if (p.mNewBubble !== newBubbleId)
            {
                p.mOldBubble = p.mNewBubble;
                p.mNewBubble = newBubbleId;
                this.AddToBubble(p);
            }
        }
        p.InsertInBoxes(box, top, newBubbleId);
    }

    /**
     * Inserts a Ball and registers ordinary/global maps only outside Evolve.
     * Adaptation: JS Maps/Sets and BigInt IDs replace Python containers and integer objects;
     * injected PyOS supplies events without native refcounts or allocation-error channels.
     *
     * @param {CjsDestinyBall|null} ball Ball to insert.
     * @returns {void} Native result or collection mutation.
     */
    @meta.adapted
    InsertBallInBoxes(ball)
    {
        if (!ball) return;
        this.InsertInBoxes(ball);
        if (!this.inEvolve)
        {
            this._balls.set(ball.mId, ball);
            if (ball.isGlobal) this.mGlobals.set(ball.mId, ball);
        }
    }

    /**
     * Iterates free balls in native signed-ID order, including later-ID insertions.
     * JS Map has no ordered iterator; a sorted key index supplies live upper-bound lookup.
     * Re-reading the index after each yield observes insertions/removals without a stale snapshot.
     * Current-node removal safely continues in JS; the corresponding native iterator is invalid.
     *
     * @returns {Generator<CjsDestinyBall>} Live ascending-ID traversal.
     */
    @meta.ours
    *_iterateFreeBalls()
    {
        let index = 0;
        while (index < this._freeBallIds.length)
        {
            const id = this._freeBallIds[index];
            yield this.mFreeBalls.get(id);
            index = CjsBallparkController._freeBallIndex(this._freeBallIds, id, true);
        }
    }

    /**
     * Inserts native free-map membership without replacing an existing ID.
     * JS Map lacks ordered keys, so its owner maintains an acceleration index alongside it.
     *
     * @param {CjsDestinyBall} ball Ball with its native signed-int64 identity.
     * @returns {void} Existing representatives are retained.
     */
    @meta.ours
    _insertFreeBall(ball)
    {
        if (this.mFreeBalls.has(ball.mId)) return;
        const index = CjsBallparkController._freeBallIndex(this._freeBallIds, ball.mId, false);
        this.mFreeBalls.set(ball.mId, ball);
        this._freeBallIds.splice(index, 0, ball.mId);
    }

    /**
     * Erases native free-map membership and its ordered key index together.
     * The index supplies std::map ordering unavailable from JavaScript Map.
     *
     * @param {bigint} id Native signed-int64 map key.
     * @returns {void} Missing keys are ignored like native erase-by-key.
     */
    @meta.ours
    _removeFreeBall(id)
    {
        if (!this.mFreeBalls.delete(id)) return;
        this._freeBallIds.splice(CjsBallparkController._freeBallIndex(this._freeBallIds, id, false), 1);
    }



    /**
     * Recalculates connected top-cell regions, or updates one ID through the Blue overload.
     * Adaptation: JS containers replace Python values; signed counter overflow throws.
     * Repeated equal-ID updates retain native add-then-remove bookkeeping behavior.
     *
     * @param {bigint|number} [id=0n] Zero for complete initialization, otherwise one ball.
     * @returns {void} Updates native bubble state.
     */
    @meta.adapted
    InitializeBubbles(id = 0n)
    {
        id = CjsDestinyBall._toInt64(id);
        if (id !== 0n) { this.UpdateBallBubble(id); return; }
        this.mPartition.ClearTraversalFlag();
        this.mBubbleId = 0;
        this.ClearBubbles();
        for (const ball of this._balls.values())
        {
            if (!ball.mMyBox)
            {
                console.error("Ball without a box in InitializeBubbles");
                ball.mOldBubble = ball.mNewBubble;
                ball.mNewBubble = -1;
                continue;
            }
            const top = this.mPartition.GetTopmost(ball.mMyBox);
            if (top.mBubble !== -1)
            {
                ball.mOldBubble = ball.mNewBubble;
                ball.mNewBubble = top.mBubble;
                this.AddToBubble(ball);
                continue;
            }
            if (this.mBubbleId >= 2147483647) throw new RangeError("Bubble counter exceeds signed-int32 increment domain");
            top.Traverse(this.mBubbleId);
            ball.mOldBubble = ball.mNewBubble;
            ball.mNewBubble = this.mBubbleId;
            this.AddToBubble(ball);
            this.mBubbleId++;
        }
    }

    /**
     * Assigns one new-bubble ID using the first nearby assigned ball, without tracker updates.
     * Adaptation: native Python dictionary order is represented by Map insertion order.
     *
     * @param {bigint|number} id Ball identity.
     * @returns {void} Leaves old bubble, partition cells and tracking collections unchanged.
     */
    @meta.adapted
    UpdateBallBubble(id)
    {
        const ball = this.GetBall(id);
        if (!ball) { console.error("UpdateBallBubble: missing ball", id); return; }
        if (ball.mNewBubble !== -1) console.warn("UpdateBallBubble: ball already has a bubble", id);
        const width2 = this.mPartition.mLevelWidth[0] * this.mPartition.mLevelWidth[0];
        let highest = -1;
        for (const other of this._balls.values())
        {
            if (other.mNewBubble > highest) highest = other.mNewBubble;
            if (other === ball || other.mNewBubble === -1) continue;
            const x = ball.x - other.x, y = ball.y - other.y, z = ball.z - other.z;
            if (x * x + y * y + z * z < width2) { ball.mNewBubble = other.mNewBubble; break; }
        }
        if (ball.mNewBubble === -1)
        {
            if (highest >= 2147483647) throw new RangeError("Bubble ID exceeds signed-int32 range");
            ball.mNewBubble = highest + 1;
        }
    }

    /**
     * Returns the existing top-cell bubble at world coordinates.
     * Adaptation: null represents Python None; unassigned existing cells retain -1.
     *
     * Numeric primitives are converted before arithmetic; nonnumeric values throw as in "ddd" parsing.
     *
     * @param {number|bigint|boolean} x World X.
     * @param {number|bigint|boolean} y World Y.
     * @param {number|bigint|boolean} z World Z.
     * @returns {number|null} Existing bubble or null for absent cells.
     */
    @meta.adapted
    GetBubbleAtCoordinates(x, y, z)
    {
        const pos = [x, y, z];
        for (let i = 0; i < 3; ++i)
        {
            if (typeof pos[i] === "bigint" || typeof pos[i] === "boolean") pos[i] = Number(pos[i]);
            else if (typeof pos[i] !== "number") throw new TypeError("Coordinates must be numeric primitives");
        }
        const top = this.mPartition.GetExistingTopBox(pos);
        return top ? top.mBubble : null;
    }

    /**
     * Resolves native explicit IDs and master/replica local-allocation requests.
     * Adaptation: checked BigInt conversion replaces the native int64 argument;
     * exhausted counters throw before decrement rather than overflowing signed C++.
     * Allocation does not search for collisions with explicitly supplied IDs.
     *
     * @param {bigint|number} objectId Explicit ID or native allocation sentinel.
     * @returns {bigint} Resolved signed-int64 collision-object identity.
     */
    @meta.adapted
    GetIDForCollisionObject(objectId)
    {
        objectId = CjsDestinyBall._toInt64(objectId);
        if ((this.isMaster && objectId < 0n) || (!this.isMaster && objectId === -1n))
        {
            this.mLocalHiCnt = CjsDestinyBall._toInt64(this.mLocalHiCnt - 1n);
            return this.mLocalHiCnt;
        }
        if (this.isMaster && objectId === 0n)
        {
            this.mLocalCnt = CjsDestinyBall._toInt64(this.mLocalCnt - 1n);
            return this.mLocalCnt;
        }
        return objectId;
    }

    /**
     * Adds or updates a ball without initializing its orientation, as native AddBall does.
     * Use AddOldStyleOrientedBall or AddDynamicallyOrientedBall for oriented creation.
     * Adaptation: checked BigInt IDs, finite scalar inputs and immediate ball-map
     * registration follows native spatial insertion and subscribed bubble callbacks.
     * Re-adding a resolved ID keeps object identity and
     * follower links. Nonpositive IDs follow native master/replica allocation.
     *
     * @param {bigint|number} objectId Signed-int64 identity or allocation sentinel; Number inputs must be safe integers.
     * @param {number} mass Mass in kilograms.
     * @param {number} radius Radius in meters.
     * @param {number} maxVel Maximum speed in meters per second.
     * @param {boolean} isFree Whether the ball can move.
     * @param {boolean} isGlobal Native global-visibility flag.
     * @param {boolean} isMassive Native collision participation flag.
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
        objectId = CjsDestinyBall._toInt64(objectId);
        if (![mass, radius, maxVel, x, y, z, vx, vy, vz, agility, speedFraction].every(Number.isFinite)
            || ![radius, maxVel, agility, speedFraction].map(Math.fround).every(Number.isFinite))
        {
            throw new RangeError("Ball parameters must be finite and fit their native scalar types");
        }

        objectId = this.GetIDForCollisionObject(objectId);
        let ball = this._balls.get(objectId);
        const created = !ball;
        if (created)
        {
            ball = this.isMaster ? new CjsDestinyBall() : new CjsDestinyClientBall();
            ball.id = objectId;
        }
        else
        {
            ball.DeleteFromBoxes();
            this.Stop(objectId);
        }
        ball.mPark = this;
        ball.x = x;
        ball.y = y;
        ball.z = z;
        ball.vx = vx;
        ball.vy = vy;
        ball.vz = vz;
        if (created)
        {
            ball._oldX = x - this.dt * vx;
            ball._oldY = y - this.dt * vy;
            ball._oldZ = z - this.dt * vz;
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
        this.moribundBalls.delete(ball);
        ball.mEffectStamp = 0;
        ball.mFormationID = -1;
        ball.mOwnerId = 0n;
        ball.mCorporationID = -1;
        ball.mAllianceID = -1;
        ball.mHarmonic = -1n;
        ball.followId = 0n;
        ball.followRange = 10;
        this.SetBallTimeFactor(ball);
        if (ball.isFree)
        {
            this._insertFreeBall(ball);
        }
        else if (!created) this._removeFreeBall(ball.mId);
        ball.SetMode(Mode.DSTBALL_STOP);
        this.InsertBallInBoxes(ball);
        return ball;
    }

    /**
     * Adds or updates a ball and snaps free balls to the legacy velocity heading.
     * Adaptation: uses the checked JS creation inputs; snapping is independent
     * of the global dynamical-orientation setting, as in the native wrapper.
     * Source: destiny/src/Ballpark.cpp:3467-3496.
     * @param {bigint|number} objectId Signed-int64 identity or allocation sentinel; Number inputs must be safe integers.
     * @param {number} mass Mass in kilograms.
     * @param {number} radius Radius in meters.
     * @param {number} maxVel Maximum speed in meters per second.
     * @param {boolean} isFree Whether the ball can move.
     * @param {boolean} isGlobal Native global-visibility flag.
     * @param {boolean} isMassive Native collision participation flag.
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
     * @returns {CjsDestinyBall} Created or updated ball after one legacy snap.
     */
    @meta.adapted
    AddOldStyleOrientedBall(objectId, mass, radius, maxVel, isFree, isGlobal, isMassive,
        isInteractive, isSpaceJunk, x, y, z, vx, vy, vz, agility, speedFraction)
    {
        const ball = this.AddBall(objectId, mass, radius, maxVel, isFree, isGlobal, isMassive,
            isInteractive, isSpaceJunk, x, y, z, vx, vy, vz, agility, speedFraction);
        if (ball.isFree) ball.CalculateYawPitchRoll(true);
        return ball;
    }

    /**
     * Creates physical orientation samples without normalizing the supplied quaternion.
     * Adaptation: native float inputs use factory-owned float32 storage. The
     * old rotation backstep reverses Carbon quaternion operands for gl-matrix.
     * Source: destiny/src/Ballpark.cpp:3503-3553; MapOfBalls.h:25-40.
     * @param {bigint|number} objectId Signed-int64 identity or allocation sentinel; Number inputs must be safe integers.
     * @param {number} mass Mass in kilograms.
     * @param {number} radius Radius in meters.
     * @param {number} maxVel Maximum speed in meters per second.
     * @param {number} maxAngVel Maximum angular speed in radians per second.
     * @param {boolean} isFree Whether the ball can move.
     * @param {boolean} isGlobal Native global-visibility flag.
     * @param {boolean} isMassive Native collision participation flag.
     * @param {boolean} isInteractive Native interactive-population flag.
     * @param {boolean} isSpaceJunk Native space-junk flag.
     * @param {number} x Position component in meters.
     * @param {number} y Position component in meters.
     * @param {number} z Position component in meters.
     * @param {number} vx Velocity component in meters per second.
     * @param {number} vy Velocity component in meters per second.
     * @param {number} vz Velocity component in meters per second.
     * @param {number} rx Quaternion X.
     * @param {number} ry Quaternion Y.
     * @param {number} rz Quaternion Z.
     * @param {number} rw Quaternion W.
     * @param {number} wx Angular velocity X in radians per second.
     * @param {number} wy Angular velocity Y in radians per second.
     * @param {number} wz Angular velocity Z in radians per second.
     * @param {number} agility Native positive mass/agility multiplier.
     * @param {number} rotAgility Rotational agility; nonpositive values become one.
     * @param {number} speedFraction Initial fraction of maximum speed.
     * @returns {CjsDestinyBall} Created or updated ball with explicit angular state.
     */
    @meta.adapted
    AddDynamicallyOrientedBall(objectId, mass, radius, maxVel, maxAngVel,
        isFree, isGlobal, isMassive, isInteractive, isSpaceJunk,
        x, y, z, vx, vy, vz, rx, ry, rz, rw, wx, wy, wz, agility, rotAgility, speedFraction)
    {
        // Native quirk: the probe consumes a sentinel ID, then AddBall resolves
        // the ORIGINAL ID again. MapOfBalls lookup does not insert a null entry.
        const theID = this.GetIDForCollisionObject(objectId);
        const isNewBall = !this.GetBall(theID);
        const ball = this.AddBall(objectId, mass, radius, maxVel, isFree, isGlobal, isMassive,
            isInteractive, isSpaceJunk, x, y, z, vx, vy, vz, agility, speedFraction);
        quat.set(ball.mNewRot, rx, ry, rz, rw);
        vec3.set(ball.mNewAngVel, wx, wy, wz);
        if (isNewBall)
        {
            // No scratch survives the creation callbacks above.
            const { quat_0 } = CjsBallparkController.scratch;
            const angle = f32(-f32(this.dt) * CjsDestinyBall._lengthVector3(ball.mNewAngVel));
            CjsDestinyBall._rotationQuaternion(quat_0,
                ball.mNewAngVel[0], ball.mNewAngVel[1], ball.mNewAngVel[2], angle);
            quat.multiply(ball.mOldRot, quat_0, ball.mNewRot);
            vec3.copy(ball.mOldAngVel, ball.mNewAngVel);
        }
        maxAngVel = f32(maxAngVel);
        rotAgility = f32(rotAgility);
        ball.mMaxAngVel = maxAngVel < 0 ? 0 : maxAngVel;
        ball.mRotAgility = rotAgility <= 0 ? 1 : rotAgility;
        return ball;
    }

    /**
     * Dispatches the native Python creation entry by the live orientation setting.
     * Adaptation: positional JS arguments replace the Python tuple; the selected
     * wrapper checks its exact arity before spreading the bounded argument list.
     * Source: destiny/src/Thunkers.cpp:150-159.
     * @param {...unknown} args Seventeen legacy arguments, or nineteen dynamic arguments.
     * @returns {CjsDestinyBall} Created or updated ball.
     */
    @meta.adapted
    PyAddBall(...args)
    {
        const count = g_useDynamicalOrientation ? 19 : 17;
        if (args.length !== count) throw new TypeError(`PyAddBall requires ${count} arguments`);
        return g_useDynamicalOrientation ? this.PyAddDynamicallyOrientedBall(...args)
            : this.PyAddOldStyleOrientedBall(...args);
    }

    /**
     * Rejects Python-facing creation while the park is evolving.
     * Adaptation: JS positional values replace tuple parsing and Error replaces
     * Python RuntimeError. Scalar validation remains in the core creation path.
     * Source: destiny/src/Thunkers.cpp:113-145.
     * @param {...unknown} args The seventeen AddOldStyleOrientedBall arguments, in the same order.
     * @returns {CjsDestinyBall} Created or updated ball after its legacy snap.
     */
    @meta.adapted
    PyAddOldStyleOrientedBall(...args)
    {
        if (args.length !== 17) throw new TypeError("PyAddOldStyleOrientedBall requires 17 arguments");
        if (this.inEvolve) throw new Error("Can not add ball during Evolve().");
        return this.AddOldStyleOrientedBall(...args);
    }

    /**
     * Creates identity/zero angular state and then snaps it to velocity, even for fixed balls.
     * Adaptation: JS positional values replace tuple parsing and Error replaces
     * Python RuntimeError. Scalar validation remains in the core creation path.
     * Source: destiny/src/Thunkers.cpp:51-106.
     * @param {...unknown} args The seventeen legacy creation arguments, followed by maxAngularSpeed and angularAgility.
     * @returns {CjsDestinyBall} Created or updated ball after its unconditional dynamic snap.
     */
    @meta.adapted
    PyAddDynamicallyOrientedBall(...args)
    {
        if (args.length !== 19) throw new TypeError("PyAddDynamicallyOrientedBall requires 19 arguments");
        if (this.inEvolve) throw new Error("Can not add ball during Evolve().");
        const [objectId, mass, radius, maxVel, isFree, isGlobal, isMassive,
            isInteractive, isSpaceJunk, x, y, z, vx, vy, vz, agility, speedFraction,
            maxAngularSpeed, angularAgility] = args;
        const ball = this.AddDynamicallyOrientedBall(objectId, mass, radius, maxVel, maxAngularSpeed,
            isFree, isGlobal, isMassive, isInteractive, isSpaceJunk, x, y, z, vx, vy, vz,
            0, 0, 0, 1, 0, 0, 0, agility, angularAgility, speedFraction);
        ball.SnapOrientation();
        return ball;
    }

    /**
     * Returns the ball or null, without inserting a missing ID into the map.
     * Adaptation: checked IDs normalize Number and BigInt inputs to one map key.
     *
     * @param {bigint|number} id Signed-int64 ball identity; Number inputs must be safe integers.
     * @returns {CjsDestinyBall|null} Live ball, or null when absent.
     */
    @meta.blue.method
    @meta.adapted
    GetBall(id)
    {
        return this._balls.get(CjsDestinyBall._toInt64(id)) ?? null;
    }

    /**
     * Reads the native Blue ego identifier.
     * @returns {bigint} Ball used as the renderer's reference origin.
     */
    @meta.type.int64
    @meta.implemented
    get ego()
    {
        return this.mEgo;
    }

    /**
     * Assigns the native ego without invalidating the same-time reference cache.
     * Adaptation: checked Number IDs normalize to BigInt.
     * @param {number|bigint} value Reference ball identity.
     * @returns {void} The next different-time sample updates the reference.
     */
    @meta.adapted
    set ego(value)
    {
        this.mEgo = CjsDestinyBall._toInt64(value);
    }

    /**
     * Resolves and caches the native ego ball.
     * Missing lookup does not insert a null map entry, matching native MapOfBalls.
     * Source: destiny/src/Ballpark.cpp:6624-6645.
     * @returns {CjsDestinyClientBall|null} Current reference ball.
     */
    @meta.adapted
    GetEgo()
    {
        if (this.mEgo === this.mLastEgo && this.mLastEgoBall) return this.mLastEgoBall;
        this.mLastEgoBall = this.GetBall(this.mEgo);
        this.mLastEgo = this.mEgo;
        return this.mLastEgoBall;
    }

    /**
     * Samples the ego's absolute position on the same clock as every client ball.
     * Adaptation: safe Number ticks normalize to BigInt and time precedes output.
     * The native same-time cache survives ego changes, removal and AdjustTimes.
     * Source: destiny/src/Ballpark.cpp:3041-3066.
     * @param {number|bigint} time Scene clock in elapsed 100ns ticks since Blue startup.
     * @param {Float64Array} out Caller-owned reference position.
     * @returns {Float64Array} The supplied output.
     */
    @meta.adapted
    GetReferencePoint(time, out)
    {
        time = CjsDestinyBall._toInt64(time);
        if (time === this.mLastReferenceTime) return vec3.copy(out, this.mLastReference);
        const ball = this.GetEgo();
        if (!ball) return vec3.set(out, 0, 0, 0);
        ball.InterpolatedPosition(time, this.mLastReference);
        vec3.copy(this.mLastDelta, this.mOldReference);
        vec3.copy(this.mOldReference, this.mLastReference);
        vec3.subtract(this.mLastDelta, this.mLastReference, this.mLastDelta);
        this.mLastReferenceTime = time;
        return vec3.copy(out, this.mLastReference);
    }

    /**
     * Computes the native direct heading torque, excluding angular roll.
     * Adaptation: caller-owned float32 output replaces Vector3 return-by-value;
     * dirty class scratch replaces stack values. Runtime arithmetic uses double
     * intermediates rounded to float32 storage, not bitwise native float math.
     * Source: destiny/src/Ballpark.cpp:1511-1578.
     * @param {Float32Array} out Receives world heading torque after all input reads.
     * @param {CjsDestinyBall} ball Physical angular state.
     * @param {Float32Array} direction Desired world direction, possibly out.
     * @returns {Float32Array} The supplied output.
     */
    @meta.adapted
    GotoTorque(out, ball, direction)
    {
        const tScale = f32(f32(this.mFriction) / f32(f32(f32(ball.mMass) * ball.mAgility) * ball.mRotAgility));
        const maxAlpha = f32(ball.mMaxAngVel * tScale);
        if (maxAlpha <= 0) return vec3.zero(out);
        const lenDir = CjsDestinyBall._lengthVector3(direction);
        if (lenDir === 0) return vec3.zero(out);
        const { vec3_5, vec3_6, vec3_7, vec3_8, vec3_12, mat4_1 } = CjsBallparkController.scratch;
        vec3.copy(vec3_12, direction);
        mat4.fromQuat(mat4_1, ball.mNewRot);
        vec3.set(vec3_5, 0, 0, 1);
        CjsDestinyBall._transformCoord(vec3_5, vec3_5, mat4_1);
        CjsDestinyBall._normalizeVector3(vec3_5, vec3_5);
        vec3.cross(vec3_6, vec3_5, vec3_12);
        vec3.scale(vec3_6, vec3_6, f32(1 / lenDir));
        const rotLength = CjsDestinyBall._lengthVector3(vec3_6);
        const cosine = f32(CjsDestinyBall._dotVector3(vec3_12, vec3_5) / lenDir);
        const capped = cosine < 1 ? cosine : 1;
        const rotAngle = f32(Math.acos(-1 < capped ? capped : -1));
        if (rotLength > 1e-12) vec3.scale(vec3_6, vec3_6, f32(rotAngle / rotLength));
        else if (rotAngle > 1) vec3.set(vec3_6, -rotAngle, 0, 0);
        vec3.scale(vec3_7, vec3_5, CjsDestinyBall._dotVector3(vec3_5, ball.mNewAngVel));
        vec3.subtract(vec3_7, ball.mNewAngVel, vec3_7);
        vec3.scale(vec3_6, vec3_6, tScale);
        vec3.subtract(vec3_8, vec3_6, vec3_7);
        const turn = f32(f32(2 * f32(Math.PI)) * tScale);
        for (let i = 0; i < 3; ++i)
        {
            const negative = f32(f32(turn - vec3_6[i]) - vec3_7[i]);
            if (Math.abs(vec3_8[i]) > Math.abs(negative)) vec3_8[i] = negative;
        }
        const tAcc = f32(CjsDestinyBall._lengthVector3(vec3_8) / maxAlpha);
        if (tAcc > this.dt) vec3.scale(vec3_8, vec3_8, f32(1 / tAcc));
        return vec3.copy(out, vec3_8);
    }

    /**
     * Finds native acceleration/braking heading torque using five bounded searches.
     * Adaptation: output/scratch replace native vector values; a retained record
     * supplies the helper's scalar references. Float storage and scalar assignments
     * are narrowed, with runtime vector intermediates remaining JavaScript doubles.
     * Source: destiny/src/Ballpark.cpp:1616-1749.
     * @param {Float32Array} out Receives world heading torque after all input reads.
     * @param {CjsDestinyBall} ball Physical angular state.
     * @param {Float32Array} direction Desired world direction, possibly out.
     * @returns {Float32Array} The supplied output.
     */
    @meta.adapted
    GotoTorqueBreaks(out, ball, direction)
    {
        const tScale = f32(f32(this.mFriction) / f32(f32(f32(ball.mMass) * ball.mAgility) * ball.mRotAgility));
        const maxAlpha = f32(ball.mMaxAngVel * tScale);
        if (maxAlpha <= 0) return vec3.zero(out);
        const lenDir = CjsDestinyBall._lengthVector3(direction);
        if (lenDir === 0) return vec3.zero(out);
        const { vec3_5, vec3_6, vec3_7, vec3_8, vec3_9, vec3_10, vec3_12, mat4_1, vectorBraking } = CjsBallparkController.scratch;
        vec3.copy(vec3_12, direction);
        mat4.fromQuat(mat4_1, ball.mNewRot);
        vec3.set(vec3_5, 0, 0, 1);
        CjsDestinyBall._transformCoord(vec3_5, vec3_5, mat4_1);
        CjsDestinyBall._normalizeVector3(vec3_5, vec3_5);
        vec3.cross(vec3_6, vec3_5, vec3_12);
        vec3.scale(vec3_6, vec3_6, f32(1 / lenDir));
        const rotLength = CjsDestinyBall._lengthVector3(vec3_6);
        const cosine = f32(CjsDestinyBall._dotVector3(vec3_12, vec3_5) / lenDir);
        const capped = cosine < 1 ? cosine : 1;
        const rotAngle = f32(Math.acos(-1 < capped ? capped : -1));
        if (rotLength > 1e-12) vec3.scale(vec3_6, vec3_6, f32(rotAngle / rotLength));
        else if (rotAngle > 1) vec3.set(vec3_6, -rotAngle, 0, 0);
        vec3.scale(vec3_7, vec3_5, CjsDestinyBall._dotVector3(vec3_5, ball.mNewAngVel));
        vec3.subtract(vec3_7, ball.mNewAngVel, vec3_7);
        const lenOmega0 = CjsDestinyBall._lengthVector3(vec3_7);
        if (lenOmega0 * this.dt < 1e-4 && rotAngle < 1e-4) return vec3.zero(out);
        let n1 = 0, kappa1 = 1;
        vec3.zero(vec3_8);
        const tf = f32(Math.exp(f32(-f32(this.dt) * tScale))), tau = f32(1 / tScale);
        CalculateN2Alpha2(vectorBraking, vec3_7, lenOmega0, ball, tf, f32(this.dt), tScale);
        for (let count = 0; count < 5; ++count)
        {
            const { n2, kappa2, alpha2 } = vectorBraking;
            if (n2 > 0)
            {
                const first = f32(f32(n2 * this.dt) - f32(tau * f32(1 - kappa2)));
                for (let i = 0; i < 3; ++i)
                    vec3_9[i] = f32(f32(f32(tau * alpha2[i]) * first) + f32(f32(tau * vec3_7[i]) * f32(1 - kappa2)));
                vec3.subtract(vec3_9, vec3_6, vec3_9);
                if (CjsDestinyBall._lengthVector3(vec3_9) < 1e-3) { n1 = 0; break; }
            }
            kappa1 = 1;
            for (n1 = 1; n1 < 100; ++n1)
            {
                kappa1 = f32(kappa1 * tf);
                let offset, denominator;
                if (n2 === 0)
                {
                    offset = f32(tau * f32(1 - kappa1));
                    denominator = f32(tau * f32(f32(n1 * this.dt) - offset));
                }
                else
                {
                    offset = f32(tau - f32(f32(f32(kappa1 * kappa2) * f32(n2 * this.dt)) / f32(1 - kappa2)));
                    denominator = f32(tau * f32(f32(n1 * this.dt) - f32(f32(f32(f32(n2 * this.dt) * kappa2) * f32(1 - kappa1)) / f32(1 - kappa2))));
                }
                for (let i = 0; i < 3; ++i) vec3_8[i] = f32(f32(vec3_6[i] - f32(vec3_7[i] * offset)) * f32(1 / denominator));
                if (CjsDestinyBall._lengthVector3(vec3_8) < maxAlpha) break;
            }
            const n2Old = vectorBraking.n2;
            const factor = f32(tau * f32(1 - kappa1));
            for (let i = 0; i < 3; ++i) vec3_10[i] = f32(f32(vec3_8[i] * factor) + f32(vec3_7[i] * kappa1));
            CalculateN2Alpha2(vectorBraking, vec3_10, CjsDestinyBall._lengthVector3(vec3_10), ball, tf, f32(this.dt), tScale);
            if (n2Old === vectorBraking.n2) break;
        }
        if (n1 > 0)
        {
            if (n1 > 1)
            {
                CjsDestinyBall._normalizeVector3(vec3_8, vec3_8);
                vec3.scale(vec3_8, vec3_8, maxAlpha);
            }
            return vec3.copy(out, vec3_8);
        }
        if (vectorBraking.n2 > 0) return vec3.copy(out, vectorBraking.alpha2);
        return vec3.zero(out);
    }

    /**
     * Computes native banking torque with acceleration and braking phases.
     * Adaptation: class scratch and a retained helper-reference record replace
     * stack values; scalar float assignments are explicitly narrowed.
     * Source: destiny/src/Ballpark.cpp:1751-1884.
     * @param {CjsDestinyBall} ball Physical angular state.
     * @param {Float32Array} headingTorque Heading torque in world coordinates.
     * @returns {number} Native float roll acceleration.
     */
    @meta.adapted
    GotoRollBreaks(ball, headingTorque)
    {
        const tScale = f32(f32(this.mFriction) / f32(f32(f32(ball.mMass) * ball.mAgility) * ball.mRotAgility));
        const maxAlpha = f32(tScale * ball.mMaxAngVel);
        if (maxAlpha <= 0) return 0;
        const { vec3_5, vec3_6, vec3_7, vec3_12, quat_3, mat4_1, scalarBraking } = CjsBallparkController.scratch;
        vec3.copy(vec3_12, headingTorque);
        quat.conjugate(quat_3, ball.mNewRot);
        mat4.fromQuat(mat4_1, quat_3);
        CjsDestinyBall._transformCoord(vec3_5, ball.mNewAngVel, mat4_1);
        const omegaRoll = vec3_5[2], lenTorque = CjsDestinyBall._lengthVector3(vec3_12);
        let turnRoll = 0, weight = 0;
        if (lenTorque > 0.05 * maxAlpha)
        {
            CjsDestinyBall._transformCoord(vec3_6, vec3_12, mat4_1);
            vec3_5[2] = 0;
            const cosine = CjsDestinyBall._dotVector3(vec3_5, vec3_6);
            if (cosine >= 0 || CjsDestinyBall._lengthVector3(vec3_5) < f32(f32(0.01) * ball.mMaxAngVel))
            {
                turnRoll = f32(Math.atan2(-vec3_6[1], -vec3_6[0]));
                weight = f32(lenTorque / tScale);
                if (weight > 1) weight = 1;
            }
        }
        vec3.set(vec3_7, 0, 1, 0);
        CjsDestinyBall._transformCoord(vec3_7, vec3_7, mat4_1);
        // Native fabs receives the boolean comparison, not up.z itself.
        const upRoll = vec3_7[2] < f32(0.95) ? f32(Math.atan2(-vec3_7[0], vec3_7[1])) : 0;
        const desiredRoll = weight < f32(0.05) ? upRoll : f32(weight * turnRoll);
        if (Math.abs(omegaRoll) < 1e-4 && Math.abs(desiredRoll) < 1e-4) return 0;
        let n1 = 0, alpha1 = NaN, kappa1 = 1;
        const tf = f32(Math.exp(f32(-f32(this.dt) * tScale))), tau = f32(1 / tScale);
        CalculateN2Alpha2(scalarBraking, omegaRoll, Math.abs(omegaRoll), ball, tf, f32(this.dt), tScale);
        for (let count = 0; count < 5; ++count)
        {
            const { n2, kappa2, alpha2 } = scalarBraking;
            if (n2 > 0)
            {
                const theta2 = f32(f32(f32(tau * alpha2) * f32(f32(n2 * this.dt) - f32(tau * f32(1 - kappa2)))) + f32(f32(tau * omegaRoll) * f32(1 - kappa2)));
                if (Math.abs(f32(desiredRoll - theta2)) < 1e-3) { n1 = 0; break; }
            }
            kappa1 = 1;
            for (n1 = 1; n1 < 100; ++n1)
            {
                kappa1 = f32(kappa1 * tf);
                let offset, denominator;
                if (n2 === 0)
                {
                    offset = f32(tau * f32(1 - kappa1));
                    denominator = f32(tau * f32(f32(n1 * this.dt) - offset));
                }
                else
                {
                    offset = f32(tau - f32(f32(f32(kappa1 * kappa2) * f32(n2 * this.dt)) / f32(1 - kappa2)));
                    denominator = f32(tau * f32(f32(n1 * this.dt) - f32(f32(f32(f32(n2 * this.dt) * kappa2) * f32(1 - kappa1)) / f32(1 - kappa2))));
                }
                alpha1 = f32(f32(desiredRoll - f32(omegaRoll * offset)) / denominator);
                if (Math.abs(alpha1) < maxAlpha) break;
            }
            const n2Old = scalarBraking.n2;
            const omega1 = f32(f32(f32(alpha1 * tau) * f32(1 - kappa1)) + f32(omegaRoll * kappa1));
            CalculateN2Alpha2(scalarBraking, omega1, Math.abs(omega1), ball, tf, f32(this.dt), tScale);
            if (n2Old === scalarBraking.n2) break;
        }
        if (n1 > 0) return n1 > 1 ? f32((alpha1 >= 0 ? 1 : -1) * maxAlpha) : alpha1;
        if (scalarBraking.n2 > 0) return scalarBraking.alpha2;
        return 0;
    }

    /**
     * Computes native direct banking torque with the alternate-turn comparison.
     * Adaptation: class scratch replaces stack values and float assignments are
     * narrowed; the native boolean up-roll condition remains unchanged.
     * Source: destiny/src/Ballpark.cpp:1886-1934.
     * @param {CjsDestinyBall} ball Physical angular state.
     * @param {Float32Array} headingTorque Heading torque in world coordinates.
     * @returns {number} Native float roll acceleration.
     */
    @meta.adapted
    GotoRoll(ball, headingTorque)
    {
        const tScale = f32(f32(this.mFriction) / f32(f32(f32(ball.mMass) * ball.mAgility) * ball.mRotAgility));
        const maxAlpha = f32(tScale * ball.mMaxAngVel);
        if (maxAlpha <= 0) return 0;
        const lenTorque = CjsDestinyBall._lengthVector3(headingTorque);
        const { vec3_5, vec3_6, vec3_12, quat_3, mat4_1 } = CjsBallparkController.scratch;
        vec3.copy(vec3_12, headingTorque);
        quat.conjugate(quat_3, ball.mNewRot);
        mat4.fromQuat(mat4_1, quat_3);
        let turnRoll = 0;
        if (lenTorque > 1e-10)
        {
            CjsDestinyBall._transformCoord(vec3_5, vec3_12, mat4_1);
            turnRoll = f32(Math.atan2(-vec3_5[1], -vec3_5[0]));
        }
        vec3.set(vec3_6, 0, 1, 0);
        CjsDestinyBall._transformCoord(vec3_6, vec3_6, mat4_1);
        const upRoll = vec3_6[2] < f32(0.95) ? f32(Math.atan2(-vec3_6[0], vec3_6[1])) : 0;
        const weight = f32(lenTorque / maxAlpha);
        const desiredRoll = weight < 0.1 ? upRoll : turnRoll;
        CjsDestinyBall._transformCoord(vec3_5, ball.mNewAngVel, mat4_1);
        const omegaRoll = vec3_5[2];
        let tauRoll = f32(f32(desiredRoll * tScale) - omegaRoll);
        const tauRollNeg = f32(f32(f32(f32(2 * f32(Math.PI)) - desiredRoll) * tScale) - omegaRoll);
        if (Math.abs(tauRollNeg) < Math.abs(tauRoll)) tauRoll = tauRollNeg;
        const tAcc = f32(Math.abs(tauRoll) / maxAlpha);
        if (tAcc > 1) tauRoll = f32(tauRoll / tAcc);
        return tauRoll;
    }

    /**
     * Analytically integrates native heading torque and roll with angular drag.
     * Adaptation: float32 scratch replaces native stack vectors and quaternions;
     * runtime arithmetic uses JS double intermediates with float32 stored results.
     * Carbon quaternion products reverse gl operands. Outputs are written last,
     * after all scratch reads, and console supplies the native NaN log channel.
     * Source: destiny/src/Ballpark.cpp:1936-1983.
     * @param {Float32Array} rotation In/out physical orientation.
     * @param {Float32Array} angvel In/out world angular velocity.
     * @param {Float32Array} torque Heading torque, permitted to alias angvel.
     * @param {number} roll Roll torque scalar.
     * @param {number} tau Angular drag time constant.
     * @param {number} timeStepFraction Fraction of this park's tick to integrate.
     * @returns {void} Updates rotation and angular velocity without allocating.
     */
    @meta.adapted
    ApplyTorque(rotation, angvel, torque, roll, tau, timeStepFraction)
    {
        const { vec3_0, vec3_1, vec3_2, vec3_3, vec3_4, quat_0, quat_1, quat_2, mat4_0 } = CjsBallparkController.scratch;
        const wx = angvel[0], wy = angvel[1], wz = angvel[2];
        const tx = torque[0], ty = torque[1], tz = torque[2];
        roll = f32(roll); tau = f32(tau); timeStepFraction = f32(timeStepFraction);
        const interval = f32(f32(this.dt) * timeStepFraction);
        const timeFactor = f32(Math.exp(f32(-interval / tau)));
        const decay = f32(1 - timeFactor);
        quat.copy(quat_0, rotation);
        mat4.fromQuat(mat4_0, quat_0);
        vec3.set(vec3_0, 0, 0, 1);
        CjsDestinyBall._transformCoord(vec3_0, vec3_0, mat4_0);
        const omegaRoll = f32(f32(f32(wx * vec3_0[0]) + f32(wy * vec3_0[1])) + f32(wz * vec3_0[2]));
        vec3.scale(vec3_1, vec3_0, omegaRoll);
        vec3.set(vec3_1, wx - vec3_1[0], wy - vec3_1[1], wz - vec3_1[2]);
        const integrated = f32(interval - f32(tau * decay));
        const rotRoll = f32(tau * f32(f32(roll * integrated) + f32(omegaRoll * decay)));
        for (let i = 0; i < 3; ++i)
            vec3_2[i] = f32(tau * f32(f32((i === 0 ? tx : i === 1 ? ty : tz) * integrated) + f32(vec3_1[i] * decay)));
        const angleHeading = f32(Math.sqrt(f32(f32(f32(vec3_2[0] * vec3_2[0]) + f32(vec3_2[1] * vec3_2[1])) + f32(vec3_2[2] * vec3_2[2]))));
        const applyHeading = angleHeading > 1e-10;
        if (applyHeading)
        {
            CjsDestinyBall._rotationQuaternion(quat_1, vec3_2[0], vec3_2[1], vec3_2[2], angleHeading);
            mat4.fromQuat(mat4_0, quat_1);
            CjsDestinyBall._transformCoord(vec3_3, vec3_0, mat4_0);
        }
        else
        {
            quat.identity(quat_1);
            vec3.copy(vec3_3, vec3_0);
        }
        const torqueFactor = f32(tau * decay);
        const tauRoll = f32(tau * roll);
        const rollFactor = f32(tauRoll - f32(f32(tauRoll - omegaRoll) * timeFactor));
        for (let i = 0; i < 3; ++i)
            vec3_4[i] = f32(f32(f32((i === 0 ? tx : i === 1 ? ty : tz) * torqueFactor) + f32(vec3_1[i] * timeFactor)) + f32(vec3_3[i] * rollFactor));
        // Carbon rotation *= quatHeading, then *= quatRoll: heading then roll.
        if (applyHeading) quat.multiply(quat_0, quat_1, quat_0);
        CjsDestinyBall._rotationQuaternion(quat_2, vec3_3[0], vec3_3[1], vec3_3[2], rotRoll);
        quat.multiply(quat_0, quat_2, quat_0);
        const norm = f32(Math.sqrt(f32(f32(f32(f32(quat_0[0] * quat_0[0]) + f32(quat_0[1] * quat_0[1])) + f32(quat_0[2] * quat_0[2])) + f32(quat_0[3] * quat_0[3]))));
        if (norm > 0) quat.scale(quat_0, quat_0, f32(1 / norm));
        // Snapshot both results so caller output may itself be a scratch slot.
        const x = vec3_4[0], y = vec3_4[1], z = vec3_4[2];
        const qx = quat_0[0], qy = quat_0[1], qz = quat_0[2], qw = quat_0[3];
        vec3.set(angvel, x, y, z);
        quat.set(rotation, qx, qy, qz, qw);
        if (Number.isNaN(norm)) console.error("NaNs in rotation");
    }

    /**
     * Approximates the native ellipsoidal contact offset from a sphere normal.
     * Adaptation: caller-owned output replaces Vector3d return-by-value; class
     * scratch retains native float conversions and axis-angle matrix behavior.
     * Native quirk: dynamic axial/perpendicular/out-of-range cosine branches
     * return the unscaled outward normal, without multiplying by radius.
     * Source: destiny/src/Ballpark.cpp:2323-2367.
     * Source: math/include/Matrix_inline.h:365-412.
     * @param {CjsDestinyBall} ball Supplies the collision radius.
     * @param {BallLocation} ballLoc Physical rotation at impact.
     * @param {CollisionItem} collision Supplies the inward double-precision normal.
     * @param {Float64Array|number[]} out Caller-owned contact offset, written last.
     * @returns {Float64Array|number[]} The supplied output.
     */
    @meta.adapted
    ApproximateEllipsePointOfImpact(ball, ballLoc, collision, out)
    {
        const nx = collision.normal[0], ny = collision.normal[1], nz = collision.normal[2];
        if (!g_useDynamicalOrientation) return vec3.set(out, -nx * ball.mRadius, -ny * ball.mRadius, -nz * ball.mRadius);
        const { vec3_15, vec3_16, mat4_3 } = CjsBallparkController.scratch;
        const qx = ballLoc.rot[0], qy = ballLoc.rot[1], qz = ballLoc.rot[2], qw = ballLoc.rot[3];
        // Float staging is branch-visible: double intermediates can turn native
        // heading.z == 0 into a nonzero cosine and select radius scaling.
        mat4_3[0] = f32(1 - f32(2 * f32(f32(qy * qy) + f32(qz * qz))));
        mat4_3[1] = f32(2 * f32(f32(qx * qy) + f32(qz * qw)));
        mat4_3[2] = f32(2 * f32(f32(qx * qz) - f32(qy * qw)));
        mat4_3[3] = 0;
        mat4_3[4] = f32(2 * f32(f32(qx * qy) - f32(qz * qw)));
        mat4_3[5] = f32(1 - f32(2 * f32(f32(qx * qx) + f32(qz * qz))));
        mat4_3[6] = f32(2 * f32(f32(qy * qz) + f32(qx * qw)));
        mat4_3[7] = 0;
        mat4_3[8] = f32(2 * f32(f32(qx * qz) + f32(qy * qw)));
        mat4_3[9] = f32(2 * f32(f32(qy * qz) - f32(qx * qw)));
        mat4_3[10] = f32(1 - f32(2 * f32(f32(qx * qx) + f32(qy * qy))));
        mat4_3[11] = mat4_3[12] = mat4_3[13] = mat4_3[14] = 0;
        mat4_3[15] = 1;
        vec3.set(vec3_15, 0, 0, 1);
        CjsDestinyBall._transformCoord(vec3_15, vec3_15, mat4_3);
        const dx = vec3_15[0], dy = vec3_15[1], dz = vec3_15[2];
        const cosine = -nx * dx - ny * dy - nz * dz;
        if (!(Math.abs(cosine) < 1 && Math.abs(cosine) > 0)) return vec3.set(out, -nx, -ny, -nz);
        const sine = Math.sqrt(1 - cosine * cosine);
        const sinAlpha = 0.6 * cosine * sine / Math.sqrt(
            (Math.pow(cosine, 2) + Math.pow(0.7 * sine, 2)) *
            (Math.pow(cosine, 2) + Math.pow(1.3 * sine, 2)));
        vec3.set(vec3_15, dy * nz - dz * ny, dz * nx - dx * nz, dx * ny - dy * nx);
        CjsDestinyBall._normalizeVector3(vec3_15, vec3_15);
        const angle = f32(Math.asin(f32(sinAlpha))), sinAngle = f32(Math.sin(angle)), cosAngle = f32(Math.cos(angle));
        const x = vec3_15[0], y = vec3_15[1], z = vec3_15[2], complement = f32(1 - cosAngle);
        // Native direct Rodrigues matrix; zero axes are not replaced by identity.
        mat4_3[0] = f32(f32(f32(complement * x) * x) + cosAngle);
        mat4_3[4] = f32(f32(f32(complement * x) * y) - f32(sinAngle * z));
        mat4_3[8] = f32(f32(f32(complement * x) * z) + f32(sinAngle * y));
        mat4_3[12] = 0;
        mat4_3[1] = f32(f32(f32(complement * y) * x) + f32(sinAngle * z));
        mat4_3[5] = f32(f32(f32(complement * y) * y) + cosAngle);
        mat4_3[9] = f32(f32(f32(complement * y) * z) - f32(sinAngle * x));
        mat4_3[13] = 0;
        mat4_3[2] = f32(f32(f32(complement * z) * x) - f32(sinAngle * y));
        mat4_3[6] = f32(f32(f32(complement * z) * y) + f32(sinAngle * x));
        mat4_3[10] = f32(f32(f32(complement * z) * z) + cosAngle);
        mat4_3[14] = 0;
        mat4_3[3] = mat4_3[7] = mat4_3[11] = 0;
        mat4_3[15] = 1;
        vec3.set(vec3_16, -nx, -ny, -nz);
        CjsDestinyBall._transformCoord(vec3_16, vec3_16, mat4_3);
        vec3.scale(vec3_16, vec3_16, ball.mRadius);
        const scale = 0.7 * Math.sqrt(1 / (sine * sine + 0.7 * cosine * cosine));
        const ox = vec3_16[0] * scale, oy = vec3_16[1] * scale, oz = vec3_16[2] * scale;
        return vec3.set(out, ox, oy, oz);
    }

    /**
     * Computes an elastic impulse against a static contact, once per candidate.
     * Adaptation: a balanced frame pool replaces native temporary value records;
     * impact storage belongs to the candidate and survives the call.
     * Negative impulses retain the native zero-valued impact and collider zero.
     * Source: destiny/src/Ballpark.cpp:2370-2440.
     * @param {CollisionBallProperties} ballProp Moving ball's collision history.
     * @param {CollisionItem} collision Static candidate, mutated to own its impact.
     * @returns {void} Existing impacts and non-static candidates are unchanged.
     */
    @meta.adapted
    CalculateCollisionImpactStatic(ballProp, collision)
    {
        if (collision.impact !== null || collision.mbIndex2 !== -2) return;
        collision.impact = new CollisionImpact();
        collision.impact.timeOfImpact = collision.timeOfImpact;
        const ball = ballProp.m_ball;
        if (ballProp.m_tStart === collision.timeOfImpact)
        {
            const anormal = vec3.dot(ball.mLastG, collision.normal);
            const acceleration = ball.mMaxVel * this.mFriction / (ball.mMass * ball.mAgility) - anormal;
            vec3.scale(ball.mLastC, collision.normal, acceleration);
        }
        const frame = CjsBallparkController._allocCollisionFrame();
        const { ballLoc, vec3d_0, vec3d_1, vec3d_2, vec3d_3 } = frame;
        try
        {
            ballProp.CalculatePosition(ballLoc.p, ballLoc.v, collision.timeOfImpact);
            if (g_useDynamicalOrientation) ballProp.CalculateRotation(ballLoc.rot, ballLoc.omega, collision.timeOfImpact);
            this.ApproximateEllipsePointOfImpact(ball, ballLoc, collision, vec3d_0);
            vec3.copy(vec3d_1, ballLoc.v);
            vec3.copy(vec3d_2, ballLoc.omega);
            if (g_useDynamicalOrientation)
            {
                vec3.cross(vec3d_2, vec3d_2, vec3d_0);
                vec3.add(vec3d_1, vec3d_1, vec3d_2);
            }
            // Native expression scales the vector before its double dot product.
            vec3.scale(vec3d_2, vec3d_1, -2);
            const vImpulse = vec3.dot(vec3d_2, collision.normal);
            if (vImpulse < 0) return;
            let impulse = vImpulse;
            if (g_useDynamicalOrientation)
            {
                vec3.cross(vec3d_3, vec3d_0, collision.normal);
                vec3.cross(vec3d_2, vec3d_3, vec3d_0);
                const inertiaOverMass = 0.5 * ball.mRadius * ball.mRadius;
                impulse = vImpulse / (1 + vec3.dot(vec3d_2, collision.normal) / inertiaOverMass);
                const scale = f32(impulse / inertiaOverMass);
                for (let i = 0; i < 3; ++i) collision.impact.angularVelocityChange[i] = f32(vec3d_3[i]) * scale;
            }
            vec3.scale(collision.impact.velocityChange, collision.normal, impulse);
            collision.impact.collider = collision.collider.mId;
        }
        finally { CjsBallparkController.collisionFrames.push(frame); }
    }

    /**
     * Computes paired elastic impulses for two free balls at a candidate time.
     * Adaptation: the returned candidate owns its data; temporary value records
     * use a balanced frame pool so sampling callbacks may reenter this method.
     * Native quirk: the returned candidate copies collision.collider, even though
     * its impact identifies the first ball; negative impulses keep collider zero.
     * Source: destiny/src/Ballpark.cpp:2442-2574.
     * @param {CollisionBallProperties} ballProp First ball history.
     * @param {CollisionBallProperties} otherProp Other ball history.
     * @param {CollisionItem} collision Candidate whose normal and impact are filled.
     * @returns {CollisionItem} Owned reciprocal candidate, or native default on invalid input.
     */
    @meta.adapted
    CalculateCollisionImpactFree(ballProp, otherProp, collision)
    {
        const otherCollision = new CollisionItem();
        if (collision.impact !== null || collision.mbIndex2 === -2) return otherCollision;
        otherCollision.timeOfImpact = collision.timeOfImpact;
        otherCollision.collider = collision.collider;
        otherCollision.mbIndex1 = collision.mbIndex2;
        otherCollision.mbIndex2 = collision.mbIndex1;
        otherCollision.impact = new CollisionImpact();
        otherCollision.impact.timeOfImpact = collision.timeOfImpact;
        collision.impact = new CollisionImpact();
        collision.impact.timeOfImpact = collision.timeOfImpact;
        const frame = CjsBallparkController._allocCollisionFrame();
        const { ballLoc, otherLoc, vec3d_0, vec3d_1, vec3d_2, vec3d_3, vec3d_4, vec3d_5, vec3d_6 } = frame;
        try
        {
            ballProp.CalculatePosition(ballLoc.p, ballLoc.v, collision.timeOfImpact);
            otherProp.CalculatePosition(otherLoc.p, otherLoc.v, collision.timeOfImpact);
            if (g_useDynamicalOrientation)
            {
                ballProp.CalculateRotation(ballLoc.rot, ballLoc.omega, collision.timeOfImpact);
                otherProp.CalculateRotation(otherLoc.rot, otherLoc.omega, collision.timeOfImpact);
            }
            vec3.subtract(collision.normal, ballLoc.p, otherLoc.p);
            const length = Math.sqrt(vec3.dot(collision.normal, collision.normal));
            if (length > 0) vec3.scale(collision.normal, collision.normal, 1 / length);
            else collision.normal[2] = 1;
            vec3.negate(otherCollision.normal, collision.normal);
            const ball = ballProp.m_ball, other = otherProp.m_ball;
            if (collision.timeOfImpact === 0)
            {
                let anormal = vec3.dot(ball.mLastG, collision.normal);
                let acceleration = ball.mMaxVel * this.mFriction / (ball.mMass * ball.mAgility) - anormal;
                vec3.scale(ball.mLastC, collision.normal, acceleration);
                anormal = vec3.dot(other.mLastG, otherCollision.normal);
                acceleration = other.mMaxVel * this.mFriction / (other.mMass * other.mAgility) - anormal;
                vec3.scale(other.mLastC, otherCollision.normal, acceleration);
            }
            this.ApproximateEllipsePointOfImpact(ball, ballLoc, collision, vec3d_0);
            this.ApproximateEllipsePointOfImpact(other, otherLoc, otherCollision, vec3d_1);
            vec3.copy(vec3d_3, ballLoc.omega);
            vec3.copy(vec3d_4, otherLoc.omega);
            vec3.subtract(vec3d_2, otherLoc.v, ballLoc.v);
            if (g_useDynamicalOrientation)
            {
                vec3.cross(vec3d_3, vec3d_3, vec3d_0);
                vec3.cross(vec3d_4, vec3d_4, vec3d_1);
                for (let i = 0; i < 3; ++i) vec3d_2[i] += vec3d_4[i] - vec3d_3[i];
            }
            const vImpulse = -2 * vec3.dot(vec3d_2, otherCollision.normal);
            if (vImpulse < 0) return otherCollision;
            vec3.copy(vec3d_5, vec3d_0);
            vec3.copy(vec3d_6, vec3d_1);
            if (g_useDynamicalOrientation)
            {
                vec3.cross(vec3d_5, vec3d_5, collision.normal);
                vec3.cross(vec3d_3, vec3d_5, vec3d_0);
                vec3.cross(vec3d_6, vec3d_6, otherCollision.normal);
                vec3.cross(vec3d_4, vec3d_6, vec3d_1);
            }
            const m1 = ball.mMass, m2 = other.mMass, r1 = ball.mRadius, r2 = other.mRadius;
            let impulse;
            if (g_useDynamicalOrientation)
            {
                for (let i = 0; i < 3; ++i)
                    vec3d_2[i] = 2 * (vec3d_3[i] * m2 * (1 / (r1 * r1)) - vec3d_4[i] * m1 * (1 / (r2 * r2)));
                impulse = m1 * m2 * vImpulse / (m1 + m2 + vec3.dot(vec3d_2, collision.normal));
            }
            else impulse = m1 * m2 * vImpulse / (m1 + m2);
            vec3.scale(collision.impact.velocityChange, collision.normal, impulse / m1);
            vec3.scale(otherCollision.impact.velocityChange, otherCollision.normal, impulse / m2);
            if (g_useDynamicalOrientation)
            {
                const scale1 = f32(impulse / (0.5 * m1 * r1 * r1));
                const scale2 = f32(impulse / (0.5 * m2 * r2 * r2));
                for (let i = 0; i < 3; ++i)
                {
                    collision.impact.angularVelocityChange[i] = f32(vec3d_5[i]) * scale1;
                    otherCollision.impact.angularVelocityChange[i] = f32(vec3d_6[i]) * scale2;
                }
            }
            collision.impact.collider = other.mId;
            otherCollision.impact.collider = ball.mId;
            return otherCollision;
        }
        finally { CjsBallparkController.collisionFrames.push(frame); }
    }

    /**
     * Limits an impulse, inserts it in history and recursively invalidates peers.
     * Adaptation: owned invalidation arrays replace native static storage; console
     * provides the native diagnostics. The unused native collIter is retained.
     * Native quirk: limits use squared ratios directly, without taking square roots.
     * Source: destiny/src/Ballpark.cpp:2577-2642.
     * @param {CollisionImpact} impact Caller-owned impulse, mutated by the limits.
     * @param {number|bigint} collIter Native iteration argument, currently unused.
     * @param {CjsDestinyBall} ball Ball whose existing history receives the impulse.
     * @returns {void} Missing history or late impacts return without changing the impulse.
     */
    @meta.adapted
    AddImpact(impact, collIter, ball)
    {
        const history = this.mCollisionLocations.get(ball.mId);
        if (!history)
        {
            console.error("Collision structure not found when adding impacts", ball.mId);
            return;
        }
        if (history.m_tEnd <= impact.timeOfImpact) return;
        const speed2 = vec3.dot(impact.velocityChange, impact.velocityChange);
        const fraction = f32(f32(25 * ball.mMaxVel) * ball.mMaxVel) / speed2;
        if (fraction < 1) vec3.scale(impact.velocityChange, impact.velocityChange, fraction);
        if (g_useDynamicalOrientation)
        {
            const omega2 = CjsDestinyBall._dotVector3(impact.angularVelocityChange, impact.angularVelocityChange);
            const fraction = f32(f32(f32(4 * ball.mMaxAngVel) * ball.mMaxAngVel) / omega2);
            if (fraction < 1) vec3.scale(impact.angularVelocityChange, impact.angularVelocityChange, fraction);
        }
        const invalidated = history.AddImpact(impact);
        for (const [time, collider] of invalidated)
        {
            const other = this.mFreeBalls.get(collider);
            if (other) this.RemoveImpactFromFree(time, ball.mId, other);
        }
        let current = 0;
        for (const location of history.m_locations)
        {
            const previous = current;
            current = location.time;
            if (current < previous) console.warn("Adding impacts out of order! This should not happen.");
        }
    }

    /**
     * Removes one free-ball impact and propagates its invalidations depth first.
     * Adaptation: local result ownership replaces value-returned native vectors;
     * repeated visits remain possible, and console provides missing-history errors.
     * Source: destiny/src/Ballpark.cpp:2647-2672.
     * @param {number} time Impact time in seconds.
     * @param {bigint|number} collider The other participant in the removed contact.
     * @param {CjsDestinyBall|null} ball Free ball to update, ignored when absent/fixed.
     * @returns {void} Rebuilds histories before recursively processing their peers.
     */
    @meta.adapted
    RemoveImpactFromFree(time, collider, ball)
    {
        if (!ball || !ball.isFree) return;
        const history = this.mCollisionLocations.get(ball.mId);
        if (!history)
        {
            console.error("Collision structure not found when removing impacts", ball.mId);
            return;
        }
        const invalidated = history.RemoveImpact(time, collider);
        for (const [otherTime, otherID] of invalidated)
        {
            const other = this.mFreeBalls.get(otherID);
            if (other) this.RemoveImpactFromFree(otherTime, ball.mId, other);
        }
    }

    /**
     * Samples angular drag or the native recorded collision rotation path.
     * Adaptation: caller-owned math outputs replace reference parameters; console
     * reports null balls. Records dispatch directly to CalculateRotation; as in
     * Carbon, a later settings change does not bypass retained histories.
     * Source: destiny/src/Ballpark.cpp:2685-2712.
     * @param {CjsDestinyBall|null} ball Source physical parameters.
     * @param {number} timeStepFraction Fraction of the simulation tick.
     * @param {Float32Array} rotation In/out orientation.
     * @param {Float32Array} omega In/out angular velocity.
     * @returns {void} Mutates outputs unless ball is null or fraction is zero.
     */
    @meta.adapted
    CalculateBallRotationVelocity(ball, timeStepFraction, rotation, omega)
    {
        if (!ball)
        {
            console.error("Null pointer for ball in CalculateBallRotationVelocity");
            return;
        }
        if (timeStepFraction === 0) return;
        const tau = f32(f32(f32(f32(ball.mMass) * ball.mAgility) * ball.mRotAgility) / f32(this.mFriction));
        const collision = this.mCollisionLocations.get(ball.mId);
        if (collision) collision.CalculateRotation(rotation, omega, timeStepFraction);
        else this.ApplyTorque(rotation, omega, ball.mTorque, ball.mRoll, tau, f32(timeStepFraction));
    }

    /**
     * Samples native fractional drag or a recorded collision trajectory.
     * Adaptation: float64 scratch holds the acceleration sum; console reports null.
     * Native quirk: retained collision records are consulted even when iterative
     * collisions have subsequently been disabled.
     * Source: destiny/src/Ballpark.cpp:2715-2741.
     * @param {CjsDestinyBall|null} ball Ball whose physical parameters are sampled.
     * @param {number} timeStepFraction Elapsed seconds from the old motion state.
     * @param {Float64Array} position In/out absolute position.
     * @param {Float64Array} velocity In/out velocity.
     * @returns {void} Mutates the supplied motion state.
     */
    @meta.adapted
    CalculateBallPositionVelocity(ball, timeStepFraction, position, velocity)
    {
        if (!ball)
        {
            console.error("Null ball in CalculateBallPositionVelocity");
            return;
        }
        if (timeStepFraction === 0) return;
        const collision = this.mCollisionLocations.get(ball.mId);
        if (collision) collision.CalculatePosition(position, velocity, timeStepFraction);
        else
        {
            const { vec3d_0 } = CjsBallparkController.scratch;
            vec3.add(vec3d_0, ball.mLastG, ball.mLastC);
            this.Integrate(position, velocity, vec3d_0, ball.mMass * ball.mAgility,
                this.mFriction, ball.mTimeFactor, timeStepFraction);
        }
    }

    /**
     * Creates a fresh fixed MiniBall with owner and mode set before insertion.
     * Adaptation: JS allocation/GC replace native Blue construction and Unlock;
     * checked BigInt IDs replace signed-int64 arguments. This deliberately does
     * not reuse AddBall, whose agility repair and duplicate handling differ.
     * Source: destiny/src/Ballpark.cpp:3559-3636.
     * @param {bigint|number} parentObjectId Owner identity used for spatial ordering.
     * @param {number} mass Parent mass; negative values clamp to zero.
     * @param {number} radius Native float radius; negative values clamp to zero.
     * @param {number} x Absolute center X.
     * @param {number} y Absolute center Y.
     * @param {number} z Absolute center Z.
     * @returns {CjsDestinyBall} New fixed Ball or ClientBall, even for a duplicate generated ID.
     */
    @meta.adapted
    AddMiniball(parentObjectId, mass, radius, x, y, z)
    {
        parentObjectId = CjsDestinyBall._toInt64(parentObjectId);
        const id = this.GetIDForCollisionObject(-1n);
        if (this._balls.has(id)) console.error("Ballpark.AddMiniball: Ball already exists for new ID", id);
        const ball = this.isMaster ? new CjsDestinyBall() : new CjsDestinyClientBall();
        ball.mId = id;
        ball.mPark = this;
        vec3.set(ball.mNewPos, x, y, z);
        vec3.copy(ball.mOldPos, ball.mNewPos);
        radius = f32(radius);
        ball.mRadius = radius < 0 ? 0 : radius;
        ball.mMass = mass < 0 ? 0 : mass;
        ball.mOwnerId = parentObjectId;
        vec3.zero(ball.mNewVel); vec3.zero(ball.mOldVel);
        ball.mMaxVel = ball.mAgility = ball.mSpeedFraction = 0;
        ball.isFree = ball.isGlobal = ball.isInteractive = ball.isSpaceJunk = false;
        ball.isMassive = true;
        quat.identity(ball.mNewRot); quat.identity(ball.mOldRot);
        vec3.zero(ball.mNewAngVel); vec3.zero(ball.mOldAngVel);
        this.SetBallTimeFactor(ball);
        ball.SetMode(Mode.DSTBALL_MINIBALL);
        this.InsertBallInBoxes(ball);
        return ball;
    }

    /**
     * Creates or reuses a native capsule ID and inserts it into the partition.
     * Adaptation: JS Map/GC replace unordered ownership and Blue allocation.
     * Existing IDs deliberately ignore new geometry and retain moribund state.
     * Source: destiny/src/Ballpark.cpp:3639-3674.
     *
     * @param {bigint|number} objectId Requested ID or native local-allocation sentinel.
     * @param {bigint|number} parentObjectId Parent ball identity.
     * @param {number} ax Endpoint A X.
     * @param {number} ay Endpoint A Y.
     * @param {number} az Endpoint A Z.
     * @param {number} bx Endpoint B X.
     * @param {number} by Endpoint B Y.
     * @param {number} bz Endpoint B Z.
     * @param {number} radius Native float radius.
     * @returns {CjsDestinyCapsule} Existing or new capsule.
     */
    @meta.adapted
    AddCapsule(objectId, parentObjectId, ax, ay, az, bx, by, bz, radius)
    {
        const id = this.GetIDForCollisionObject(objectId);
        let capsule;
        if (this.mCapsules.has(id)) capsule = this.mCapsules.get(id);
        else
        {
            capsule = new CjsDestinyCapsule();
            capsule.Initialize(id, parentObjectId, ax, ay, az, bx, by, bz, radius);
            this.mCapsules.set(id, capsule);
        }
        // A native null map entry also fails here; JS throws instead of dereferencing null.
        capsule.mPark = this;
        this.InsertStaticCollidableInBoxes(capsule);
        return capsule;
    }

    /**
     * Creates or reuses a native oriented-box ID, preserving existing geometry.
     * Adaptation: JS Map/GC replace unordered ownership and Blue allocation.
     * Source: destiny/src/Ballpark.cpp:3676-3713.
     *
     * @param {bigint|number} objectId Requested ID or local-allocation sentinel.
     * @param {bigint|number} parentObjectId Parent ball identity.
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
     * @returns {CjsDestinyOrientedBox} Existing or new box.
     */
    @meta.adapted
    AddOrientedBox(objectId, parentObjectId, c0, c1, c2, x0, x1, x2, y0, y1, y2, z0, z1, z2)
    {
        const id = this.GetIDForCollisionObject(objectId);
        let box;
        if (this.mOrientedBoxes.has(id)) box = this.mOrientedBoxes.get(id);
        else
        {
            box = new CjsDestinyOrientedBox();
            box.Initialize(id, parentObjectId, c0, c1, c2, x0, x1, x2, y0, y1, y2, z0, z1, z2);
            this.mOrientedBoxes.set(id, box);
        }
        box.mPark = this;
        this.InsertStaticCollidableInBoxes(box);
        return box;
    }

    /**
     * Inserts membership before registering the aggregate static-shape map.
     * Adaptation: Map replaces the unordered native map; evolution skips registration.
     * Source: destiny/src/Ballpark.cpp:3224-3231.
     *
     * @param {CjsDestinyStaticCollidable} collidable Shape owned by this park.
     * @returns {void} Callbacks can see the typed map before the aggregate map.
     */
    @meta.adapted
    InsertStaticCollidableInBoxes(collidable)
    {
        this.InsertInBoxes(collidable);
        if (!this.inEvolve) this.mStaticCollidables.set(collidable.mId, collidable);
    }

    /**
     * Returns the native static base-cell width and center tuple.
     * Adaptation: arrays/null replace Python tuples/None.
     * Source: destiny/src/Thunkers.cpp:2302-2344.
     *
     * @param {bigint|number} id Native static-shape ID.
     * @returns {Array|null} [width, center], or null when missing or detached.
     */
    @meta.blue.method
    @meta.adapted
    GetStaticCollidableBox(id)
    {
        const shape = this.mStaticCollidables.get(CjsDestinyBall._toInt64(id));
        if (!shape || !shape.mMyBox) return null;
        const box = shape.mMyBox;
        return [box.hi[0] - box.lo[0], box.lo.map((value, q) => value + (box.hi[q] - value) * 0.5)];
    }

    /**
     * Marks a capsule for delayed removal or performs native final cleanup now.
     * Adaptation: Set ordering replaces an unordered pointer set; the injected
     * PyOS bridge supplies events and console supplies missing-ID diagnostics.
     * Native operator[] inserts a null entry on a missing ID; this is retained.
     * Source: destiny/src/Ballpark.cpp:5594-5642.
     *
     * @param {bigint|number} id Capsule ID.
     * @param {number} [delay=0] Tick delay.
     * @returns {void} The aggregate map retains the native stale-entry quirk.
     */
    @meta.adapted
    RemoveCapsule(id, delay = 0)
    {
        id = CjsDestinyBall._toInt64(id);
        if (!this.mCapsules.has(id)) this.mCapsules.set(id, null);
        const capsule = this.mCapsules.get(id);
        if (!capsule) { console.error("RemoveCapsule: missing capsule", id); return; }
        capsule.isMoribund = true;
        if (this.inEvolve || delay > 0)
        {
            capsule.mEffectStamp = this.currentTime + delay;
            this.moribundCapsules.add(capsule);
            return;
        }
        if (this._pyOS && !this._pyOS.SendEvent(capsule, "Destiny::Capsule::DoFinalCleanup",
            "DoFinalCleanup", null, "()")) this._pyOS.PyError();
        this.moribundCapsules.delete(capsule);
        capsule.DeleteFromBoxes();
        capsule.mPark = null;
        capsule.mOldBubble = capsule.mNewBubble;
        capsule.mNewBubble = -1;
        this.AddToBubble(capsule);
        // Native quirk: mStaticCollidables is not erased here.
        this.mCapsules.delete(id);
    }

    /**
     * Marks an oriented box for delayed removal or performs native final cleanup.
     * Adaptation: Map/Set replace native unordered containers and PyOS is injected.
     * Missing IDs retain operator[] null insertion; JS throws if later reused by Add.
     * Source: destiny/src/Ballpark.cpp:5644-5694.
     *
     * @param {bigint|number} id Box ID.
     * @param {number} [delay=0] Tick delay.
     * @returns {void} Native aggregate-entry and undrained delayed-queue quirks remain.
     */
    @meta.adapted
    RemoveOrientedBox(id, delay = 0)
    {
        id = CjsDestinyBall._toInt64(id);
        if (!this.mOrientedBoxes.has(id)) this.mOrientedBoxes.set(id, null);
        const box = this.mOrientedBoxes.get(id);
        if (!box) { console.error("RemoveOrientedBox: missing box", id); return; }
        box.isMoribund = true;
        if (this.inEvolve || delay > 0)
        {
            box.mEffectStamp = this.currentTime + delay;
            this.moribundOrientedBoxes.add(box);
            return;
        }
        if (this._pyOS && !this._pyOS.SendEvent(box, "Destiny::OrientedBox::DoFinalCleanup",
            "DoFinalCleanup", null, "()")) this._pyOS.PyError();
        this.moribundOrientedBoxes.delete(box);
        box.DeleteFromBoxes();
        box.mPark = null;
        box.mOldBubble = box.mNewBubble;
        box.mNewBubble = -1;
        this.AddToBubble(box);
        this.mOrientedBoxes.delete(id);
    }

    /**
     * Detaches followers; interactive orbiters and missiles retain their velocity direction.
     * Adaptation: JS IDs and object references replace native map/pointer arguments.
     * Snapshot iteration replaces native unordered-set traversal; invalid links
     * are diagnosed and removed. Detached missiles become non-massive GOTO balls.
     * Source: destiny/src/Ballpark.cpp:5416-5472.
     *
     * @param {CjsDestinyBall|null} ball Target whose incoming follower links are detached.
     * @returns {void} No return value.
     */
    @meta.adapted
    StopAllFollowers(ball)
    {
        if (!ball) return;
        for (const id of Array.from(ball._followers))
        {
            const follower = this.GetBall(id);
            if (!follower || follower.followId !== ball.id || follower._followPtr !== ball)
            {
                console.error("StopAllFollowers: invalid follower link", ball.id, id);
                ball._followers.delete(id);
                continue;
            }
            if (follower.mode === Mode.DSTBALL_MISSILE
                || (follower.isInteractive && follower.mode === Mode.DSTBALL_ORBIT))
            {
                if (follower.mode === Mode.DSTBALL_MISSILE) follower.isMassive = false;
                this.GotoDirection(follower, follower.mNewVel);
            }
            else this.Stop(follower);
        }
    }

    /**
     * Detaches follower orders, then removes the ball now or queues native delayed cleanup.
     * Adaptation: JS retains object references and uses an optional PyOS bridge for
     * DoFinalCleanup. Cell membership is removed during final cleanup;
     * fixed-parent mini colliders are removed before delay handling. Collision caches are erased only
     * while iterative collisions are enabled, preserving the native settings quirk.
     *
     * @param {bigint|number} id Signed-int64 ball identity; Number inputs must be safe integers.
     * @param {number} [delay=0] Tick delay before buffered cleanup.
     * @returns {void} No return value.
     */
    @meta.blue.method
    @meta.adapted
    RemoveBall(id, delay = 0)
    {
        const ball = this.GetBall(id);
        if (!ball) return;
        this.Stop(ball);
        this.StopAllFollowers(ball);
        ball.isMoribund = true;
        // Source: destiny/src/Ballpark.cpp:5496-5528. Fixed-parent children ignore its delay.
        let size = ball.mMiniBalls.GetSize();
        if (size > 0 && !ball.isFree)
        {
            for (let i = size - 1; i >= 0; --i) this.RemoveBall(ball.mMiniBalls.GetAt(i).mId);
            ball.mMiniBalls.Remove(-1);
        }
        size = ball.mMiniCapsules.GetSize();
        if (size > 0 && !ball.isFree)
        {
            for (let i = size - 1; i >= 0; --i) this.RemoveCapsule(ball.mMiniCapsules.GetAt(i).mId);
            ball.mMiniCapsules.Remove(-1);
        }
        size = ball.mMiniBoxes.GetSize();
        if (size > 0 && !ball.isFree)
        {
            for (let i = size - 1; i >= 0; --i) this.RemoveOrientedBox(ball.mMiniBoxes.GetAt(i).mId);
            ball.mMiniBoxes.Remove(-1);
        }
        if (this.inEvolve || delay > 0)
        {
            ball.isMassive = false;
            ball.mEffectStamp = this.currentTime + delay;
            this.moribundBalls.add(ball);
            return;
        }
        if (this._pyOS && !this._pyOS.SendEvent(ball, "Destiny::Ball::DoFinalCleanup",
            "DoFinalCleanup", null, "()")) this._pyOS.PyError();
        this.moribundBalls.delete(ball);
        // Source: destiny/src/Ballpark.cpp:5556-5562. Native quirk: conditional cleanup.
        if (g_useIterativeCollision)
        {
            this.mCollisionLocations.delete(ball.mId);
            this.mPotentialCollisionBalls.delete(ball.mId);
            this.mPotentialCollidables.delete(ball.mId);
        }
        ball.DeleteFromBoxes();
        ball.mPark = null;
        ball.mOldBubble = ball.mNewBubble;
        ball.mNewBubble = -1;
        this.AddToBubble(ball);
        if (ball.isFree) this._removeFreeBall(ball.mId);
        if (ball.mHasProximity) this.mProximityBalls.delete(ball.mId);
        if (ball.isGlobal) this.mGlobals.delete(ball.mId);
        this._balls.delete(ball.id);
        if (this.mEgo === ball.id)
        {
            this.mLastEgo = 0n;
            this.mLastEgoBall = null;
        }
    }

    /**
     * Clears owned balls without mode/final-cleanup events or changing the clocks.
     * Adaptation: clears the ball deletion queue because native owner/refcount
     * teardown has no JS equivalent. Retained handles keep mode/follower state. Shape
     * queues and aggregate-only shape detachment retain native ClearAll behavior.
     *
     * @returns {void} No return value.
     */
    @meta.blue.method
    @meta.adapted
    ClearAll()
    {
        // Source: destiny/src/Ballpark.cpp:5894-5953. ClearAll never calls Stop.
        for (const ball of this._balls.values())
        {
            ball.DeleteFromBoxes();
            ball.mPark = null;
        }
        this._balls.clear();
        this.mGlobals.clear();
        // Source: destiny/src/Ballpark.cpp:5912-5917. Disabled settings retain caches.
        if (g_useIterativeCollision)
        {
            this.mCollisionLocations.clear();
            this.mPotentialCollisionBalls.clear();
            this.mPotentialCollidables.clear();
        }
        for (const shape of this.mStaticCollidables.values())
        {
            shape.DeleteFromBoxes();
            shape.mPark = null;
        }
        this.mStaticCollidables.clear();
        this.mCapsules.clear();
        this.mOrientedBoxes.clear();
        // Native ClearAll retains both shape queues and only detaches aggregate entries.
        this.mFreeBalls.clear();
        this.mProximityBalls.clear();
        this._freeBallIds.length = 0;
        this.ClearBubbles();
        this.moribundBalls.clear();
        this.mLocalCnt = -1n;
        this.mLocalHiCnt = -1073741824n;
        this.mLastEgo = 0n;
        this.mLastEgoBall = null;
    }


    /**
     * Runs deferred cleanup before tick eligibility, unless evolution is active.
     * Native quirk: no oriented-box queue processor exists in the donor.
     *
     * @returns {void} No return value.
     */
    @meta.adapted
    BringOutTheDeads()
    {
        if (this.inEvolve) return;
        this.BringOutDeadBalls();
        this.BringOutDeadCapsules();
    }

    /**
     * Removes expired balls without a cap and buffered balls up to the configured limit (default seven).
     * Adaptation: a JS Set replaces the native unordered pointer set; selection
     * among equally eligible buffered balls follows insertion order. Invalid queue
     * records are discarded without native logging.
     *
     * @returns {void} No return value.
     */
    @meta.adapted
    BringOutDeadBalls()
    {
        let killCounter = 0;
        const toDelete = [];
        for (const ball of this.moribundBalls)
        {
            if (!ball || !ball.isMoribund || ball.mEffectStamp - this.currentTime < 0)
            {
                toDelete.push(ball);
            }
            else if (ball.mEffectStamp - this.currentTime - this.mMoribundBallRemovalBuffer < 0
                && killCounter < this.mMoribundBallRemovalCount)
            {
                toDelete.push(ball);
                killCounter++;
            }
        }
        for (const ball of toDelete)
        {
            if (ball && ball.isMoribund) this.RemoveBall(ball.id);
            this.moribundBalls.delete(ball);
        }
    }

    /**
     * Drains expired capsules and a separately capped buffered set.
     * Adaptation: JS Set insertion order replaces native unordered pointer order;
     * console replaces CCP logging. Unlike balls, an unflagged capsule remains
     * eligible for expiry and removal; null entries are simply discarded.
     * Source: destiny/src/Ballpark.cpp:5767-5817.
     *
     * @returns {void} Removes selected capsules after candidate collection finishes.
     */
    @meta.adapted
    BringOutDeadCapsules()
    {
        let killCounter = 0;
        const toDelete = [];
        for (const capsule of this.moribundCapsules)
        {
            if (!capsule) { console.error("BringOutDeadCapsules: null entry"); toDelete.push(capsule); continue; }
            if (!capsule.isMoribund) console.error("BringOutDeadCapsules: capsule not flagged", capsule.mId);
            if (capsule.mEffectStamp - this.currentTime < 0) toDelete.push(capsule);
            else if (capsule.mEffectStamp - this.currentTime - this.mMoribundBallRemovalBuffer < 0
                && killCounter < this.mMoribundBallRemovalCount)
            {
                toDelete.push(capsule);
                ++killCounter;
            }
        }
        for (const capsule of toDelete)
        {
            if (capsule) this.RemoveCapsule(capsule.mId);
            this.moribundCapsules.delete(capsule);
        }
    }

    /**
     * Advances one cached simulation step and increments currentTime, not time.
     * Forces are evaluated before positions. Adaptation: the default timestamp of
     * zero follows the Python Evolve wrapper. Proximity follows troll petrification.
     * Invalid mobile mass and unsupported modes fail
     * before changing the tick, rather than silently simulating another behavior.
     * JS exceptions release inEvolve with finally so callbacks cannot strand cleanup.
     * Timestamp conversion and signed-int64 initialization overflow are checked before movement.
     * Mushroom signed-int32 elapsed overflow throws at the native arithmetic site;
     * its float growth skips sample commit. Trolls petrify after every ball commits.
     * Iterative collision trajectories are solved between behavior and integration.
     *
     * @param {bigint|number} [timestamp=0n] New ball timestamp in 100ns units; zero preserves ball timestamps.
     * @throws {RangeError} If a mobile mass/agility is invalid.
     * @throws {Error} If an active ball uses an unknown mode value.
     * @returns {void} No return value.
     */
    @meta.blue.method
    @meta.adapted
    Evolve(timestamp = 0n)
    {
        timestamp = CjsDestinyBall._toInt64(timestamp);
        for (const ball of this._iterateFreeBalls())
        {
            if (ball.isMoribund || this.InDeadBubble(ball)) continue;
            if (timestamp !== 0n && ball.mNewTime === 0n)
            {
                CjsDestinyBall._toInt64(timestamp - CjsBallparkController._tickTime(this.tickInterval));
            }
            if (!(ball.mass > 0) || !(ball.agility > 0)
                || !Number.isFinite(ball.mass * ball.agility))
            {
                throw new RangeError(`Mobile ball ${ball.id} requires positive finite mass and agility`);
            }
            if (ball.mode !== Mode.DSTBALL_STOP && ball.mode !== Mode.DSTBALL_GOTO
                && ball.mode !== Mode.DSTBALL_FOLLOW && ball.mode !== Mode.DSTBALL_ORBIT
                && ball.mode !== Mode.DSTBALL_FORMATION && ball.mode !== Mode.DSTBALL_WARP
                && ball.mode !== Mode.DSTBALL_MISSILE && ball.mode !== Mode.DSTBALL_MUSHROOM
                && ball.mode !== Mode.DSTBALL_TROLL && ball.mode !== Mode.DSTBALL_RIGID
                && ball.mode !== Mode.DSTBALL_FIELD && ball.mode !== Mode.DSTBALL_BOID
                && ball.mode !== Mode.DSTBALL_MINIBALL)
            {
                throw new Error(`Destiny mode ${ball.mode} is not implemented`);
            }
        }
        this.inEvolve = true;
        try
        {
            for (const ball of this._iterateFreeBalls())
            {
                if (ball.isMoribund) continue;
                if (this.InDeadBubble(ball))
                {
                    ball.mInDeadBubble = true;
                    continue;
                }
                this.EvolveBehaviorForBall(ball);
            }
            if (g_useIterativeCollision) this.CalculateIterativeCollisionResponses();
            for (const ball of this._iterateFreeBalls())
            {
                if (ball.isMoribund || ball.mInDeadBubble) continue;
                if (!g_useIterativeCollision && ball.isMassive)
                {
                    ball.mLastCollision = -1;
                    this.Gradient(ball);
                }
                // Native stack vectors survive warp callbacks without exposing staged results.
                // Source: destiny/src/Ballpark.cpp:474-520.
                const p = vec3d.alloc(), v = vec3d.alloc();
                try
                {
                    vec3.copy(p, ball.mNewPos);
                    vec3.copy(v, ball.mNewVel);
                    if (ball.IsWarping())
                    {
                        this.WarpDistance(ball, p, v, (this.currentTime - ball.mEffectStamp) * this.dt, false);
                        if (ball.mMode === Mode.DSTBALL_STOP)
                        {
                            vec3.copy(ball.mNewPos, p);
                            vec3.copy(ball.mNewVel, v);
                            const acceleration = vec3d.alloc();
                            try
                            {
                                vec3.add(acceleration, ball.mLastG, ball.mLastC);
                                this.Integrate(p, v, acceleration, ball.mMass * ball.mAgility,
                                    this.mFriction, ball.mTimeFactor, this.dt);
                            }
                            finally { vec3d.unalloc(acceleration); }
                            if (vec3.squaredLength(ball.mNewVel) < 0.1) this.InsertBallInBoxes(ball);
                        }
                    }
                    else
                    {
                        this.CalculateBallPositionVelocity(ball, this.dt, p, v);
                    }
                    if (g_useDynamicalOrientation && !DynamicalOrientationDisabledForBall(ball))
                    {
                        quat.copy(ball.mOldRot, ball.mNewRot);
                        vec3.copy(ball.mOldAngVel, ball.mNewAngVel);
                        if (g_useIterativeCollision) this.CalculateBallRotationVelocity(ball, 1, ball.mOldRot, ball.mOldAngVel);
                        else
                        {
                            const tau = f32(f32(f32(f32(ball.mMass) * ball.mAgility) * ball.mRotAgility) / f32(this.mFriction));
                            this.ApplyTorque(ball.mOldRot, ball.mOldAngVel, ball.mTorque, ball.mRoll, tau, 1);
                        }
                    }
                    vec3.copy(ball.mOldPos, p);
                    vec3.copy(ball.mOldVel, v);
                }
                finally
                {
                    vec3d.unalloc(v);
                    vec3d.unalloc(p);
                }
            }
            // Carbon completes integration for every ball before updating timestamps.
            // Owned per-call list survives callbacks that evolve another park.
            const trolls = [];
            for (const ball of this._iterateFreeBalls())
            {
                if (ball.isMoribund) continue;
                if (ball.mInDeadBubble)
                {
                    ball.mInDeadBubble = false;
                    continue;
                }
                if (this.TrollReady(ball)) trolls.push(ball);
                if (timestamp !== 0n)
                {
                    ball.mOldTime = ball.mNewTime === 0n
                        ? timestamp - CjsBallparkController._tickTime(this.tickInterval) : ball.mNewTime;
                    ball.mNewTime = timestamp;
                }
                // Source: destiny/src/Ballpark.cpp:561-578. Native quirk: growth
                // commits no motion/orientation samples and never reaches full radius.
                if (ball.mMode === Mode.DSTBALL_MUSHROOM)
                {
                    const elapsed = (this.currentTime - ball.mEffectStamp) * this.tickInterval;
                    if (!Number.isInteger(elapsed) || elapsed < -2147483648 || elapsed > 2147483647)
                        throw new RangeError("Mushroom elapsed milliseconds exceed native signed-int32 arithmetic");
                    const fraction = f32(f32(f32(elapsed) * f32(0.001)) / f32(ball.mGoto[0]));
                    if (fraction < 1)
                    {
                        ball.mRadius = f32(ball.mFollowRange * f32(Math.pow(fraction, 0.25)));
                        this.InsertBallInBoxes(ball);
                    }
                    else this.RemoveBall(ball.mId);
                    continue;
                }
                for (let q = 0; q < 3; ++q)
                {
                    const position = ball.mNewPos[q], velocity = ball.mNewVel[q];
                    ball.mNewPos[q] = ball.mOldPos[q];
                    ball.mOldPos[q] = position;
                    ball.mNewVel[q] = ball.mOldVel[q];
                    ball.mOldVel[q] = velocity;
                }
                if (g_useDynamicalOrientation)
                {
                    const q = ball.mOldRot, w = ball.mOldAngVel;
                    const rotationLength2 = f32(f32(f32(f32(q[0] * q[0]) + f32(q[1] * q[1])) + f32(q[2] * q[2])) + f32(q[3] * q[3]));
                    const angularLength2 = f32(f32(f32(w[0] * w[0]) + f32(w[1] * w[1])) + f32(w[2] * w[2]));
                    if (Number.isFinite(rotationLength2))
                    {
                        for (let i = 0; i < 4; ++i)
                        {
                            const value = ball.mNewRot[i];
                            ball.mNewRot[i] = ball.mOldRot[i];
                            ball.mOldRot[i] = value;
                        }
                    }
                    if (Number.isFinite(angularLength2))
                    {
                        for (let i = 0; i < 3; ++i)
                        {
                            const value = ball.mNewAngVel[i];
                            ball.mNewAngVel[i] = ball.mOldAngVel[i];
                            ball.mOldAngVel[i] = value;
                        }
                    }
                    if (DynamicalOrientationDisabledForBall(ball)) ball.SnapOrientation();
                }
                else ball.CalculateYawPitchRoll();
                const dx = ball.x - ball._oldX, dy = ball.y - ball._oldY, dz = ball.z - ball._oldZ;
                if (dx * dx + dy * dy + dz * dz < 0.1) continue;
                this.InsertBallInBoxes(ball);
                // Source: destiny/src/Ballpark.cpp:601-638. Native dispatch follows
                // reinsertion and is also skipped when movement is below threshold.
                if (ball.mMode === Mode.DSTBALL_MISSILE)
                {
                    if (g_useIterativeCollision)
                    {
                        const history = this.mCollisionLocations.get(ball.mId);
                        if (history)
                            for (const location of history.m_locations)
                                if (location.collider !== -1n) ball.mCollisions.push(location.collider);
                    }
                    if (this.isMaster)
                    {
                        const owner = this.GetBall(ball.mOwnerId < 0n ? -ball.mOwnerId : ball.mOwnerId);
                        if (!owner || (owner.mNewBubble !== ball.mNewBubble && ball.mNewBubble !== -1) || owner.isCloaked)
                            ball.mCollisions.push(ball.mId);
                    }
                    ball.DispatchCollisions();
                }
            }
            // Source: destiny/src/Ballpark.cpp:641-648. Recheck readiness after
            // all commits because callbacks can change a queued troll's mode/deadline.
            for (const ball of trolls) this.PetrifyTroll(ball);
            this.HandleProximities();
            this.currentTime++;
        }
        finally
        {
            // JS callbacks can throw; never leave the deletion semaphore stuck.
            this.inEvolve = false;
        }
    }

    /**
     * Adaptation: supported modes write mLastG components in place.
     * Native heading/roll previews reshape thrust without committing physical
     * orientation; the tick's separate integration pass stages angular results.
     * Proper warp steers toward its destination without ordinary thrust.
     * Source: destiny/src/Ballpark.cpp:789-900.
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
        ball.mLastC.fill(0);
        ball.mCollisions.length = 0;
        switch (ball.mode)
        {
            case Mode.DSTBALL_WARP:
                this.EvolveWarp(ball);
                break;

            case Mode.DSTBALL_MISSILE:
                this.EvolveMissile(ball);
                break;

            case Mode.DSTBALL_GOTO:
                this.EvolveGoto(ball);
                break;
            case Mode.DSTBALL_FOLLOW:
                this.EvolveFollow(ball);
                break;
            case Mode.DSTBALL_FORMATION:
                this.EvolveFormation(ball);
                break;
            case Mode.DSTBALL_ORBIT:
                this.EvolveOrbit(ball, this.currentTime);
                break;
            case Mode.DSTBALL_STOP:
                this.EvolveStop(ball);
                break;
            // Native switch default supplies zero steering for these state modes.
            // Source: destiny/src/Ballpark.cpp:791-839.
            case Mode.DSTBALL_MUSHROOM:
            case Mode.DSTBALL_TROLL:
            case Mode.DSTBALL_RIGID:
            case Mode.DSTBALL_FIELD:
            case Mode.DSTBALL_BOID:
            case Mode.DSTBALL_MINIBALL:
                break;
            default:
                throw new Error(`Destiny mode ${ball.mode} is not implemented`);
        }
        if (g_useDynamicalOrientation && !DynamicalOrientationDisabledForBall(ball))
        {
            const accel = f32(vec3.length(ball.mLastG));
            const maxAccel = f32(f32(f32(f32(this.mFriction) * ball.mSpeedFraction) * ball.mMaxVel) / f32(f32(ball.mMass) * ball.mAgility));
            if (accel > 1e-2 * maxAccel)
            {
                // These slots are separate from the steering and integrator slots.
                const { vec3_13, vec3_14, quat_4, mat4_2 } = CjsBallparkController.scratch;
                vec3.copy(vec3_13, ball.mLastG);
                this.GotoTorqueBreaks(ball.mTorque, ball, vec3_13);
                ball.mRoll = this.GotoRollBreaks(ball, ball.mTorque);
                quat.copy(quat_4, ball.mNewRot);
                vec3.copy(vec3_14, ball.mNewAngVel);
                const tau = f32(f32(f32(f32(ball.mMass) * ball.mAgility) * ball.mRotAgility) / f32(this.mFriction));
                this.ApplyTorque(quat_4, vec3_14, ball.mTorque, ball.mRoll, tau, 1);
                mat4.fromQuat(mat4_2, quat_4);
                vec3.set(vec3_14, 0, 0, 1);
                CjsDestinyBall._transformCoord(vec3_14, vec3_14, mat4_2);
                const cosine = f32(CjsDestinyBall._dotVector3(vec3_14, vec3_13) / accel);
                const cosangle = cosine < 1 ? cosine : 1;
                if (cosangle <= 0) vec3.zero(ball.mLastG);
                else
                {
                    const magnitude = f32(f32(cosangle * cosangle) * accel);
                    // Native multiplication yields Vector3 before promotion to Vector3d.
                    ball.mLastG[0] = f32(vec3_14[0] * magnitude);
                    ball.mLastG[1] = f32(vec3_14[1] * magnitude);
                    ball.mLastG[2] = f32(vec3_14[2] * magnitude);
                }
            }
            else
            {
                if (ball.IsWarping())
                {
                    const { vec3_13 } = CjsBallparkController.scratch;
                    vec3.subtract(vec3_13, ball.mGoto, ball.mNewPos);
                    this.GotoTorqueBreaks(ball.mTorque, ball, vec3_13);
                }
                else vec3.zero(ball.mTorque);
                ball.mRoll = this.GotoRollBreaks(ball, ball.mTorque);
            }
        }
        else this.CapAcceleration(ball, ball.mLastG);
    }

    /**
     * Retains the donor's immediate-return acceleration cap.
     * Source: destiny/src/Ballpark.cpp:1350-1353.
     * @param {CjsDestinyBall} ball Unused physical ball.
     * @param {Float64Array|number[]} acceleration Unchanged acceleration.
     * @returns {void} Native intentional no-op.
     */
    @meta.noop
    CapAcceleration(ball, acceleration)
    {
        return;
    }

    /**
     * Aligns with ordinary goto thrust, or announces entry before starting warp.
     * Adaptation: mLastG replaces the native Vector3d return and is written after
     * activation callbacks; an optional injected PyOS supplies event delivery.
     * Source: destiny/src/Ballpark.cpp:915-946.
     * @param {CjsDestinyBall} ball Ball in warp mode.
     * @returns {void} Proper warp has zero ordinary acceleration.
     */
    @meta.adapted
    EvolveWarp(ball)
    {
        if (ball.IsWarping())
        {
            vec3.zero(ball.mLastG);
            return;
        }
        if (ball.IsAlignedForWarp())
        {
            if (this._pyOS && !this._pyOS.PostEvent(this, "Destiny::OnActivatingWarp", "OnActivatingWarp", "Li", ball.mId, this.currentTime)) this._pyOS.PyError();
            this.RealWarp(ball);
            vec3.zero(ball.mLastG);
        }
        else
        {
            --ball.mEffectStamp;
            this.EvolveGoto(ball);
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
     * Flies straight through the first 800 milliseconds, then predicts target motion.
     * Adaptation: scalar double locals replace stack vectors and mLastG replaces
     * the return value. Native zero-speed/nonfinite arithmetic is not clamped.
     * Source: destiny/src/Ballpark.cpp:972-1011.
     * @param {CjsDestinyBall} ball Missile with a native target pointer.
     * @returns {void} Updates goto and thrust after the launch interval.
     */
    @meta.adapted
    EvolveMissile(ball)
    {
        if ((this.currentTime - ball.mEffectStamp) * this.tickInterval <= 800)
        {
            this.GotoThrust(ball, ball.mGoto[0], ball.mGoto[1], ball.mGoto[2]);
            return;
        }
        const other = ball.mFollowPtr;
        const x = other.mNewPos[0], y = other.mNewPos[1], z = other.mNewPos[2];
        const dx = ball.mNewPos[0] - x, dy = ball.mNewPos[1] - y, dz = ball.mNewPos[2] - z;
        const distance = Math.sqrt(dx * dx + dy * dy + dz * dz), time = distance / ball.mMaxVel;
        let tx = x + time * other.mNewVel[0], ty = y + time * other.mNewVel[1], tz = z + time * other.mNewVel[2];
        const radius = ball.mFollowRange + ball.mRadius + other.mRadius;
        // Native quirk: retain zero-times-infinity when the float radius sum overflowed.
        // Source: destiny/src/Ballpark.cpp:996-1000.
        if (distance === 0) { tx = x + radius; ty = y + 0 * radius; tz = z + 0 * radius; }
        else
        {
            const inverse = 1 / distance;
            tx += dx * radius * inverse; ty += dy * radius * inverse; tz += dz * radius * inverse;
        }
        vec3.set(ball.mGoto, tx, ty, tz);
        this.GotoThrust(ball, tx, ty, tz, ball.mMode === Mode.DSTBALL_MISSILE);
    }

    /**
     * Steers toward the leader's rotated formation offset, including both radii.
     * Adaptation: mLastG replaces the native Vector3d return; a pooled float32
     * offset survives reentry through the leader's rotation method and is returned
     * on throws. Negative native vector indexing raises in JS rather than reading memory.
     * Source: destiny/src/Ballpark.cpp:1023-1061.
     * @param {CjsDestinyBall} ball Formation follower with a native target link.
     * @returns {void} Invalid formation IDs or high slots produce zero thrust.
     */
    @meta.adapted
    EvolveFormation(ball)
    {
        vec3.zero(ball.mLastG);
        const other = ball.mFollowPtr;
        if (other.mFormationID < 0 || other.mFormationID > this.mFormations.length - 1) return;
        const slot = (ball.mEffectStamp << 24) >> 24;
        const formation = this.mFormations[other.mFormationID];
        if (slot > formation.length - 1) return;
        const offset = formation[slot];
        let length = Math.sqrt(offset[0] * offset[0] + offset[1] * offset[1] + offset[2] * offset[2]);
        if (length === 0) length = 1;
        const x = other.mNewPos[0], y = other.mNewPos[1], z = other.mNewPos[2];
        const distance = ball.mRadius + other.mRadius + length, inverse = 1 / length;
        const vec3_0 = vec3.alloc();
        try
        {
            vec3.set(vec3_0, distance * offset[0] * inverse, distance * offset[1] * inverse, distance * offset[2] * inverse);
            other.GetRotatedVector(vec3_0);
            vec3.set(ball.mGoto, x + vec3_0[0], y + vec3_0[1], z + vec3_0[2]);
        }
        finally { vec3.unalloc(vec3_0); }
        this.GotoThrust(ball, ball.mGoto[0], ball.mGoto[1], ball.mGoto[2]);
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
        this.GotoThrust(ball, ball.gotoX, ball.gotoY, ball.gotoZ, ball.mMode === Mode.DSTBALL_MISSILE);
    }

    /**
     * Selects the native legacy or new orbit from the live global setting.
     * Adaptation: each branch writes scalar mLastG output instead of returning Vector3d.
     *
     * @param {CjsDestinyBall} ball Ball whose existing state is read or updated.
     * @param {number} currentTime Native integer tick counter.
     * @returns {void} No return value.
     */
    @meta.blue.method
    @meta.adapted
    EvolveOrbit(ball, currentTime)
    {
        if (g_useNewOrbit) this.EvolveNewStyleOrbit(ball, currentTime);
        else this.EvolveOldStyleOrbit(ball, currentTime);
    }

    /**
     * Calculates the native precessing fallback plane from the park counter and ID.
     * Adaptation: caller-owned f64 Number output replaces the Vector3d return.
     *
     * @param {CjsDestinyBall} ball Ball whose low sixteen ID bits seed the plane.
     * @param {number[]} out Three-component destination for the orbital normal.
     * @returns {number[]} The supplied destination, truncated to seven decimals.
     */
    @meta.adapted
    DefaultOrbitalNormal(ball, out)
    {
        const phi1 = this.currentTime * ORBITAL_PRECESSION;
        const phi2 = Number(ball.id & 0xffffn) + this.currentTime * ORBITAL_PRECESSION;
        const x = Math.trunc(Math.cos(phi1) * Math.cos(phi2) * 1e7) / 1e7;
        const y = Math.trunc(Math.sin(phi2) * 1e7) / 1e7;
        const z = Math.trunc(Math.sin(phi1) * Math.cos(phi2) * 1e7) / 1e7;
        out[0] = x;
        out[1] = y;
        out[2] = z;
        return out;
    }

    /**
     * Finds the native orbital plane and predicted target direction and distance.
     * Adaptation: out combines the Vector3d return with native toVector/dist refs;
     * Number arrays preserve f64. Null/non-orbit leaves toVector/dist untouched.
     * Native dynamical heading supplies the fallback when velocity cannot define a plane.
     *
     * @param {CjsDestinyBall|null} ball Orbiting ball, or null.
     * @param {{orbitalVector:number[],toVector:number[],dist:number}} out Caller-owned result storage.
     * @returns {Object} The supplied result record.
     */
    @meta.adapted
    GetOrbitalNormal(ball, out)
    {
        if (!ball || ball.mode !== Mode.DSTBALL_ORBIT)
        {
            out.orbitalVector[0] = out.orbitalVector[1] = out.orbitalVector[2] = 0;
            return out;
        }
        const other = ball._followPtr;
        let tx = other.x - ball.x, ty = other.y - ball.y, tz = other.z - ball.z;
        if (g_useNewOrbit)
        {
            tx += other.vx * this.dt;
            ty += other.vy * this.dt;
            tz += other.vz * this.dt;
        }
        const dist = Math.sqrt(tx * tx + ty * ty + tz * tz);
        if (dist > 0)
        {
            const inverse = 1 / dist;
            tx *= inverse; ty *= inverse; tz *= inverse;
        }
        else
        {
            tx = ty = 0; tz = 1;
        }
        let nx = ty * ball.vz - tz * ball.vy;
        let ny = tz * ball.vx - tx * ball.vz;
        let nz = tx * ball.vy - ty * ball.vx;
        let length2 = nx * nx + ny * ny + nz * nz;
        let defaultPlane = !g_useNewOrbit || !(length2 > 1e-12);
        if (g_useNewOrbit && !(length2 > 1e-12) && g_useDynamicalOrientation)
        {
            const { vec3_13 } = CjsBallparkController.scratch;
            vec3.set(vec3_13, 0, 0, 1);
            ball.GetRotatedVector(vec3_13);
            nx = ty * vec3_13[2] - tz * vec3_13[1];
            ny = tz * vec3_13[0] - tx * vec3_13[2];
            nz = tx * vec3_13[1] - ty * vec3_13[0];
            length2 = nx * nx + ny * ny + nz * nz;
            // Unlike the first test, native NaN reaches normalization here.
            defaultPlane = length2 <= 1e-12;
        }
        out.toVector[0] = tx; out.toVector[1] = ty; out.toVector[2] = tz;
        out.dist = dist;
        if (defaultPlane)
        {
            this.DefaultOrbitalNormal(ball, out.orbitalVector);
        }
        else
        {
            const inverse = 1 / Math.sqrt(length2);
            nx *= inverse; ny *= inverse; nz *= inverse;
            out.orbitalVector[0] = nx;
            out.orbitalVector[1] = ny;
            out.orbitalVector[2] = nz;
        }
        return out;
    }

    /**
     * Follows the native exponential-spiral orbit trajectory and velocity target.
     * Adaptation: scalar f64 temporaries and mLastG output replace native vectors;
     * shared scratch is consumed before the thrust call and never returned.
     * The donor ignores currentTime here; its fallback plane reads park.currentTime.
     * The zero-speed 0/0 goto quirk at Ballpark.cpp:1174-1223 is retained.
     *
     * @param {CjsDestinyBall} ball Orbiting ball with a valid target link.
     * @param {number} currentTime Native argument, unused by this algorithm.
     * @returns {void} No return value; updates goto and mLastG scalar fields.
     */
    @meta.adapted
    EvolveNewStyleOrbit(ball, currentTime)
    {
        const cruiseVelocity = ball.speedFraction * ball.maxVelocity;
        const tau = (ball.mass * ball.agility) / this.mFriction;
        const maxThrust = cruiseVelocity / tau;
        const other = ball._followPtr;
        const r = ball.followRange + ball.radius + other.radius;
        const { orbitalNormal } = CjsBallparkController.scratch;
        this.GetOrbitalNormal(ball, orbitalNormal);
        const tx = orbitalNormal.toVector[0], ty = orbitalNormal.toVector[1], tz = orbitalNormal.toVector[2];
        const nx = orbitalNormal.orbitalVector[0], ny = orbitalNormal.orbitalVector[1], nz = orbitalNormal.orbitalVector[2];
        let dist = orbitalNormal.dist;
        let rx = ny * tz - nz * ty, ry = nz * tx - nx * tz, rz = nx * ty - ny * tx;
        const radialLength = Math.sqrt(rx * rx + ry * ry + rz * rz);
        if (radialLength !== 0)
        {
            const inverse = 1 / radialLength;
            rx *= inverse; ry *= inverse; rz *= inverse;
        }
        const currentSpeed = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy + ball.vz * ball.vz);
        // std::max/min retain the first operand when comparison with NaN is false.
        const maxSpeed = cruiseVelocity < currentSpeed ? currentSpeed : cruiseVelocity;
        let angle = 0.1 * (r - dist) / maxSpeed;
        if (angle < -1) angle = -1;
        if (angle > 1) angle = 1;
        if (dist < 0.1) dist = 0.1;
        const maxVelocity = Math.sqrt(dist * maxThrust);
        const estimatedVelocity = maxVelocity < maxSpeed ? maxVelocity : maxSpeed;
        const estimatedDistance = estimatedVelocity * this.dt;
        let px, py, pz, vx, vy, vz;
        if (Math.abs(angle) < 1e-10)
        {
            const t = estimatedDistance / dist;
            const pTo = dist * (1 - Math.cos(t)), pRadial = dist * Math.sin(t);
            px = tx * pTo + rx * pRadial;
            py = ty * pTo + ry * pRadial;
            pz = tz * pTo + rz * pRadial;
            const vRadial = Math.cos(t) * estimatedVelocity, vTo = Math.sin(t) * estimatedVelocity;
            vx = rx * vRadial + tx * vTo;
            vy = ry * vRadial + ty * vTo;
            vz = rz * vRadial + tz * vTo;
        }
        else
        {
            const factor = estimatedDistance * angle / dist / Math.sqrt(angle * angle + 1);
            const t = factor < -0.999 ? Math.log(0.001) / angle
                : (Math.abs(factor) > 1e-10 ? Math.log(1 + factor) / angle : factor / angle);
            const dexp = dist * Math.exp(angle * t);
            const pTo = dist - dexp * Math.cos(t), pRadial = dexp * Math.sin(t);
            px = tx * pTo + rx * pRadial;
            py = ty * pTo + ry * pRadial;
            pz = tz * pTo + rz * pRadial;
            const vTo = -angle * Math.cos(t) + Math.sin(t), vRadial = angle * Math.sin(t) + Math.cos(t);
            vx = tx * vTo + rx * vRadial;
            vy = ty * vTo + ry * vRadial;
            vz = tz * vTo + rz * vRadial;
            const length = Math.sqrt(vx * vx + vy * vy + vz * vz);
            if (length !== 0)
            {
                const inverse = 1 / length;
                vx *= inverse; vy *= inverse; vz *= inverse;
            }
            vx *= estimatedVelocity; vy *= estimatedVelocity; vz *= estimatedVelocity;
        }
        ball.gotoX = ball.x + px;
        ball.gotoY = ball.y + py;
        ball.gotoZ = ball.z + pz;
        this.GotoThrustFollow(ball, ball.gotoX, ball.gotoY, ball.gotoZ,
            vx + other.vx, vy + other.vy, vz + other.vz, 1);
    }

    /**
     * Computes native damped arrival thrust for slow new-orbit targets.
     * Adaptation: scalar target and mLastG fields replace Vector3d arguments/return.
     * The donor's exact 0.1 deadband and one-second cap thresholds are retained.
     *
     * @param {CjsDestinyBall} ball Ball whose current state is read.
     * @param {number} x Target X position in meters.
     * @param {number} y Target Y position in meters.
     * @param {number} z Target Z position in meters.
     * @returns {void} No return value; writes the thrust components.
     */
    @meta.adapted
    OrbitThrust(ball, x, y, z)
    {
        const f = this.mFriction / (ball.mass * ball.agility);
        const maxAccel = f * ball.speedFraction * ball.maxVelocity;
        if (maxAccel <= 0)
        {
            ball._lastGx = ball._lastGy = ball._lastGz = 0;
            return;
        }
        let ax = (x - ball.x) * f - ball.vx;
        let ay = (y - ball.y) * f - ball.vy;
        let az = (z - ball.z) * f - ball.vz;
        const tacc = Math.sqrt(ax * ax + ay * ay + az * az) / maxAccel;
        if (tacc > 1)
        {
            const inverse = 1 / tacc;
            ax *= inverse; ay *= inverse; az *= inverse;
        }
        if (tacc < 0.1) ax = ay = az = 0;
        ball._lastGx = ax; ball._lastGy = ay; ball._lastGz = az;
    }

    /**
     * Blends native position-derived and velocity-derived acceleration under a cap.
     * Adaptation: scalar targets/velocity and mLastG output replace native Vector3d.
     * Denominators retain native arithmetic, without epsilon or expm1 substitutions.
     *
     * @param {CjsDestinyBall} ball Ball whose existing state is read.
     * @param {number} x Target X position in meters.
     * @param {number} y Target Y position in meters.
     * @param {number} z Target Z position in meters.
     * @param {number} vx Desired X velocity in meters per second.
     * @param {number} vy Desired Y velocity in meters per second.
     * @param {number} vz Desired Z velocity in meters per second.
     * @param {number} weight Native relative weight of velocity-derived acceleration.
     * @returns {void} No return value; writes the thrust components.
     */
    @meta.adapted
    GotoThrustFollow(ball, x, y, z, vx, vy, vz, weight)
    {
        const speed = Math.sqrt(vx * vx + vy * vy + vz * vz);
        if (speed < 5e-2 * ball.maxVelocity * ball.speedFraction)
        {
            if (g_useNewOrbit && ball.mode === Mode.DSTBALL_ORBIT) this.OrbitThrust(ball, x, y, z);
            else this.GotoThrust(ball, x, y, z);
            return;
        }
        const f = this.mFriction / (ball.mass * ball.agility);
        const maxAccel = f * ball.speedFraction * ball.maxVelocity;
        if (maxAccel <= 0)
        {
            ball._lastGx = ball._lastGy = ball._lastGz = 0;
            return;
        }
        const tf = ball._timeFactor, inversePosition = 1 / (this.dt * f - (1 - tf));
        let ax = ((x - ball.x) * f - ball.vx * (1 - tf)) * f * inversePosition;
        let ay = ((y - ball.y) * f - ball.vy * (1 - tf)) * f * inversePosition;
        let az = ((z - ball.z) * f - ball.vz * (1 - tf)) * f * inversePosition;
        const inverseVelocity = 1 / (1 - tf);
        const avx = (vx - ball.vx * tf) * f * inverseVelocity;
        const avy = (vy - ball.vy * tf) * f * inverseVelocity;
        const avz = (vz - ball.vz * tf) * f * inverseVelocity;
        const inverseWeight = 1 / (1 + weight);
        ax = (ax + weight * avx) * inverseWeight;
        ay = (ay + weight * avy) * inverseWeight;
        az = (az + weight * avz) * inverseWeight;
        const accel = ax * ax + ay * ay + az * az;
        if (accel > maxAccel * maxAccel)
        {
            const factor = maxAccel / Math.sqrt(accel);
            ax *= factor; ay *= factor; az *= factor;
        }
        ball._lastGx = ax; ball._lastGy = ay; ball._lastGz = az;
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
        const phi2 = Number(ball.id & 0xffffn) + currentTime * ORBITAL_PRECESSION;
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
        const maxThrust = this.mFriction * cruiseVelocity / (ball.mass * ball.agility);
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
        if (!g_useDynamicalOrientation)
        {
            ball.vy = (ball.vy - 0.07 * ball.vy) * 0.9345794392523364485981308411215;
        }
    }

    /**
     * Aims full thrust at a point, reducing close-range thrust only for non-missiles.
     * Adaptation: f64 scalar target and mLastG output replace native Vector3d values.
     * Source: destiny/src/Ballpark.cpp:1398-1426; destiny/src/Vector3d.h:62-72.
     *
     * @param {CjsDestinyBall} ball Ball whose existing state is read or updated.
     * @param {number} x Position component in meters.
     * @param {number} y Position component in meters.
     * @param {number} z Position component in meters.
     * @param {boolean} [missile=false] Bypass the native close-distance thrust scaling.
     * @returns {void} No return value.
     */
    @meta.blue.method
    @meta.adapted
    GotoThrust(ball, x, y, z, missile = false)
    {
        const dx = x - ball.x;
        const dy = y - ball.y;
        const dz = z - ball.z;
        const length2 = dx * dx + dy * dy + dz * dz;
        const dist = ball.speedFraction * ball.maxVelocity * this.dt;
        let thrust = this.mFriction * ball.speedFraction * ball.maxVelocity / (ball.mass * ball.agility);
        if (!missile && length2 < dist * dist)
        {
            const coefficient = length2 / (dist * dist);
            thrust = thrust * coefficient * coefficient;
        }
        const inverseLength = length2 === 0 ? 1 : 1 / Math.sqrt(length2);
        ball._lastGx = dx * inverseLength * thrust;
        ball._lastGy = dy * inverseLength * thrust;
        ball._lastGz = dz * inverseLength * thrust;
    }

    /**
     * Integrates native linear drag for a full tick or fractional interval.
     * Adaptation: mutable Number vectors replace Vector3d references, retaining f64
     * arithmetic and native singular results. The full tick uses the supplied cache.
     * Source: destiny/src/Ballpark.cpp:751-777.
     *
     * @param {number[]} p Position, updated before velocity as in Carbon.
     * @param {number[]} v Velocity, updated in place.
     * @param {number[]} a Applied acceleration.
     * @param {number} m Mass multiplied by agility.
     * @param {number} k Friction coefficient.
     * @param {number} timeFactor Cached full-tick exponential.
     * @param {number} t Integration duration in seconds.
     * @returns {void} Zero duration leaves both outputs untouched.
     */
    @meta.blue.method
    @meta.adapted
    Integrate(p, v, a, m, k, timeFactor, t)
    {
        if (t === 0) return;
        if (t !== this.dt) timeFactor = Math.exp(-k / m * t);
        const k2 = k * k;
        const inverseK2 = 1 / k2;
        const inverseK = 1 / k;
        for (let q = 0; q < 3; ++q)
        {
            if (k < 1e-10 * m * t)
                p[q] = (m * (a[q] * (-k * t) + k * (a[q] * t + v[q] * k * (1 / m) * t)) + p[q] * k2) * inverseK2;
            else
                p[q] = (m * (m * a[q] * (timeFactor - 1) + k * (a[q] * t + v[q] - timeFactor * v[q])) + p[q] * k2) * inverseK2;
        }
        for (let q = 0; q < 3; ++q)
            v[q] = (m * a[q] - (m * a[q] - v[q] * k) * timeFactor) * inverseK;
    }

    /**
     * Accumulates native ball responses before static-shape responses in discovery order.
     * Adaptation: reusable JS arrays replace native static vectors; finally retains
     * ON_BLOCK_EXIT cleanup on exceptions. Filters remain at their native layers.
     * Source: destiny/src/Ballpark.cpp:2745-2784.
     *
     * @param {CjsDestinyBall|null} ball Moving ball.
     * @returns {void} Updates the ball's collision acceleration and contact IDs.
     */
    @meta.adapted
    Gradient(ball)
    {
        if (!ball) return;
        const { gradientBalls: balls, gradientStatics: shapes } = CjsBallparkController.scratch;
        try
        {
            this.mPartition.GetCollisionCandidates(ball, balls, shapes, this.isMaster);
            for (const other of balls)
            {
                if ((ball.mMode === Mode.DSTBALL_MISSILE && (other.mId === ball.mOwnerId
                    || (other.mMode === Mode.DSTBALL_MINIBALL && other.mOwnerId === ball.mOwnerId)))
                    || ((other.mMode === Mode.DSTBALL_MISSILE || other.mMode === Mode.DSTBALL_MUSHROOM) && ball.mId === other.mOwnerId)
                    || (other.mMode === Mode.DSTBALL_MISSILE && ball.mId === other.mFollowId)
                    || (other.isSpaceJunk && !ball.isSpaceJunk)) continue;
                this.Potential(ball, other);
            }
            for (const shape of shapes)
            {
                if (ball.mMode === Mode.DSTBALL_MISSILE || ball.mMode === Mode.DSTBALL_MUSHROOM) continue;
                shape.CollideWithBall(ball);
            }
        }
        finally
        {
            balls.length = 0;
            shapes.length = 0;
        }
    }

    /**
     * Computes native legacy sphere response, including temporary overlap separation.
     * Adaptation: pooled f64 vectors retain C++ value semantics across recursion;
     * finally returns every vector and restores positions on JS exceptions. Console replaces the depth warning.
     * Scalar mass divisions and native vector reciprocal multiplication stay distinct.
     * Source: destiny/src/Ballpark.cpp:2789-3006.
     *
     * @param {CjsDestinyBall} me Ball receiving force/contact state.
     * @param {CjsDestinyBall} other Candidate sphere.
     * @param {number} [recursionDepth=0] Native overlap recursion depth.
     * @returns {void} Later contact times win; every accepted sweep appends an ID.
     */
    @meta.adapted
    Potential(me, other, recursionDepth = 0)
    {
        const p0 = vec3d.alloc();
        const p1 = vec3d.alloc();
        const vp1 = vec3d.alloc();
        const q0 = vec3d.alloc();
        const q1 = vec3d.alloc();
        const vq1 = vec3d.alloc();
        const a1 = vec3d.alloc();
        const normal = vec3d.alloc();
        const work = vec3d.alloc();
        const savedMe = vec3d.alloc();
        const savedOther = vec3d.alloc();
        try
        {
            const m1 = me.isFree ? me.mMass * me.mAgility : 1e34;
            const m2 = other.isFree ? other.mMass * other.mAgility : 1e34;
            const collRadius = me.mRadius + other.mRadius;
            vec3.copy(p0, me.mNewPos); vec3.copy(p1, p0); vec3.copy(vp1, me.mNewVel);
            vec3.copy(q0, other.mNewPos); vec3.copy(q1, q0); vec3.copy(vq1, other.mNewVel);
            this.Integrate(p1, vp1, me.mLastG, m1, this.mFriction, me.mTimeFactor, this.dt);
            this.Integrate(q1, vq1, other.mLastG, m2, this.mFriction, other.mTimeFactor, this.dt);
            const s = CollideTwoSpheres(p0, p1, q0, q1, collRadius);
            if (s === -1) return;
            vec3.copy(p1, me.mNewPos); vec3.copy(vp1, me.mNewVel);
            vec3.copy(q1, other.mNewPos); vec3.copy(vq1, other.mNewVel);
            if (s > 0)
            {
                this.Integrate(p1, vp1, me.mLastG, m1, this.mFriction, me.mTimeFactor, s * this.dt);
                this.Integrate(q1, vq1, other.mLastG, m2, this.mFriction, other.mTimeFactor, s * this.dt);
                vec3.subtract(normal, q1, p1);
                const length = Math.sqrt(vec3.dot(normal, normal));
                if (length !== 0) vec3.scale(normal, normal, 1 / length);
                const v1 = vec3.dot(vp1, normal), v2 = vec3.dot(vq1, normal);
                if (!other.isFree)
                {
                    for (let q = 0; q < 3; ++q) vp1[q] -= 2 * v1 * normal[q];
                }
                else
                {
                    const mm1 = me.mMass, mm2 = other.mMass;
                    const v1p = (mm1 * v1 - mm2 * v1 + 2 * mm2 * v2) / (mm1 + mm2);
                    for (let q = 0; q < 3; ++q) vp1[q] += (v1p - v1) * normal[q];
                }
                this.Integrate(p1, vp1, me.mLastG, m1, this.mFriction, me.mTimeFactor, (1 - s) * this.dt);
                const k = this.mFriction;
                for (let q = 0; q < 3; ++q)
                    a1[q] = -(-m1 * me.mLastG[q] + me.mTimeFactor * m1 * me.mLastG[q]
                        - me.mTimeFactor * me.mNewVel[q] * k + vp1[q] * k) * (1 / m1) * (1 / (me.mTimeFactor - 1));
            }
            else
            {
                const separation = vec3.subtract(work, q0, p0), separation2 = vec3.dot(separation, separation);
                if (separation2 === 0) vec3.set(normal, me.mId > other.mId ? 1 : -1, 0, 0);
                else
                {
                    vec3.subtract(normal, q1, p1);
                    const length = Math.sqrt(vec3.dot(normal, normal));
                    if (length !== 0) vec3.scale(normal, normal, 1 / length);
                }
                const dist = collRadius - Math.sqrt(separation2) + 1;
                const d1 = m2 / (m1 + m2) * dist, d2 = m1 / (m1 + m2) * dist;
                if (me.isFree && other.isFree)
                {
                    if (recursionDepth < 2)
                    {
                        vec3.copy(savedMe, me.mNewPos); vec3.copy(savedOther, other.mNewPos);
                        try
                        {
                            for (let q = 0; q < 3; ++q)
                            {
                                me.mNewPos[q] -= d1 * normal[q];
                                other.mNewPos[q] += d2 * normal[q];
                            }
                            this.Potential(me, other, recursionDepth + 1);
                        }
                        finally
                        {
                            vec3.copy(me.mNewPos, savedMe);
                            vec3.copy(other.mNewPos, savedOther);
                        }
                        if (m2 / m1 > 25)
                        {
                            const length = Math.sqrt(vec3.dot(me.mLastC, me.mLastC));
                            if (length !== 0) vec3.scale(me.mLastC, me.mLastC, 1 / length);
                            vec3.scale(me.mLastC, me.mLastC, dist);
                        }
                        const deltaVelocity = vec3.subtract(work, me.mNewVel, other.mNewVel);
                        if (vec3.dot(deltaVelocity, deltaVelocity) > 0.0001) return;
                    }
                    else console.error("Potential: overlap recursion limit", me.mId, other.mId);
                }
                const normalComp = vec3.dot(me.mLastG, normal), tmp = 1 / (m1 + this.dt * this.mFriction);
                for (let q = 0; q < 3; ++q)
                    a1[q] = ((-d1 / (this.dt * tmp * m1)) * normal[q] - me.mNewVel[q]) * (1 / this.dt) - normalComp * normal[q];
            }
            if ((me.mMode !== Mode.DSTBALL_MISSILE || other.mId !== me.mFollowId) && s >= me.mLastCollision)
            {
                const lastC = vec3.scale(a1, a1, 0.85);
                if (s === me.mLastCollision)
                {
                    if (vec3.dot(lastC, lastC) > vec3.dot(me.mLastC, me.mLastC)) vec3.copy(me.mLastC, lastC);
                }
                else
                {
                    vec3.copy(me.mLastC, lastC);
                    me.mLastCollision = s;
                }
            }
            me.mCollisions.push(other.mId);
        }
        finally
        {
            vec3d.unalloc(p0);
            vec3d.unalloc(p1);
            vec3d.unalloc(vp1);
            vec3d.unalloc(q0);
            vec3d.unalloc(q1);
            vec3d.unalloc(vq1);
            vec3d.unalloc(a1);
            vec3d.unalloc(normal);
            vec3d.unalloc(work);
            vec3d.unalloc(savedMe);
            vec3d.unalloc(savedOther);
        }
    }

    /**
     * Reads Carbon's exposed warp-speed property, unused by trajectory calculations.
     * Source: destiny/src/Ballpark.cpp:101; destiny/src/Ballpark_Blue.cpp:95-103.
     * @returns {number} Stored native double value.
     */
    @meta.type.float64
    @meta.implemented
    get warpSpeed() { return this.mWarpSpeed; }

    /**
     * Writes the native property without altering active warp factors.
     * Source: destiny/src/Ballpark_Blue.cpp:95-103.
     * @param {number} value Native double field value.
     * @returns {void} Updates only mWarpSpeed.
     */
    @meta.implemented
    set warpSpeed(value) { this.mWarpSpeed = value; }

    /**
     * Orders alignment and warp, or a normal goto for destinations below 100 km.
     * Adaptation: typed JS scalars replace the native overload/Python tuple; Python
     * defaults are retained and invalid int32 factors throw. DataView preserves
     * the native double-to-int64 bit reinterpretation in mFollowId. PyOS is injected.
     * Source: destiny/src/Ballpark.cpp:4072-4137; destiny/src/Thunkers.cpp:360-382.
     * @param {bigint|number} id Ball identity.
     * @param {number} x Absolute destination X.
     * @param {number} y Absolute destination Y.
     * @param {number} z Absolute destination Z.
     * @param {number} [minRange=20000] Minimum range, clamping negative values only.
     * @param {number} [warpFactor=20] Signed-int32 milli-AU/s factor; nonpositive becomes one.
     * @returns {void} Exact repeated destinations preserve the current warp command.
     */
    @meta.blue.method
    @meta.adapted
    WarpTo(id, x, y, z, minRange = 20000, warpFactor = 20)
    {
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return;
        if (!Number.isInteger(warpFactor) || warpFactor < -2147483648 || warpFactor > 2147483647)
            throw new RangeError("Warp factor must fit native int32");
        if (minRange < 0) minRange = 0;
        if (warpFactor <= 0) warpFactor = 1;
        const ball = this.GetBall(id);
        if (!ball) return;
        const dx = ball.mNewPos[0] - x, dy = ball.mNewPos[1] - y, dz = ball.mNewPos[2] - z;
        if (dx * dx + dy * dy + dz * dz < 1e10)
        {
            const vec3d_0 = vec3d.alloc();
            try { vec3.set(vec3d_0, x, y, z); this.GotoPoint(ball, vec3d_0); }
            finally { vec3d.unalloc(vec3d_0); }
            if (this._pyOS && !this._pyOS.PostEvent(this, "Destiny::OnExitWarp", "OnExitWarp", "Li", ball.mId, 1)) this._pyOS.PyError();
            return;
        }
        if (ball.IsWarpish() && x === ball.mGoto[0] && y === ball.mGoto[1] && z === ball.mGoto[2]) return;
        this.Stop(ball);
        vec3.set(ball.mGoto, x, y, z);
        ball.mEffectStamp = -1;
        ball.mFollowRange = 0;
        const { dataView_0 } = CjsBallparkController.scratch;
        dataView_0.setFloat64(0, minRange, true);
        ball.mFollowId = dataView_0.getBigInt64(0, true);
        ball.mOwnerId = BigInt(warpFactor);
        ball.SetMode(Mode.DSTBALL_WARP);
    }

    /**
     * Enters proper warp after stopping followers and offsetting the destination.
     * Adaptation: scalar double locals replace stack Vector3d values; DataView
     * decodes the native aliased minimum-range bits after follower callbacks.
     * Source: destiny/src/Ballpark.cpp:4145-4165.
     * @param {CjsDestinyBall|null} ball Aligning ball, or null for a native no-op.
     * @returns {void} Stamps the tick, saves distance and disables collision/sensor participation.
     */
    @meta.adapted
    RealWarp(ball)
    {
        if (!ball) return;
        this.StopAllFollowers(ball);
        let x = ball.mNewPos[0] - ball.mGoto[0], y = ball.mNewPos[1] - ball.mGoto[1], z = ball.mNewPos[2] - ball.mGoto[2];
        let norm = Math.sqrt(x * x + y * y + z * z);
        if (norm !== 0) { norm = 1 / norm; x *= norm; y *= norm; z *= norm; }
        const { dataView_0 } = CjsBallparkController.scratch;
        dataView_0.setBigInt64(0, ball.mFollowId, true);
        const range = dataView_0.getFloat64(0, true);
        x = ball.mGoto[0] + range * x; y = ball.mGoto[1] + range * y; z = ball.mGoto[2] + range * z;
        const dx = x - ball.mNewPos[0], dy = y - ball.mNewPos[1], dz = z - ball.mNewPos[2];
        vec3.set(ball.mGoto, x, y, z);
        ball.mEffectStamp = this.currentTime;
        ball.mLastCollision = Math.sqrt(dx * dx + dy * dy + dz * dz);
        ball.isMassive = false;
        ball.mSensor.active = false;
    }

    /**
     * Computes the native three-phase exponential warp constants.
     * Adaptation: one caller-owned record replaces nine double reference outputs.
     * All intermediates remain doubles; ordered comparisons preserve std::min NaN behavior.
     * Source: destiny/src/Ballpark.cpp:4167-4261; destiny/src/Ballpark.cpp:61-63.
     * @param {number} warpFactor Native factor converted from ownerId.
     * @param {number} warpDistance Total warp length.
     * @param {Object} out Caller-owned record receiving native output names.
     * @returns {Object} Supplied record; durations/distances are not clamped.
     */
    @meta.adapted
    SetupWarpConstants(warpFactor, warpDistance, out)
    {
        let warpSpeed = warpFactor * 0.001 * AU;
        const accelRate = warpFactor * (1 / 1000);
        const decel = warpFactor * (1 / 3000), decelRate = 2 < decel ? 2 : decel;
        const limit = (warpDistance + 1) * accelRate * decelRate / (accelRate + decelRate);
        if (limit < warpSpeed) warpSpeed = limit;
        const accelDuration = Math.log(warpSpeed / accelRate) / accelRate;
        const cruiseDuration = warpDistance / warpSpeed - 1 / accelRate - 1 / decelRate + 1 / warpSpeed;
        const decelDuration = Math.log(warpSpeed / decelRate) / decelRate;
        out.accelDuration = accelDuration; out.cruiseDuration = cruiseDuration; out.decelDuration = decelDuration;
        out.accelDistance = warpSpeed / accelRate; out.cruiseDistance = warpSpeed * cruiseDuration;
        out.decelDistance = warpSpeed / decelRate - 1;
        out.accelRate = accelRate; out.decelRate = decelRate; out.warpSpeed = warpSpeed;
        return out;
    }

    /**
     * Samples native warp position/velocity and optionally completes simulation warp.
     * Adaptation: caller-owned vectors replace reference outputs; a pooled record
     * replaces stack constants and is released before callbacks. Scalars survive
     * reentry. PyOS/logging are explicit JS boundaries; no native profiling runs.
     * Source: destiny/src/Ballpark.cpp:4263-4362.
     * @param {CjsDestinyBall} ball Warp state and destination owner.
     * @param {Float64Array|number[]} p In/out position used to derive warp direction.
     * @param {Float64Array|number[]} v In/out velocity; faster acceleration input is retained.
     * @param {number} t Seconds since proper warp started.
     * @param {boolean} interpolating True suppresses simulation transitions and events.
     * @returns {number} Native distance scalar; extended-warp fallback returns zero.
     */
    @meta.adapted
    WarpDistance(ball, p, v, t, interpolating)
    {
        const constants = CjsBallparkController.warpConstants.pop() || {};
        let accelDuration, cruiseDuration, decelDuration, accelDistance, cruiseDistance, decelDistance, accelRate, decelRate, warpSpeed;
        try
        {
            this.SetupWarpConstants(Number(ball.mOwnerId), ball.mLastCollision, constants);
            ({ accelDuration, cruiseDuration, decelDuration, accelDistance, cruiseDistance, decelDistance, accelRate, decelRate, warpSpeed } = constants);
        }
        finally { CjsBallparkController.warpConstants.push(constants); }
        let x = ball.mGoto[0] - p[0], y = ball.mGoto[1] - p[1], z = ball.mGoto[2] - p[2];
        let norm = Math.sqrt(x * x + y * y + z * z);
        if (norm !== 0) { norm = 1 / norm; x *= norm; y *= norm; z *= norm; }
        let distance, speed, ending = false;
        if (t < accelDuration)
        {
            // Native quirk: exp(0) starts one meter along the path, even at time zero.
            // Source: destiny/src/Ballpark.cpp:4291-4303.
            speed = accelRate * Math.exp(accelRate * t);
            const currentSpeed = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
            if (currentSpeed > speed) speed = currentSpeed;
            distance = Math.exp(accelRate * t);
        }
        else if (t - accelDuration < cruiseDuration)
        {
            speed = warpSpeed;
            distance = warpSpeed * (t - accelDuration) + accelDistance;
        }
        else if (t - cruiseDuration - accelDuration < decelDuration + 1)
        {
            speed = warpSpeed * Math.exp(-decelRate * (t - cruiseDuration - accelDuration));
            distance = warpSpeed / decelRate - warpSpeed / decelRate * Math.exp(-decelRate * (t - cruiseDuration - accelDuration)) + accelDistance + cruiseDistance;
            ending = speed < Math.min(ball.mMaxVel / 2, 100) && !interpolating;
        }
        else
        {
            console.error("Ship stuck in extended warp", ball.mId, Number(ball.mOwnerId), ball.mLastCollision, t, interpolating);
            vec3.copy(p, ball.mGoto); vec3.zero(v);
            distance = 0;
            ending = !interpolating;
        }
        if (speed !== undefined)
        {
            const remaining = accelDistance + cruiseDistance + decelDistance - distance;
            vec3.set(v, speed * x, speed * y, speed * z);
            vec3.set(p, ball.mGoto[0] - remaining * x, ball.mGoto[1] - remaining * y, ball.mGoto[2] - remaining * z);
        }
        if (ending)
        {
            if (!this.isMaster && this._pyOS && !this._pyOS.PostEvent(this, "Destiny::OnDeactivatingWarp", "OnDeactivatingWarp", "Li", ball.mId, this.currentTime)) this._pyOS.PyError();
            ball.isMassive = true;
            ball.mSensor.active = true;
            this.Stop(ball);
        }
        return distance;
    }

    /**
     * Starts proper warp immediately using the native absolute-destination velocity.
     * Adaptation: typed JS arguments replace the Python wrapper; scalar normalization
     * preserves double arithmetic and injected PyOS owns activation notifications.
     * Source: destiny/src/Ballpark.cpp:4370-4410; destiny/src/Thunkers.cpp:389-410.
     * @param {bigint|number} id Ball identity, resolved again after WarpTo callbacks.
     * @param {number} x Absolute destination X.
     * @param {number} y Absolute destination Y.
     * @param {number} z Absolute destination Z.
     * @param {number} warpFactor Native signed-int32 warp factor.
     * @returns {void} GOTO fallback does not enter warp.
     */
    @meta.blue.method
    @meta.adapted
    EntityWarpIn(id, x, y, z, warpFactor)
    {
        this.WarpTo(id, x, y, z, 0, warpFactor);
        const ball = this.GetBall(id);
        if (!ball || ball.mMode === Mode.DSTBALL_GOTO) return;
        this.RealWarp(ball);
        // Native quirk: this is absolute destination, not destination minus position.
        // Source: destiny/src/Ballpark.cpp:4393-4394.
        let norm = Math.sqrt(x * x + y * y + z * z);
        if (norm !== 0) { norm = 1 / norm; x *= norm; y *= norm; z *= norm; }
        vec3.set(ball.mNewVel, x * AU, y * AU, z * AU);
        if (g_useDynamicalOrientation) ball.SnapOrientation();
        ball.mEffectStamp = Math.max(this.currentTime - 5, 0);
        const dx = ball.mNewPos[0] - ball.mGoto[0], dy = ball.mNewPos[1] - ball.mGoto[1], dz = ball.mNewPos[2] - ball.mGoto[2];
        ball.mLastCollision = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (this.isMaster && this._pyOS && !this._pyOS.PostEvent(this, "Destiny::OnActivatingWarp", "OnActivatingWarp", "Li", ball.mId, this.currentTime)) this._pyOS.PyError();
    }

    /**
     * Moves a point outside the first intersecting global ball's 1.1-radius shell.
     * Adaptation: caller-owned float64 storage replaces Vector3d&, and Map insertion
     * order replaces Python dictionary traversal when global spheres overlap.
     * Native quirk: a point at the exact center stays there after zero normalization.
     * This helper has no native WarpTo/RealWarp call site.
     * Source: destiny/src/Ballpark.cpp:4443-4462; destiny/src/MapOfBalls.h:100-136.
     * @param {Float64Array|number[]} p In/out absolute point.
     * @returns {void} Stops after the first containing global sphere, even at its center.
     */
    @meta.adapted
    ShiftFromPlanets(p)
    {
        for (const sphere of this._balls.values())
        {
            if (!sphere.isGlobal) continue;
            let x = p[0] - sphere.mNewPos[0], y = p[1] - sphere.mNewPos[1], z = p[2] - sphere.mNewPos[2];
            const length2 = x * x + y * y + z * z, r = sphere.mRadius;
            if (length2 < 1.1 * 1.1 * r * r)
            {
                const length = Math.sqrt(length2);
                if (length !== 0) { const inverse = 1 / length; x *= inverse; y *= inverse; z *= inverse; }
                const scale = 1.1 * r;
                vec3.set(p, scale * x + sphere.mNewPos[0], scale * y + sphere.mNewPos[1], scale * z + sphere.mNewPos[2]);
                break;
            }
        }
    }

    /**
     * Appends a native formation from caller-supplied local offset vectors.
     * Adaptation: JS arrays replace Python tuples/native vectors and owned f64
     * factories copy offsets. Malformed input throws instead of leaving a Python error.
     * Source: destiny/src/Ballpark.cpp:6651-6671.
     * @param {Array<Float64Array|number[]>} vectorList Local offsets to copy.
     * @returns {void} Names are not stored by the native formation container.
     */
    @meta.adapted
    AddFormation(vectorList)
    {
        const vectors = [];
        const length = vectorList.length;
        for (let i = 0; i < length; ++i)
        {
            const value = vectorList[i];
            vectors.push(vec3d.fromValues(value[0], value[1], value[2]));
        }
        this.mFormations.push(vectors);
    }

    /**
     * Replaces formation definitions from native name/vector-list pairs.
     * Adaptation: caller-owned JS arrays replace Python tuples; names are ignored,
     * existing ball IDs/slot reservations are not reset, and errors retain earlier appends.
     * Source: destiny/src/Thunkers.cpp:1921-1945.
     * @param {Array} formationList Pairs of display name and local offset vectors.
     * @returns {void} Clears then appends definitions in input order.
     */
    @meta.blue.method
    @meta.adapted
    LoadFormations(formationList)
    {
        this.mFormations.length = 0;
        const count = formationList.length;
        for (let i = 0; i < count; ++i) this.AddFormation(formationList[i][1]);
    }

    /**
     * Assigns a leader formation and stops followers whose slots no longer fit.
     * Adaptation: signed-char narrowing follows the native boundary; a JS snapshot
     * owns stop candidates across callbacks. Negative native vector indices throw
     * on access rather than reading invalid memory. The reversed shrink-reset loop stays.
     * Source: destiny/src/Ballpark.cpp:6673-6727; destiny/src/Thunkers.cpp:1899-1917.
     * @param {bigint|number} id Leader identity.
     * @param {number} formationID Signed-char formation index; -1 disables leadership.
     * @returns {void} Does not reserve slots or update followers when reusing an ID.
     */
    @meta.blue.method
    @meta.adapted
    SetBallFormation(id, formationID)
    {
        formationID = (formationID << 24) >> 24;
        const ball = this.GetBall(id);
        if (!ball || formationID > this.mFormations.length - 1) return;
        if (ball.mFormationID >= 0)
        {
            if (formationID === -1)
            {
                this.StopAllFollowers(ball);
                ball.mFormationSlots = 0;
            }
            else if (formationID !== ball.mFormationID)
            {
                const newLength = this.mFormations[formationID].length;
                if (this.mFormations[ball.mFormationID].length > newLength)
                {
                    const stopCandidates = [];
                    for (const followerId of ball.mFollowers)
                    {
                        const follower = this.GetBall(followerId);
                        if (follower.mMode !== Mode.DSTBALL_FORMATION) continue;
                        if (follower.mEffectStamp > newLength - 1) stopCandidates.push(follower);
                    }
                    for (const follower of stopCandidates) this.Stop(follower);
                    for (let i = this.mFormations[ball.mFormationID].length; i < newLength; ++i)
                    {
                        if (i >= 16) throw new RangeError("Formation bitset index is out of range");
                        ball.mFormationSlots &= ~(1 << i);
                    }
                }
            }
        }
        ball.mFormationID = formationID;
    }

    /**
     * Joins a leader's formation without implicitly reserving its slot.
     * Adaptation: signed-char slot narrowing and JS references replace native
     * char/pointers. Native negative slots are retained until their later invalid access.
     * Source: destiny/src/Ballpark.cpp:3951-4001; destiny/src/Thunkers.cpp:1098-1118.
     * @param {bigint|number} id Follower identity.
     * @param {bigint|number} targetId Leader identity.
     * @param {number} slot Native formation slot, normally returned by ReserveFormationSlot.
     * @returns {void} Bubble/cloak rejection occurs after stopping the previous order.
     */
    @meta.blue.method
    @meta.adapted
    FormationFollow(id, targetId, slot)
    {
        slot = (slot << 24) >> 24;
        const ball = this.GetBall(id);
        if (!ball) return;
        targetId = CjsDestinyBall._toInt64(targetId);
        if (ball.mId === targetId) return;
        const target = this.GetBall(targetId);
        if (!target || target.mFormationID < 0 || target.mFormationID > this.mFormations.length - 1) return;
        if (slot > this.mFormations[target.mFormationID].length - 1) return;
        this.Stop(ball);
        if (ball.mNewBubble !== target.mNewBubble || target.isCloaked) return;
        ball.mFollowId = targetId;
        ball.mFollowPtr = target;
        ball.mEffectStamp = slot;
        ball.SetMode(Mode.DSTBALL_FORMATION);
        target.mFollowers.add(ball.mId);
    }

    /**
     * Applies Python's negative-target restriction before native following.
     * Adaptation: typed JS arguments replace tuple parsing and RangeError replaces BeOS error state.
     * Source: destiny/src/Thunkers.cpp:244-269.
     * @param {bigint|number} id Follower identity.
     * @param {bigint|number} targetId Nonnegative target identity.
     * @param {number} [range=1] Native float surface separation.
     * @returns {void} Delegates to the native core after the wrapper guard.
     */
    @meta.adapted
    PyFollowBall(id, targetId, range = 1)
    {
        targetId = CjsDestinyBall._toInt64(targetId);
        if (targetId < 0n) throw new RangeError("Cannot follow a negative ball ID");
        this.FollowBall(id, targetId, range);
    }

    /**
     * Applies Python's negative-target restriction before native orbiting.
     * Adaptation: typed JS arguments replace tuple parsing and RangeError replaces BeOS error state.
     * Source: destiny/src/Thunkers.cpp:330-355.
     * @param {bigint|number} id Orbiter identity.
     * @param {bigint|number} targetId Nonnegative target identity.
     * @param {number} [range=1] Native float surface separation.
     * @returns {void} Delegates to the native core after the wrapper guard.
     */
    @meta.adapted
    PyOrbit(id, targetId, range = 1)
    {
        targetId = CjsDestinyBall._toInt64(targetId);
        if (targetId < 0n) throw new RangeError("Cannot orbit a negative ball ID");
        this.Orbit(id, targetId, range);
    }

    /**
     * Sets a destination after native stop callbacks and restarts zero throttle.
     * Adaptation: argument shape selects ID/scalars or Ball/vector overloads;
     * the scalar wrapper borrows f64 storage across callbacks and returns it on throws.
     * Source: destiny/src/Ballpark.cpp:4513-4548.
     *
     * @param {bigint|number|CjsDestinyBall} id Signed-int64 identity or native Ball reference.
     * @param {number|Float64Array|number[]} x Position X, or the reference overload's target vector.
     * @param {number} [y] Position Y in the scalar overload.
     * @param {number} [z] Position Z in the scalar overload.
     * @returns {void} No return value.
     */
    @meta.blue.method
    @meta.adapted
    GotoPoint(id, x, y, z)
    {
        if (typeof id !== "object")
        {
            const ball = this.GetBall(id);
            if (!ball) return;
            const vec3d_0 = vec3d.alloc();
            try
            {
                vec3.set(vec3d_0, x, y, z);
                this.GotoPoint(ball, vec3d_0);
            }
            finally { vec3d.unalloc(vec3d_0); }
            return;
        }
        const ball = id, point = x;
        if (!Number.isFinite(point[0]) || !Number.isFinite(point[1]) || !Number.isFinite(point[2])) return;
        this.Stop(ball);
        vec3.copy(ball.mGoto, point);
        if (ball.speedFraction === 0) ball.speedFraction = 1;
        ball.SetMode(Mode.DSTBALL_GOTO);
    }

    /**
     * Normalizes a direction and orders a native destination 1e17 units away.
     * Adaptation: argument shape selects ID/scalars or Ball/vector overloads;
     * components copy by value before callbacks, matching native Vector3d.
     * Source: destiny/src/Ballpark.cpp:4471-4505; destiny/src/Vector3d.h:62-72.
     *
     * @param {bigint|number|CjsDestinyBall|null} id Signed-int64 identity or native Ball reference.
     * @param {number|Float64Array|number[]} x Direction X or the reference overload's vector.
     * @param {number} [y] Direction Y in the scalar overload.
     * @param {number} [z] Direction Z in the scalar overload.
     * @returns {void} No return value.
     */
    @meta.blue.method
    @meta.adapted
    GotoDirection(id, x, y, z)
    {
        const reference = typeof id === "object";
        const ball = reference ? id : this.GetBall(id);
        if (!ball) return;
        if (reference) { z = x[2]; y = x[1]; x = x[0]; }
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return;
        const length = Math.sqrt(x * x + y * y + z * z);
        if (length !== 0) { const inverse = 1 / length; x *= inverse; y *= inverse; z *= inverse; }
        const vec3d_0 = vec3d.alloc();
        try
        {
            vec3.set(vec3d_0, ball.x + x * 1e17, ball.y + y * 1e17, ball.z + z * 1e17);
            this.GotoPoint(ball, vec3d_0);
        }
        finally { vec3d.unalloc(vec3d_0); }
    }

    /**
     * Creates a fixed expanding sphere at its owner's position using native ID zero.
     * Adaptation: checked IDs and existing oriented creation cores replace native
     * objects; range narrows to float32. Core creation's documented JS input and
     * replacement differences also apply. NaN range/duration retain native guards.
     * Source: destiny/src/Ballpark.cpp:3719-3789.
     * @param {bigint|number} ownerId Exact signed owner identity, without absolute lookup.
     * @param {number} range Final radius parameter, rejected only when nonpositive.
     * @param {number} time Growth duration in seconds, rejected only when nonpositive.
     * @returns {void} The created ball remains fixed until SetBallFree is called.
     */
    @meta.blue.method
    @meta.adapted
    AddMushroom(ownerId, range, time)
    {
        ownerId = CjsDestinyBall._toInt64(ownerId);
        range = f32(range);
        if (range <= 0 || time <= 0) { console.warn("Inconsistent parameters for mushroom. Canceled."); return; }
        const owner = this.GetBall(ownerId);
        if (!owner) { console.warn("Non existing parent for mushroom. Canceled."); return; }
        const x = owner.mNewPos[0], y = owner.mNewPos[1], z = owner.mNewPos[2];
        const mushroom = g_useDynamicalOrientation
            ? this.AddDynamicallyOrientedBall(0n, f32(1e20), 0, 0, 0, false, false, true, false, false,
                x, y, z, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 1, 1)
            : this.AddOldStyleOrientedBall(0n, f32(1e20), 0, 0, false, false, true, false, false,
                x, y, z, 0, 0, 0, 1, 1);
        mushroom.mFollowRange = range;
        mushroom.mGoto[0] = time;
        mushroom.mOwnerId = ownerId;
        mushroom.mEffectStamp = this.currentTime;
        mushroom.SetMode(Mode.DSTBALL_MUSHROOM);
    }

    /**
     * Binds the three required mushroom arguments without an evolution guard.
     * Adaptation: positional JS arguments replace Python tuple parsing.
     * Source: destiny/src/Thunkers.cpp:306-325.
     * @param {bigint|number} ownerId Existing signed owner identity.
     * @param {number} range Float32 radius parameter.
     * @param {number} time Double duration in seconds.
     * @returns {void} Delegates to AddMushroom.
     */
    @meta.adapted
    PyAddMushroom(ownerId, range, time)
    {
        if (arguments.length !== 3) throw new TypeError("PyAddMushroom requires 3 arguments");
        this.AddMushroom(ownerId, range, time);
    }

    /**
     * Sets up missile pursuit, tolerating a missing owner but requiring a live target.
     * Adaptation: checked BigInt IDs replace native integers, references/Sets
     * replace pointers/unordered sets, and scalar locals preserve Vector3d values.
     * Minimum int64 owner negation throws instead of native signed overflow.
     * Source: destiny/src/Ballpark.cpp:3798-3872.
     * @param {bigint|number} id Existing missile identity.
     * @param {bigint|number} targetId Target identity; negative is allowed in this core.
     * @param {bigint|number} ownerId Signed owner; negative selects defender collision behavior.
     * @returns {void} Bubble/cloak rejection stops the old command before returning.
     */
    @meta.adapted
    MissileFollow(id, targetId, ownerId)
    {
        id = CjsDestinyBall._toInt64(id); targetId = CjsDestinyBall._toInt64(targetId); ownerId = CjsDestinyBall._toInt64(ownerId);
        if (id === targetId || id === ownerId || targetId === ownerId) return;
        const owner = this.GetBall(ownerId < 0n ? -ownerId : ownerId);
        const ball = this.GetBall(id), target = this.GetBall(targetId);
        if (!ball || !target || target.isMoribund) return;
        if (!owner) console.warn("Non existing missile owner. Tolerated.");
        this.Stop(ball);
        if (ball.mNewBubble !== target.mNewBubble || target.isCloaked) return;
        ball.mFollowId = targetId; ball.mFollowPtr = target;
        ball.mFollowRange = -f32(f32(ball.mRadius) + f32(target.mRadius));
        ball.mOwnerId = ownerId; ball.mEffectStamp = this.currentTime;
        let x = ball.mNewVel[0], y = ball.mNewVel[1], z = ball.mNewVel[2];
        const length = Math.sqrt(x * x + y * y + z * z);
        if (length !== 0) { const inverse = 1 / length; x *= inverse; y *= inverse; z *= inverse; }
        // Native quirk: an absolute launch waypoint, without the missile position.
        vec3.set(ball.mGoto, x * 1e16, y * 1e16, z * 1e16);
        ball.mSpeedFraction = 1;
        ball.SetMode(Mode.DSTBALL_MISSILE);
        target.mFollowers.add(ball.mId);
    }

    /**
     * Applies the Python-only negative-target restriction before missile pursuit.
     * Adaptation: JS arguments and RangeError replace Python parsing/error state.
     * Source: destiny/src/Thunkers.cpp:275-299.
     * @param {bigint|number} id Existing missile identity.
     * @param {bigint|number} targetId Nonnegative target identity.
     * @param {bigint|number} ownerId Signed owner identity.
     * @returns {void} Delegates to the native core after binding checks.
     */
    @meta.adapted
    PyMissileFollow(id, targetId, ownerId)
    {
        if (arguments.length !== 3) throw new TypeError("PyMissileFollow requires 3 arguments");
        id = CjsDestinyBall._toInt64(id); targetId = CjsDestinyBall._toInt64(targetId); ownerId = CjsDestinyBall._toInt64(ownerId);
        if (targetId < 0n) throw new RangeError("Can not MissileFollow a negative ballID");
        this.MissileFollow(id, targetId, ownerId);
    }

    /**
     * Launches an existing ball from an owner, then pursues its target if available.
     * Adaptation: JS positional values replace the required Python tuple and byte
     * flags. Scalar snapshots and a pooled float32 direction survive callbacks;
     * finally releases the direction on error. Checked IDs reject native overflow.
     * Source: destiny/src/Thunkers.cpp:857-946.
     * @param {bigint|number} id Existing source ball identity; never allocated here.
     * @param {bigint|number} targetId Nonnegative target identity.
     * @param {bigint|number} ownerId Signed launcher identity, looked up by absolute value.
     * @param {boolean|number} aimedLaunch Byte flag; only one requests aimed launch.
     * @param {boolean|number} massive Byte flag; nonzero sets massiveness, zero retains it.
     * @returns {void} Missing launcher is a no-op; missing/cloaked targets may leave updated motion.
     */
    @meta.adapted
    PyLaunchMissile(id, targetId, ownerId, aimedLaunch, massive)
    {
        if (arguments.length !== 5) throw new TypeError("PyLaunchMissile requires 5 arguments");
        id = CjsDestinyBall._toInt64(id); targetId = CjsDestinyBall._toInt64(targetId); ownerId = CjsDestinyBall._toInt64(ownerId);
        if (typeof aimedLaunch === "boolean") aimedLaunch = Number(aimedLaunch);
        if (typeof massive === "boolean") massive = Number(massive);
        if (!Number.isInteger(aimedLaunch) || aimedLaunch < 0 || aimedLaunch > 255
            || !Number.isInteger(massive) || massive < 0 || massive > 255)
            throw new RangeError("LaunchMissile flags must fit unsigned bytes");
        if (targetId < 0n) throw new RangeError("Can not launch missile on a negative ballID");
        const launcher = this.GetBall(ownerId < 0n ? -ownerId : ownerId);
        if (!launcher) return;
        const target = targetId !== ownerId ? this.GetBall(targetId) : null;
        const px = launcher.mNewPos[0], py = launcher.mNewPos[1], pz = launcher.mNewPos[2];
        let maxVelocity = 0, vx, vy, vz;
        if (target && aimedLaunch === 1 && !target.isCloaked)
        {
            vx = target.mNewPos[0] - px; vy = target.mNewPos[1] - py; vz = target.mNewPos[2] - pz;
            const length = Math.sqrt(vx * vx + vy * vy + vz * vz);
            if (length !== 0) { const inverse = 1 / length; vx *= inverse; vy *= inverse; vz *= inverse; }
        }
        else
        {
            const x = launcher.mNewVel[0], y = launcher.mNewVel[1], z = launcher.mNewVel[2];
            maxVelocity = launcher.mMaxVel;
            let dx = x, dy = y, dz = z;
            const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
            if (length !== 0) { const inverse = 1 / length; dx *= inverse; dy *= inverse; dz *= inverse; }
            if (dx * dx + dy * dy + dz * dz === 0)
            {
                const vec3_0 = vec3.alloc();
                try
                {
                    vec3.set(vec3_0, 0, 0, -1);
                    launcher.GetRotatedVector(vec3_0);
                    dx = vec3_0[0]; dy = vec3_0[1]; dz = vec3_0[2];
                }
                finally { vec3.unalloc(vec3_0); }
            }
            const speed = 150 < maxVelocity ? maxVelocity : 150;
            vx = x + speed * dx; vy = y + speed * dy; vz = z + speed * dz;
        }
        if (massive) this.SetBallMassive(id, true);
        this.SetBallPosition(id, px, py, pz);
        this.SetBallVelocity(id, vx, vy, vz);
        if (target && target.isCloaked) return;
        if (!target)
        {
            if (maxVelocity > 0) this.GotoDirection(id, vx, vy, vz);
        }
        else this.MissileFollow(id, targetId, ownerId);
    }

    /**
     * Exposes Carbon's Blue LaunchMissile name on the Python-shaped implementation.
     * Adaptation: an explicit delegate replaces the native Blue method alias.
     * Source: destiny/src/Ballpark_Blue.cpp:695-700.
     * @param {...unknown} args The five required PyLaunchMissile arguments.
     * @returns {void} Launches the existing source without creating a ball.
     */
    @meta.blue.renamed("PyLaunchMissile")
    @meta.adapted
    LaunchMissile(...args)
    {
        if (args.length !== 5) throw new TypeError("LaunchMissile requires 5 arguments");
        this.PyLaunchMissile(...args);
    }

    /**
     * Follows a valid uncloaked target in the same native bubble.
     * Adaptation: JS references/Sets replace native pointers/unordered sets; float
     * narrowing and the Python wrapper's default range are retained. This core
     * allows negative IDs; PyFollowBall applies the separate Python restriction.
     * Source: destiny/src/Ballpark.cpp:3878-3945; destiny/src/Thunkers.cpp:244-269.
     *
     * @param {bigint|number} id Signed-int64 ball identity; Number inputs must be safe integers.
     * @param {bigint|number} targetId Signed-int64 target identity; Number inputs must be safe integers.
     * @param {number} [range] Surface separation in meters.
     * @returns {void} No return value.
     */
    @meta.blue.method
    @meta.adapted
    FollowBall(id, targetId, range = 1)
    {
        range = Math.fround(range);
        if (!Number.isFinite(range)) return;
        const ball = this.GetBall(id);
        if (!ball) return;
        targetId = CjsDestinyBall._toInt64(targetId);
        if (ball.id === targetId) return;
        const target = this.GetBall(targetId);
        if (!target || target.isMoribund || ball.mNewBubble !== target.mNewBubble || target.isCloaked) return;
        this.Stop(ball);
        ball.followId = target.id;
        ball._followPtr = target;
        ball.followRange = range;
        ball.SetMode(Mode.DSTBALL_FOLLOW);
        if (target._followers.has(ball.id)) console.error("FollowBall: ball already flagged as follower", ball.id, target.id);
        target._followers.add(ball.id);
    }

    /**
     * Orbits a valid uncloaked target in the same native bubble.
     * Adaptation: JS references/Sets replace native pointers/unordered sets; float
     * narrowing and the Python default range are retained. PyOrbit separately
     * applies the Python negative-target-ID restriction.
     * Source: destiny/src/Ballpark.cpp:4006-4071; destiny/src/Thunkers.cpp:330-355.
     *
     * @param {bigint|number} id Signed-int64 ball identity; Number inputs must be safe integers.
     * @param {bigint|number} targetId Signed-int64 target identity; Number inputs must be safe integers.
     * @param {number} [range] Surface separation in meters.
     * @returns {void} No return value.
     */
    @meta.blue.method
    @meta.adapted
    Orbit(id, targetId, range = 1)
    {
        range = Math.fround(range);
        if (!Number.isFinite(range)) return;
        const ball = this.GetBall(id);
        if (!ball) return;
        targetId = CjsDestinyBall._toInt64(targetId);
        if (ball.id === targetId) return;
        const target = this.GetBall(targetId);
        if (!target || target.isMoribund || ball.mNewBubble !== target.mNewBubble || target.isCloaked) return;
        this.Stop(ball);
        ball.followId = target.id;
        ball._followPtr = target;
        ball.followRange = range;
        ball.SetMode(Mode.DSTBALL_ORBIT);
        target._followers.add(ball.id);
    }

    /**
     * Stops the ball through the native mode-change callback path, retaining velocity.
     * Adaptation: argument shape selects native ID or pointer overloads. JS references
     * and Sets replace native pointers/sets. A broken native follow pointer throws
     * instead of invoking the native assertion; logging uses console diagnostics.
     * Source: destiny/src/Ballpark.cpp:4556-4643.
     *
     * @param {bigint|number|CjsDestinyBall} id Signed-int64 identity or native Ball reference.
     * @returns {void} No return value.
     */
    @meta.blue.method
    @meta.adapted
    Stop(id)
    {
        const reference = typeof id === "object";
        const ball = reference ? id : this.GetBall(id);
        if (!reference && (!ball || ball.mMode === Mode.DSTBALL_STOP)) return;
        const mode = ball.mMode;
        if (mode === Mode.DSTBALL_FOLLOW || mode === Mode.DSTBALL_ORBIT
            || mode === Mode.DSTBALL_MISSILE || mode === Mode.DSTBALL_FORMATION)
        {
            if (!ball.mFollowPtr) throw new Error("Stop: native follow mode requires a target pointer");
            let found = false;
            if (this.isMaster) found = ball.mFollowPtr.mFollowers.delete(ball.mId);
            else
            {
                const target = this.GetBall(ball.mFollowId);
                if (!target) console.error("Stop: followId does not identify a ball", ball.mId, ball.mFollowId);
                else if (target !== ball.mFollowPtr) console.error("Stop: follow pointer does not match followId", ball.mId);
                else found = target.mFollowers.delete(ball.mId);
            }
            if (!found) console.warn("Stop: ball was absent from target followers", ball.mId);
            if (this.isMaster && ball.mMode === Mode.DSTBALL_FORMATION)
                ball.mFollowPtr.FreeFormationSlot(ball.mEffectStamp);
            ball.mEffectStamp = 0;
            ball.mFollowPtr = null;
            ball.mFollowId = 0n;
            ball.mOwnerId = 0n;
            ball.mFollowRange = 0;
        }
        ball.SetMode(Mode.DSTBALL_STOP);
    }

    /**
     * Stops the old command and selects rigid mode without changing free membership.
     * Adaptation: checked BigInt identity and JS references replace native map access.
     * Source: destiny/src/Ballpark.cpp:6278-6289.
     * @param {bigint|number} id Ball identity.
     * @returns {void} Missing balls are ignored.
     */
    @meta.blue.method
    @meta.adapted
    SetBallRigid(id)
    {
        const ball = this.GetBall(id);
        if (!ball) return;
        this.Stop(ball);
        ball.SetMode(Mode.DSTBALL_RIGID);
    }

    /**
     * Makes a ball free and interactive until its delayed petrification tick.
     * Adaptation: JS checked integers reject native signed overflow; callbacks
     * retain native Stop/free/interactive/stamp/mode ordering.
     * Source: destiny/src/Ballpark.cpp:6290-6313.
     * @param {bigint|number} id Ball identity.
     * @param {number} delay Signed-int32 tick count, clamped to at least one.
     * @returns {void} Existing velocity survives entry into troll mode.
     */
    @meta.blue.method
    @meta.adapted
    SetBallTroll(id, delay)
    {
        if (!Number.isInteger(delay) || delay < -2147483648 || delay > 2147483647)
            throw new RangeError("Troll delay must fit native int32");
        const ball = this.GetBall(id);
        if (!ball) return;
        delay = Math.max(1, delay);
        this.Stop(ball);
        this.SetBallFree(id, true);
        this.SetBallInteractive(id, true);
        const stamp = this.currentTime + delay;
        if (!Number.isInteger(stamp) || stamp < -2147483648 || stamp > 2147483647)
            throw new RangeError("Troll deadline exceeds native signed-int32 arithmetic");
        ball.mEffectStamp = stamp;
        ball.SetMode(Mode.DSTBALL_TROLL);
    }

    /**
     * Tests native troll mode and an inclusive deadline using the current tick.
     * Source: destiny/src/Ballpark.cpp:6315-6326.
     * @param {CjsDestinyBall} ball Ball to inspect.
     * @returns {boolean} Whether its troll deadline has arrived.
     */
    @meta.implemented
    TrollReady(ball)
    {
        if (ball.mMode !== Mode.DSTBALL_TROLL) return false;
        if (ball.mEffectStamp > this.currentTime) return false;
        return true;
    }

    /**
     * Rechecks a queued troll, fixes it in space, then selects rigid mode.
     * Adaptation: JS references replace native pointers; setters retain callbacks
     * and child-shape attachment. Native RIGID wins over the header's STOP claim.
     * Native quirk: child insertion during Evolve skips aggregate map registration.
     * Source: destiny/src/Ballpark.cpp:6327-6337; destiny/src/Ballpark.h:670-676.
     * @param {CjsDestinyBall} ball Previously queued troll reference.
     * @returns {void} Readiness failure leaves the ball unchanged.
     */
    @meta.adapted
    PetrifyTroll(ball)
    {
        if (!this.TrollReady(ball)) return;
        this.SetBallFree(ball.mId, false);
        this.SetBallInteractive(ball.mId, false);
        ball.SetMode(Mode.DSTBALL_RIGID);
    }

    /**
     * Stores collision affiliation before optional field-mode transitions.
     * Adaptation: checked BigInt/int32 inputs replace native scalar arguments;
     * direct backing-field writes avoid JS property notification recursion.
     * Source: destiny/src/Ballpark.cpp:4852-4880.
     * @param {bigint|number} id Ball identity.
     * @param {bigint|number} harmonic Native signed-int64 harmonic value.
     * @param {number} corporationID Native signed-int32 corporation value.
     * @param {number} allianceID Native signed-int32 alliance value.
     * @param {boolean} field Whether to enter FIELD mode.
     * @returns {void} Disabling FIELD stops it; other modes remain unchanged.
     */
    @meta.blue.method
    @meta.adapted
    SetBallHarmonic(id, harmonic, corporationID, allianceID, field)
    {
        harmonic = CjsDestinyBall._toInt64(harmonic);
        for (const value of [corporationID, allianceID])
            if (!Number.isInteger(value) || value < -2147483648 || value > 2147483647)
                throw new RangeError("Collision affiliation must fit native int32");
        const ball = this.GetBall(id);
        if (!ball) return;
        ball.mHarmonic = harmonic;
        ball.mCorporationID = corporationID;
        ball.mAllianceID = allianceID;
        if (field) { this.Stop(ball); ball.SetMode(Mode.DSTBALL_FIELD); }
        else if (ball.mMode === Mode.DSTBALL_FIELD) this.Stop(ball);
    }

    /**
     * Binds the required rigid command argument before calling the native core.
     * Adaptation: positional JS arguments replace Python tuple parsing.
     * Source: destiny/src/Thunkers.cpp:510-524.
     * @param {bigint|number} id Ball identity.
     * @returns {void} Delegates to SetBallRigid.
     */
    @meta.adapted
    PySetBallRigid(id)
    {
        if (arguments.length !== 1) throw new TypeError("PySetBallRigid requires 1 argument");
        this.SetBallRigid(id);
    }

    /**
     * Binds the required troll identity and delay before calling the native core.
     * Adaptation: positional JS arguments replace Python tuple parsing.
     * Source: destiny/src/Thunkers.cpp:530-547.
     * @param {bigint|number} id Ball identity.
     * @param {number} delay Signed-int32 tick delay.
     * @returns {void} Delegates to SetBallTroll.
     */
    @meta.adapted
    PySetBallTroll(id, delay)
    {
        if (arguments.length !== 2) throw new TypeError("PySetBallTroll requires 2 arguments");
        this.SetBallTroll(id, delay);
    }

    /**
     * Binds harmonic fields and converts the Python integer field flag to bool.
     * Adaptation: JS arguments, checked values and exceptions replace tuple parsing.
     * Source: destiny/src/Thunkers.cpp:952-975.
     * @param {bigint|number} id Ball identity.
     * @param {bigint|number} harmonic Signed-int64 harmonic.
     * @param {number} corporationID Signed-int32 corporation.
     * @param {number} allianceID Signed-int32 alliance.
     * @param {number|boolean} field Nonzero selects field mode.
     * @returns {void} Delegates to SetBallHarmonic.
     */
    @meta.adapted
    PySetBallHarmonic(id, harmonic, corporationID, allianceID, field)
    {
        if (arguments.length !== 5) throw new TypeError("PySetBallHarmonic requires 5 arguments");
        if (typeof field === "boolean") field = Number(field);
        if (!Number.isInteger(field) || field < -2147483648 || field > 2147483647)
            throw new RangeError("Field flag must fit native int32");
        this.SetBallHarmonic(id, harmonic, corporationID, allianceID, field !== 0);
    }

    /**
     * Selects passive boid mode or stops the ball, matching the Python-only donor.
     * Adaptation: JS positional arguments and checked integers replace tuple parsing.
     * Source: destiny/src/Thunkers.cpp:1003-1026.
     * @param {bigint|number} id Ball identity.
     * @param {number|boolean} turnOn Nonzero selects BOID without stopping first.
     * @returns {void} Missing balls are ignored.
     */
    @meta.adapted
    PySetBoid(id, turnOn)
    {
        if (arguments.length !== 2) throw new TypeError("PySetBoid requires 2 arguments");
        if (typeof turnOn === "boolean") turnOn = Number(turnOn);
        if (!Number.isInteger(turnOn) || turnOn < -2147483648 || turnOn > 2147483647)
            throw new RangeError("Boid flag must fit native int32");
        const ball = this.GetBall(id);
        if (ball) { if (turnOn) ball.SetMode(Mode.DSTBALL_BOID); else this.Stop(ball); }
    }

    /**
     * Exposes the Blue name for the Python-only boid command.
     * Adaptation: explicit delegation replaces Carbon's method alias.
     * Source: destiny/src/Ballpark_Blue.cpp:599-604.
     * @param {...unknown} args Two required PySetBoid arguments.
     * @returns {void} Delegates without inventing flocking behavior.
     */
    @meta.blue.renamed("PySetBoid")
    @meta.adapted
    SetBoid(...args)
    {
        if (args.length !== 2) throw new TypeError("SetBoid requires 2 arguments");
        this.PySetBoid(...args);
    }

    /**
     * Changes collision participation without reinsertion or other side effects.
     * Adaptation: JS Boolean conversion represents the native bool argument.
     * Source: destiny/src/Ballpark.cpp:5074-5085.
     * @param {bigint|number} id Existing ball identity.
     * @param {boolean} flag New massiveness flag.
     * @returns {void} Missing balls are ignored.
     */
    @meta.blue.method
    @meta.adapted
    SetBallMassive(id, flag)
    {
        const ball = this.GetBall(id);
        if (ball) ball.isMassive = Boolean(flag);
    }

    /**
     * Adaptation: scalar accessors update native vectors with a finite input guard.
     * Native spatial membership and bubble transitions are refreshed afterward.
     *
     * @param {bigint|number} id Signed-int64 ball identity; Number inputs must be safe integers.
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
        this.InsertBallInBoxes(ball);
    }

    /**
     * Adaptation: scalar old/new velocities and the existing finite input guard.
     * Native settings select SnapOrientation or the legacy yaw/pitch/roll path.
     *
     * @param {bigint|number} id Signed-int64 ball identity; Number inputs must be safe integers.
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
        if (g_useDynamicalOrientation) ball.SnapOrientation();
        else ball.CalculateYawPitchRoll(true);
    }

    /**
     * Assigns both angular velocity samples to suppress interpolation discontinuity.
     * Adaptation: factory-owned outputs narrow doubles to native float32 values.
     * Source: destiny/src/Ballpark.cpp:4802-4817.
     * @param {bigint|number} id Ball identity.
     * @param {number} wx Angular velocity X in radians per second.
     * @param {number} wy Angular velocity Y in radians per second.
     * @param {number} wz Angular velocity Z in radians per second.
     * @returns {void} Missing balls are ignored.
     */
    @meta.blue.method
    @meta.adapted
    SetBallAngularVelocity(id, wx, wy, wz)
    {
        const ball = this.GetBall(id);
        if (!ball) return;
        vec3.set(ball.mNewAngVel, wx, wy, wz);
        vec3.copy(ball.mOldAngVel, ball.mNewAngVel);
    }

    /**
     * Normalizes a supplied rotation and clears old/new angular motion.
     * Adaptation: float32 scratch replaces the temporary native quaternion.
     * Source: destiny/src/Ballpark.cpp:4819-4846.
     * @param {bigint|number} id Ball identity.
     * @param {number} rx Quaternion X.
     * @param {number} ry Quaternion Y.
     * @param {number} rz Quaternion Z.
     * @param {number} rw Quaternion W.
     * @returns {void} Norms at or below 1e-20 and unordered NaN are ignored.
     */
    @meta.blue.method
    @meta.adapted
    SetBallRotation(id, rx, ry, rz, rw)
    {
        const ball = this.GetBall(id);
        if (!ball) return;
        const { quat_0 } = CjsBallparkController.scratch;
        quat.set(quat_0, rx, ry, rz, rw);
        const length = f32(Math.sqrt(f32(f32(f32(f32(quat_0[0] * quat_0[0]) + f32(quat_0[1] * quat_0[1])) + f32(quat_0[2] * quat_0[2])) + f32(quat_0[3] * quat_0[3]))));
        if (!(length > 1e-20)) return;
        quat.scale(quat_0, quat_0, f32(1 / length));
        quat.copy(ball.mNewRot, quat_0);
        quat.copy(ball.mOldRot, quat_0);
        vec3.zero(ball.mNewAngVel);
        vec3.zero(ball.mOldAngVel);
    }

    /**
     * Sets the physical angular speed limit independently of visual impact speed.
     * Adaptation: rounds the native float argument. Native NaN acceptance is retained.
     * Source: destiny/src/Ballpark.cpp:4721-4732.
     * @param {bigint|number} id Ball identity.
     * @param {number} maxAngVel Maximum angular speed in radians per second.
     * @returns {void} Negative limits and missing balls are ignored.
     */
    @meta.blue.method
    @meta.adapted
    SetMaxAngularSpeed(id, maxAngVel)
    {
        maxAngVel = f32(maxAngVel);
        if (maxAngVel < 0) return;
        const ball = this.GetBall(id);
        if (ball) ball.mMaxAngVel = maxAngVel;
    }

    /**
     * Sets rotational agility without changing translational drag caches.
     * Adaptation: rounds the native float argument. Native NaN acceptance is retained.
     * Source: destiny/src/Ballpark.cpp:4958-4966.
     * @param {bigint|number} id Ball identity.
     * @param {number} rotAgility Rotational agility modifier.
     * @returns {void} Nonpositive values and missing balls are ignored.
     */
    @meta.blue.method
    @meta.adapted
    SetBallAngularAgility(id, rotAgility)
    {
        const ball = this.GetBall(id);
        rotAgility = f32(rotAgility);
        if (!ball || rotAgility <= 0) return;
        ball.mRotAgility = rotAgility;
    }

    /**
     * Adaptation: finite mass guard before recomputing cached drag.
     *
     * @param {bigint|number} id Signed-int64 ball identity; Number inputs must be safe integers.
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
     * Sets native float radius and reinserts either an ID lookup or a Ball reference.
     * Adaptation: argument shape selects the native overload; reference calls work
     * for balls absent from the aggregate map. Only negative radii are rejected.
     * Source: destiny/src/Ballpark.cpp:4673-4696.
     * @param {bigint|number|CjsDestinyBall|null} id Identity or direct Ball reference.
     * @param {number} radius Radius in meters, narrowed to float32.
     * @returns {void} Mutates the native backing field before insertion callbacks.
     */
    @meta.blue.method
    @meta.adapted
    SetBallRadius(id, radius)
    {
        const ball = typeof id === "object" ? id : this.GetBall(id);
        radius = f32(radius);
        if (!ball || radius < 0) return;
        ball.mRadius = radius;
        this.InsertBallInBoxes(ball);
    }

    /**
     * Sets a double destination-notification range and resets its within flag.
     * Adaptation: direct JS arguments and checked IDs replace native binding values.
     * Source: destiny/src/Ballpark.cpp:5026-5041.
     * @param {bigint|number} id Ball identity.
     * @param {number} notificationRange Range in meters; only negative values are ignored.
     * @returns {void} Registration updates before the within flag is reset.
     */
    @meta.blue.method
    @meta.adapted
    SetNotificationRange(id, notificationRange)
    {
        const ball = this.GetBall(id);
        if (!ball || notificationRange < 0) return;
        ball.mNotificationRange = notificationRange;
        ball.UpdateProximityStatus();
        ball.mWithinRange = false;
    }

    /**
     * Tracks a target pointer independently of follower commands and target radius.
     * Adaptation: JS references and checked BigInt IDs replace native pointers.
     * Native quirk: cancellation retains registration and the prior within flag.
     * Source: destiny/src/Ballpark.cpp:5043-5068.
     * @param {bigint|number} id Source identity.
     * @param {bigint|number} targetId Target identity; zero cancels tracking.
     * @param {number} trackingRange Double range; nonpositive cancels tracking.
     * @returns {void} A missing target leaves prior tracking unchanged.
     */
    @meta.blue.method
    @meta.adapted
    SetTargetTracking(id, targetId, trackingRange)
    {
        const ball = this.GetBall(id);
        if (!ball) return;
        targetId = CjsDestinyBall._toInt64(targetId);
        if (trackingRange <= 0 || targetId === 0n)
        {
            ball.mTrackingPtr = null; ball.mTrackingRange = 0;
            return;
        }
        const target = this.GetBall(targetId);
        if (!target) return;
        ball.mTrackingPtr = target; ball.mTrackingRange = trackingRange;
        ball.UpdateProximityStatus(); ball.mWithinTrackingRange = false;
    }

    /**
     * Activates an existing ball's sensor without exposing the core status result.
     * Adaptation: JS defaults reflect Python defaults; checked IDs replace native IDs.
     * Source: destiny/src/Ballpark.cpp:5120-5134; Thunkers.cpp:1284-1307.
     * @param {bigint|number} id Sensor ball identity.
     * @param {number} range Float32 surface range.
     * @param {number} [period=2] Scan period in seconds.
     * @param {number|boolean} [shuffle=0] Nonzero shuffles initial elapsed time.
     * @param {boolean} [onlyInteractives=false] Interactive-only candidate filter.
     * @returns {void} Missing balls and rejected combined radii are ignored.
     */
    @meta.blue.method
    @meta.adapted
    AddProximitySensor(id, range, period = 2, shuffle = 0, onlyInteractives = false)
    {
        const ball = this.GetBall(id);
        if (ball) ball.AddProximitySensor(range, period, shuffle, onlyInteractives);
    }

    /**
     * Disables an existing sensor while preserving notification/tracking registration.
     * Adaptation: checked JS identity replaces native map lookup.
     * Source: destiny/src/Ballpark.cpp:5140-5150.
     * @param {bigint|number} id Sensor ball identity.
     * @returns {void} Missing balls are ignored.
     */
    @meta.blue.method
    @meta.adapted
    RemoveProximitySensor(id)
    {
        const ball = this.GetBall(id);
        if (ball) ball.RemoveProximitySensor();
    }

    /**
     * Binds Python sensor defaults and discards the Ball core's rejection code.
     * Adaptation: explicit JS arity/integer checks replace native tuple parsing.
     * Source: destiny/src/Thunkers.cpp:1284-1307.
     * @param {bigint|number} id Sensor identity.
     * @param {number} range Float32 sensor range.
     * @param {number} [period=2] Period in seconds.
     * @param {number|boolean} [shuffle=0] Signed-int32 shuffle flag.
     * @param {number|boolean} [onlyInteractives=0] Unsigned-byte interactive flag.
     * @returns {void} Missing balls and native sensor rejection return no value.
     */
    @meta.adapted
    PyAddProximitySensor(id, range, period = 2, shuffle = 0, onlyInteractives = 0)
    {
        if (arguments.length < 2 || arguments.length > 5) throw new TypeError("PyAddProximitySensor requires 2 to 5 arguments");
        id = CjsDestinyBall._toInt64(id);
        if (typeof shuffle === "boolean") shuffle = Number(shuffle);
        if (typeof onlyInteractives === "boolean") onlyInteractives = Number(onlyInteractives);
        if (!Number.isInteger(shuffle) || shuffle < -2147483648 || shuffle > 2147483647
            || !Number.isInteger(onlyInteractives) || onlyInteractives < 0 || onlyInteractives > 255)
            throw new RangeError("Sensor flags exceed native integer storage");
        this.AddProximitySensor(id, range, period, shuffle, onlyInteractives !== 0);
    }

    /**
     * Binds the single required sensor-removal identity.
     * Adaptation: JS arity checking replaces Python tuple parsing.
     * Source: destiny/src/Thunkers.cpp:1312-1327.
     * @param {bigint|number} id Sensor identity.
     * @returns {void} Delegates to RemoveProximitySensor.
     */
    @meta.adapted
    PyRemoveProximitySensor(id)
    {
        if (arguments.length !== 1) throw new TypeError("PyRemoveProximitySensor requires 1 argument");
        this.RemoveProximitySensor(id);
    }

    /**
     * Binds the required notification identity and double range.
     * Adaptation: JS arity checking replaces Python tuple parsing.
     * Source: destiny/src/Thunkers.cpp:732-748.
     * @param {bigint|number} id Ball identity.
     * @param {number} range Destination range.
     * @returns {void} Delegates to SetNotificationRange.
     */
    @meta.adapted
    PySetNotificationRange(id, range)
    {
        if (arguments.length !== 2) throw new TypeError("PySetNotificationRange requires 2 arguments");
        this.SetNotificationRange(id, range);
    }

    /**
     * Binds the two tracking identities and required double range.
     * Adaptation: checked JS IDs and arity replace Python tuple parsing.
     * Source: destiny/src/Thunkers.cpp:754-770.
     * @param {bigint|number} id Source identity.
     * @param {bigint|number} targetId Target identity.
     * @param {number} range Tracking range.
     * @returns {void} Delegates to SetTargetTracking.
     */
    @meta.adapted
    PySetTargetTracking(id, targetId, range)
    {
        if (arguments.length !== 3) throw new TypeError("PySetTargetTracking requires 3 arguments");
        id = CjsDestinyBall._toInt64(id); targetId = CjsDestinyBall._toInt64(targetId);
        this.SetTargetTracking(id, targetId, range);
    }

    /**
     * Checks a registration snapshot, giving inactive bubbles one final populated scan.
     * Adaptation: strong JS references replace native Lock/Unlock; snapshot iteration
     * uses Map insertion order rather than unordered-map traversal. Callback additions
     * wait for the next pass. Removed/detached entries retain native entry checks.
     * Source: destiny/src/Ballpark.cpp:5822-5867.
     * @returns {void} Dead bubbles clear remembered sensor contacts after the check.
     */
    @meta.adapted
    HandleProximities()
    {
        const copy = Array.from(this.mProximityBalls.values());
        for (const ball of copy)
        {
            if (ball.isMoribund) continue;
            if (this.InDeadBubble(ball))
            {
                if (ball.mSensor.balls.size > 0)
                {
                    ball.mSensor.elapsed = ball.mSensor.period;
                    ball.CheckForProximity();
                }
                ball.mSensor.balls.clear();
                continue;
            }
            if (!ball.mHasProximity) continue;
            ball.CheckForProximity();
        }
    }

    /**
     * Adaptation: finite native f32 input guard before native spatial reinsertion.
     *
     * @param {bigint|number} id Signed-int64 ball identity; Number inputs must be safe integers.
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
        this.InsertBallInBoxes(ball);
    }

    /**
     * Adaptation: finite native f32 input guard before recomputing cached drag.
     *
     * @param {bigint|number} id Signed-int64 ball identity; Number inputs must be safe integers.
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
        ball._timeFactor = mass <= 0 ? 0 : Math.exp(-this.mFriction * this.dt / mass);
    }

    /**
     * Native throttle clamp; f32 conversion models the native argument type.
     * Adaptation: GetBall checks and normalizes JavaScript ID inputs.
     *
     * @param {bigint|number} id Signed-int64 ball identity; Number inputs must be safe integers.
     * @param {number} fraction Requested fraction of maximum speed.
     * @returns {void} No return value.
     */
    @meta.blue.method
    @meta.adapted
    SetSpeedFraction(id, fraction)
    {
        const ball = this.GetBall(id);
        fraction = Math.fround(fraction);
        if (!ball || !Number.isFinite(fraction)) return;
        ball.speedFraction = Math.min(1, Math.max(0, fraction));
    }

    /**
     * Updates native free membership and removes/recreates fixed-parent mini colliders.
     * Adaptation: JS ordered collections replace native maps and pointer ownership;
     * checked BigInt timestamp subtraction rejects signed overflow before changing the flag.
     *
     * @param {bigint|number} id Signed-int64 ball identity; Number inputs must be safe integers.
     * @param {boolean} isFree Whether the ball can move.
     * @returns {void} No return value.
     */
    @meta.blue.method
    @meta.adapted
    SetBallFree(id, isFree)
    {
        const ball = this.GetBall(id);
        if (!ball || ball.isFree === Boolean(isFree)) return;
        if (isFree) CjsDestinyBall._toInt64(this.time - CjsBallparkController._tickTime(this.tickInterval));
        ball.isFree = Boolean(isFree);
        if (ball.isFree)
        {
            this._insertFreeBall(ball);
            ball.RemoveMiniBalls();
            ball.RemoveMiniCapsules();
            ball.RemoveMiniBoxes();
            ball.mNewTime = CjsDestinyBall._toInt64(this.time - CjsBallparkController._tickTime(this.tickInterval));
        }
        else
        {
            this.Stop(ball);
            this.SetBallVelocity(id, 0, 0, 0);
            this._removeFreeBall(ball.mId);
            this.InsertBallInBoxes(ball);
            ball._lastGx = ball._lastGy = ball._lastGz = 0;
            ball.AddMiniBalls();
            ball.AddMiniCapsules();
            ball.AddMiniBoxes();
        }
    }


    /**
     * Finds and applies the next impact, updating the neighbor before this ball.
     * Adaptation: Maps replace native dictionaries; missing candidate arrays are
     * created explicitly for native operator[]. JS records own their math values.
     * Source: destiny/src/Ballpark.cpp:1988-2076.
     * @param {CjsDestinyBall|null} ball Ball being searched.
     * @param {bigint|number} collisionIteration Zero fetches candidates; later passes reuse them.
     * @returns {boolean} Whether a non-sentinel impact was passed to AddImpact.
     */
    @meta.adapted
    CalculateCollisionResponse(ball, collisionIteration)
    {
        if (!ball)
        {
            console.warn("CalculateCollisionResponses called with a null pointer for ball");
            return false;
        }
        let ballProperties = this.mCollisionLocations.get(ball.mId);
        if (!ballProperties)
        {
            ballProperties = new CollisionBallProperties();
            this.mCollisionLocations.set(ball.mId, ballProperties);
            ballProperties.Initialize(ball, this.dt);
        }
        if (collisionIteration === 0 || collisionIteration === 0n)
        {
            if (!this.mPotentialCollisionBalls.has(ball.mId)) this.mPotentialCollisionBalls.set(ball.mId, []);
            if (!this.mPotentialCollidables.has(ball.mId)) this.mPotentialCollidables.set(ball.mId, []);
            this.mPartition.GetCollisionCandidates(ball, this.mPotentialCollisionBalls.get(ball.mId),
                this.mPotentialCollidables.get(ball.mId), this.isMaster);
        }
        if (ballProperties.m_tStart >= ballProperties.m_tEnd)
        {
            ballProperties.CalculateEnd();
            return false;
        }
        if (ballProperties.m_locations[0].collider !== -1n) return false;
        if (!this.mPotentialCollisionBalls.has(ball.mId)) this.mPotentialCollisionBalls.set(ball.mId, []);
        if (!this.mPotentialCollidables.has(ball.mId)) this.mPotentialCollidables.set(ball.mId, []);
        const balls = this.mPotentialCollisionBalls.get(ball.mId);
        const collidables = this.mPotentialCollidables.get(ball.mId);
        if (balls.length === 0 && collidables.length === 0) return false;
        const frame = CjsBallparkController._allocCollisionFrame();
        const collisionItem = frame.collisionItem;
        try
        {
            let neighborCollision = null;
            this.GetNextCollisionStatic(ballProperties, collisionItem, balls, collidables);
            if (collisionItem.timeOfImpact !== ballProperties.m_tStart)
                this.GetNextCollisionFree(ballProperties, collisionItem, balls, collisionIteration);
            if (collisionItem.collider !== null)
            {
                if (collisionItem.mbIndex2 === -2) this.CalculateCollisionImpactStatic(ballProperties, collisionItem);
                else neighborCollision = this.CalculateCollisionImpactFree(ballProperties,
                    this.mCollisionLocations.get(collisionItem.collider.mId), collisionItem);
                if (neighborCollision && neighborCollision.impact && neighborCollision.impact.collider !== -1n)
                    this.AddImpact(neighborCollision.impact, collisionIteration, neighborCollision.collider);
                if (collisionItem.impact && collisionItem.impact.collider !== -1n)
                {
                    this.AddImpact(collisionItem.impact, collisionIteration, ball);
                    ballProperties.CalculateEnd();
                    return true;
                }
            }
            ballProperties.CalculateEnd();
            return false;
        }
        finally
        {
            collisionItem.collider = collisionItem.impact = null;
            CjsBallparkController.collisionFrames.push(frame);
        }
    }

    /**
     * Searches static shapes, then fixed balls in native candidate order.
     * Adaptation: a pooled frame replaces stack vectors and reference outputs;
     * native unused miniball-vector scaffolding is omitted. Static hits leave
     * mbIndex2 untouched, relying on a new CollisionItem's -2 default.
     * Source: destiny/src/Ballpark.cpp:2080-2178.
     * @param {CollisionBallProperties} ballProp Current trajectory and search interval.
     * @param {CollisionItem} collisionItem Mutable best collision.
     * @param {CjsDestinyBall[]} balls Candidates, including free balls to skip.
     * @param {CjsDestinyStaticCollidable[]} collidables Shape candidates.
     * @returns {void} Updates the best collision when a candidate qualifies.
     */
    @meta.adapted
    GetNextCollisionStatic(ballProp, collisionItem, balls, collidables)
    {
        const ball = ballProp.m_ball;
        const frame = CjsBallparkController._allocCollisionFrame();
        const { vec3d_0, vec3d_1, vec3d_4, vec3d_5 } = frame;
        try
        {
            ballProp.CalculatePosition(vec3d_0, vec3d_4, ballProp.m_tStart);
            ballProp.CalculatePosition(vec3d_1, vec3d_4, ballProp.m_tEnd);
            if (ball.mMode !== Mode.DSTBALL_MISSILE && ball.mMode !== Mode.DSTBALL_MUSHROOM)
            {
                for (const collidable of collidables)
                {
                    vec3.zero(frame.hit.normal);
                    frame.hit.timeOfImpact = 0;
                    if (collidable.CheckCollision(vec3d_0, vec3d_1, ball.mRadius, frame.hit))
                    {
                        const fraction = frame.hit.timeOfImpact;
                        if (ballProp.IgnoreCollision(collidable.mId, fraction)) continue;
                        const time = ballProp.m_tStart + (ballProp.m_tEnd - ballProp.m_tStart) * fraction;
                        if (collisionItem.timeOfImpact < 0 || time < collisionItem.timeOfImpact)
                        {
                            vec3.copy(collisionItem.normal, frame.hit.normal);
                            collisionItem.collider = collidable;
                            collisionItem.timeOfImpact = time;
                            collisionItem.mbIndex1 = -1;
                            collisionItem.impact = null;
                        }
                    }
                    if (collisionItem.timeOfImpact === ballProp.m_tStart) break;
                }
            }
            if (collisionItem.timeOfImpact !== ballProp.m_tStart)
            {
                for (const neighbor of balls)
                {
                    if (!neighbor.isFree)
                    {
                        if (this.CollisionBallNeighborIgnore(ball, neighbor)) continue;
                        const fraction = CollideTwoSpheres(vec3d_0, vec3d_1, neighbor.mNewPos,
                            neighbor.mNewPos, ball.mRadius + neighbor.mRadius);
                        if (fraction >= 0)
                        {
                            if (ballProp.IgnoreCollision(neighbor.mId, fraction)) continue;
                            const time = ballProp.m_tStart + fraction * (ballProp.m_tEnd - ballProp.m_tStart);
                            // Native bug: compare the fraction against an absolute time (2158).
                            if (collisionItem.timeOfImpact < 0 || fraction < collisionItem.timeOfImpact)
                            {
                                for (let i = 0; i < 3; ++i)
                                    vec3d_5[i] = vec3d_0[i] + (vec3d_1[i] - vec3d_0[i]) * fraction - neighbor.mNewPos[i];
                                const length = Math.sqrt(vec3.dot(vec3d_5, vec3d_5));
                                if (length !== 0) vec3.scale(vec3d_5, vec3d_5, 1 / length);
                                vec3.copy(collisionItem.normal, vec3d_5);
                                collisionItem.collider = neighbor;
                                collisionItem.timeOfImpact = time;
                                collisionItem.mbIndex1 = -1;
                                collisionItem.impact = null;
                            }
                        }
                    }
                    if (collisionItem.timeOfImpact === ballProp.m_tStart) break;
                }
            }
        }
        finally { CjsBallparkController.collisionFrames.push(frame); }
    }

    /**
     * Searches free-ball trajectories, splitting at the other ball's impacts.
     * Adaptation: pooled vectors and a variable-length array replace stack values
     * and native static scratch, allowing reentry. Unused miniball arrays are omitted.
     * Source: destiny/src/Ballpark.cpp:2180-2320.
     * @param {CollisionBallProperties} ballProp Current trajectory and search interval.
     * @param {CollisionItem} collisionItem Mutable best collision; normal remains untouched.
     * @param {CjsDestinyBall[]} balls Candidates in partition discovery order.
     * @param {bigint|number} collisionIteration Native unused iteration argument.
     * @returns {void} Updates the best collision when a candidate qualifies.
     */
    @meta.adapted
    GetNextCollisionFree(ballProp, collisionItem, balls, collisionIteration)
    {
        const ball = ballProp.m_ball;
        const frame = CjsBallparkController._allocCollisionFrame();
        const { vec3d_0, vec3d_1, vec3d_2, vec3d_3, vec3d_4, times } = frame;
        try
        {
            for (const other of balls)
            {
                if (!other.isFree || !(other.mId > ball.mId || ball.mMode === Mode.DSTBALL_MISSILE)) continue;
                if (this.CollisionBallNeighborIgnore(ball, other)) continue;
                let otherProp = this.mCollisionLocations.get(other.mId);
                if (!otherProp)
                {
                    otherProp = new CollisionBallProperties();
                    this.mCollisionLocations.set(other.mId, otherProp);
                    otherProp.Initialize(other, this.dt);
                }
                const endTime = otherProp.m_tEnd < ballProp.m_tEnd ? otherProp.m_tEnd : ballProp.m_tEnd;
                if (ballProp.m_tStart >= endTime) continue;
                times.length = 0;
                times.push(ballProp.m_tStart);
                for (const location of otherProp.m_locations)
                    if (location.time > ballProp.m_tStart && location.time < endTime) times.push(location.time);
                times.push(endTime);
                ballProp.CalculatePosition(vec3d_0, vec3d_4, times[0]);
                otherProp.CalculatePosition(vec3d_2, vec3d_4, times[0]);
                for (let i = 0; i < times.length - 1; ++i)
                {
                    const start = times[i], end = times[i + 1];
                    ballProp.CalculatePosition(vec3d_1, vec3d_4, end);
                    otherProp.CalculatePosition(vec3d_3, vec3d_4, end);
                    const fraction = CollideTwoSpheres(vec3d_0, vec3d_1, vec3d_2, vec3d_3, ball.mRadius + other.mRadius);
                    if (fraction >= 0)
                    {
                        const time = start + (end - start) * fraction;
                        if (collisionItem.timeOfImpact < 0 || time < collisionItem.timeOfImpact)
                        {
                            // Native quirk: this continue also skips advancing segment positions (2276).
                            if (ballProp.IgnoreCollision(other.mId, fraction)) continue;
                            collisionItem.timeOfImpact = time;
                            collisionItem.collider = other;
                            collisionItem.mbIndex1 = -1;
                            collisionItem.mbIndex2 = -1;
                            collisionItem.impact = null;
                            break;
                        }
                    }
                    if (times.length > 2)
                    {
                        vec3.copy(vec3d_0, vec3d_1);
                        vec3.copy(vec3d_2, vec3d_3);
                    }
                }
                if (collisionItem.timeOfImpact === ballProp.m_tStart) break;
            }
        }
        finally
        {
            times.length = 0;
            CjsBallparkController.collisionFrames.push(frame);
        }
    }

    /**
     * Applies Carbon's asymmetric ownership, missile, junk and mass exclusions.
     * Source: destiny/src/Ballpark.cpp:2675-2682.
     * @param {CjsDestinyBall} ball Ball being searched.
     * @param {CjsDestinyBall} neighbor Potential collision partner.
     * @returns {boolean} Whether the neighbor is excluded.
     */
    @meta.implemented
    CollisionBallNeighborIgnore(ball, neighbor)
    {
        return (ball.mMode === Mode.DSTBALL_MISSILE && (neighbor.mId === ball.mOwnerId
            || (neighbor.mMode === Mode.DSTBALL_MINIBALL && neighbor.mOwnerId === ball.mOwnerId)))
            || ((neighbor.mMode === Mode.DSTBALL_MISSILE || neighbor.mMode === Mode.DSTBALL_MUSHROOM) && ball.mId === neighbor.mOwnerId)
            || (neighbor.mMode === Mode.DSTBALL_MISSILE && ball.mId === neighbor.mFollowId)
            || ((neighbor.isSpaceJunk && !ball.isSpaceJunk) || !neighbor.isMassive);
    }

    /**
     * Reinitializes collision histories and solves ordered worklists until stable or capped.
     * Adaptation: Maps plus reusable sorted key arrays implement native ordered
     * dictionaries. History initialization uses Map insertion order in place of
     * native unspecified unordered-map order. BigInt preserves the uint64 cap.
     * Source: destiny/src/Ballpark.cpp:332-402.
     * @returns {void} Updates collision trajectories used by the integration pass.
     */
    @meta.adapted
    CalculateIterativeCollisionResponses()
    {
        for (const record of this.mCollisionLocations.values()) record.Initialize(record.m_ball, this.dt);
        for (const values of this.mPotentialCollisionBalls.values()) values.length = 0;
        for (const values of this.mPotentialCollidables.values()) values.length = 0;
        let currentBalls = new Map(), nextBalls = new Map();
        let currentIds = [], nextIds = [];
        let collisionIteration = 0n;
        let balls = this._iterateFreeBalls();
        for (;;)
        {
            for (const entry of balls)
            {
                const ball = collisionIteration === 0n ? entry : currentBalls.get(entry);
                if (ball.isMoribund || ball.mInDeadBubble || !ball.isMassive) continue;
                if (this.CalculateCollisionResponse(ball, collisionIteration))
                {
                    for (const neighbor of this.mPotentialCollisionBalls.get(ball.mId))
                    {
                        if (!neighbor.isFree) continue;
                        if (!nextBalls.has(neighbor.mId))
                            nextIds.splice(CjsBallparkController._freeBallIndex(nextIds, neighbor.mId, false), 0, neighbor.mId);
                        nextBalls.set(neighbor.mId, neighbor);
                    }
                    if (!nextBalls.has(ball.mId))
                        nextIds.splice(CjsBallparkController._freeBallIndex(nextIds, ball.mId, false), 0, ball.mId);
                    nextBalls.set(ball.mId, ball);
                }
            }
            if (nextBalls.size === 0) break;
            if (++collisionIteration >= g_collisionMaxIterations) break;
            const oldBalls = currentBalls, oldIds = currentIds;
            currentBalls = nextBalls;
            currentIds = nextIds;
            nextBalls = oldBalls;
            nextIds = oldIds;
            nextBalls.clear();
            nextIds.length = 0;
            // The local ordered worklist cannot change while this pass runs.
            balls = currentIds;
        }
    }

    /**
     * Replaces the process-global callback used by detached Ball operations.
     * Adaptation: a direct JS value replaces Python tuple/refcount handling;
     * native registration does not require callability. Null disables it.
     * Source: destiny/src/Ballpark.cpp:6730-6742.
     * @param {Function|null} callback Callback receiving the detached Ball.
     * @returns {void} Affects every park and detached Ball, not only this instance.
     */
    @meta.blue.method
    @meta.adapted
    SetBallNotInParkCallback(callback)
    {
        CjsBallparkController.s_ballNotInParkCallback = callback;
    }

    /**
     * Finds a lower/upper bound in the controller's native signed-ID order.
     * JavaScript has no ordered Map primitive, so binary lookup indexes its owned key array.
     *
     * @param {bigint[]} ids Sorted signed-int64 keys.
     * @param {bigint} id Search key.
     * @param {boolean} after Whether equality must be skipped.
     * @returns {number} First qualifying index or the array length.
     */
    @meta.ours
    static _freeBallIndex(ids, id, after)
    {
        let low = 0, high = ids.length;
        while (low < high)
        {
            const mid = Math.floor((low + high) / 2);
            if (ids[mid] < id || (after && ids[mid] === id)) low = mid + 1;
            else high = mid;
        }
        return low;
    }

    /**
     * Converts native int milliseconds to exact 100ns ticks for the private clock path.
     * JS adaptation: rejects nonpositive intervals and products outside signed int32;
     * the donor divides by this int product and supplies no portable overflow behavior.
     *
     * @param {number} interval Positive millisecond interval whose product fits native int32.
     * @returns {bigint} Exact interval in 100ns units.
     * @throws {RangeError} If interval arithmetic is outside the supported native domain.
     */
    @meta.ours
    static _tickTime(interval)
    {
        if (!Number.isInteger(interval) || interval <= 0 || interval > 214748)
        {
            throw new RangeError("Tick interval must be positive integer milliseconds with an int32 100ns product");
        }
        return BigInt(interval) * 10000n;
    }

    /**
     * Borrows independent value storage for reentrant collision search/impact calls.
     * Ours: JS has no C++ stack-value allocation; reuse complete records/views
     * instead. Sampling fills p/v, while default angular values are reset here.
     * @returns {Object} Dirty frame; return to collisionFrames in finally.
     */
    @meta.ours
    static _allocCollisionFrame()
    {
        const frame = CjsBallparkController.collisionFrames.pop() || {
            ballLoc: new BallLocation(), otherLoc: new BallLocation(),
            vec3d_0: vec3d.create(), vec3d_1: vec3d.create(), vec3d_2: vec3d.create(),
            vec3d_3: vec3d.create(), vec3d_4: vec3d.create(), vec3d_5: vec3d.create(), vec3d_6: vec3d.create(),
            times: [], hit: { normal: vec3d.create(), timeOfImpact: 0 }, collisionItem: new CollisionItem()
        };
        frame.ballLoc.time = frame.otherLoc.time = -1;
        frame.ballLoc.collider = frame.otherLoc.collider = -1n;
        quat.identity(frame.ballLoc.rot);
        quat.identity(frame.otherLoc.rot);
        vec3.zero(frame.ballLoc.omega);
        vec3.zero(frame.otherLoc.omega);
        frame.collisionItem.timeOfImpact = -1;
        frame.collisionItem.collider = frame.collisionItem.impact = null;
        frame.collisionItem.mbIndex1 = frame.collisionItem.mbIndex2 = -2;
        vec3.zero(frame.collisionItem.normal);
        return frame; // pool-return: caller owns the frame until finally.
    }

    /**
     * Reads the native process-global detached-ball callback.
     * Adaptation: Ball owns private backing to avoid the circular module edge
     * through ClientBall; the native Ballpark field remains the public owner.
     * Source: destiny/src/Ballpark.h:84; destiny/src/Ballpark.cpp:56.
     * @returns {Function|null} Current callback, or any value supplied by the native permissive setter.
     */
    @meta.adapted
    static get s_ballNotInParkCallback() { return CjsDestinyBall._ballNotInParkCallback; }

    /**
     * Writes the native process-global callback through shared JS backing.
     * Adaptation: avoids a Ball-to-Ballpark module cycle without registry lookups.
     * Native destruction clears it; deterministic park teardown remains unported.
     * @param {Function|null} value New callback; null disables reporting.
     * @returns {void} Replaces the callback for all parks and Ball subclasses.
     */
    @meta.adapted
    static set s_ballNotInParkCallback(value) { CjsDestinyBall._ballNotInParkCallback = value; }

    static collisionFrames = [];

    static warpConstants = [];

    static scratch = {
        dataView_0: new DataView(new ArrayBuffer(8)),
        orbitalNormal: { orbitalVector: vec3d.create(), toVector: vec3d.create(), dist: 0 },
        gradientBalls: [], gradientStatics: [], vec3d_0: vec3d.create(),
        vec3_0: vec3.create(), vec3_1: vec3.create(), vec3_2: vec3.create(),
        vec3_3: vec3.create(), vec3_4: vec3.create(),
        quat_0: quat.create(), quat_1: quat.create(), quat_2: quat.create(), mat4_0: mat4.create(),
        vec3_5: vec3.create(), vec3_6: vec3.create(), vec3_7: vec3.create(),
        vec3_8: vec3.create(), vec3_9: vec3.create(), vec3_10: vec3.create(), vec3_12: vec3.create(),
        quat_3: quat.create(), mat4_1: mat4.create(),
        vectorBraking: { n2: 0, kappa2: 1, alpha2: vec3.create() },
        scalarBraking: { n2: 0, kappa2: 1, alpha2: 0 },
        vec3_13: vec3.create(), vec3_14: vec3.create(), quat_4: quat.create(), mat4_2: mat4.create(),
        vec3_15: vec3.create(), vec3_16: vec3.create(), mat4_3: mat4.create()
    };
}

/**
 * Applies the native missile-only exception to dynamical orientation.
 *
 * @param {CjsDestinyBall} ball Ball whose native movement mode is inspected.
 * @returns {boolean} Whether this ball bypasses dynamical orientation.
 */
function DynamicalOrientationDisabledForBall(ball)
{
    return g_disableDynamicalOrientationForMissiles && ball.mode === Mode.DSTBALL_MISSILE;
}

/**
 * Computes native stopping steps for scalar roll or vector heading velocity.
 * Adaptation: one internal record replaces three reference outputs and the two
 * C++ overloads. Nonfinite/out-of-int32 step counts throw because their native
 * float-to-int conversion has no portable defined result.
 * Source: destiny/src/Ballpark.cpp:1580-1614.
 * @param {Object} out Retained n2/kappa2/alpha2 output record.
 * @param {number|Float32Array} omega0 Scalar roll or vector heading velocity.
 * @param {number} lenOmega0 Absolute scalar velocity or vector length.
 * @param {CjsDestinyBall} ball Supplies the native maximum angular speed.
 * @param {number} tf Float32 exponential time factor.
 * @param {number} dt Float32 tick duration.
 * @param {number} tScale Reciprocal angular time constant.
 * @returns {void} Writes all outputs, including the zero-speed branch.
 * @throws {RangeError} When the native integer conversion has no portable value.
 */
function CalculateN2Alpha2(out, omega0, lenOmega0, ball, tf, dt, tScale)
{
    if (lenOmega0 > 1e-10)
    {
        const factor = f32(ball.mMaxAngVel / lenOmega0);
        const steps = Math.ceil(f32(f32(Math.log(f32(factor / f32(1 + factor)))) / f32(-dt * tScale)));
        if (!Number.isFinite(steps) || steps < -2147483648 || steps > 2147483647)
            throw new RangeError("Native angular braking step count is outside int32");
        out.n2 = steps;
        out.kappa2 = f32(Math.pow(tf, steps));
        const scale = f32(f32(tScale * out.kappa2) / f32(1 - out.kappa2));
        if (typeof omega0 === "number") out.alpha2 = f32(-omega0 * scale);
        else vec3.scale(out.alpha2, omega0, -scale);
    }
    else
    {
        out.n2 = 0;
        out.kappa2 = 1;
        if (typeof omega0 === "number") out.alpha2 = 0;
        else vec3.zero(out.alpha2);
    }
}
