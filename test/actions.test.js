import assert from "node:assert/strict";
import test from "node:test";
import { CjsSchema } from "@carbonenginejs/runtime/schema";
import { CjsBallparkController } from "@carbonenginejs/server/destiny";
import { Actions } from "@carbonenginejs/server/destiny/net/server";

const ID = 1000000000001n;
const TARGET = 1000000000002n;

// Expected event tuples copied from CCP's test_actions.py, not derived by the port.
// Source: destiny/python/destiny/test/net/server/test_actions.py:86-386.
const cases = [
    ["go_to_point", [ID, 100, 200, 300], ["GotoPoint", [ID, 100, 200, 300]]],
    ["go_to_direction", [ID, 100, 200, 300], ["GotoDirection", [ID, 100, 200, 300]]],
    ["orbit", [ID, TARGET, 123], ["Orbit", [ID, TARGET, 123]]],
    ["set_ball_velocity", [ID, 333.3, 666.6, 999.9], ["SetBallVelocity", [ID, 333.3, 666.6, 999.9]]],
    ["stop", [ID], ["Stop", [ID]]],
    ["set_ball_mass", [ID, 72.6], ["SetBallMass", [ID, 72.6]]],
    ["set_ball_agility", [ID, 3.141592], ["SetBallAgility", [ID, 3.141592]]],
    ["set_speed_fraction", [ID, 0.5], ["SetSpeedFraction", [ID, 0.5]]],
    ["set_ball_position", [ID, 123, 456, 789], ["SetBallPosition", [ID, 123, 456, 789], false]],
    ["set_ball_position", [ID, 123, 456, 789, true], ["SetBallPosition", [ID, 123, 456, 789], true]],
    ["set_ball_radius", [ID, 42], ["SetBallRadius", [ID, 42]]],
    ["set_ball_free", [ID], ["SetBallFree", [ID, true]]],
    ["set_ball_free", [ID, false], ["SetBallFree", [ID, false]]],
    ["follow_ball", [ID, TARGET, 1000], ["FollowBall", [ID, TARGET, 1000]]],
    ["set_max_speed", [ID, 500], ["SetMaxSpeed", [ID, 500]]]
];

for (const [method, args, expected] of cases)
{
    test(`Carbon Actions tuple: ${method} ${JSON.stringify(args, (_, value) => typeof value === "bigint" ? `${value}n` : value)}`, () =>
    {
        const actions = new Actions(new CjsBallparkController());
        actions[method](...args); // Donor fixture arity is bounded to five.
        assert.deepEqual(actions.flush_history(), [[ID, 0, expected]],
            "destiny/python/destiny/test/net/server/test_actions.py");
        assert.deepEqual(actions.flush_history(), []);
    });
}

test("Carbon Actions adjacent dedupe preserves intervening commands and tick stamps", () =>
{
    // Source: test_actions.py:92-125; _actions.py:60-64.
    const actions = new Actions(new CjsBallparkController());
    actions.go_to_point(ID, 100, 200, 300);
    actions.go_to_point(ID, 100, 200, 300);
    actions.stop(ID);
    actions.go_to_point(ID, 100, 200, 300);
    actions.set_stamp_for_system(1);
    actions.go_to_point(ID, 100, 200, 300);
    const go = ["GotoPoint", [ID, 100, 200, 300]];
    assert.deepEqual(actions.flush_history(), [
        [ID, 0, go], [ID, 0, ["Stop", [ID]]], [ID, 0, go], [ID, 1, go]
    ]);
});

test("position metadata and Python bool/integer equality participate in dedupe", () =>
{
    // Source: _actions.py:36-64,452-473. Python tuple equality includes local_args.
    const actions = new Actions(new CjsBallparkController());
    actions.set_ball_position(ID, 1, 2, 3, false);
    actions.set_ball_position(ID, 1, 2, 3, true);
    actions.set_ball_free(ID, true);
    actions.set_ball_free(ID, 1);
    assert.equal(actions.flush_history().length, 3);
});

test("stamps label batches without sorting, scheduling or mutating prior history", () =>
{
    // Source: _actions.py:31-34,66-79.
    const park = new CjsBallparkController();
    park.Evolve();
    park.Evolve();
    const actions = new Actions(park);
    actions.stop(ID);
    const previous = actions.flush_history();
    assert.deepEqual(previous, [[ID, 3, ["Stop", [ID]]]]);
    actions.set_stamp_for_system(10);
    actions.stop(ID);
    actions.set_stamp_for_system(4);
    actions.stop(ID);
    assert.deepEqual(actions.flush_history().map(entry => entry[1]), [10, 4]);
    assert.deepEqual(previous, [[ID, 3, ["Stop", [ID]]]]);
});

/** Creates the existing donor-fixture movement park without assets or transport. */
function movingPark()
{
    const park = new CjsBallparkController();
    park.AddBall(ID, 13000000, 2, 10, true, false, false, false, false,
        0, 0, 0, 0, 0, 0, 0.9, 0.95);
    return park;
}

test("pending values use last queued command, native empty result and live fallback", () =>
{
    // Source: _actions.py:744-766; test_actions.py:497-525,542-555.
    const park = movingPark();
    const actions = new Actions(park);
    assert.equal(actions.has_pending_set_free(ID), 0);
    assert.equal(actions.has_pending_set_not_free(ID), 0);
    assert.equal(actions.get_pending_speed_fraction(TARGET), null);
    assert.equal(actions.get_pending_speed_fraction(ID), park.GetBall(ID).speedFraction);
    actions.set_ball_free(ID, false);
    actions.set_ball_free(ID, true);
    assert.equal(actions.has_pending_set_free(ID), true);
    assert.equal(actions.has_pending_set_not_free(ID), false);
    actions.set_ball_free(ID, false);
    assert.equal(actions.has_pending_set_free(ID), false);
    assert.equal(actions.has_pending_set_not_free(ID), true);
    actions.set_speed_fraction(ID, 0.2);
    actions.set_speed_fraction(TARGET, 0.9);
    actions.set_speed_fraction(ID, 1.123456789);
    assert.equal(actions.get_pending_speed_fraction(ID), 1.123456789);
    assert.equal(park.GetBall(ID).speedFraction, Math.fround(0.95));
    actions.flush_history();
    assert.equal(actions.get_pending_speed_fraction(ID), park.GetBall(ID).speedFraction);
});

test("queued movement applied before Evolve matches direct commands and delays reentrant input", () =>
{
    // Native phase order: server/_baseticker.py:23-32, _ticker.py:61-79,106-122;
    // Ballpark.cpp:290-299 sends DoPreTick before Evolve.
    const queued = movingPark();
    const direct = movingPark();
    const actions = new Actions(queued);
    actions.set_ball_position(ID, 2, 3, 4, true);
    actions.set_speed_fraction(ID, 0.8123456789);
    actions.go_to_direction(ID, 1, 2, 3);
    assert.equal(queued.GetBall(ID).x, 0, "enqueue must not execute");

    actions.set_stamp_for_system(queued.currentTime + 1);
    const batch = actions.flush_history();
    actions.stop(ID); // Input arriving while the prior batch is being processed.
    for (const [, stamp, [method, args]] of batch)
    {
        assert.equal(stamp, 0);
        // Only trusted, in-process Actions tuples are dispatched. No remote method invocation.
        queued[method](...args); // Supported action arity is bounded to four.
    }
    direct.SetBallPosition(ID, 2, 3, 4);
    direct.SetSpeedFraction(ID, 0.8123456789);
    direct.GotoDirection(ID, 1, 2, 3);
    queued.Evolve();
    direct.Evolve();
    assert.deepEqual(queued.GetBall(ID), direct.GetBall(ID));
    assert.deepEqual(actions.flush_history(), [[ID, 1, ["Stop", [ID]]]]);
});

test("Actions declares partial provenance and fails explicitly for unported signals", () =>
{
    const actions = new Actions(new CjsBallparkController());
    assert.equal(CjsSchema.getClassName(Actions), "Actions");
    assert.equal(CjsSchema.getSchema(Actions).modelledOn, "destiny.net.server.Actions");
    assert.throws(() => actions.on_add_to_system_history, /not implemented/);
    assert.throws(() => actions.on_ball_made_global, /not implemented/);
    assert.equal(Actions.prototype.warp_to, undefined, "no phantom warp support");
});
