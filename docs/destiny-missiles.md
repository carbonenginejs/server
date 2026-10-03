# Destiny missile movement

Status: Evolving
Scope: Ballpark launch and pursuit, collision events and queued missile actions
Audience: Simulation and gameplay integrators
Summary: Launch existing balls and receive Carbon's physical missile collision events.

## Usage

`LaunchMissile(id, targetId, ownerId, aimedLaunch, massive)` is Carbon's Blue alias
for `PyLaunchMissile`. All five arguments are required. Create the missile first;
launch neither creates a ball nor changes whether it is free. Both flags accept
booleans or byte integers. Only aimed value one selects an aimed launch; nonzero
massive sets massiveness, while zero preserves the previous flag.

```js
import { CjsBallparkController } from "@carbonenginejs/server";

const park = new CjsBallparkController();
park.AddBall(1, 13000000, 2, 10, false, false, true, false, false,
    1000000, 0, 0, 0, 0, 0, 0.9, 1);
park.AddBall(2, 13000000, 2, 10, false, false, true, false, false,
    0, 0, 0, 0, 0, 0, 0.9, 1);
const missile = park.AddBall(3, 10000, 2, 300, true, false, true, false, false,
    0, 0, 0, 0, 0, 0, 0.01, 1);
park.LaunchMissile(missile.id, 1, 2, true, true);
for (let tick = 0; tick < 20; ++tick) park.Evolve();
```

`Actions.launch_missile` queues the same five arguments.
`SetBallMassive(id, flag)` and `Actions.set_ball_massive` explicitly change
participation without moving or reinserting the object. See [action queue](destiny-actions.md).

## Motion and guard ordering

Launch copies the owner's position. Aimed velocity is the unit direction toward
an uncloaked target. Otherwise it adds at least 150m/s along the owner's current
velocity, or rotated local negative Z when stationary. The rotated float32
direction is widened without renormalizing. A missing owner returns immediately;
a cloaked target returns after position/velocity setters. A missing target uses
GotoDirection only when the captured owner maximum velocity is positive.

`MissileFollow` is the native core. It rejects equal signed IDs and missing or
moribund targets before stopping the old command, but rejects cloak or a bubble
mismatch after stopping it. A missing owner is tolerated. Its initial waypoint
is normalized velocity times 1e16 without adding missile position. The mode-change
callback sees the installed fields before target follower membership is added.
`PyMissileFollow` separately rejects negative targets, as does launch.

For elapsed time at or below 800ms, the missile uses ordinary goto thrust.
Thereafter it predicts target position using distance divided by maximum speed
and bypasses goto's close-distance braking. Native float32 radius addition occurs
before the negative follow range is stored; summing these fields as doubles later
need not cancel. Zero speed and radius overflow retain native nonfinite results.
Target removal changes the missile to nonmassive GOTO through StopAllFollowers.

Both collision solvers are supported. Nonnegative-owner missiles consider their
same-bubble target; negative-owner defender missiles consider nearby candidates.
Owner lookup at launch/completion uses the absolute ID while collision exclusions
retain its sign. Capsule/OrientedBox static checks exclude missiles, but fixed
MiniBall sphere candidates remain eligible. The legacy target-contact force
exemption is not added to the iterative impulse algorithm.

## Collision delivery

Provide the park's PyOS host as described in [movement API](../destiny/README.md).
Missile completion dispatches:

```text
SendEvent(ball, "Destiny::Ball::DoCollision", "DoCollision",
          null, "Lddd", colliderId, lastCx, lastCy, lastCz)
```

Delivery happens after movement commit, orientation and spatial reinsertion.
Displacement squared below 0.1 skips both reinsertion and delivery, even owner
checks. Reinsertion callbacks may change the mode before the missile check.
Iterative histories append every collider except -1, retaining zero and duplicates.
Masters then append self-contact if the absolute owner is missing, cloaked, or in
another bubble while the missile's bubble is not -1. Replicas skip owner checks.

Dispatch captures the initial contact count and injected host. Each event rereads
the current contact ID and force; appended contacts wait for a later call. False
delivery calls PyError and continues. Dispatch neither clears contacts nor removes
the missile. EvolveBehaviorForBall clears contacts at the next active tick.
The host owns explosion, damage and removal policy. Detached balls have no host.

## Provenance and validation

All ranges below use Destiny baseline `114e89f`.

| Behavior | Carbon source |
|---|---|
| Launch and Blue alias | `Thunkers.cpp:857-946`; `Ballpark_Blue.cpp:695-700` |
| Pursuit commands and wrapper | `Ballpark.cpp:3798-3872`; `Thunkers.cpp:275-299` |
| Pursuit and goto thrust | `Ballpark.cpp:972-1011,1398-1425` |
| Massiveness setter | `Ballpark.cpp:5074-5085` |
| Candidate selection | `Partition.cpp:302-324` |
| Completion and dispatch | `Ballpark.cpp:601-638`; `Ball.cpp:468-488` |
| Queued actions | `python/destiny/net/server/_actions.py:234-248,653-675` |

The tests translate four donor flight scenarios from `evolve/test_missile.py`
under both solvers and the launch fixtures in `test_movement_controls.py`.
Additional source-derived tests exercise actual hits, phase-isolated completion
ordering, signed owner handling, callback mutation, overflow, pool reentry and
exceptions. Native executable parity and game damage behavior are not asserted.
Dynamic orientation and its missile-only exception use the [global settings](destiny-settings.md).
