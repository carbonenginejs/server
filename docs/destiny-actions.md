# Destiny action queue

Status: Evolving
Scope: Native command history, immediate global/removal operations and signal/timer integration
Audience: Server and demo maintainers
Summary: Carbon command admission and its immediate side effects before server ticker distribution.

Import `Actions` from `@carbonenginejs/server/destiny/net/server` after building
the server package. It ports all command methods in
`destiny/python/destiny/net/server/_actions.py` at donor revision
`114e89fa584f0e1a81eb0a679aabf41af8870072`. Native Python method names are retained;
event names retain the ballpark's native PascalCase names.

## Current contract

Movement queue calls do not mutate balls. Global/local changes and removal have
immediate side effects described below. `flush_history()` hands the current batch to
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
| `warp_to`, `entity_warp_in` | `WarpTo`, `EntityWarpIn` |
| `cloak_ball`, `uncloak_ball` | `CloakBall`, `UncloakBall` |
| `launch_missile`, `set_ball_massive` | `LaunchMissile`, `SetBallMassive` |
| `set_ball_troll`, `set_ball_harmonic` | `SetBallTroll`, `SetBallHarmonic` |
| `set_ball_velocity`, `set_ball_position` | `SetBallVelocity`, `SetBallPosition` |
| `set_ball_mass`, `set_ball_agility`, `set_ball_radius` | `SetBallMass`, `SetBallAgility`, `SetBallRadius` |
| `set_speed_fraction`, `set_max_speed`, `set_ball_free` | `SetSpeedFraction`, `SetMaxSpeed`, `SetBallFree` |
| `set_ball_angular_velocity`, `set_ball_rotation` | `SetBallAngularVelocity`, `SetBallRotation` |
| `set_ball_angular_agility`, `set_max_angular_speed` | `SetBallAngularAgility`, `SetMaxAngularSpeed` |
| `set_max_angular_velocity`, `set_ball_interactive` | `SetMaxAngularVelocity`, `SetBallInteractive` |

All five angular methods require dynamical orientation at admission. Carbon's
three-component SetMaxAngularVelocity event has no matching public donor C++/Blue
method; the port preserves that unresolved action rather than substituting the
different scalar SetMaxAngularSpeed command.

`make_ball_global` immediately updates global state, serializes a selected native
ball stream as AddBallsToPark, then emits on_ball_made_global. A missing source
still produces a header-only stream and the signal. `make_ball_local` immediately
clears global state, then queues BallNotGlobal with only the current bubble ID;
a missing source logs and returns. `remove_ball` requires an existing source,
queues RemoveGlobalBall when global, then immediately removes through the core
owner. Earlier queued commands remain. These operations are not transactional.

`clean_up_followers` queues Stop for each native remote-follower result without
changing the stamp or live motion. Pending interactive state uses the last queued
flag before falling back to the live flag or null.

When enabling a forcefield, `set_ball_harmonic` first queues SetBallMassive:
true if any affiliation differs from -1, false otherwise. It then queues harmonic
state. Disabling a field queues only harmonic state. Direct SetBallHarmonic does
not change massiveness. Harmonic values normalize to signed-int64 BigInt.

Cloak events carry a third item containing the old bubble when the ball is
changing bubbles, otherwise the current bubble (including zero or -1). Cloaking
a missing ball returns false; uncloak still queues missing IDs. Pending cloak
mode reads the last queued cloak, even after a later uncloak or ball removal,
then falls back to live numeric state or null. undo_pending_cloak removes every
matching cloak while retaining other entries and their order. Native ticker
routing and same-tick cloak/uncloak conflict handling are still unported; the
simple loop below does not implement those policies.

The initial stamp is zero when the park's `currentTime` is zero, otherwise `currentTime + 1`.
`set_stamp_for_system(stamp)` labels subsequent commands. Stamps are tick
counters, not wall-clock times. This queue does not sort commands, defer arbitrary
future stamps, discard old entries or provide a timer.

Only an identical immediately preceding complete entry is suppressed. The
comparison includes its stamp and local metadata, and preserves Python's
boolean/integer equality and native byte-string content equality. Admission emits
on_add_to_system_history even when an adjacent duplicate is suppressed.
Commands separated by another command remain. This
is not network or provider-message idempotency. Equality includes Number/BigInt
and boolean equivalents without coercing strings or null.

IDs normalize to checked signed-int64 BigInts when enqueued or queried, including
Follow/Orbit targets and missile target/owner IDs. Safe integer Number IDs are accepted; unsafe or out-of-range
IDs throw at admission. This is earlier than native Python argument rejection.
Other payloads remain unchanged until the ballpark executes each command. In
particular, queueing does not clamp throttle or round parameters to float32.
Pending speed queries return the last queued value, then the live ball value,
or null for a missing ball. Pending freedom queries use the last queued flag
and preserve the donor's numeric zero when no matching action exists.

BigInt history entries are in-process values; ordinary JSON.stringify cannot
serialize them. Actions defines no JSON wire encoding. Native binary ball streams
are implemented; packaged actions still require the external Blue marshal codec.

## Host tick example

This example applies ordinary movement commands only. Global/removal notifications,
cloaking and recipient routing require the server ticker orchestration still being ported.

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
    // Supported movement methods have at most six arguments.
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
- Weak Signal slots use explicit receiver pairs and emission, described below.
- Native profiling is available through a supplied taskletTimer host; it is
  omitted when the host is absent. Python diagnostic logging is only partially mapped.
- Server tick scheduling, batch application and recipient routing remain separate
  work. Native ball-stream writing/restoration and client replay are implemented
  in their owning modules; Actions only admits or immediately performs its commands.

## Signal and profiling integration

The two Actions signals support `signal.connect(callback)` and
`signal.connect(receiver.method, receiver)`. Retain callbacks and receivers for
as long as they should remain connected: both are weakly held. JS bound functions
hide their original receiver; the explicit pair preserves native identity and
deduplication. Disconnect takes the same arguments. Each emission snapshots live
slots, so callback edits affect subsequent emissions. A monitor runs before that
snapshot; its exceptions propagate, while synchronous handler exceptions log and
allow delivery to continue.

Import `Signal` from `@carbonenginejs/server/destiny/_util/signal` when a native
consumer needs another signal. Use `signal.__call__([arg1, arg2], { keyword: value })`:
JS cannot call a class instance or pass Python keyword arguments directly. Nonempty
keyword mappings become a fresh trailing options object per handler; nested values
remain shared. Arrows are accepted because JS has no reliable Python lambda
classification. Free functions precede receiver methods; order within those
groups is a JS insertion-order adaptation. Dispatch does not await promises or
catch later promise rejections. Collection timing follows JavaScript WeakRef.

`Timer` and `TimedFunction` live at `@carbonenginejs/server/destiny/_util/timing`.
They require a synchronous host exposing EnterTasklet and ReturnFromTasklet;
the Blue profiling service itself remains external. Supply it to Actions as
`new Actions(park, { taskletTimer })` to instrument follower cleanup and cloak
pruning with the native labels. Wrappers return the entered token in finally,
including on failure, and preserve synchronous native scope around returned promises.

`test/actions.test.js` translates donor command fixtures from
`python/destiny/test/net/server/test_actions.py`, checks timestamp/deduplication
and pending-value rules, and compares pre-tick queued application against
direct commands on the existing movement park. No native executable is run.
The completion checkpoint adds all 24 remaining donor Actions cases plus
source-derived Signal/timing and binding regressions. The full suite has 885 tests;
this does not establish complete server ticker or transport parity.
