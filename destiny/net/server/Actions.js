import { meta } from "@carbonenginejs/runtime/schema";
import { CjsDestinyBall } from "../../CjsDestinyBall.js";

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
     * Adaptation: native currentTime/_currentTime both read the explicit tick counter.
     *
     * @returns {number} Zero at startup, otherwise the next tick label.
     */
    @meta.adapted
    _get_initial_stamp_for_system()
    {
        return this._park.currentTime === 0 ? 0 : this._park.currentTime + 1;
    }

    /**
     * Preserves adjacent tuple deduplication and the optional third event item.
     * Adaptation: JS arrays represent Python tuples, and keyword arguments become
     * an options object. Signal delivery is explicitly unported. Payloads are
     * retained unchanged except IDs, which normalize to BigInt. Checked ID rejection
     * occurs at queue admission rather than native execution; Number cannot retain
     * every int64 identity. The ballpark applies physical scalar conversions later.
     *
     * @param {bigint|number} ball_id Ball identity associated with the event.
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
        ball_id = CjsDestinyBall._toInt64(ball_id);
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
     * Adaptation: checked BigInt IDs replace Python integers at queue admission/query.
     *
     * @param {bigint|number} src_id Signed-int64 source ID; Number inputs must be safe integers.
     * @param {number} x Position component in meters.
     * @param {number} y Position component in meters.
     * @param {number} z Position component in meters.
     * @returns {void} No return value.
     */
    @meta.adapted
    go_to_point(src_id, x, y, z)
    {
        this._add_to_system_history(src_id, "GotoPoint", [x, y, z]);
    }

    /**
     * Queues native GotoDirection with its unmodified direction.
     * Adaptation: checked BigInt IDs replace Python integers at queue admission/query.
     *
     * @param {bigint|number} src_id Signed-int64 source ID; Number inputs must be safe integers.
     * @param {number} x Direction component.
     * @param {number} y Direction component.
     * @param {number} z Direction component.
     * @returns {void} No return value.
     */
    @meta.adapted
    go_to_direction(src_id, x, y, z)
    {
        this._add_to_system_history(src_id, "GotoDirection", [x, y, z]);
    }

    /**
     * Queues native Orbit with the target and surface range in meters.
     * Adaptation: checked BigInt IDs replace Python integers at queue admission/query.
     *
     * @param {bigint|number} src_id Signed-int64 source ID; Number inputs must be safe integers.
     * @param {bigint|number} dst_id Signed-int64 target ID; Number inputs must be safe integers.
     * @param {number} orbit_range_meters Orbit surface separation in meters.
     * @returns {void} No return value.
     */
    @meta.adapted
    orbit(src_id, dst_id, orbit_range_meters)
    {
        this._add_to_system_history(src_id, "Orbit", [CjsDestinyBall._toInt64(dst_id), orbit_range_meters]);
    }

    /**
     * Queues native SetBallVelocity in meters per second.
     * Adaptation: checked BigInt IDs replace Python integers at queue admission/query.
     *
     * @param {bigint|number} src_id Signed-int64 source ID; Number inputs must be safe integers.
     * @param {number} vx Velocity component in meters per second.
     * @param {number} vy Velocity component in meters per second.
     * @param {number} vz Velocity component in meters per second.
     * @returns {void} No return value.
     */
    @meta.adapted
    set_ball_velocity(src_id, vx, vy, vz)
    {
        this._add_to_system_history(src_id, "SetBallVelocity", [vx, vy, vz]);
    }

    /**
     * Queues native Stop; it does not immediately zero velocity.
     * Adaptation: checked BigInt IDs replace Python integers at queue admission/query.
     *
     * @param {bigint|number} src_id Signed-int64 source ID; Number inputs must be safe integers.
     * @returns {void} No return value.
     */
    @meta.adapted
    stop(src_id)
    {
        this._add_to_system_history(src_id, "Stop");
    }

    /**
     * Queues native SetBallMass in kilograms.
     * Adaptation: checked BigInt IDs replace Python integers at queue admission/query.
     *
     * @param {bigint|number} src_id Signed-int64 source ID; Number inputs must be safe integers.
     * @param {number} mass_kg Mass in kilograms.
     * @returns {void} No return value.
     */
    @meta.adapted
    set_ball_mass(src_id, mass_kg)
    {
        this._add_to_system_history(src_id, "SetBallMass", [mass_kg]);
    }

    /**
     * Queues the native linear agility multiplier.
     * Adaptation: checked BigInt IDs replace Python integers at queue admission/query.
     *
     * @param {bigint|number} src_id Signed-int64 source ID; Number inputs must be safe integers.
     * @param {number} agility Native positive mass/agility multiplier.
     * @returns {void} No return value.
     */
    @meta.adapted
    set_ball_agility(src_id, agility)
    {
        this._add_to_system_history(src_id, "SetBallAgility", [agility]);
    }

    /**
     * Queues throttle without clamping or rounding ahead of the ballpark.
     * Adaptation: checked BigInt IDs replace Python integers at queue admission/query.
     *
     * @param {bigint|number} src_id Signed-int64 source ID; Number inputs must be safe integers.
     * @param {number} speed_fraction Unmodified requested fraction of maximum speed.
     * @returns {void} No return value.
     */
    @meta.adapted
    set_speed_fraction(src_id, speed_fraction)
    {
        this._add_to_system_history(src_id, "SetSpeedFraction", [speed_fraction]);
    }

    /**
     * Queues a position with separate server-local notification metadata.
     * Adaptation: checked BigInt IDs replace Python integers at queue admission/query.
     *
     * @param {bigint|number} src_id Signed-int64 source ID; Number inputs must be safe integers.
     * @param {number} x Position component in meters.
     * @param {number} y Position component in meters.
     * @param {number} z Position component in meters.
     * @param {boolean} [is_local_ball] Server-local notification metadata, separate from position arguments.
     * @returns {void} No return value.
     */
    @meta.adapted
    set_ball_position(src_id, x, y, z, is_local_ball = false)
    {
        this._add_to_system_history(src_id, "SetBallPosition", [x, y, z],
            { local_args: is_local_ball });
    }

    /**
     * Queues native SetBallRadius in meters.
     * Adaptation: checked BigInt IDs replace Python integers at queue admission/query.
     *
     * @param {bigint|number} src_id Signed-int64 source ID; Number inputs must be safe integers.
     * @param {number} radius_meters Radius in meters.
     * @returns {void} No return value.
     */
    @meta.adapted
    set_ball_radius(src_id, radius_meters)
    {
        this._add_to_system_history(src_id, "SetBallRadius", [radius_meters]);
    }

    /**
     * Queues movement participation, defaulting to free as in Carbon.
     * Adaptation: checked BigInt IDs replace Python integers at queue admission/query.
     *
     * @param {bigint|number} src_id Signed-int64 source ID; Number inputs must be safe integers.
     * @param {boolean} [is_free] Whether the ball can move.
     * @returns {void} No return value.
     */
    @meta.adapted
    set_ball_free(src_id, is_free = true)
    {
        this._add_to_system_history(src_id, "SetBallFree", [is_free]);
    }

    /**
     * Queues native FollowBall with a surface range in meters.
     * Adaptation: checked BigInt IDs replace Python integers at queue admission/query.
     *
     * @param {bigint|number} src_id Signed-int64 source ID; Number inputs must be safe integers.
     * @param {bigint|number} dst_id Signed-int64 target ID; Number inputs must be safe integers.
     * @param {number} range_meters Surface separation in meters.
     * @returns {void} No return value.
     */
    @meta.adapted
    follow_ball(src_id, dst_id, range_meters)
    {
        this._add_to_system_history(src_id, "FollowBall", [CjsDestinyBall._toInt64(dst_id), range_meters]);
    }

    /**
     * Queues native SetMaxSpeed in meters per second.
     * Adaptation: checked BigInt IDs replace Python integers at queue admission/query.
     *
     * @param {bigint|number} src_id Signed-int64 source ID; Number inputs must be safe integers.
     * @param {number} max_meters_per_second Maximum speed in meters per second.
     * @returns {void} No return value.
     */
    @meta.adapted
    set_max_speed(src_id, max_meters_per_second)
    {
        this._add_to_system_history(src_id, "SetMaxSpeed", [max_meters_per_second]);
    }

    /**
     * Returns matching pending event tuples in their existing order.
     * Adaptation: checked BigInt IDs replace Python integers at queue admission/query.
     *
     * @param {bigint|number} src_id Signed-int64 source ID; Number inputs must be safe integers.
     * @param {string} event_name Native event name to match.
     * @returns {Array} Matching event tuples in their original order.
     */
    @meta.adapted
    _get_pending_actions(src_id, event_name)
    {
        src_id = CjsDestinyBall._toInt64(src_id);
        const events = [];
        for (const [ball_id, , event] of this._system_history)
        {
            if (ball_id === src_id && event[0] === event_name) events.push(event);
        }
        return events;
    }

    /**
     * Reports whether any matching event remains in the unflushed batch.
     * Adaptation: checked BigInt IDs replace Python integers at queue admission/query.
     *
     * @param {bigint|number} src_id Signed-int64 source ID; Number inputs must be safe integers.
     * @param {string} event_name Native event name to match.
     * @returns {boolean} Whether a matching event is queued.
     */
    @meta.adapted
    _has_pending_action(src_id, event_name)
    {
        src_id = CjsDestinyBall._toInt64(src_id);
        for (const [ball_id, , event] of this._system_history)
        {
            if (ball_id === src_id && event[0] === event_name) return true;
        }
        return false;
    }

    /**
     * Preserves Python's zero-on-empty result and last-pending-value rule.
     * Adaptation: JS tuple comparison retains Python numeric equality; query IDs
     * normalize to checked BigInt because Number cannot retain every int64 ID.
     *
     * @param {bigint|number} src_id Signed-int64 source ID; Number inputs must be safe integers.
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
     * Adaptation: JS tuple comparison retains Python numeric equality; query IDs
     * normalize to checked BigInt because Number cannot retain every int64 ID.
     *
     * @param {bigint|number} src_id Signed-int64 source ID; Number inputs must be safe integers.
     * @returns {boolean|0} Last queued non-freedom state, or numeric zero when absent.
     */
    @meta.adapted
    has_pending_set_not_free(src_id)
    {
        const events = this._get_pending_actions(src_id, "SetBallFree");
        return events.length && sameTuple(events[events.length - 1][1][1], 0);
    }

    /**
     * Adaptation: GetBall replaces the native balls dictionary for fallback;
     * checked BigInt query IDs retain identities beyond Number precision.
     *
     * @param {bigint|number} src_id Signed-int64 source ID; Number inputs must be safe integers.
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
     * Queues native warp alignment with its minimum range and integer speed factor.
     * Adaptation: checked BigInt IDs and arrays replace Python integers and tuples.
     * Source: destiny/python/destiny/net/server/_actions.py:405-429.
     * @param {bigint|number} src_id Signed-int64 ball identity.
     * @param {number} x Destination X in meters.
     * @param {number} y Destination Y in meters.
     * @param {number} z Destination Z in meters.
     * @param {number} minimum_range Distance to stop short in meters.
     * @param {number} warp_speed Native integer warp factor.
     * @returns {void} Appends the native WarpTo event.
     */
    @meta.adapted
    warp_to(src_id, x, y, z, minimum_range, warp_speed)
    {
        this._add_to_system_history(src_id, "WarpTo", [x, y, z, minimum_range, warp_speed]);
    }

    /**
     * Queues native warp-in with immediate entry and its historical five-tick offset.
     * Adaptation: checked BigInt IDs and arrays replace Python integers and tuples.
     * Source: destiny/python/destiny/net/server/_actions.py:431-450.
     * @param {bigint|number} src_id Signed-int64 ball identity.
     * @param {number} x Destination X in meters.
     * @param {number} y Destination Y in meters.
     * @param {number} z Destination Z in meters.
     * @param {number} warp_speed Native integer warp factor.
     * @returns {void} Appends the native EntityWarpIn event.
     */
    @meta.adapted
    entity_warp_in(src_id, x, y, z, warp_speed)
    {
        this._add_to_system_history(src_id, "EntityWarpIn", [x, y, z, warp_speed]);
    }

    /**
     * Queues collision participation without changing spatial membership immediately.
     * Adaptation: checked BigInt identity and JS arrays replace Python integer/tuple values.
     * Source: destiny/python/destiny/net/server/_actions.py:234-248.
     * @param {bigint|number} src_id Existing ball identity.
     * @param {boolean} is_massive Requested collision participation.
     * @returns {void} Appends SetBallMassive with its unmodified flag.
     */
    @meta.adapted
    set_ball_massive(src_id, is_massive)
    {
        this._add_to_system_history(src_id, "SetBallMassive", [is_massive]);
    }

    /**
     * Queues launch of an existing missile; collision callbacks own explosion policy.
     * Adaptation: all three IDs normalize to checked BigInt; JS arrays replace tuples.
     * Source: destiny/python/destiny/net/server/_actions.py:653-675.
     * @param {bigint|number} src_id Existing missile identity.
     * @param {bigint|number} dst_id Target identity.
     * @param {bigint|number} owner_id Signed launcher identity.
     * @param {boolean|number} is_aimed_launch Native byte flag, retained until application.
     * @param {boolean|number} is_missile_massive Native byte flag, retained until application.
     * @returns {void} Appends LaunchMissile without executing it.
     */
    @meta.adapted
    launch_missile(src_id, dst_id, owner_id, is_aimed_launch, is_missile_massive)
    {
        dst_id = CjsDestinyBall._toInt64(dst_id);
        owner_id = CjsDestinyBall._toInt64(owner_id);
        this._add_to_system_history(src_id, "LaunchMissile", [dst_id, owner_id, is_aimed_launch, is_missile_massive]);
    }

    /**
     * Queues delayed troll petrification at the current history stamp.
     * Adaptation: checked BigInt identity and JS arrays replace Python values.
     * Source: destiny/python/destiny/net/server/_actions.py:133-148.
     * @param {bigint|number} src_id Ball identity.
     * @param {number} delay_ticks Tick delay, validated when applied by the park.
     * @returns {void} Appends SetBallTroll without executing it.
     */
    @meta.adapted
    set_ball_troll(src_id, delay_ticks)
    {
        this._add_to_system_history(src_id, "SetBallTroll", [delay_ticks]);
    }

    /**
     * Queues field participation before harmonic affiliation when enabling a field.
     * Adaptation: harmonic normalizes to checked BigInt before sentinel comparison;
     * JS arrays replace Python tuples. Core controller calls do not set massiveness.
     * Source: destiny/python/destiny/net/server/_actions.py:475-508.
     * @param {bigint|number} src_id Ball identity.
     * @param {bigint|number} harmonic_value Signed-int64 collision harmonic.
     * @param {number} corporation_id Corporation value, retained until application.
     * @param {number} alliance_id Alliance value, retained until application.
     * @param {boolean} is_forcefield Whether to enter field mode.
     * @returns {void} Appends one harmonic event and, for fields, one massiveness event.
     */
    @meta.adapted
    set_ball_harmonic(src_id, harmonic_value, corporation_id, alliance_id, is_forcefield)
    {
        harmonic_value = CjsDestinyBall._toInt64(harmonic_value);
        if (is_forcefield)
            this.set_ball_massive(src_id, harmonic_value !== -1n || corporation_id !== -1 || alliance_id !== -1);
        this._add_to_system_history(src_id, "SetBallHarmonic", [harmonic_value, corporation_id, alliance_id, is_forcefield]);
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
    if (typeof a === "boolean") a = Number(a);
    if (typeof b === "boolean") b = Number(b);
    if (typeof a === "number" && typeof b === "bigint") return Number.isInteger(a) && BigInt(a) === b;
    if (typeof b === "number" && typeof a === "bigint") return Number.isInteger(b) && a === BigInt(b);
    return a === b;
}
