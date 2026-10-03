# Destiny action queue

Status: Evolving
Scope: In-process movement action history; no transport or automatic tick driver
Audience: Server and demo maintainers
Summary: Queue Carbon-shaped movement actions for application at a simulation tick boundary.

Import `Actions` from `@carbonenginejs/server/destiny/net/server` after building
the server package. It ports the supported movement subset of
`destiny/python/destiny/net/server/_actions.py` at donor revision
`114e89fa584f0e1a81eb0a679aabf41af8870072`. Native Python method names are retained;
event names retain the ballpark's native PascalCase names.

## Current contract

Queue calls do not mutate balls. `flush_history()` hands the current batch to
the caller and replaces it with an empty array. Each entry is:

```js
[ballId, stamp, [eventName, [ballId, ...parameters]]]
```

`set_ball_position` includes a third event item, `is_local_ball`, even when
false. That value controls future notification routing; it is not an extra
argument to `SetBallPosition`.

| Queue method | Ballpark event |
|---|---|
| `go_to_point`, `go_to_direction` | `GotoPoint`, `GotoDirection` |
| `orbit`, `follow_ball`, `stop` | `Orbit`, `FollowBall`, `Stop` |
| `set_ball_velocity`, `set_ball_position` | `SetBallVelocity`, `SetBallPosition` |
| `set_ball_mass`, `set_ball_agility`, `set_ball_radius` | `SetBallMass`, `SetBallAgility`, `SetBallRadius` |
| `set_speed_fraction`, `set_max_speed`, `set_ball_free` | `SetSpeedFraction`, `SetMaxSpeed`, `SetBallFree` |

The initial stamp is zero when the park's `currentTime` is zero, otherwise `currentTime + 1`.
`set_stamp_for_system(stamp)` labels subsequent commands. Stamps are tick
counters, not wall-clock times. This queue does not sort commands, defer arbitrary
future stamps, discard old entries or provide a timer.

Only an identical immediately preceding complete entry is suppressed. The
comparison includes its stamp and local metadata, and preserves Python's
boolean/integer equality. Commands separated by another command remain. This
is not network or provider-message idempotency.

Numbers remain unchanged until the ballpark executes each command. In
particular, queueing does not clamp throttle or round parameters to float32.
Pending speed queries return the last queued value, then the live ball value,
or null for a missing ball. Pending freedom queries use the last queued flag
and preserve the donor's numeric zero when no matching action exists.

## Host tick example

This minimal caller illustrates Carbon's pre-tick phase order. It is not a
port of the server `Ticker`, a remote-command dispatcher or a replication wire.
The park's `Evolve()` advances its cached step, one second by default.

```js
import { CjsBallparkController } from "@carbonenginejs/server/destiny";
import { Actions } from "@carbonenginejs/server/destiny/net/server";

const park = new CjsBallparkController();
park.AddBall(1, 13000000, 2, 10, true, false, false, false, false,
    0, 0, 0, 0, 0, 0, 0.9, 0.95);
const actions = new Actions(park);

actions.go_to_direction(1, 1, 0, 0);

// Advance the stamp before detaching the prior batch. New inputs belong to
// the next batch even if they arrive during application of the current one.
actions.set_stamp_for_system(park.currentTime + 1);
const history = actions.flush_history();
for (const [, , [method, args]] of history)
{
    // Only tuples produced by this trusted, in-process Actions instance.
    // Supported movement methods have at most four arguments.
    park[method](...args);
}
park.Evolve();
```

Player, autonomous and accepted stream commands can share this queue, but
admission, player ownership and provider-message deduplication belong to their
host. Do not feed remote method names directly into the example loop. The host
also owns failures: a flushed batch is detached, and execution is not transactional.

## Explicit adaptations and remaining work

- Arrays represent Python tuples. They remain mutable, consistent with this
  package's data contract; the receiver owns a flushed batch.
- JS `currentTime` serves native `currentTime`/`_currentTime`; `GetBall` replaces
  the `balls` dictionary. The separate `time` timestamp is never an action stamp.
- Native weak-reference `Signal` is unported. Accessing either signal property
  throws explicitly. This subset omits enqueue notifications, including the
  notification Carbon sends for a suppressed duplicate.
- Warp, angular controls, cloak, global/bubble actions, stream serialization,
  follower cleanup and removal wrappers are not exported by this subset.
  Native `remove_ball` performs immediate removal and must not later be
  misrepresented as an ordinary queued action.
- Tick scheduling, batch application, binary state, replication, client
  prediction and reconciliation are not implemented by `Actions`.

`test/actions.test.js` translates donor command fixtures from
`python/destiny/test/net/server/test_actions.py`, checks timestamp/deduplication
and pending-value rules, and compares pre-tick queued application against
direct commands on the existing movement park. No native executable is run.
