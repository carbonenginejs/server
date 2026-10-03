import { meta } from "@carbonenginejs/runtime/schema";

// Source: destiny/python/destiny/net/client/_interface.py:6-95.
/** Native client-game callbacks; applications implement the abstract operations. */
@meta.define({ className: "DestinyClientTickerInterface", carbon: "destiny.net.client.ClientTickerInterface" })
export class ClientTickerInterface
{
    _ballpark = null;

    /**
     * Retains the current park for application callbacks.
     * @param {CjsBallparkController|null} ballpark Active park.
     * @returns {void} Replaces the retained reference.
     */
    @meta.implemented
    set_ballpark(ballpark) { this._ballpark = ballpark; }

    /**
     * Requires game cleanup before full state replacement.
     * Adaptation: an abstract invocation throws in JS instead of ABC enforcement.
     * @returns {void} Implement in the game adapter.
     */
    @meta.adapted
    on_set_state() { throw new TypeError("ClientTickerInterface.on_set_state is abstract"); }

    /**
     * Requires notification after a core ballpark action.
     * Adaptation: an abstract invocation throws in JS instead of ABC enforcement.
     * @param {string} func_name Native action name.
     * @param {Array} args Native positional arguments.
     * @returns {void} Implement in the game adapter.
     */
    @meta.adapted
    on_ballpark_local_action(func_name, args) { throw new TypeError("ClientTickerInterface.on_ballpark_local_action is abstract"); }

    /**
     * Requires the application's action logging preference.
     * Adaptation: an abstract invocation throws in JS instead of ABC enforcement.
     * @returns {boolean} Implement in the game adapter.
     */
    @meta.adapted
    should_log_actions() { throw new TypeError("ClientTickerInterface.should_log_actions is abstract"); }

    /**
     * Requires a destruction delay for one ball.
     * Adaptation: positional boolean replaces a Python keyword; abstract calls throw.
     * @param {CjsDestinyBall|null} ball Ball before removal, or null if absent.
     * @param {boolean} [is_terminal=false] Whether removal represents destruction.
     * @returns {number} Delay in simulation ticks, supplied by the game.
     */
    @meta.adapted
    get_ball_destruction_delay(ball, is_terminal = false) { throw new TypeError("ClientTickerInterface.get_ball_destruction_delay is abstract"); }

    /**
     * Requires per-ID delays for a group removal.
     * Adaptation: a Map replaces the Python dict; positional boolean replaces the
     * Python keyword and abstract invocation throws in place of ABC enforcement.
     * @param {Array} ball_ids Ball identities.
     * @param {boolean} [is_release=false] Whether the scene is being released.
     * @returns {Map<bigint|number,number>} IDs and tick delays supplied by the game.
     */
    @meta.adapted
    get_ball_destruction_delays(ball_ids, is_release = false) { throw new TypeError("ClientTickerInterface.get_ball_destruction_delays is abstract"); }

    /**
     * Requires cleanup after a single core removal.
     * Adaptation: positional boolean replaces a Python keyword; abstract calls throw.
     * @param {bigint|number} ball_id Removed identity.
     * @param {CjsDestinyBall|null} ball Pre-removal object, or null.
     * @param {boolean} [is_terminal=false] Whether removal represents destruction.
     * @returns {void} Implement in the game adapter.
     */
    @meta.adapted
    clean_up_after_ball_removal(ball_id, ball, is_terminal = false) { throw new TypeError("ClientTickerInterface.clean_up_after_ball_removal is abstract"); }

    /**
     * Requires group cleanup before delay lookup and core removal.
     * Adaptation: positional boolean replaces a Python keyword; abstract calls throw.
     * @param {Array} ball_ids Ball identities.
     * @param {boolean} [is_release=false] Whether the scene is being released.
     * @returns {void} Implement in the game adapter.
     */
    @meta.adapted
    clean_up_after_multiple_ball_removal(ball_ids, is_release = false) { throw new TypeError("ClientTickerInterface.clean_up_after_multiple_ball_removal is abstract"); }
}
