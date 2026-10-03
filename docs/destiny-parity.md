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

- Native `Vector3d` movement values use double-precision JS components. Ball
  position, velocity, target and force fields now use server-owned `vec3d` factory
  storage; the inherited previous-position field still uses a Number array.
  Server-owned float64 scratch/pools preserve precision; arithmetic continues to
  use runtime vec3 operations. Runtime allocation defaults are unchanged.
- Native float parameters are rounded with `Math.fround` at controller boundaries.
  Setters maintain the cached drag factor. Direct field writes bypass native-like
  validation and hooks, so physical changes must use the controller.
- IDs and native timestamps use signed-int64 BigInts, with checked safe Number
  inputs. Maps, follower links and Actions share canonical IDs. Native local-ID
  allocation is implemented; PyFollowBall/PyOrbit apply Blue-specific negative-target rejection.
- There is a single implicit region. Removal supports native delay/buffering and
  an optional injected PyOS bridge for tick/final-cleanup callbacks. Collision
  forces and legacy client orientation/interpolation are implemented; networking,
  full orientation and spatial notifications remain incomplete.
  Boolean flags are retained as data; only `isFree`/`isMoribund` affect tick participation,
  and follow/orbit validate target cloaking/death and bubble identity when receiving a command.
- Mobile balls with nonpositive or nonfinite mass/agility fail before tick mutation.
  Static balls may have zero mass. This avoids pretending the native zero-mass thrust
  division is a supported movement case. Unknown/unsupported mobile modes also throw.
- Nonfinite input is rejected or ignored, as documented by the method. This extends
  native guards to finite f32 conversions and position/velocity setters.
- Re-adding a follower explicitly detaches its previous target. Re-adding a target
  retains its object identity and valid incoming follower references. This remains
  an adaptation; native replacement-state and callback-phase parity needs a separate audit.
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
The configured iterative branch and SnapOrientation dependencies are now implemented.
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
[Mini attachment](destiny-minis.md), iterative propagation and [warp](destiny-warp.md) are implemented. No native
executable validation is claimed.

## ClientBall renderer subset

Replica creation now uses the exported CjsDestinyClientBall subclass. Legacy
yaw/pitch/roll runs at native creation, velocity-set and evolution sites. Its tick
curve methods accept safe Number or BigInt ticks on the same Blue-start epoch,
select position/rotation by output length and fill caller-owned buffers. Float64
state and distinct class scratch slots protect nested ego-reference sampling.
See [ClientBall curves](destiny-client-curves.md) for per-contract donor ranges,
cache quirks and explicitly unsupported native branches. Complete native interface
registration remains open; relative motion is covered below. No runtime files
were changed to introduce this renderer-method subset.

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
commit and client predicates; [missile movement](destiny-missiles.md) is implemented. The
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
(`Ballpark.cpp:3467-3553`). Both methods use native C++ argument order; `PyAddBall`
supplies separate Python dispatch and its additional dynamic snap.

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
impulses, recursive invalidation, discovery, scheduling and conditional cleanup
are implemented below.


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
Collision discovery, iterative scheduling and conditional cache cleanup now
connect these kernels to Evolve. See the [collision contract](destiny-collision-records.md)
for source ordering, pool ownership, settings hazards and native comparison quirks.


## Movement transitions and formations

The [formation guide](destiny-formations.md) records native pointer/ID overloads,
command guard order, callback-visible state, replica follower validation and
master reservation cleanup. Creation and implemented commands use SetMode.
ClearAll now follows native teardown without calling Stop or changing retained
movement/follower state. Formation vectors use owned float64 factories; rotated
float32 temporaries and goto wrapper vectors return to their pools on throws.

That checkpoint added twenty-eight tests, reaching 513, including both literal donor
formation trajectories. Native signed/unsigned formation bytes, empty-size
underflow, stale reservation bits and callback reentry are covered. No native
executable or networked formation synchronization is claimed.

## Warp and Python creation boundaries

[Warp simulation](destiny-warp.md) now covers commands, strict alignment,
entry/exit state, phase equations, tick integration, client sampling and action
tuples. Source is Ballpark.cpp:4072-4462,789-946,474-520 and
Ball.cpp:1885-1923,1275-1292 at the same donor baseline. ProximitySensor and
MapOfLongLongs provide the native storage used by warp; scanning is still open.
The unused ShiftFromPlanets helper is ported without adding an automatic call.

Scalar double locals and caller-owned output records replace native stack/reference
values. Evolve borrows independent float64 position/velocity vectors across
callbacks, returns them on errors and commits old samples only after integration.
The raw minimum-range bit representation, first-meter displacement, unrounded
cruise durations, cached client inputs, unconditional exit flag restoration and
absolute-destination entity velocity are retained. Map insertion order replaces
Python dictionary traversal for overlapping global spheres in ShiftFromPlanets.

PyAddBall and its two oriented wrappers preserve exact 17/19 argument counts,
live global dispatch and the dynamic wrapper's unconditional final snap
(Thunkers.cpp:51-159). JS Error replaces Python RuntimeError. Core scalar validation
runs after the evolution guard; native Python parses scalar types before it.
Native core creation remains callable during Evolve. The host test adapter catches
wrapper exceptions before reporting dispatch failure, matching the donor event test.

The maxVelocity accessor now narrows to the native float32 storage (Ball.h:126,
Ball_Blue.cpp:48-54), correcting an earlier direct-property precision gap at strict
warp thresholds. Controller creation/setters already performed this conversion.
That checkpoint added twenty-seven tests, reaching 540. No native executable or graphical
integration was run at that checkpoint; replication and sensors remain open.

## Missile launch and collision completion

[Missiles](destiny-missiles.md) covers PyLaunchMissile's Blue alias, native
MissileFollow, the Python target restriction, EvolveMissile and GotoThrust's
missile branch. SetBallMassive and Actions launch/massiveness tuples are included.
The guide maps each family to the unchanged 114e89f donor source.

Scalar snapshots replace native stack vectors across launch setter callbacks.
The float32 rotated direction is borrowed and returned in finally, with no
class scratch surviving reentry. Checked BigInt IDs reject minimum-int64 owner
negation instead of native undefined overflow. The injected park PyOS replaces
the native global bridge; detached balls have no bridge. JS exceptions propagate
while Evolve releases its semaphore. No runtime change is required.

Native radius-sum float overflow, zero-times-infinity components, absolute launch
waypoint, exact-one aimed flag, false-massive retention, signed defender identity,
close-thrust bypass and movement-gated collision delivery are retained. Dispatch
snapshots count but rereads contacts/force, preserving duplicate and zero IDs.
GotoThrust also now preserves computed-zero-length normalization and left-to-right
thrust scaling, correcting earlier JS arithmetic differences without donor changes.

Thirty-two added tests bring the suite to 572: four donor flight scenarios under
each solver, native launch fixtures, actual target-hit dispatch, source-derived
completion boundaries, dynamic-orientation selection and exceptional pool cleanup.
No native executable, transport or gameplay damage implementation is claimed.

## Special lifecycle and passive modes

[Special modes](destiny-special-modes.md) now cover mushroom creation/growth/expiry,
troll entry/readiness/petrification, rigid/boid commands and harmonic affiliation.
The full thirteen-value enum reaches its native steering or passive branch.
Unknown values retain explicit JS rejection; mobile mass/agility validation remains.
Network export and persistence remain unfinished; proximity handling is covered below.

Growth uses float32 fraction, power and radius stages, runs after timestamps and
skips motion/orientation sample commit. The old radius survives expiry. Troll
references collect in an owned per-call list and petrify after all commits,
with a second readiness check. Scalar arguments and owned references survive
callbacks without shared live scratch. Signed elapsed/deadline overflow throws
instead of assigning portable behavior to native undefined arithmetic.

Direct harmonic commands store affiliation before callbacks; Blue-style property
writes notify with field=false, so unchanged assignment exits FIELD. Queued field
commands separately select massiveness before affiliation. Boid enabling retains
old follow links because it does not call Stop. MiniBall creation during troll
petrification preserves native spatial-only insertion while inEvolve is true.

The iterative mushroom-owner filter is asymmetric. A lower-ID mushroom can
collide with its owner; separating contacts retain default collider zero, miss
owner-ID duplicate detection and repeatedly consume the iteration cap. Legacy
owner exclusion is not generalized to the iterative path. Source-derived tests
pin both outcomes, in addition to the literal donor growth trajectory.

Twenty-three new tests bring the suite to 595, including both solvers, staged
sample retention, delayed freezing, nested evolution, callback rescheduling,
Mini creation, harmonic notifications, action ordering and checked overflow.
Donor remains 114e89f; no changed upstream behavior or native executable oracle
is claimed. Existing AddBall replacement adaptations remain a separate audit.

## Proximity event integration

[Proximity integration](destiny-proximity.md) connects periodic Ball sensors,
destination notifications and target tracking to the park's post-movement phase.
The native callback fixtures and source-derived cases cover strict versus inclusive
boundaries, float32 threshold evaluation, stale registrations, dead bubbles,
recursive scans, detachment and dispatch failures. Thirty-one tests bring the
suite to 626. The donor remains 114e89f; no upstream behavior changed.

Owned candidate arrays and scalar velocity snapshots survive callbacks; finally
restores temporary radius/velocity after JavaScript failures. Entry event hosts
survive notification callback detachment. Map insertion order replaces native
unordered traversal, and Math.random replaces the CRT shuffle sequence.
SetBallRadius now accepts the native pointer overload and rejects only negative
radii, removing the earlier JS finite-value guard. Cloak commands and sphere
visibility, spatial queries and relative-motion families are covered below.
No native executable oracle ran.

## Cloak commands and sphere visibility

[Cloaking and visibility](destiny-visibility.md) connects numeric cloak state,
normal master sensors, follower transitions and same-bubble contact clearing.
Uncloak preserves massiveness and contacts in proper warp; alignment is not
proper warp. Replacing normal cloak with another mode retains its old sensor.
Queued cloak events retain old-bubble routing metadata and native pending/prune
behavior, without claiming ticker application or network delivery.

CheckVisibility uses Carbon's sphere near-root test and first traversal hit,
including strict endpoints, tangent hits and source-inside exclusion. It returns
0n for clear and -2n for invalid endpoints/bubbles. Double scalar locals preserve
world positions; Map traversal explicitly replaces Python dict traversal.

The ownerless DSTCONSTANTS enum is exported as one object. Direct isCloaked
property writes follow BlueVariable.cpp's byte mask of a native-long input;
out-of-int32 inputs explicitly throw instead of reproducing a pending Python
overflow error. Python cloak arguments separately validate unsigned bytes,
then narrow to signed char. Runtime remains unchanged.

Twenty-six new tests cover nine native cloak/visibility fixtures, donor action
cases, sensor/follower ordering, mode transitions, byte conversion, proper warp,
visibility edges, large translated coordinates and exact IDs. The suite has 652
passing tests. Destiny remains 114e89f; supporting Blue byte conversion was
reviewed at blueexposure 086a6948fa29e568cbe10f239910cdef70defa61.

## Spatial query boundaries

[Spatial queries](destiny-queries.md) implement native range, triangle, cone,
capsule, full-map scan, center/surface distance and ray-sphere roots. Bubble
queries retain live entries awaiting cleanup and ignore map values; ScanCone
instead scans all balls and excludes negative IDs and cloaked state. Cone angle,
radius arithmetic and boundary tests remain specific to each native algorithm.

Forty-seven tests bring the suite to 699, including the donor query/distance
fixtures, an independent grid oracle, output aliasing, float32 boundaries and
stale bubble entries. Two donor cone fixtures omitted bubble initialization;
tests preserve those literal cases and add initialized counterparts. Fixed-size
geometry scratch comes from factories on the class; returned lists are owned.
Destiny remains 114e89f. No runtime changes or native executable oracle.

## Relative velocities and accuracy

[Relative motion](destiny-relative-motion.md) implements Ball and ClientBall
calculations with caller-owned output records, native flag dependencies and
partial-write behavior. ClientBall samples at the donor-selected shared time,
preserves float32 velocity subtraction, and uses pools across reentrant curve
calls. Dynamic angular compensation leaves raw transversal speed unchanged.

GetAccuracy retains the source subtraction formula, including negative-roundoff
NaN tracking and accuracy above one. Reference arguments and the seven-scalar
Blue wrapper preserve output order and early-return values. The two-tick client
offset widens to BigInt like GetShiftedTime; final int64 overflow throws.

Twenty-one tests bring the suite to 720, including all seven donor accuracy
fixtures, independent relative-motion examples, cached curves, nested sampling,
exception pool balance, precision and reference aliasing. Donor remains 114e89f;
runtime remains untouched. Interfaces, streams, network batches and replay stay open.

## Native state packet writing

[State streams](destiny-streams.md) implement full and selected packet writers,
all supported mode payloads, native integer narrowing, Mini section order/count
wrapping, filtering and overwrite without truncation. BOID/MINIBALL retain the
native incomplete-prefix behavior. CjsDestinyStream wraps the existing runtime
bounded reader with owned storage, seek/write and exact-width scalar operations;
it avoids float normalization and does not change runtime.

Nineteen tests bring the suite to 739. Independent literal/field-offset fixtures
verify wire layout rather than relying on self-round-trip. Reader restoration
remains open, including the native AddBall replacement behavior documented in
the stream guide. Scalar snapshots preserve native stack values across nested
stream calls. No native executable oracle, transport or restart parity is claimed.

## Native state restoration checkpoint

ReadBallFromStream and the public ReadFullStateFromStream/PyReadFullStateFromStream
wrappers now follow Thunkers.cpp:2083-2142,2463-2509,2897-3177. The C++ body
method becomes _ReadFullStateBody solely to distinguish it from the Blue alias.
Source baseline remains 114e89f. Thirty additional tests bring the suite to 769.

Independent rigid/dynamic packet literals verify defaults, widths, signed fields
and orientation layout. Further fixtures cover all supported mode tails,
duplicate/forward/missing follow references, partial==0/1/2, all mini families,
reverse removal order, retained descriptor/collider ownership, old samples,
pooled-vector reentry and error cleanup. Bounded-read and finite-creation
adaptations are documented in the [stream guide](destiny-streams.md).

Two earlier port errors were corrected without a donor update. AddBall had
called Stop on replacement, prematurely unlinking the old target and freeing
formation slots; native Ballpark.cpp:3303-3462 retains them and prunes only
inconsistent incoming followers after its SetMode call. Clamps now also narrow
float inputs first and preserve negative zero. ScanCone now uses the native
PI literal 3.141592654 (Thunkers.cpp:10,2379-2461), including its slightly wider
spherical-shortcut threshold. Regression tests distinguish both behaviors.
Runtime remains untouched; transport, client snapshots/replay and interfaces
remain separate outstanding obligations.

## Client ticker and nonvirtual binding checkpoint

The [client ticker](destiny-client-ticker.md) ports all production methods in
the donor client BaseTicker/Ticker and merge helper, plus the application callback
contracts. Its native input and snapshots use the existing simulation and stream
ports. Blue marshal.Load is an explicit external dependency, not a new encoding.
Forty tests bring the suite to 809, including all 21 native client tests.

The new integration exposed a prior JS dispatch difference: native C++ calls
between exposed Ballpark methods are nonvirtual, while this.Method() could
re-enter a game override. Seventy-eight call sites now use the owner prototype,
including Python bindings, creation/restoration and movement/removal chains.
Existing behavioral spies were moved to the owner methods with finally cleanup;
their assertions remain. New override regressions exercise incoming FollowBall,
Stop, CloakBall, creation and rewind. The native Blue-name table excludes internal
or inherited Object methods and retains explicit Py admission checks.

Source evidence: destiny/src/Ballpark.h:295-299; destiny/src/Ballpark.cpp:3929;
destiny/src/Thunkers.cpp:244-269,1846-1865;
destiny/src/Ballpark_Blue.cpp:180-188,292-753. Donor remains 114e89f; this is a
port correction rather than changed upstream behavior. PyOS/game callbacks
remain dynamic. Native snapshots retain their partial-restore and pruning
quirks; full native interface parity, remaining binding admission, server
batching and actual marshal wire compatibility are not claimed.
