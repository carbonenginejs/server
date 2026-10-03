# Destiny warp simulation

Status: Evolving
Scope: Ballpark warp commands, evolution, ClientBall sampling and queued actions
Audience: Simulation and renderer integrators
Summary: Run Carbon's alignment and warp phases on the shared simulation clock.

## Usage

`WarpTo(id, x, y, z, minRange = 20000, warpFactor = 20)` begins alignment.
Distances are meters; the integer factor is in thousandths of AU per second.
`EntityWarpIn(id, x, y, z, warpFactor)` enters immediately, using Carbon's
five-tick backdating and initial velocity of one AU per second. Apply commands
before evolving the park. Queued equivalents are `Actions.warp_to` and
`Actions.entity_warp_in`; they retain native history tuples and do not execute
or transport the command themselves.

```js
import { CjsBallparkController } from "@carbonenginejs/server";

const park = new CjsBallparkController();
const ball = park.AddBall(1, 13000000, 2, 100, true, false, true, false, false,
    0, 0, 0, 0, 0, 0, 0.9, 0.95);
park.WarpTo(ball.id, 1000000, 0, 0, 20000, 1000);
for (let tick = 0; tick < 120; ++tick) park.Evolve();
```

The park advances one cached step per `Evolve`, not one render frame. Replica
ClientBall curves use the same elapsed 100ns clock as the scene, including the
native two-tick sampling shift. See [ClientBall curves](destiny-client-curves.md).

## State and callbacks

Alignment is WARP mode with a negative `effectStamp`. Proper warp begins when
heading error is below 0.01 and speed is strictly above 75% of maximum, or when
the absolute alignment counter exceeds 180. These are ticks, not elapsed seconds.
Entry first emits `OnActivatingWarp`, then stops followers, offsets the destination
by minimum range, stamps the current tick, and disables massiveness and the sensor.

The exponential acceleration/cruise/deceleration phases use float64 vectors.
The final simulation sample drops out below both half maximum speed and 100m/s.
Replica parks emit `OnDeactivatingWarp` before restoring massiveness/sensor state;
`Stop` then emits `OnExitWarp` and the mode-change event. Mode commits after its
callbacks. The exit position/velocity becomes the interpolation interval's old
state, followed by one ordinary drag step. Very slow exits force spatial insertion.
Legacy and iterative collision paths both exclude proper warp through native flags.

Client warp sampling retains cached position and velocity as its inputs. It uses
the native fractional-time formula and does not emit exit events or change mode.
Position remains absolute float64 until the curve subtracts the ego reference and
converts to float32. Quaternion sampling keeps the existing legacy/dynamic paths.

The optional PyOS host owns subscriber failures. A false dispatch result calls
`PyError` and native work continues. An uncaught JS exception propagates, but
borrowed vectors are returned and `inEvolve` is cleared. Local integration vectors
survive nested host callbacks; no shared scratch remains live across them.

## Preserved source quirks

- A destination closer than 100km becomes GOTO and emits exit flag 1; exactly
  100km enters alignment. Repeating the exact warp target leaves the existing
  alignment counter, range and factor unchanged.
- Minimum range is stored as raw double bits in signed-int64 `followId`;
  `ownerId` holds the integer factor. Negative range clamps to zero, while
  negative zero, NaN and positive infinity retain native semantics. Range can
  overshoot behind the starting point. Nonpositive factors become one.
- Warp starts with one meter of displacement at time zero. A faster incoming
  velocity is retained during acceleration without changing the distance equation.
  Tiny positive or negative cruise durations are not rounded to zero.
- Interpolation may overshoot during the extra final second. Extended-warp
  fallback logs, snaps to the destination, zeros velocity and returns distance zero.
- Entity warp-in normalizes the absolute destination for velocity, rather than
  the displacement from the ball. Its activation event is master-only.
- Warp exit restores massiveness and sensor activity even if they were false
  before entry. Legacy proper-warp orientation retains Carbon's initially zero
  direction branch; dynamic orientation points toward the destination.

## Creation and remaining scope

`PyAddBall` models the Python-facing dispatch: exactly 17 legacy arguments, or
19 with dynamical orientation enabled. Dynamic arguments append maximum angular
speed and angular agility to the legacy list. These wrappers reject creation
during evolution. Native `AddBall`, `AddOldStyleOrientedBall` and
`AddDynamicallyOrientedBall` remain separate and have no such guard.

`ProximitySensor` and its `MapOfLongLongs` storage are implemented records;
periodic scanning, tracking and proximity notifications are implemented in the
[proximity integration](destiny-proximity.md); cloak commands remain unfinished.
`ShiftFromPlanets` implements the native in-place global-sphere helper; neither
Carbon nor this port calls it automatically from warp commands. Overlapping globals
use JS Map insertion order instead of Python dictionary traversal. An exact-center
point stays at the center, preserving native zero normalization. Replication and
native interface registration remain separate work. The entire Destiny port is not complete.

## Evidence

Donor baseline: `114e89fa584f0e1a81eb0a679aabf41af8870072`.
Commands/math are `destiny/src/Ballpark.cpp:4072-4410`; entry/steering and tick
integration are `:789-946` and `:474-520`. Predicates and client sampling are
`destiny/src/Ball.cpp:1885-1923,1275-1292`; sensor defaults are
`destiny/src/Ball.h:31-40`. Python creation is `destiny/src/Thunkers.cpp:51-159`.
Queue commands are `destiny/python/destiny/net/server/_actions.py:405-450`.

Tests reproduce the donor alignment trajectory, legacy/iterative pass-through
cases, action tuples and creation refusal during warp exit. Source-derived
tests cover phase thresholds, equations, callback state, large distances,
dirty pool reuse, exception cleanup and nested evolution. No native executable
oracle or renderer integration is claimed.
