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
- IDs and native timestamps use signed-int64 BigInts, with checked safe Number
  inputs. Maps, follower links and Actions share canonical IDs. Native local-ID
  allocation is implemented; Blue-specific negative-target rejection remains unported.
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
metadata/trajectory tests; the current suite has 293 passing tests.

## Validation and remaining work

The original movement suite contains seventeen tests, including six numeric trajectories copied directly
from CCP's `test_goto.py`, `test_follow.py`, `test_orbit.py` and `test_stop.py`.
All coordinates/velocities match those fixtures within absolute `1e-10` tolerance.
Moving-target follow is also tested in both insertion orders. Other tests exercise
command transitions, radii, coincident centers, target removal/replacement, static
objects, parameter changes, precision at large coordinates, failure boundaries and
schema registration. These are fixture comparisons; the native binary was not run.

The next source areas are spatial integration, collision shapes and forces,
orientation, additional movement modes, then state replication. None of
those capabilities is implied by this movement subset. Higher-level combat and
drone policy remain separate consumers of the ballpark.

## Numeric geometry

The geometry subpath implements `AABB`, `Planed`, `Triangle`, and all six
`Collision` free functions from the matching native headers and implementations.
The 44 tests from `TestAABB.cpp`, `TestPlane.cpp`, `TestTriangle.cpp` and
`TestCollision.cpp` are transcribed with their native names and expectations.
Seven additional cases cover aliasing, partial output writes, large coordinates,
swept spheres and source quirks. There are 293 passing tests in the current suite.
See [geometry](destiny-geometry.md) for the exact value/reference adaptations.

`BoxShape.h:7-67` and `BoxShape.cpp:8-306` now supply shared corner/side enums,
RectangleShape and BoxShape, with native member copies, default construction,
closest-point/corner queries, ray intervals and sphere overlap/sweep queries.
All 25 fixtures in `TestBoxShape.cpp` are transcribed. Eighteen additional tests
cover defaults, precision, rotated axes, aliases, overlap displacement, partial
writes and the two retained ray defects. Expected values are donor or
source-derived, not native-executable evidence. Vector results use explicit
output storage; reference results use mutable records. Runtime is unchanged.

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

The one source algorithm change was in the then-unported spatial partition:
`src/Partition.h:104-123` introduces `KeyHash`, combining hashes of ix, iy,
iz and n in order, replacing the implicit linear Key-to-size_t hash. Key
clamping, equality and ordering remain unchanged (`src/Partition.h:70-101`).
The final added regression is `tests/TestPartition.cpp:5-13`, distinguishing
keys (1,0,0,16) and (0,2,0,16). Their old collision did not make them equal or
lose map entries. Bucket distribution and native unordered traversal can change;
`src/Partition.cpp:490-518` exposes such traversal through GetActiveBoxes.
The standalone partition checkpoint below now implements this hash change.
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
for the host contract. Phase 1 remains incomplete until its remaining
state/settings and lifecycle obligations land.

## Signed-int64 identities and timestamps

The ID definition is src/Ball.h:74; follow and timestamp fields are at
src/Ball.h:99,181-182. Ballpark owns its native clock and local counters
(src/Ballpark.h:85-93). Be::Time is int64_t in Carbon's
blueexposure/include/BlueTypes.h. BigInt replaces these integer primitives;
physical f64 values, tick counters and action stamps remain Numbers.

Ballpark.cpp:3265-3296 supplies GetIDForCollisionObject; initial local counters
are Ballpark.cpp:111-112, DSTLOCALBALLS is IDstConstants.h:76, and ClearAll
resets them at Ballpark.cpp:5948-5949. Master zero/negative requests and replica
-1 requests now follow those branches. Resolved-ID collisions reuse the existing
ball as the donor does. Legacy orbit retains the exact ID low bits
(Ballpark.cpp:1275) without converting a full wide ID to Number.

The internal primitive conversion helper is owned by CjsDestinyBall and shared
by the park/Actions. No runtime math helper provides this strict conversion;
schema conversion is intentionally not used. The JS boundary rejects unsafe
Numbers, fractional or coercible values and signed overflow. Native arithmetic
has no portable signed-overflow behavior to emulate. Timestamp adjustments and
initial old timestamps are checked before their ordinary mutations; tick
callbacks still make a whole OnTick nontransactional. Positive interval products
and ordinary catch-up counts must fit native int32. The source-family guide
documents these domains and the API migration from Number outputs.

Twelve additional JS boundary tests cover canonical keys, full signed endpoints,
adjacent IDs beyond Number precision, local allocation, exact 100ns clocks,
overflow and Actions equality. Existing donor trajectory values are unchanged.
This is source/fixture validation, not a native binary or stream-parity claim.

## Global settings and non-dynamical new orbit

Settings.h:9-42 and Settings.cpp:13-65 define all five defaults, module-global
ownership and detached configuration copies. Settings_Blue.cpp:13-16,27-66
defines the four method aliases and read/write fields. SettingsConfiguration and
GlobalSettings stay together under the Settings header family, one class per file.
The native Python settings helpers are translated at their existing _util path.
The Windows64 size_t binding is uint64; flags follow integer conversion with a
checked signed-int32 JS boundary. The weak configuration brand replaces native
interface casting without calling schema APIs. Full IRoot/module lifecycle is
still a separate unfinished obligation, not implied by settings behavior.

Ballpark.cpp:664-749,1116-1235,1428-1505 supplies orbital normals, new orbit,
OrbitThrust and GotoThrustFollow. JS scalar outputs/caller-owned f64 arrays replace
Vector3d return/reference arguments. Native thresholds and arithmetic are retained;
only the dynamical-heading fallback remains unported in this dependency chain.
The configured dynamic/iterative branches fail before ordinary Evolve mutation;
SetBallVelocity and SetBallFree also expose their missing SnapOrientation dependency.
Native AddBall and the Python wrapper's oriented-creation dispatch remain distinct.

All six test_configure.py cases and four new-orbit test_orbit.py scenarios pass.
Seventeen additional cases cover boundary conversions, copied/global state, casts,
aliases, unsupported execution and orbit branch/quirk behavior. The suite now has
151 tests. Native collision, orientation and binary execution are not claimed.

## Standalone spatial partition

At baseline `114e89fa584f0e1a81eb0a679aabf41af8870072`, Partition.h:66-123,195-209,
Partition.cpp:19-554 and Box.cpp:15-282 supply the cell hierarchy, keys/hash,
candidate filters, traversal and cell lifetime. Partitionable.h/.cpp and
StaticCollidable.h/.cpp supply shared spatial state and static membership;
SortedSets.h supplies comparator-aware ordering. Partition_Blue.cpp:7-34 supplies
the module-level GetBoxCenter binding. See the [partition guide](../destiny/partition/README.md)
for representation choices and retained source quirks.

Forty tests cover the donor TestPartition hash fixture, source-derived ordering,
membership, traversal and filtering, and an independent cell-volume overlap
oracle. A native-header MSVC 14.50 x64 probe confirms two Windows integer hash
values; it does not validate the complete native partition implementation.
That checkpoint had 234 passing tests. JS Map iteration is insertion order,
whereas the native unordered-map order is unspecified. Sorted candidate discovery
retains source ordering and appends to caller output without a final sort.

Those kernel tests use native-shaped records to isolate partition behavior.
The Ball integration checkpoint below adds shared state and native membership;
automatic Ballpark insertion and bubble tracking follow below; collision consumers remain open.
Runtime remains unchanged; schema machinery is not used in the simulation.


## Ball spatial state and neighborhood membership

Ball.cpp:228-238,812-863,2354-2526 supplies the seven membership/radius methods.
Ball.h:77-191 and Partitionable.h:15-41 define the inherited state; Ball's
constructor sets its new position to [1e10,1e10,1e10]. Blue scalar properties now
forward to native fields/vectors, rather than retaining duplicate values.
The old private movement helpers also forward to their native fields.
Ball's shadowed mPark/mHandled and their base members become one logical JS slot
per name; no native object-layout contract is promised.

Ballpark.cpp:3349-3350,3446-3449,5564-5567,5903-5907 supplies replacement cleanup,
park assignment and detachment. These lifecycle portions now operate on real
Ball memberships. The subsequent bubble checkpoint adds automatic insertion,
counts and transitions. The controller uses native dt/mFriction names;
the former private _dt/_friction fields have been removed.

Sixteen source-derived tests cover native default/shared state, cached inflation,
strict tangency, insertion order, master/replica restoration, huge-radius and
unchanged-key cache behavior, live candidates and removal. A separate small-cell
bounding-volume oracle checks membership sets. All 250 JS tests pass, including
unchanged donor movement trajectories. No native membership executable ran.


## Automatic bubble lifecycle

Ballpark now maintains native insertion hooks, master/replica bubble assignment,
activity/keep-alive sets, add/delete markers and subscriptions. It stages movement
until the native commit pass and traverses the live free-ball map by signed ID.
The [bubble guide](destiny-bubbles.md) records exact source ranges, callback
ordering and retained equal-ID bookkeeping quirks. Sixteen bubble tests brought
the suite to 266; the subsequent ordered-index checkpoint adds four more cases.
The live free-ball iterator now uses a sorted key index and binary upper bounds,
retaining callback mutation behavior without a whole-map scan for every ball. Native networking
recipient batches, conflict resolution and collision/proximity consumers remain
unported; these tests do not establish full server replication or native execution.

## Static-shape kernels and fractional integration

Capsule and OrientedBox now implement their complete concrete header methods,
Blue component aliases and native partition insertion. Ballpark's fractional
vector Integrate replaces the temporary fixed-tick Ball-only signature; existing
clock and movement tests still pass. Ball stores the native collision acceleration,
time and ID list. The [geometry guide](destiny-geometry.md#static-capsule-and-oriented-box)
records source ranges, f32 boundaries, partial outputs and retained source quirks.

The sampling loop explicitly throws when native float subtraction cannot advance;
it preserves ordinary diameter sampling and its omitted far-endpoint neighborhood.
Uninitialized native scalar fields use NaN JS placeholders until Initialize.
Twenty-three new direct source-derived fixtures bring the suite to 293. Static
shape ownership, compound mini-shapes, Gradient/Potential, scheduling and both
complete solver paths are still required; no full collision-trajectory parity
or native executable validation is claimed by this checkpoint.
