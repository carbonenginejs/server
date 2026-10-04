import assert from "node:assert/strict";
import test from "node:test";
import { CjsBallparkController as Park, CjsDestinyStream as Stream } from "@carbonenginejs/server";
import { Actions } from "@carbonenginejs/server/destiny/net/server";
import { enable_dynamical_orientation, disable_dynamical_orientation, reset_settings_to_default } from "@carbonenginejs/server/destiny/_util/settings";

const add = (park, id = 1001) => park.AddBall(id, 1e6, 1, 100, true, false, false, true, false, 240, 240, 240, 0, 0, 0, 1, 1);
const setup = () => { const park = new Park(); park.isMaster = true; return [park, new Actions(park)]; };
// Source: destiny/python/destiny/test/net/server/test_actions.py:151-273,369-398,430-438,526-539.
const angular = [
    ["set_ball_angular_velocity", "SetBallAngularVelocity", [1, 2, 3]],
    ["set_max_angular_velocity", "SetMaxAngularVelocity", [1, 2, 3]],
    ["set_ball_rotation", "SetBallRotation", [0, 0.1, 0.2, 0.3]],
    ["set_ball_angular_agility", "SetBallAngularAgility", [0.3]],
    ["set_max_angular_speed", "SetMaxAngularSpeed", [0.7]]
];
for (const [method, event, args] of angular)
{
    test(`donor enabled ${method} enqueues native tuple`, () =>
    {
        enable_dynamical_orientation();
        try { const [, actions] = setup(); actions[method](1001n, ...args);
            assert.deepEqual(actions.flush_history(), [[1001n, 0, [event, [1001n, ...args]]]]); }
        finally { reset_settings_to_default(); }
    });
    test(`donor disabled ${method} throws before queue admission`, () =>
    {
        disable_dynamical_orientation();
        try { const [, actions] = setup(); assert.throws(() => actions[method](1001n, ...args), /Dynamical Orientation/);
            assert.deepEqual(actions.flush_history(), []); }
        finally { reset_settings_to_default(); }
    });
}
test("donor add_ball_to_client_parks carries only reconstructable native bytes", () =>
{
    const [park, actions] = setup(), ball = add(park); actions.add_ball_to_client_parks(ball.id);
    const [[id, stamp, [name, args]]] = actions.flush_history();
    assert.equal(id, ball.id); assert.equal(stamp, 0); assert.equal(name, "AddBallsToPark"); assert.equal(args.length, 1);
    const replica = new Park(); replica.ReadFullStateFromStream(new Stream(args[0]));
    const copy = replica.GetBall(ball.id); assert.equal(copy.radius, ball.radius); assert.equal(copy.mass, ball.mass);
    assert.equal(copy.maxVelocity, ball.maxVelocity); assert.deepEqual(copy.mNewPos, ball.mNewPos);
});
test("donor make_ball_local changes state immediately and queues only bubble metadata", () =>
{
    const [park, actions] = setup(), ball = add(park); park.SetBallGlobal(ball.id, true);
    actions.make_ball_local(ball.id); assert.equal(ball.isGlobal, false); assert.equal(park.mGlobals.has(ball.id), false);
    assert.deepEqual(actions.flush_history(), [[ball.id, 0, ["BallNotGlobal", [ball.newBubbleId]]]]);
});
test("donor make_ball_global changes flag immediately", () =>
{
    const [park, actions] = setup(), ball = add(park); actions.make_ball_global(ball.id);
    assert.equal(ball.isGlobal, true); assert.equal(park.mGlobals.get(ball.id), ball);
});
test("donor make_ball_global queues full client addition", () =>
{
    const [park, actions] = setup(), ball = add(park); actions.make_ball_global(ball.id);
    const bytes = actions.flush_history()[0][2][1][0], replica = new Park();
    replica.ReadFullStateFromStream(new Stream(bytes)); assert.equal(replica.GetBall(ball.id).isGlobal, true);
});
test("donor make_ball_global signals source after state change and admission", () =>
{
    const [park, actions] = setup(), ball = add(park), seen = [];
    function callback(id) { assert.equal(ball.isGlobal, true); assert.equal(actions._system_history.length, 1); seen.push(id); }
    actions.on_ball_made_global.connect(callback); actions.make_ball_global(ball.id); assert.deepEqual(seen, [ball.id]);
});
test("donor remove_ball removes immediately", () =>
{
    const [park, actions] = setup(), ball = add(park); actions.remove_ball(ball.id); assert.equal(park.balls.has(ball.id), false);
});
test("donor nonglobal removal queues nothing", () =>
{
    const [park, actions] = setup(), ball = add(park); actions.remove_ball(ball.id); assert.deepEqual(actions.flush_history(), []);
});
test("donor global removal queues notification before native deletion", () =>
{
    const [park, actions] = setup(), ball = add(park); park.SetBallGlobal(ball.id, true);
    function callback(name) { assert.equal(name, "RemoveGlobalBall"); assert.equal(park.balls.has(ball.id), true); }
    actions.on_add_to_system_history.connect(callback);
    park.RemoveBall = () => assert.fail("parent removal bypasses game override"); actions.remove_ball(ball.id);
    assert.equal(park.balls.has(ball.id), false);
    assert.deepEqual(actions.flush_history(), [[ball.id, 0, ["RemoveGlobalBall", [ball.id]]]]);
});
for (const state of [true, false]) test(`donor interactive ${state} stays queued`, () =>
{
    const [park, actions] = setup(), ball = add(park); actions.set_ball_interactive(ball.id, state);
    assert.equal(ball.isInteractive, true);
    assert.deepEqual(actions.flush_history(), [[ball.id, 0, ["SetBallInteractive", [ball.id, state]]]]);
});
test("donor follower cleanup queues Stop without immediate state mutation", () =>
{
    const [park, actions] = setup(), follower = add(park, 1), target = add(park, 2);
    park.FollowBall(follower.id, target.id, 1000); park.SetBallPosition(follower.id, 5e8, 0, 0);
    const mode = follower.mode; actions.clean_up_followers(); assert.equal(follower.mode, mode);
    assert.deepEqual(actions.flush_history(), [[follower.id, 0, ["Stop", [follower.id]]]]);
});
test("donor pending interactive returns null for absent source", () =>
{
    const [, actions] = setup(); assert.equal(actions.get_pending_interactive_state(1), null);
});
test("donor pending interactive falls back to live flag", () =>
{
    const [park, actions] = setup(), ball = add(park); assert.equal(actions.get_pending_interactive_state(ball.id), true);
});
test("donor pending interactive returns last queued state", () =>
{
    const [park, actions] = setup(), ball = add(park); actions.set_ball_interactive(ball.id, false);
    assert.equal(actions.get_pending_interactive_state(ball.id), false);
});
test("duplicate admission still signals; fresh identical streams compare by bytes", () =>
{
    const [park, actions] = setup(), ball = add(park), names = [];
    function callback(name) { names.push(name); }
    actions.on_add_to_system_history.connect(callback);
    actions.add_ball_to_client_parks(ball.id); actions.add_ball_to_client_parks(ball.id);
    assert.equal(actions._system_history.length, 1); assert.deepEqual(names, ["AddBallsToPark", "AddBallsToPark"]);
    ball.x += 1; actions.add_ball_to_client_parks(ball.id); assert.equal(actions._system_history.length, 2);
});
test("missing global/local/removal preserve native different admission paths", () =>
{
    const [, actions] = setup(), seen = [];
    function callback(id) { seen.push(id); }
    actions.on_ball_made_global.connect(callback); actions.make_ball_local(1); assert.deepEqual(actions.flush_history(), []);
    actions.make_ball_global(1); const bytes = actions.flush_history()[0][2][1][0];
    assert.equal(bytes.length, 5); assert.deepEqual(seen, [1n]); assert.throws(() => actions.remove_ball(1), /not in park/);
});
test("global binding maintains registry without spatial changes or an evolution guard", () =>
{
    const [park] = setup(), ball = add(park), bubble = ball.newBubbleId; park.inEvolve = true;
    park.PySetBallGlobal(ball.id, -2n); assert.equal(ball.isGlobal, true); assert.equal(ball.newBubbleId, bubble);
    park.PySetBallGlobal(ball.id, 0n); assert.equal(ball.isGlobal, false); assert.equal(park.mGlobals.has(ball.id), false);
    assert.throws(() => park.PySetBallGlobal(ball.id, 2147483648), RangeError);
    assert.throws(() => park.PySetBallGlobal(ball.id, "1"), TypeError);
    assert.throws(() => park.PySetBallGlobal(null, 2147483648), /integer ID/);
    park.mGlobals.set(ball.id, ball); park.SetBallGlobal(ball.id, false);
    assert.equal(park.mGlobals.has(ball.id), true, "native false flag does not repair stale registry");
});
test("pending interactive uses Python numeric and empty-container truth values", () =>
{
    const [, actions] = setup();
    for (const [value, expected] of [[0, false], [NaN, true], [[], false], [[0], true], [new Map(), false], [2n, true]])
    { actions.set_ball_interactive(1, value); assert.equal(actions.get_pending_interactive_state(1), expected); }
});
