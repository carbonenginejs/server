import { meta } from "@carbonenginejs/runtime/schema";

// Source: destiny/python/destiny/net/client/_baseticker.py:12-140.
/** Client pre-tick base owning incoming history and malformed-batch reporting. */
@meta.define({ className: "DestinyClientBaseTicker", carbon: "destiny.net.client.BaseTicker" })
export class BaseTicker
{
    _ballpark = null;
    _history = [];
    _latest_set_state_time = 0;
    _error_handler = null;
    _marshal = null;
    _logger = null;

    /**
     * Retains the native error handler and external codec/logging dependencies.
     * Adaptation: JS has no imported blue.marshal or Python logger; hosts supply
     * the native Load(payload) operation and console-shaped logging. Missing
     * codecs follow the native caught decoding-error path for packaged entries.
     * @param {TickErrorHandlerInterface} error_handler Desynchronization callbacks.
     * @param {Object} [dependencies] External dependencies, without ownership transfer.
     * @param {Object|null} [dependencies.marshal=null] Blue-compatible Load operation.
     * @param {Object} [dependencies.logger=console] info/warn/error logger, optional numeric level.
     * @returns {BaseTicker} Independent history owner.
     */
    constructor(error_handler, { marshal = null, logger = console } = {})
    {
        this._error_handler = error_handler; this._marshal = marshal; this._logger = logger;
    }

    /**
     * Changes the active park and forwards it to the error handler.
     * @param {CjsBallparkController|null} ballpark Active park, or null between scenes.
     * @returns {void} Existing history is retained.
     */
    @meta.implemented
    set_ballpark(ballpark) { this._ballpark = ballpark; this._error_handler.set_ballpark(ballpark); }

    /**
     * Requires the concrete ticker's pre-tick implementation.
     * Adaptation: JS throws on an abstract call instead of Python ABC construction.
     * @returns {void} Always throws.
     */
    @meta.adapted
    do_pre_tick() { throw new TypeError("BaseTicker.do_pre_tick is abstract"); }

    /**
     * Expands packaged actions, reports mixed stamps, then merges the state.
     * Adaptation: codec/logger dependencies replace imported Python modules.
     * @param {Array} state Stamped native action tuples.
     * @param {boolean} wait_for_bubble Whether bubble events are still expected.
     * @returns {void} No active park ignores the update.
     */
    @meta.adapted
    update(state, wait_for_bubble)
    {
        if (this._ballpark === null) return;
        state = _expand_states(state, this._marshal, this._logger);
        this._report_update_if_bad(state); this._flush_state(state, wait_for_bubble);
    }

    /**
     * Requires the concrete history merge operation.
     * Adaptation: JS throws on an abstract call instead of Python ABC construction.
     * @param {Array} state Expanded state.
     * @param {boolean} wait_for_bubble Bubble wait flag.
     * @returns {void} Always throws.
     */
    @meta.adapted
    _flush_state(state, wait_for_bubble) { throw new TypeError("BaseTicker._flush_state is abstract"); }

    /**
     * Returns the active simulation tick.
     * @returns {number} Ballpark currentTime.
     */
    get _current_time() { return this._ballpark.currentTime; }

    /**
     * Logs newest history first, coalescing adjacent equal stamp/method labels.
     * Adaptation: console-shaped logging replaces Python logging and class identity
     * uses its registered constant label rather than minifiable Function.name.
     * @returns {void} Level above Python INFO (20) skips the dump.
     */
    @meta.adapted
    _dump_history()
    {
        if (this._logger.level > 20) return;
        this._logger.info("------ DestinyClientTicker History Dump", this._current_time, "-------");
        const rev = this._history.slice().reverse();
        for (const [state, wait] of rev)
        {
            this._logger.info("state waiting:", wait ? "yes" : "no");
            let stamp, name, count = 0;
            for (const [nextStamp, [nextName]] of state)
            {
                if (count && (stamp !== nextStamp || name !== nextName))
                {
                    this._logger.info("[", stamp, "]", name, count === 1 ? "" : `(x ${count})`); count = 0;
                }
                stamp = nextStamp; name = nextName; ++count;
            }
            if (count) this._logger.info("[", stamp, "]", name, count === 1 ? "" : `(x ${count})`);
            this._logger.info(" ");
        }
    }

    /**
     * Reports mixed timestamps without preventing subsequent merge/application.
     * Adaptation: Set replaces the native set and injected logging replaces Python logging.
     * @param {Array} state Expanded events.
     * @returns {void} Invokes the fatal handler once when multiple stamps exist.
     */
    @meta.adapted
    _report_update_if_bad(state)
    {
        const timestamps = new Set(state.map(action => action[0]));
        if (timestamps.size > 1)
        {
            this._logger.error("Found update batch with", state.length, "items and", timestamps.size, "timestamps");
            for (const action of state) this._logger.error("Action:", action);
            this._error_handler.on_fatal_desync();
        }
    }
}

/**
 * Expands one level of native PackagedAction envelopes, retaining ordinary entries.
 * Adaptation: callers provide blue.marshal.Load; decoding failures log and drop
 * only the failing package. No substitute encoding or recursive expansion is added.
 * @param {Array} state Stamped native events.
 * @param {Object|null} marshal Blue-compatible decoder.
 * @param {Object} logger Console-shaped error logger.
 * @returns {Array} New outer event array with original decoded entries.
 */
export function _expand_states(state, marshal, logger)
{
    const expanded_states = [];
    for (const action of state)
    {
        if (action[1][0] === "PackagedAction")
        {
            try { for (const entry of marshal.Load(action[1][1])) expanded_states.push(entry); }
            catch (error) { logger.error("Exception whilst expanding a PackagedAction", error); }
        }
        else expanded_states.push(action);
    }
    return expanded_states;
}
