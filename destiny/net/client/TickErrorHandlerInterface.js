// Source: destiny/python/destiny/net/client/_interface.py:98-118.
/** Native client desynchronization callbacks implemented by the application. */
/**
 * Carbon: TickErrorHandlerInterface (destiny/python/destiny/net/client/_interface.py:98-118)
 */
export class TickErrorHandlerInterface
{
    _ballpark = null;

    /**
     * Retains the park for subsequent error handling.
     * @param {CjsBallparkController|null} ballpark Active park.
     * @returns {void} Replaces the reference.
     */
    set_ballpark(ballpark) { this._ballpark = ballpark; }

    /**
     * Requires a response to mixed-timestamp updates.
     * Adaptation: an abstract invocation throws in JS instead of ABC enforcement.
     * @returns {void} Implement in the game adapter.
     */
    on_fatal_desync() { throw new TypeError("TickErrorHandlerInterface.on_fatal_desync is abstract"); }

    /**
     * Requires a response when the client cannot restore a requested tick.
     * Adaptation: an abstract invocation throws in JS instead of ABC enforcement.
     * @returns {void} Implement in the game adapter, typically requesting full state.
     */
    on_recoverable_desync() { throw new TypeError("TickErrorHandlerInterface.on_recoverable_desync is abstract"); }
}
