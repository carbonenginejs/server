# Destiny source correspondence

Status: Evolving
Scope: Implemented Destiny subsets and declared JavaScript adaptations
Audience: Server maintainers
Summary: Maps current movement, action and numeric geometry behavior to the donor.

## Source and ownership

Reviewed the local `carbonengine/destiny` donor at
`114e89fa584f0e1a81eb0a679aabf41af8870072`. This review did not fetch or modify the donor.
The public source lives at <https://github.com/carbonengine/destiny>.

The user-approved temporary server experiment owns `CjsDestinyBall` and
`CjsBallparkController`. Their schema definitions use `modelledOn: "Ball"` and
`modelledOn: "Ballpark"`, not claims of full native class parity. All methods remain
on the corresponding donor's class. No existing runtime class is duplicated or moved.
`DSTBALLMODE` is a static enum on the local Ball model; no cross-package enum owner
has been introduced. Nothing was promoted from generated source or regenerated.

| Source | Implemented correspondence |
| --- | --- |
| `src/Ball.h`, `Ball.cpp`, `Ball_Blue.cpp` | Movement state and public scalar position/velocity. |
| `src/IDstConstants.h:11` | Full `DSTBALLMODE` member vocabulary and numeric values. |
| `src/Ballpark.cpp:86-100` | Default one-second tick and friction coefficient `1e6`. |
| `src/Ballpark.cpp:421,751,789` | Evaluate forces before integration; exact drag equations. |
| `src/Ballpark.cpp:956,1073,1246,1339,1398` | Goto, follow, old orbit, stop and homing thrust. |
| `src/Ballpark.cpp:3303,3879,4007,4471,4511,4556` | Ball creation and movement commands. |
| `src/Ballpark.cpp:4652–5024` | Relevant property setters and cached drag. |
| `src/Ballpark.cpp:5471,5896` | Removal and clearing responsibilities. |
| `src/Settings.h:11–13` | Dynamical orientation and new orbit default to disabled. |
| `src/Thunkers.cpp:244-253,330-339` | Follow/orbit default range of one. |
| `python/destiny/test/helpers.py:207-229` | Fixture mass, agility, radius, speed and throttle. |

## Adaptations and constraints

- Native `Vector3d` movement values are scalar JS Numbers, following the Blue
  position/velocity surface. This preserves double precision without allocating
  f32 runtime vectors. No alternative vector library or typed-array allocator exists.
- Native float parameters are rounded with `Math.fround` at controller boundaries.
  Setters maintain the cached drag factor. Direct field writes bypass native-like
  validation and hooks, so physical changes must use the controller.
- IDs must be safe JS integers. Full signed 64-bit IDs and automatic native local-ID
  allocation are outside this temporary model. Explicit negative safe IDs are ordinary
  map keys here; Blue-specific negative-target rejection is not implemented.
- There is a single implicit region. Removal supports native delay/buffering and
  an optional injected PyOS bridge for tick/final-cleanup callbacks. Collision
  forces, networking, orientation, interpolation and spatial notifications are absent.
  Boolean flags are retained as data; only `isFree`/`isMoribund` affect tick participation,
  and follow/orbit validate target cloaking/death when receiving a command.
- Mobile balls with nonpositive or nonfinite mass/agility fail before tick mutation.
  Static balls may have zero mass. This avoids pretending the native zero-mass thrust
  division is a supported movement case. Unknown/unsupported mobile modes also throw.
- Nonfinite input is rejected or ignored, as documented by the method. This extends
  native guards to finite f32 conversions and position/velocity setters.
- Re-adding a follower explicitly detaches its previous target. Re-adding a target
  retains its object identity and valid incoming follower references.
- The legacy orbit zero-distance, zero-total-radius tangent computes `0/0` in the
  donor (`Ballpark.cpp:1287–1294`). This port skips that undefined tangent and applies
  zero thrust. This deliberate correction is covered by a regression test.
- Native stopping's extra Y-axis damping (`Ballpark.cpp:1339–1345`) is retained, as
  are orbit's seven-decimal truncation and goto's inertial overshoot. This is the
  local donor's default movement, not a claim about current EVE Frontier behavior.

## Action queue subset

`Actions` now ports the movement-command subset of
`python/destiny/net/server/_actions.py`. Its Python method spellings and history
tuples are preserved. Native signals, unsupported commands, tick dispatch and
replication remain excluded. The JS park's `currentTime` and `GetBall` replace
native counter access and the dictionary at explicitly annotated sites. See
[Destiny action queue](destiny-actions.md) for exact behavior and adaptations.

The new tests translate donor `test_actions.py` fixtures and cover stamp/order
semantics, adjacent tuple deduplication, local position metadata, pending state,
and queued-versus-direct movement application. The action checkpoint had 38
passing tests, including the original 17 movement
metadata/trajectory tests; the current suite has 112 passing tests.

## Validation and remaining work

The original movement suite contains seventeen tests, including six numeric trajectories copied directly
from CCP's `test_goto.py`, `test_follow.py`, `test_orbit.py` and `test_stop.py`.
All coordinates/velocities match those fixtures within absolute `1e-10` tolerance.
Moving-target follow is also tested in both insertion orders. Other tests exercise
command transitions, radii, coincident centers, target removal/replacement, static
objects, parameter changes, precision at large coordinates, failure boundaries and
schema registration. These are fixture comparisons; the native binary was not run.

The next source areas are spatial queries/partitions, collision shapes and forces,
new orbit/orientation, additional movement modes, then state replication. None of
those capabilities is implied by this movement subset. Higher-level combat and
drone policy remain separate consumers of the ballpark.

## Numeric geometry

The geometry subpath implements `AABB`, `Planed`, `Triangle`, and all six
`Collision` free functions from the matching native headers and implementations.
The 44 tests from `TestAABB.cpp`, `TestPlane.cpp`, `TestTriangle.cpp` and
`TestCollision.cpp` are transcribed with their native names and expectations.
Seven additional cases cover aliasing, partial output writes, large coordinates,
swept spheres and source quirks. There are 112 passing tests in the current suite.
See [geometry](destiny-geometry.md) for the exact value/reference adaptations.

## Donor update reviewed 2026-10-04

The baseline advanced from `ef738406b61ad06bae2f402857e464735ab106a2` to
`114e89fa584f0e1a81eb0a679aabf41af8870072` (26 commits). All Destiny
file/line citations in this package were re-opened against the new tree. A few
pre-existing overlong or imprecise ranges were corrected; none was caused by
upstream movement of the implemented methods. File-head source paths remain valid.

No upstream behavior change affects the implemented movement, Actions or numeric
geometry subsets. The Python tree and four translated geometry test files are
unchanged. Ballpark, Ball Blue exposure, settings and wrappers only received
include-name casing corrections; the ported formulas/defaults are unchanged.
The recorded orbit, stopping and numeric geometry quirks still exist.

The one source algorithm change is in the unported spatial partition:
`src/Partition.h:104-123` introduces `KeyHash`, combining hashes of ix, iy,
iz and n in order, replacing the implicit linear Key-to-size_t hash. Key
clamping, equality and ordering remain unchanged (`src/Partition.h:70-101`).
The final added regression is `tests/TestPartition.cpp:5-13`, distinguishing
keys (1,0,0,16) and (0,2,0,16). Their old collision did not make them equal or
lose map entries. Bucket distribution and native unordered traversal can change;
`src/Partition.cpp:490-518` exposes such traversal through GetActiveBoxes.
This is pending work for the partition port, not a change to current JS behavior.
Hash integers depend on size_t width and the native standard library and are not
portable wire values. JS signed 32-bit shift operators are not a direct translation.

Other changes concern native build/CI, registry/toolchain setup and dependency
minimums (carbon-blue 5.1.2 to 6.2.0; carbon-core 2.6.0 to 3.1.0). They do not
alter this package's runtime dependency. Native binaries and dependency internals
were not rebuilt or behaviorally qualified in this review.

Validation after the baseline update: all 89 server tests pass against runtime
alpha.9, source JSDoc has no gaps, and documentation/package-content checks pass.
The six stored movement trajectories also match current donor literals exactly
(68 points, 204 scalar values); this is a literal comparison, not native execution.

## Clock and ball cleanup

`Ballpark.cpp:219-330,3013-3032,4415-4441` supplies OnTick, Start/Pause and
AdjustTimes. The Python zero-argument Evolve wrapper (`Thunkers.cpp:1244-1250`)
uses timestamp zero; explicit timestamps follow `Ballpark.cpp:550-559`.
Blue field mappings are `Ballpark_Blue.cpp:55-72,105-120`.
`Ballpark.cpp:5415-5572,5699-5766` supplies follower transitions, delayed
removal and buffered cleanup; capsule/box/bubble cleanup remains unported.
The original metadata/trajectory tests now assert currentTime for counters.

The clock/lifecycle tests include all five donor test_time.py cases, actual
runtime manual-host integration, catch-up thresholds, timestamp sentinels, callback
phase ordering/failure handling, drag-cache behavior, deferred cleanup and re-add.
Native host globals become explicit injected interfaces; there is no new scheduler
or event-bus implementation. See the [source-family guide](../destiny/README.md)
for the host contract and the current Number timestamp limitation. Phase 1 remains
incomplete until its state/settings, full-int64 and remaining lifecycle obligations land.
