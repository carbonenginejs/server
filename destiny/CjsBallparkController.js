import { meta } from "@carbonenginejs/runtime/schema";
import { IBlueEvents } from "@carbonenginejs/runtime/blue";
import { CjsDestinyBall } from "./CjsDestinyBall.js";
import { CjsDestinyClientBall } from "./CjsDestinyClientBall.js";
import { CjsDestinyPartition } from "./partition/Partition/CjsDestinyPartition.js";
import { CjsDestinyCapsule } from "./geometry/CjsDestinyCapsule.js";
import { CjsDestinyOrientedBox } from "./geometry/CjsDestinyOrientedBox.js";
import { CollideTwoSpheres } from "./geometry/Collision.js";
import { vec3 } from "@carbonenginejs/runtime/math/vec3";
import { quat } from "@carbonenginejs/runtime/math/quat";
import { mat4 } from "@carbonenginejs/runtime/math/mat4";
import { vec3d } from "./math/vec3d.js";

import { g_useIterativeCollision, g_useDynamicalOrientation, g_useNewOrbit,
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
 * legacy collision response is available; dynamical orientation and wire replication remain unported.
 */
@meta.define({ className: "CjsBallparkController", modelledOn: "Ballpark" })
@meta.blue.inherit(IBlueEvents)
export class CjsBallparkController
{
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
     * Adds or updates a ball using Carbon's positional argument order.
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
     * @param {boolean} isMassive Native collision participation flag; currently retained as data.
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
        ball.mOwnerId = 0n;
        ball.mCorporationID = -1;
        ball.mAllianceID = -1;
        ball.mHarmonic = -1n;
        ball.followId = 0n;
        ball.followRange = 10;
        ball.mode = Mode.DSTBALL_STOP;
        this.SetBallTimeFactor(ball);
        if (ball.isFree)
        {
            this._insertFreeBall(ball);
        }
        else if (!created) this._removeFreeBall(ball.mId);
        this.InsertBallInBoxes(ball);
        if (ball.isFree && !g_useDynamicalOrientation) ball.CalculateYawPitchRoll(true);
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
     * Adaptation: missing lookup does not insert a null map entry, matching GetBall.
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
     * Samples angular drag or the native recorded collision rotation path.
     * Adaptation: caller-owned math outputs replace reference parameters; console
     * reports null balls. Collision record production remains unported, but records
     * dispatch directly to CalculateRotation rather than interpolating endpoints.
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
     * Iterative collision record production remains unported, but existing records
     * retain Carbon's CalculatePosition dispatch rather than endpoint interpolation.
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
     * Adaptation: JS IDs and scalar velocities replace native map/vector arguments.
     * The copied Set replaces a native unordered set; invalid links are removed
     * without native logging. Missile steering itself remains unported.
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
                ball._followers.delete(id);
                continue;
            }
            if (follower.mode === Mode.DSTBALL_MISSILE
                || (follower.isInteractive && follower.mode === Mode.DSTBALL_ORBIT))
            {
                if (follower.mode === Mode.DSTBALL_MISSILE) follower.isMassive = false;
                this.GotoDirection(id, follower.vx, follower.vy, follower.vz);
            }
            else this.Stop(id);
        }
    }

    /**
     * Detaches follower orders, then removes the ball now or queues native delayed cleanup.
     * Adaptation: JS retains object references and uses an optional PyOS bridge for
     * DoFinalCleanup. Cell membership is removed during final cleanup;
     * mini-shapes and collision caches remain unported.
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
        this.Stop(id);
        this.StopAllFollowers(ball);
        ball.isMoribund = true;
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
        ball.DeleteFromBoxes();
        ball.mPark = null;
        ball.mOldBubble = ball.mNewBubble;
        ball.mNewBubble = -1;
        this.AddToBubble(ball);
        if (ball.isFree) this._removeFreeBall(ball.mId);
        if (ball.isGlobal) this.mGlobals.delete(ball.mId);
        this._balls.delete(ball.id);
        if (this.mEgo === ball.id)
        {
            this.mLastEgo = 0n;
            this.mLastEgoBall = null;
        }
    }

    /**
     * Clears owned balls without final-cleanup events or changing the clocks.
     * Adaptation: detaches outstanding Ball handles and clears the ball deletion
     * queue because native owner/refcount teardown has no JS equivalent. Shape
     * queues and aggregate-only shape detachment retain native ClearAll behavior.
     *
     * @returns {void} No return value.
     */
    @meta.blue.method
    @meta.adapted
    ClearAll()
    {
        // ClearAll does not send per-ball final-cleanup events in Carbon.
        // JS handles remain live, so detach their follower links explicitly.
        for (const ball of this._balls.values())
        {
            this.Stop(ball.id);
            ball.isMoribund = true;
            ball.DeleteFromBoxes();
            ball.mPark = null;
        }
        this._balls.clear();
        this.mGlobals.clear();
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
     * zero follows the Python Evolve wrapper; orientation and
     * proximity notifications remain unported. Invalid mobile mass and unsupported modes fail
     * before changing the tick, rather than silently simulating another behavior.
     * JS exceptions release inEvolve with finally so callbacks cannot strand cleanup.
     * Timestamp conversion and signed-int64 initialization overflow are checked before movement.
     * Selected iterative collisions or dynamical orientation throw before movement
     * until those native algorithms are ported; configuration itself still accepts them.
     *
     * @param {bigint|number} [timestamp=0n] New ball timestamp in 100ns units; zero preserves ball timestamps.
     * @throws {RangeError} If a mobile mass/agility is invalid.
     * @throws {Error} If an active ball uses an unported mode.
     * @returns {void} No return value.
     */
    @meta.blue.method
    @meta.adapted
    Evolve(timestamp = 0n)
    {
        timestamp = CjsDestinyBall._toInt64(timestamp);
        if (g_useIterativeCollision) throw new Error("Iterative collision response is not implemented");
        for (const ball of this._iterateFreeBalls())
        {
            if (ball.isMoribund || this.InDeadBubble(ball)) continue;
            if (g_useDynamicalOrientation && !DynamicalOrientationDisabledForBall(ball))
            {
                throw new Error("Dynamical orientation evolution is not implemented");
            }
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
                && ball.mode !== Mode.DSTBALL_FOLLOW && ball.mode !== Mode.DSTBALL_ORBIT)
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
            for (const ball of this._iterateFreeBalls())
            {
                if (ball.isMoribund || ball.mInDeadBubble) continue;
                if (ball.isMassive)
                {
                    ball.mLastCollision = -1;
                    this.Gradient(ball);
                }
                for (let q = 0; q < 3; ++q)
                {
                    ball.mOldPos[q] = ball.mNewPos[q];
                    ball.mOldVel[q] = ball.mNewVel[q];
                }
                // Native integration stages results in old vectors until the commit pass.
                this.Integrate(ball.mOldPos, ball.mOldVel, vec3.add(CjsBallparkController.scratch.vec3d_0, ball.mLastG, ball.mLastC),
                    ball.mMass * ball.mAgility, this.mFriction, ball.mTimeFactor, this.dt);
            }
            // Carbon completes integration for every ball before updating timestamps.
            for (const ball of this._iterateFreeBalls())
            {
                if (ball.isMoribund) continue;
                if (ball.mInDeadBubble)
                {
                    ball.mInDeadBubble = false;
                    continue;
                }
                if (timestamp !== 0n)
                {
                    ball.mOldTime = ball.mNewTime === 0n
                        ? timestamp - CjsBallparkController._tickTime(this.tickInterval) : ball.mNewTime;
                    ball.mNewTime = timestamp;
                }
                for (let q = 0; q < 3; ++q)
                {
                    const position = ball.mNewPos[q], velocity = ball.mNewVel[q];
                    ball.mNewPos[q] = ball.mOldPos[q];
                    ball.mOldPos[q] = position;
                    ball.mNewVel[q] = ball.mOldVel[q];
                    ball.mOldVel[q] = velocity;
                }
                ball.CalculateYawPitchRoll();
                const dx = ball.x - ball._oldX, dy = ball.y - ball._oldY, dz = ball.z - ball._oldZ;
                if (dx * dx + dy * dy + dz * dz >= 0.1) this.InsertBallInBoxes(ball);
            }
            this.currentTime++;
        }
        finally
        {
            // JS callbacks can throw; never leave the deletion semaphore stuck.
            this.inEvolve = false;
        }
    }

    /**
     * Adaptation: four supported modes, writing scalar mLastG components in place.
     * The native dynamical thrust/torque branch throws until orientation is ported.
     *
     * @param {CjsDestinyBall} ball Ball whose existing state is read or updated.
     * @returns {void} No return value.
     */
    @meta.blue.method
    @meta.adapted
    EvolveBehaviorForBall(ball)
    {
        if (g_useDynamicalOrientation && !DynamicalOrientationDisabledForBall(ball))
        {
            throw new Error("Dynamical orientation thrust and torque are not implemented");
        }
        ball._lastGx = 0;
        ball._lastGy = 0;
        ball._lastGz = 0;
        ball.mLastC.fill(0);
        ball.mCollisions.length = 0;
        switch (ball.mode)
        {
            case Mode.DSTBALL_GOTO:
                this.EvolveGoto(ball);
                break;
            case Mode.DSTBALL_FOLLOW:
                this.EvolveFollow(ball);
                break;
            case Mode.DSTBALL_ORBIT:
                this.EvolveOrbit(ball, this.currentTime);
                break;
            case Mode.DSTBALL_STOP:
                this.EvolveStop(ball);
                break;
            default:
                throw new Error(`Destiny mode ${ball.mode} is not implemented`);
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
        this.GotoThrust(ball, ball.gotoX, ball.gotoY, ball.gotoZ);
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
     * The dynamical-heading fallback throws until native orientation is ported.
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
        const length2 = nx * nx + ny * ny + nz * nz;
        if (g_useNewOrbit && !(length2 > 1e-12) && g_useDynamicalOrientation)
        {
            throw new Error("GetOrbitalNormal dynamical heading fallback is not implemented");
        }
        out.toVector[0] = tx; out.toVector[1] = ty; out.toVector[2] = tz;
        out.dist = dist;
        if (!g_useNewOrbit || !(length2 > 1e-12))
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
     * Adaptation: f64 scalar target and mLastG output; missile mode is excluded.
     *
     * @param {CjsDestinyBall} ball Ball whose existing state is read or updated.
     * @param {number} x Position component in meters.
     * @param {number} y Position component in meters.
     * @param {number} z Position component in meters.
     * @returns {void} No return value.
     */
    @meta.blue.method
    @meta.adapted
    GotoThrust(ball, x, y, z)
    {
        const dx = x - ball.x;
        const dy = y - ball.y;
        const dz = z - ball.z;
        const length2 = dx * dx + dy * dy + dz * dz;
        const dist = ball.speedFraction * ball.maxVelocity * this.dt;
        let thrust = this.mFriction * ball.speedFraction * ball.maxVelocity / (ball.mass * ball.agility);
        if (length2 < dist * dist)
        {
            const coefficient = length2 / (dist * dist);
            thrust *= coefficient * coefficient;
        }
        const inverseLength = length2 === 0 ? 0 : 1 / Math.sqrt(length2);
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
     * Adaptation: ID overload only; same finite-target guard and restart at zero throttle.
     *
     * @param {bigint|number} id Signed-int64 ball identity; Number inputs must be safe integers.
     * @param {number} x Position component in meters.
     * @param {number} y Position component in meters.
     * @param {number} z Position component in meters.
     * @returns {void} No return value.
     */
    @meta.blue.method
    @meta.adapted
    GotoPoint(id, x, y, z)
    {
        const ball = this.GetBall(id);
        if (!ball || ![x, y, z].every(Number.isFinite)) return;
        this.Stop(id);
        ball.gotoX = x;
        ball.gotoY = y;
        ball.gotoZ = z;
        if (ball.speedFraction === 0) ball.speedFraction = 1;
        ball.mode = Mode.DSTBALL_GOTO;
    }

    /**
     * Adaptation: ID overload; keeps Carbon's distant target (1e17 units).
     *
     * @param {bigint|number} id Signed-int64 ball identity; Number inputs must be safe integers.
     * @param {number} x Direction component.
     * @param {number} y Direction component.
     * @param {number} z Direction component.
     * @returns {void} No return value.
     */
    @meta.blue.method
    @meta.adapted
    GotoDirection(id, x, y, z)
    {
        const ball = this.GetBall(id);
        if (!ball || ![x, y, z].every(Number.isFinite)) return;
        const length = Math.sqrt(x * x + y * y + z * z);
        const inverse = length === 0 ? 0 : 1 / length;
        this.GotoPoint(id, ball.x + x * inverse * 1e17, ball.y + y * inverse * 1e17, ball.z + z * inverse * 1e17);
    }

    /**
     * Adaptation: all balls share one region; native target validity checks retained.
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
        const ball = this.GetBall(id);
        const target = this.GetBall(targetId);
        range = Math.fround(range);
        if (!ball || !target || ball === target || target.isMoribund
            || target.isCloaked || !Number.isFinite(range)) return;
        this.Stop(id);
        ball.followId = target.id;
        ball._followPtr = target;
        ball.followRange = range;
        ball.mode = Mode.DSTBALL_FOLLOW;
        target._followers.add(ball.id);
    }

    /**
     * Adaptation: single region, native float range and target validity checks.
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
        const ball = this.GetBall(id);
        const target = this.GetBall(targetId);
        range = Math.fround(range);
        if (!ball || !target || ball === target || target.isMoribund
            || target.isCloaked || !Number.isFinite(range)) return;
        this.Stop(id);
        ball.followId = target.id;
        ball._followPtr = target;
        ball.followRange = range;
        ball.mode = Mode.DSTBALL_ORBIT;
        target._followers.add(ball.id);
    }

    /**
     * Adaptation: ID overload; no formation slots/network state. Velocity is retained.
     *
     * @param {bigint|number} id Signed-int64 ball identity; Number inputs must be safe integers.
     * @returns {void} No return value.
     */
    @meta.blue.method
    @meta.adapted
    Stop(id)
    {
        const ball = this.GetBall(id);
        if (!ball) return;
        if (ball._followPtr)
        {
            ball._followPtr._followers.delete(ball.id);
            ball._followPtr = null;
            ball.followId = 0n;
            ball.followRange = 0;
        }
        ball.mode = Mode.DSTBALL_STOP;
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
     * Adaptation: factory-owned outputs narrow doubles to native float32 values;
     * the existing GetBall lookup does not insert a missing null map entry.
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
     * Adaptation: float32 scratch replaces the temporary native quaternion; the
     * existing GetBall lookup does not insert a missing null map entry.
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
     * Adaptation: rounds the native float argument; GetBall does not insert a
     * missing null entry. Native NaN acceptance is retained.
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
     * Adaptation: rounds the native float argument; GetBall does not insert a
     * missing null entry. Native NaN acceptance is retained.
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
     * Adaptation: finite native f32 input guard before native spatial reinsertion.
     *
     * @param {bigint|number} id Signed-int64 ball identity; Number inputs must be safe integers.
     * @param {number} radius Radius in meters.
     * @returns {void} No return value.
     */
    @meta.blue.method
    @meta.adapted
    SetBallRadius(id, radius)
    {
        const ball = this.GetBall(id);
        radius = Math.fround(radius);
        if (!ball || !Number.isFinite(radius) || radius < 0) return;
        ball.radius = radius;
        this.InsertBallInBoxes(ball);
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
     * Adaptation: updates the ordered free-ball collection and spatial membership without mini-shapes;
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
        const newTime = isFree ? CjsDestinyBall._toInt64(this.time - CjsBallparkController._tickTime(this.tickInterval)) : ball.mNewTime;
        ball.isFree = Boolean(isFree);
        if (ball.isFree)
        {
            this._insertFreeBall(ball);
            ball.mNewTime = newTime;
        }
        else
        {
            this.Stop(id);
            this.SetBallVelocity(id, 0, 0, 0);
            this._removeFreeBall(ball.mId);
            this.InsertBallInBoxes(ball);
            ball._lastGx = ball._lastGy = ball._lastGz = 0;
        }
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

    static scratch = {
        orbitalNormal: { orbitalVector: vec3d.create(), toVector: vec3d.create(), dist: 0 },
        gradientBalls: [], gradientStatics: [], vec3d_0: vec3d.create(),
        vec3_0: vec3.create(), vec3_1: vec3.create(), vec3_2: vec3.create(),
        vec3_3: vec3.create(), vec3_4: vec3.create(),
        quat_0: quat.create(), quat_1: quat.create(), quat_2: quat.create(), mat4_0: mat4.create()
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
