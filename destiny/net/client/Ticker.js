import { meta } from "@carbonenginejs/runtime/schema";
import { CjsBallparkController } from "../../CjsBallparkController.js";
import { CjsDestinyBall } from "../../CjsDestinyBall.js";
import { CjsDestinyStream } from "../../CjsDestinyStream.js";
import { BaseTicker } from "./BaseTicker.js";
import { merge_state_into_history } from "./_util.js";

// Source: destiny/python/destiny/net/client/_ticker.py:14-415.
const LOCAL_ACTIONS = new Set(["AddBallsToPark", "RemoveBall", "RemoveBalls"]);

/** Client action history, native stream snapshots and tick synchronization. */
@meta.define({ className: "DestinyClientTicker", carbon: "destiny.net.client.Ticker" })
export class Ticker extends BaseTicker
{
    _should_rebase = false;
    _last_stamp = -1;
    _states = [];
    _state_is_valid = false;
    _client_ticker_interface = null;

    /**
     * Creates native client state with explicit external codec/logging dependencies.
     * Adaptation: dependencies supply unavailable Python modules through BaseTicker.
     * @param {TickErrorHandlerInterface} error_handler Desynchronization callbacks.
     * @param {ClientTickerInterface} client_ticker_interface Game-specific callbacks.
     * @param {Object} [dependencies] BaseTicker marshal/logger dependencies.
     * @returns {Ticker} Detached client ticker; call set_ballpark before use.
     */
    constructor(error_handler, client_ticker_interface, dependencies)
    {
        super(error_handler, dependencies); this._client_ticker_interface = client_ticker_interface;
    }

    /**
     * Switches the active park without clearing history or snapshot state.
     * @param {CjsBallparkController|null} ballpark New active park.
     * @returns {void} Notifies both interfaces.
     */
    @meta.implemented
    set_ballpark(ballpark)
    {
        super.set_ballpark(ballpark); this._client_ticker_interface.set_ballpark(ballpark);
    }

    /**
     * Filters history against the most recent arriving SetState, then merges it.
     * Adaptation: JS arrays replace Python lists and the injected logger handles messages.
     * Source: destiny/python/destiny/net/client/_ticker.py:47-86.
     * @param {Array} state Expanded stamped events.
     * @param {boolean} wait_for_bubble Whether to wait for companion bubble events.
     * @returns {void} Empty or stale ordinary updates are ignored.
     */
    @meta.adapted
    _flush_state(state, wait_for_bubble)
    {
        if (!state.length) { this._logger.warn("Empty state received from remote ballpark"); return; }
        if (state[0][1][0] === "SetState")
        {
            this._latest_set_state_time = state[0][0];
            this._history = this._history.filter(entry => entry[0][0][0] >= this._latest_set_state_time);
            this._dump_history();
        }
        else if (state[0][0] < this._latest_set_state_time)
        {
            this._logger.warn("Discarded state older than SetState", state[0][0], this._latest_set_state_time);
            this._dump_history(); return;
        }
        merge_state_into_history(state, this._history, wait_for_bubble); this._dump_history();
    }

    /**
     * Applies ready history groups and retains native mid-tick snapshot timing.
     * Adaptation: direct owner-prototype calls replace Blue _parent_ dispatch,
     * bypassing game overrides. The donor's remaining-history >1 quirk is retained.
     * Source: destiny/python/destiny/net/client/_ticker.py:88-123.
     * @returns {void} Waiting groups and updates one or two ticks ahead defer.
     */
    @meta.adapted
    do_pre_tick()
    {
        while (this._history.length)
        {
            const [state, wait_for_bubble] = this._history[0];
            if (wait_for_bubble) return;
            const event_stamp = state[0][0];
            if (event_stamp > this._current_time && event_stamp - this._current_time < 3) break;
            this._real_flush_state(state); this._history.splice(0, 1);
            if (this._state_is_valid && this._should_rebase) this.store_state(true);
            if (this._history.length > 1)
            {
                if (this._history[0][1]) return;
                CjsBallparkController.prototype.Evolve.call(this._ballpark);
            }
        }
    }

    /**
     * Replaces the scene from native bytes, assigns ego and starts its tick host.
     * Adaptation: the owned Destiny byte adapter replaces Blue MemStream; the
     * ballpark retains its existing host-clock contract, including Start failures.
     * Source: destiny/python/destiny/net/client/_ticker.py:125-144.
     * @param {ArrayBuffer|ArrayBufferView} state Native packet bytes.
     * @param {bigint|number} ego_ball_id Ego ball identity.
     * @returns {void} Creates a base snapshot after successful startup.
     */
    @meta.adapted
    _set_state(state, ego_ball_id)
    {
        this._client_ticker_interface.on_set_state(); this._ballpark.ClearAll();
        this._ballpark.ReadFullStateFromStream(new CjsDestinyStream(state));
        this._ballpark.ego = ego_ball_id; this._ballpark.Start();
        this._state_is_valid = true; this.flush_simulation_history();
    }

    /**
     * Synchronizes once per batch, then applies each native action in order.
     * Adaptation: the native Blue-name table and owner-prototype dispatch replace
     * _parent_ methods, selecting explicit Py bindings where present, and
     * native positional argument tuples become bounded per-method JS arguments.
     * Logging uses the injected logger; an individual action failure still allows
     * later actions, while initial SetState failure remains outside that catch.
     * Source: destiny/python/destiny/net/client/_ticker.py:146-222.
     * @param {Array} state Ordered stamped actions.
     * @returns {void} Reports recoverable desync when synchronization fails.
     */
    @meta.adapted
    _real_flush_state(state)
    {
        if (!state.length) { this._logger.warn("Empty state received from remote ballpark"); return; }
        const [event_stamp, [func_name, args]] = state[0];
        if (func_name === "SetState")
        {
            if (this._client_ticker_interface.should_log_actions()) this._logger.info("Action:", func_name, event_stamp, this._current_time, args);
            this._set_state(...args);
        }
        if (!this._state_is_valid) return;
        this._should_rebase = false; let synchronised = false;
        for (const [stamp, [name, parameters]] of state)
        {
            if (name === "SetState") continue;
            if (this._client_ticker_interface.should_log_actions()) this._logger.info("Action:", name, stamp, this._current_time, parameters);
            try
            {
                if (!synchronised) synchronised = this.synchronize_to_simulation_time(stamp);
                if (!synchronised) { this._error_handler.on_recoverable_desync(); return; }
                this._should_rebase = true;
                if (LOCAL_ACTIONS.has(name)) this[name](...parameters);
                else
                {
                    if (!Object.hasOwn(CjsBallparkController.blueMethods, name)) throw new TypeError(`Unknown Blue ballpark method: ${name}`);
                    CjsBallparkController.prototype[CjsBallparkController.blueMethods[name]].apply(this._ballpark, parameters);
                    this._client_ticker_interface.on_ballpark_local_action(name, parameters);
                    if (name === "CloakBall" && this._ballpark.ego && this._ballpark.ego !== CjsDestinyBall._toInt64(parameters[0]))
                        this.RemoveBall(parameters[0]);
                }
            }
            catch (error) { this._logger.error(`${name} failed.`, error); }
        }
    }

    /**
     * Rebases after actions, otherwise stores a snapshot beyond the ten-tick interval.
     * @param {number} stamp Post-tick label supplied by the host.
     * @returns {void} Resets the rebase flag only after a successful flush.
     */
    @meta.implemented
    do_post_tick(stamp)
    {
        if (this._should_rebase) { this.flush_simulation_history(); this._should_rebase = false; }
        else if (stamp > this._last_stamp + 10) this.store_state();
    }

    /**
     * Replaces the snapshot list without changing its last-stamp marker.
     * @returns {void} Old list references remain detached.
     */
    @meta.implemented
    clear_states() { this._states = []; }

    /**
     * Saves a native full-state stream while the park runs.
     * Adaptation: CjsDestinyStream replaces MemStream. Native quirk: the [3:3]
     * slice is empty, so pruning keeps the first and last five snapshots only.
     * Source: destiny/python/destiny/net/client/_ticker.py:244-263.
     * @param {boolean} [mid_tick=false] Whether this snapshot was captured in pre-tick.
     * @returns {void} Does not capture omitted native transient state or local IDs.
     */
    @meta.adapted
    store_state(mid_tick = false)
    {
        if (!this._ballpark.isRunning) return;
        const ms = new CjsDestinyStream(); this._ballpark.WriteFullStateToStream(ms);
        this._states.push([ms, this._current_time, mid_tick]);
        if (this._states.length > 10) this._states = this._states.slice(0, 1).concat(this._states.slice(3, 3), this._states.slice(-5));
        this._last_stamp = this._current_time;
    }

    /**
     * Restores the last eligible list entry and evolves to the requested tick.
     * Adaptation: owner-prototype calls bypass game overrides like native _parent_.
     * Rewind uses partial=1, retaining absent balls, minis and old samples; this is
     * not a full rollback. Replay calls Evolve with its native zero-time default;
     * safe integer iteration counts replace Python range admission without rounding.
     * Source: destiny/python/destiny/net/client/_ticker.py:265-305.
     * @param {number} stamp Target simulation tick.
     * @returns {number} One on success; zero if rewind has no eligible snapshot.
     */
    @meta.adapted
    synchronize_to_simulation_time(stamp)
    {
        let last_stamp;
        if (stamp < this._current_time)
        {
            last_stamp = 0; let last_state = null;
            for (const item of this._states) if (item[1] <= stamp) { last_stamp = item[1]; last_state = item[0]; }
            if (!last_state) return 0;
            CjsBallparkController.prototype.PyReadFullStateFromStream.call(this._ballpark, last_state, 1);
        }
        else last_stamp = this._current_time;
        const delta = stamp - last_stamp;
        if (!Number.isSafeInteger(delta)) throw new RangeError("Replay requires an exact integer tick count");
        for (let i = 0; i < delta; ++i) CjsBallparkController.prototype.Evolve.call(this._ballpark);
        return 1;
    }

    /**
     * Rebases snapshot history while preserving a last previous-tick mid-state.
     * Adaptation: arrays replace Python lists; stream identities remain unchanged.
     * Source: destiny/python/destiny/net/client/_ticker.py:307-342.
     * @param {boolean} [new_base_snapshot=true] False clears without saving a base.
     * @returns {void} Retains at most the eligible mid-state and the new base.
     */
    @meta.adapted
    flush_simulation_history(new_base_snapshot = true)
    {
        let last_mid_state = null;
        if (new_base_snapshot && this._states.length)
        {
            last_mid_state = this._states[this._states.length - 1];
            if (!last_mid_state[2] || last_mid_state[1] !== this._current_time - 1) last_mid_state = null;
        }
        this.clear_states();
        if (new_base_snapshot)
        {
            if (last_mid_state) this._states.push(last_mid_state);
            this.store_state();
        }
    }

    /**
     * Adds native packet records without clearing the existing registries.
     * Adaptation: the Destiny byte adapter replaces Blue MemStream.
     * @param {ArrayBuffer|ArrayBufferView} state Selected-ball packet bytes.
     * @returns {void} Partial=2 still replaces fixed minis, as the native reader does.
     */
    @meta.adapted
    AddBallsToPark(state) { this._ballpark.ReadFullStateFromStream(new CjsDestinyStream(state), 2); }

    /**
     * Obtains the game delay, removes through the core method, then runs cleanup.
     * Adaptation: GetBall normalizes exact JS IDs; owner-prototype dispatch replaces
     * _parent_. Native Blue profiling zones are omitted, not simulation callbacks.
     * @param {bigint|number} ball_id Ball identity.
     * @param {boolean} [terminal=false] Whether the game treats this as destruction.
     * @returns {void} Cleanup receives the pre-removal ball, including null if absent.
     */
    @meta.adapted
    RemoveBall(ball_id, terminal = false)
    {
        const ball = CjsBallparkController.prototype.GetBall.call(this._ballpark, ball_id);
        const delay = this._client_ticker_interface.get_ball_destruction_delay(ball, terminal);
        CjsBallparkController.prototype.RemoveBall.call(this._ballpark, ball_id, delay);
        this._client_ticker_interface.clean_up_after_ball_removal(ball_id, ball, terminal);
    }

    /**
     * Runs group cleanup before requesting delays and removing each returned ID.
     * Adaptation: Map replaces the delay dictionary, preserving iteration order;
     * positional booleans replace Python keywords and Blue profiling is omitted.
     * @param {Array} ball_ids IDs passed unchanged to the game callbacks.
     * @param {boolean} [is_release=false] Whether the whole park is being released.
     * @returns {void} Removes exactly the IDs returned by the delay callback.
     */
    @meta.adapted
    RemoveBalls(ball_ids, is_release = false)
    {
        this._client_ticker_interface.clean_up_after_multiple_ball_removal(ball_ids, is_release);
        const delays = this._client_ticker_interface.get_ball_destruction_delays(ball_ids, is_release);
        for (const [id, delay] of delays) CjsBallparkController.prototype.RemoveBall.call(this._ballpark, id, delay);
    }

    /**
     * Marks the simulation invalid pending a subsequent SetState.
     * @returns {void} Does not clear history or pause the park.
     */
    @meta.implemented
    invalidate_state() { this._state_is_valid = false; }

    /**
     * Releases balls and histories without pausing or detaching the active park.
     * Adaptation: Array.from snapshots Python dict.keys before cleanup callbacks.
     * Source: destiny/python/destiny/net/client/_ticker.py:402-415.
     * @returns {void} Native last-stamp and should-rebase fields remain unchanged.
     */
    @meta.adapted
    release()
    {
        this.RemoveBalls(Array.from(this._ballpark.balls.keys()), true); this._ballpark.ClearAll();
        this.flush_simulation_history(false); this._history = []; this._latest_set_state_time = 0; this._state_is_valid = false;
    }
}
