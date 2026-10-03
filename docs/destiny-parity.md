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
  f32 runtime vectors. Server-owned `destiny/math/vec3d.js` supplies float64
  storage for new scratch and pooled recursion frames; arithmetic continues to
  use runtime vec3 operations. Existing Number-array state remains double precision.
- Native float parameters are rounded with `Math.fround` at controller boundaries.
  Setters maintain the cached drag factor. Direct field writes bypass native-like
  validation and hooks, so physical changes must use the controller.
- IDs and native timestamps use signed-int64 BigInts, with checked safe Number
  inputs. Maps, follower links and Actions share canonical IDs. Native local-ID
  allocation is implemented; Blue-specific negative-target rejection remains unported.
- There is a single implicit region. Removal supports native delay/buffering and
  an optional injected PyOS bridge for tick/final-cleanup callbacks. Collision
  forces and legacy client orientation/interpolation are implemented; networking,
  full orientation and spatial notifications remain incomplete.
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
metadata/trajectory tests; the ownership/legacy collision checkpoint had 321 passing tests.

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
swept spheres and source quirks. There are 321 passing tests in the current suite.
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
the dynamical-heading fallback is now implemented in this dependency chain.
The configured iterative branch fails before ordinary Evolve mutation;
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
Twenty-three direct source-derived fixtures brought the suite to 293. The
subsequent ownership/legacy checkpoint added 28 tests for a total of 321 at that point.
See the [geometry guide](destiny-geometry.md#ballpark-ownership-and-legacy-collisions)
for ownership, Gradient/Potential, scheduling and the 13 donor trajectories.
Compound Mini attachment, warp and iterative propagation remain open. No native
executable validation is claimed.

## ClientBall renderer subset

Replica creation now uses the exported CjsDestinyClientBall subclass. Legacy
yaw/pitch/roll runs at native creation, velocity-set and evolution sites. Its tick
curve methods accept safe Number or BigInt ticks on the same Blue-start epoch,
select position/rotation by output length and fill caller-owned buffers. Float64
state and distinct class scratch slots protect nested ego-reference sampling.
See [ClientBall curves](destiny-client-curves.md) for per-contract donor ranges,
cache quirks and explicitly unsupported native branches. Complete native interface
registration, warp sampling and relative-motion methods remain
open; no runtime files were changed to introduce this renderer-method subset.

ClientBall impact rotation now retains the native cached inverse-inertia formula,
strict impulse threshold, goal-angle cap, independent growth/recovery phases and
soft rotation limit. Owner-local quaternion adapters preserve the native slerp
threshold, axis normalization and zero-quaternion behavior without changing runtime
math. Runtime quaternion products reverse Carbon operands and still use JavaScript
double intermediates with float32 results. Ordered comparisons preserve native
std::min/max selection for NaN deterioration. Extra curve helpers, distance getters
and partition debugging retain their native cache and detached-call asymmetries.


## Physical orientation kernels

Ball now owns the native float32 quaternion, angular velocity, torque, roll,
maximum angular speed and rotational agility state (`Ball.h:129-166`,
`Ball.cpp:74-83`). These fields remain independent of ClientBall's visual impact
parameters. `SnapOrientation` and `GetRotatedVector` follow `Ball.cpp:290-333`
and `2191-2203`, including zero-velocity early return, unnormalized quaternion
transforms, the native boolean roll condition and degenerate reverse heading.
`SetBallVelocity` selects the native dynamic or legacy snap; setting zero velocity
while making a ball static does not clear angular velocity.

`ApplyTorque` implements the heading/roll drag integrator at
`Ballpark.cpp:1936-1983`. `CalculateBallRotationVelocity` follows
`Ballpark.cpp:2685-2712`, including fraction-zero bypass, single-integrator fallback
and direct collision-record dispatch. Record production is still incomplete.
`SetMaxAngularSpeed`, `SetBallAngularVelocity`, `SetBallRotation` and
`SetBallAngularAgility` retain the guards and float casts at
`Ballpark.cpp:4721-4732,4802-4846,4958-4966`. Their missing-ID lookup uses the
native non-inserting MapOfBalls contract. Native acceptance of nonfinite
values is retained where its ordered comparisons allow them.

All fixed-size math storage comes from runtime factories; temporary storage is
class scratch. The native axis-angle adapter lives on Ball and is inherited by
ClientBall. Quaternion composition reverses Carbon operands. Runtime operations
use JS double intermediates with float32 result storage, so this is not a promise
of bitwise C++ float equivalence. Explicit float rounding retains branch thresholds
and squared-length overflow where it changes behavior. A scalar TransformCoord
adapter retains Carbon's zero and NaN homogeneous-divisor behavior, which differs
from runtime transformMat4. Snap retains actual cross products so finite double
velocities overflowing float32 propagate native NaNs.

Tests independently solve angular decay and constant torque, compose a rotated
heading plus roll, and cover zero-fraction dispatch, nonunit/zero quaternions,
setter thresholds, native reverse/downward-heading quirks and aliased scratch.
The four GotoTorque/GotoRoll variants now feed native dynamic behavior, staged
tick integration and client interpolation. Iterative collision record production
remains unfinished; native oriented-creation methods are described below.


## Dynamic steering and evolution

GotoTorque, GotoTorqueBreaks, GotoRoll and GotoRollBreaks follow
`Ballpark.cpp:1511-1934`, including five outer searches, acceleration steps 1-99,
strict braking residuals, distinct scalar/vector rounding, direct torque's dt cap,
component-wise alternate turns, braking suppression and the native boolean roll
guard. The two CalculateN2Alpha2 overloads share an internal record-based helper.
A nonfinite or out-of-int32 stopping count throws: the native float-to-int conversion
has no portable defined result, so the port does not invent a wrapped integer.

Behavior previews angular integration to redirect thrust but does not commit
rotation (`Ballpark.cpp:841-893`). Evolution stages all balls, then independently
checks and commits native float squared lengths for rotation and angular velocity
(`Ballpark.cpp:502-519,584-595`). Disabled missiles retain the donor's distinct
commit and client predicates; missile movement itself is still unported. The
new-orbit fallback uses physical heading and preserves the second nonpositive
threshold's NaN behavior (`Ballpark.cpp:712-732`). CapAcceleration preserves its
native immediate-return no-op (`Ballpark.cpp:1350-1353`).

Class scratch keeps preview, steering, integrator and client temporaries separate.
Float dot/length and scaled normalization adapters preserve overflow-sensitive
branch choices without changing runtime. Tests cover analytic acceleration and
braking, banking suppression, scratch aliases, preview versus authoritative state,
all-ball staging, independent commit rejection and delayed client sampling.
These are source-derived and analytic checks, not native-executable trajectories.


## Oriented creation and angular properties

`AddBall` now follows raw C++ creation and leaves orientation unchanged. This
removes the earlier implicit legacy snap. Call `AddOldStyleOrientedBall` for
one legacy snap of a free ball, or `AddDynamicallyOrientedBall` for explicit
quaternion, angular velocity, angular speed and agility inputs
(`Ballpark.cpp:3467-3553`). Both methods use native C++ argument order; Python
wrapper dispatch and its additional dynamic snap remain unported.

Dynamic creation keeps nonunit quaternions. It backsteps the old rotation at
constant angular speed only when the initial ID probe found no ball. The native
quirk resolves allocation sentinels twice, consuming two IDs. The captured probe
result controls old angular state even when the second ID names a different
object. `MapOfBalls.h:25-40` proves missing lookup does not insert an entry;
non-inserting JS lookup is parity, not an adaptation.

Angular Blue aliases `wx/wy/wz`, `rx/ry/rz/rw`, `maxAngularVelocity` and
`RotationalAgility` store float32 values before calling their attached controller
(`Ball_Blue.cpp:58-63,219-273,317-323`, `Ball.cpp:1506-1584`). Direct JS dispatch
replaces these branches of pointer-based OnModified; no schema APIs participate.
Rejected negative limits or zero agility therefore remain stored after property
assignment. A rejected zero quaternion leaves old rotation and angular velocity
unchanged. ClientBall's visual `maxAngularVelocity` still shadows the physical
property and has no notification (`Ball_Blue.cpp:578-584`). Other native property
notification branches remain unfinished.

Tests cover the settings-independent creation methods, single legacy snap,
noncommuting backstep, nonunit rotations, ID probe/reuse asymmetries, detached
properties, attached store-before-notify behavior, the ClientBall shadow and
nested creation during spatial callbacks with dirty scratch.


## Collision history records

CollisionImpact, CollisionItem and BallLocation follow CollisionStructures.h/cpp.
CollisionBallProperties ports every declared history method, including default
construction, initialization, impact insertion/removal, endpoint rebuilding,
collision ignoring and position/rotation sampling. Native value assignments copy
factory-owned math storage. JS storage grows lazily and reuses removed records;
regrown records reset all native fields, while surviving records stay untouched.
The native vector capacity hint does not impose a history-size cap.

Caller-owned invalidation pairs replace returned C++ vectors; BigInt normalization
preserves signed-int64 IDs. Pooled integration temporaries are returned through
finally, and output staging supports aliases without sharing live scratch across
nested sampling. Undefined initial times represent native indeterminate members.
Stable JS object references avoid native vector-reference invalidation on growth.

The missing-removal bug, different invalidation orders and sampling inequalities,
equal-time insertion, nonfinite-time comparisons, dynamic-off angular retention
and elapsed-seconds-as-angular-fraction behavior are preserved. The
[record contract](destiny-collision-records.md) describes those cases and tests.
These records work through both existing park sampling dispatchers. Contact
impulses and recursive invalidation are implemented below; discovery, scheduling
and cleanup remain unfinished.


## Iterative contact impulses and invalidation

Ballpark.cpp:2323-2672 supplies ApproximateEllipsePointOfImpact,
CalculateCollisionImpactStatic, CalculateCollisionImpactFree, AddImpact and
RemoveImpactFromFree. The port retains their native argument order; contact
approximation adds a caller-owned output in place of its return-by-value vector.
Complete pooled frames hold independent temporary BallLocation records and f64
vectors across sampling calls; finally returns them on every exit path. Owned
impact objects and returned reciprocal candidates remain with their callers.

Ellipse calculations preserve double cross/dot operations, native quaternion
matrix float staging, Rodrigues zero-axis behavior, float narrowing before asin,
float contact/radius multiplication and final double ellipse scaling. A source
review caught a branch-visible quaternion matrix rounding mismatch: using the
runtime's double intermediates could turn an exact-zero cosine into a tiny value
and wrongly enable radius scaling. A regression pins the native branch locally,
without changing runtime math.

Static impulses scale the relative velocity by -2 before its dot product; free
impulses scale the completed dot. Rotational surface velocity, inertia, reciprocal
vector division, negative-impulse zero IDs, pointer-copy quirks and singular
nonfinite outputs remain intact. Linear and angular caps apply squared ratios,
including float32 numerator rounding. Recursive invalidation uses owned result
lists and preserves repeated visits, native map lookups and diagnostics.

Eighteen tests cover analytic linear impulses, independently derived oblique
angular fixtures, precision/degenerate branches, overlap update ordering, caps,
a four-ball recursive graph, reentrant sampling and exceptional pool cleanup.
Collision discovery, the iterative scheduler and its lifecycle cleanup remain
unfinished; these kernels do not enable iterative Evolve yet.
