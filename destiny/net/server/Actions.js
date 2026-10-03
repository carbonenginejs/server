import { meta } from "@carbonenginejs/runtime/schema";

// Source: destiny/python/destiny/net/server/_actions.py
/**
 * Movement-command subset of Carbon's Actions queue. Native Python method names
 * and history tuples are preserved. This class neither executes nor transports
 * commands. Signals, serialization and commands absent from the movement park
 * remain outside this subset; it does not claim the complete native identity.
 */
@meta.define({ className: "Actions", modelledOn: "destiny.net.server.Actions" })
export class Actions
{
    _park = null;
    _system_history = [];
    _stamp_for_system = 0;

    /**
     * Binds the existing movement park without changing its state or clock.
     *
     * @param {CjsBallparkController} park Existing movement park; no ownership transfer.
     * @returns {Actions} New instance with its own native value fields.
     */
    constructor(park)
    {
        this._park = park;
        this._stamp_for_system = this._get_initial_stamp_for_system();
    }

    /**
     * Adaptation: native currentTime/_currentTime is this subset's time field.
     *
     * @returns {number} Zero at startup, otherwise the next tick label.
     */
    @meta.adapted
    _get_initial_stamp_for_system()
    {
        return this._park.time === 0 ? 0 : this._park.time + 1;
    }

    /**
     * Preserves adjacent tuple deduplication and the optional third event item.
     * Adaptation: JS arrays represent Python tuples, and keyword arguments become
     * an options object. Signal delivery is explicitly unported. Payloads are
     * retained unchanged; the ballpark applies its own scalar conversions later.
     *
     * @param {number} ball_id Ball identity associated with the event.
     * @param {string} eventName Native ballpark method name.
     * @param {unknown[]} [args] Bounded movement-command arguments before optional ball ID insertion.
     * @param {Object} [options] Native keyword options expressed as a JavaScript object.
     * @param {boolean} [options.insert_ball_id_into_args=true] Prefix the event arguments with its ball identity.
     * @param {unknown} [options.local_args=null] Optional third event item; null omits it.
     * @returns {void} No return value.
     */
    @meta.adapted
    _add_to_system_history(ball_id, eventName, args = [],
        { insert_ball_id_into_args = true, local_args = null } = {})
    {
        const parameters = insert_ball_id_into_args ? [ball_id, ...args] : args;
        const event = local_args === null
            ? [eventName, parameters]
            : [eventName, parameters, local_args];
        const action = [ball_id, this._stamp_for_system, event];
        const history = this._system_history;
        if (!history.length || !sameTuple(history[history.length - 1], action))
        {
            history.push(action);
        }
    }

    /**
     * Sets the label for subsequent actions; does not schedule their execution.
     *
     * @param {number} stamp Tick label for subsequent queue entries.
     * @returns {void} No return value.
     */
    @meta.implemented
    set_stamp_for_system(stamp)
    {
        this._stamp_for_system = stamp;
    }

    /**
     * Hands the accumulated history to the caller and starts a fresh batch.
     *
     * @returns {Array} Detached native-shaped history tuples in insertion order.
     */
    @meta.implemented
    flush_history()
    {
        const history = this._system_history;
        this._system_history = [];
        return history;
    }

    /**
     * Queues native GotoPoint with its unmodified coordinates.
     *
     * @param {number} src_id Safe-integer source ball identity.
     * @param {number} x Position component in meters.
     * @param {number} y Position component in meters.
     * @param {number} z Position component in meters.
     * @returns {void} No return value.
     */
    @meta.implemented
    go_to_point(src_id, x, y, z)
    {
        this._add_to_system_history(src_id, "GotoPoint", [x, y, z]);
    }

    /**
     * Queues native GotoDirection with its unmodified direction.
     *
     * @param {number} src_id Safe-integer source ball identity.
     * @param {number} x Direction component.
     * @param {number} y Direction component.
     * @param {number} z Direction component.
     * @returns {void} No return value.
     */
    @meta.implemented
    go_to_direction(src_id, x, y, z)
    {
        this._add_to_system_history(src_id, "GotoDirection", [x, y, z]);
    }

    /**
     * Queues native Orbit with the target and surface range in meters.
     *
     * @param {number} src_id Safe-integer source ball identity.
     * @param {number} dst_id Target ball identity.
     * @param {number} orbit_range_meters Orbit surface separation in meters.
     * @returns {void} No return value.
     */
    @meta.implemented
    orbit(src_id, dst_id, orbit_range_meters)
    {
        this._add_to_system_history(src_id, "Orbit", [dst_id, orbit_range_meters]);
    }

    /**
     * Queues native SetBallVelocity in meters per second.
     *
     * @param {number} src_id Safe-integer source ball identity.
     * @param {number} vx Velocity component in meters per second.
     * @param {number} vy Velocity component in meters per second.
     * @param {number} vz Velocity component in meters per second.
     * @returns {void} No return value.
     */
    @meta.implemented
    set_ball_velocity(src_id, vx, vy, vz)
    {
        this._add_to_system_history(src_id, "SetBallVelocity", [vx, vy, vz]);
    }

    /**
     * Queues native Stop; it does not immediately zero velocity.
     *
     * @param {number} src_id Safe-integer source ball identity.
     * @returns {void} No return value.
     */
    @meta.implemented
    stop(src_id)
    {
        this._add_to_system_history(src_id, "Stop");
    }

    /**
     * Queues native SetBallMass in kilograms.
     *
     * @param {number} src_id Safe-integer source ball identity.
     * @param {number} mass_kg Mass in kilograms.
     * @returns {void} No return value.
     */
    @meta.implemented
    set_ball_mass(src_id, mass_kg)
    {
        this._add_to_system_history(src_id, "SetBallMass", [mass_kg]);
    }

    /**
     * Queues the native linear agility multiplier.
     *
     * @param {number} src_id Safe-integer source ball identity.
     * @param {number} agility Native positive mass/agility multiplier.
     * @returns {void} No return value.
     */
    @meta.implemented
    set_ball_agility(src_id, agility)
    {
        this._add_to_system_history(src_id, "SetBallAgility", [agility]);
    }

    /**
     * Queues throttle without clamping or rounding ahead of the ballpark.
     *
     * @param {number} src_id Safe-integer source ball identity.
     * @param {number} speed_fraction Unmodified requested fraction of maximum speed.
     * @returns {void} No return value.
     */
    @meta.implemented
    set_speed_fraction(src_id, speed_fraction)
    {
        this._add_to_system_history(src_id, "SetSpeedFraction", [speed_fraction]);
    }

    /**
     * Queues a position with separate server-local notification metadata.
     *
     * @param {number} src_id Safe-integer source ball identity.
     * @param {number} x Position component in meters.
     * @param {number} y Position component in meters.
     * @param {number} z Position component in meters.
     * @param {boolean} [is_local_ball] Server-local notification metadata, separate from position arguments.
     * @returns {void} No return value.
     */
    @meta.implemented
    set_ball_position(src_id, x, y, z, is_local_ball = false)
    {
        this._add_to_system_history(src_id, "SetBallPosition", [x, y, z],
            { local_args: is_local_ball });
    }

    /**
     * Queues native SetBallRadius in meters.
     *
     * @param {number} src_id Safe-integer source ball identity.
     * @param {number} radius_meters Radius in meters.
     * @returns {void} No return value.
     */
    @meta.implemented
    set_ball_radius(src_id, radius_meters)
    {
        this._add_to_system_history(src_id, "SetBallRadius", [radius_meters]);
    }

    /**
     * Queues movement participation, defaulting to free as in Carbon.
     *
     * @param {number} src_id Safe-integer source ball identity.
     * @param {boolean} [is_free] Whether the ball can move.
     * @returns {void} No return value.
     */
    @meta.implemented
    set_ball_free(src_id, is_free = true)
    {
        this._add_to_system_history(src_id, "SetBallFree", [is_free]);
    }

    /**
     * Queues native FollowBall with a surface range in meters.
     *
     * @param {number} src_id Safe-integer source ball identity.
     * @param {number} dst_id Target ball identity.
     * @param {number} range_meters Surface separation in meters.
     * @returns {void} No return value.
     */
    @meta.implemented
    follow_ball(src_id, dst_id, range_meters)
    {
        this._add_to_system_history(src_id, "FollowBall", [dst_id, range_meters]);
    }

    /**
     * Queues native SetMaxSpeed in meters per second.
     *
     * @param {number} src_id Safe-integer source ball identity.
     * @param {number} max_meters_per_second Maximum speed in meters per second.
     * @returns {void} No return value.
     */
    @meta.implemented
    set_max_speed(src_id, max_meters_per_second)
    {
        this._add_to_system_history(src_id, "SetMaxSpeed", [max_meters_per_second]);
    }

    /**
     * Returns matching pending event tuples in their existing order.
     *
     * @param {number} src_id Safe-integer source ball identity.
     * @param {string} event_name Native event name to match.
     * @returns {Array} Matching event tuples in their original order.
     */
    @meta.implemented
    _get_pending_actions(src_id, event_name)
    {
        const events = [];
        for (const [ball_id, , event] of this._system_history)
        {
            if (ball_id === src_id && event[0] === event_name) events.push(event);
        }
        return events;
    }

    /**
     * Reports whether any matching event remains in the unflushed batch.
     *
     * @param {number} src_id Safe-integer source ball identity.
     * @param {string} event_name Native event name to match.
     * @returns {boolean} Whether a matching event is queued.
     */
    @meta.implemented
    _has_pending_action(src_id, event_name)
    {
        for (const [ball_id, , event] of this._system_history)
        {
            if (ball_id === src_id && event[0] === event_name) return true;
        }
        return false;
    }

    /**
     * Preserves Python's zero-on-empty result and last-pending-value rule.
     *
     * @param {number} src_id Safe-integer source ball identity.
     * @returns {boolean|0} Last queued freedom state, or numeric zero when absent.
     */
    @meta.adapted
    has_pending_set_free(src_id)
    {
        const events = this._get_pending_actions(src_id, "SetBallFree");
        return events.length && sameTuple(events[events.length - 1][1][1], 1);
    }

    /**
     * Preserves Python's zero-on-empty result and last-pending-value rule.
     *
     * @param {number} src_id Safe-integer source ball identity.
     * @returns {boolean|0} Last queued non-freedom state, or numeric zero when absent.
     */
    @meta.adapted
    has_pending_set_not_free(src_id)
    {
        const events = this._get_pending_actions(src_id, "SetBallFree");
        return events.length && sameTuple(events[events.length - 1][1][1], 0);
    }

    /**
     * Adaptation: GetBall replaces the native balls dictionary for fallback.
     *
     * @param {number} src_id Safe-integer source ball identity.
     * @returns {number|null} Last queued value, live value, or null for a missing ball.
     */
    @meta.adapted
    get_pending_speed_fraction(src_id)
    {
        const events = this._get_pending_actions(src_id, "SetSpeedFraction");
        if (events.length) return events[events.length - 1][1][1];
        const ball = this._park.GetBall(src_id);
        return ball === null ? null : ball.speedFraction;
    }

    /**
     * Native weak-reference Signal delivery is not part of this queue subset.
     *
     * @returns {never} Throws until native Signal delivery is ported.
     */
    @meta.notImplemented
    get on_add_to_system_history()
    {
        throw new Error("Actions.on_add_to_system_history Signal is not implemented");
    }

    /**
     * Global-ball actions and their native Signal are not implemented.
     *
     * @returns {never} Throws until global actions and Signal delivery are ported.
     */
    @meta.notImplemented
    get on_ball_made_global()
    {
        throw new Error("Actions.on_ball_made_global Signal is not implemented");
    }
}

/**
 * Python tuple equality for this subset's nested arrays and scalar arguments.
 *
 * @param {unknown} a Scalar or nested tuple value.
 * @param {unknown} b Scalar or nested tuple value.
 * @returns {boolean} Whether supported scalar/tuple values compare equal.
 */
function sameTuple(a, b)
{
    if (Array.isArray(a) && Array.isArray(b))
    {
        if (a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++)
        {
            if (!sameTuple(a[i], b[i])) return false;
        }
        return true;
    }
    // Python bool is an integer subtype. Avoid JS coercion of strings or null.
    if (typeof a === "boolean" && typeof b === "number") return Number(a) === b;
    if (typeof b === "boolean" && typeof a === "number") return a === Number(b);
    return a === b;
}
