# Destiny headless physics implementation plan

Status: Evolving
Audience: Destiny port maintainers
Summary: Implementation phases for the native headless simulation; this is future work, not supported APIs.
Scope: The physics and spatial behavior available in the public Destiny donor,
implemented in the experimental server package without a running EVE client.

The objective is a headless ballpark that accepts object state and commands,
advances the source physics, and exposes state, spatial queries and events.
The client is not required to calculate these results. Authored ship shapes,
gameplay parameters and host services must instead be supplied explicitly.
Implement the donor algorithms first; distinguish absent client data from an
absent algorithm, and keep approximations visible.

The plan is pinned to Destiny revision
`114e89fa584f0e1a81eb0a679aabf41af8870072`. It covers the reviewed public source,
not an assertion of current Frontier server behavior. Source references below
are relative to the `carbonengine/destiny` repository. The starting implementation
and its recorded adaptations are described in [destiny-parity.md](destiny-parity.md).

## Current implementation

`CjsBallparkController` and `CjsDestinyBall` currently provide object lifecycle,
fixed one-second ticks, drag integration, goto point/direction, follow, legacy/new
orbit, and stopping. Seventeen tests passed when this plan was prepared,
including six numeric donor trajectories. Collision forces, bubbles, full
orientation, queries, warp and replication are not implemented.

Preserve those fixtures while extending the implementation. The current scalar
position/velocity representation retains double precision; native float fields
are rounded at controller boundaries. Direct field mutation does not currently
implement native property hooks. IDs and native timestamps now use checked BigInt storage; safe integer Number
inputs remain convenience forms. The settings and non-dynamical new-orbit
checkpoints are also implemented; phase completion still needs the remaining
state, settings consumers and orientation work.

## What can run without the client

| Feature family | Headless implementation and required inputs | Donor entry points |
| --- | --- | --- |
| Linear movement | Port directly using mass, agility, speed, throttle and commands. Complete fractional-time evaluation as well as fixed ticks. | `Ballpark.cpp::Integrate`, `GotoThrust`, `EvolveBehaviorForBall` |
| Legacy orientation | Calculate heading, yaw, pitch, roll and orientation continuity from motion. No rendered ship is needed. | `Ball.cpp::CalculateYawPitchRoll`, `SnapOrientation` |
| Dynamical orientation | Port torque, roll, angular velocity, quaternion integration and angular controls. Supply native physical parameters. | `Ballpark.cpp::GotoTorque`, `GotoTorqueBreaks`, `GotoRoll`, `GotoRollBreaks`, `ApplyTorque` |
| Both orbit models | Retain old orbit and add the newer spiral/velocity-following model and orbital normals. | `EvolveOldStyleOrbit`, `EvolveNewStyleOrbit`, `GetOrbitalNormal`, `GotoThrustFollow`, `OrbitThrust` |
| Collision primitives | Port swept sphere, segment/plane, sphere/triangle, capsule and oriented-box math. Synthetic shapes suffice for verification. | `Collision.*`, `AABB.*`, `Plane.*`, `Triangle.*`, `BoxShape.*`, `Capsule.*`, `OrientedBox.*` |
| Compound collision shapes | Preserve mini-ball, mini-capsule and mini-box attachment, owner transforms and lifecycle. Shapes must be supplied by a caller or a verified data importer. | `MiniBall.*`, `MiniCapsule.*`, `MiniBox.*`, `Ball.cpp::AddMiniBalls`, `AddMiniCapsules`, `AddMiniBoxes` |
| Legacy collision response | Port the source-default gradient/potential path, static contacts and collision exclusions. | `Ballpark.cpp::Gradient`, `Potential`; collidable `CollideWithBall` methods |
| Iterative collision response | Port time-of-impact ordering, multiple impacts, impact invalidation and re-evaluation, static/dynamic impulses and rotation coupling. | `CalculateIterativeCollisionResponses`, `CalculateCollisionResponse`, `CollisionBallProperties.*`, `CollisionStructures.*` |
| Spatial partition | Port occupied hierarchical boxes, inflated bounds, membership and candidate enumeration. This is a search structure, not a texture or hull-detail representation. | `Partition.*`, `Partitionable.*`, `Box.*`, ballpark insertion methods |
| Bubbles and activity | Emulate grouping, transitions, merging/conflict handling, interactive counts, keep-alives and inactive-region evolution rules. Host population is synthetic or supplied. | `InitializeBubbles`, `CopyBubbles`, `ResolveBubbleConflicts`, `InDeadBubble`, `UpdateBallBubble` |
| Warp | Port alignment, entry, acceleration/cruise/deceleration, exit, destination adjustment and entity warp-in. Supply warp parameters and relevant world objects. | `WarpTo`, `RealWarp`, `SetupWarpConstants`, `WarpDistance`, `ShiftFromPlanets`, `EntityWarpIn`; Ball warp predicates |
| Missiles | Port launch state, initial straight flight, predictive pursuit and owner/target collision rules. Impact events remain separate from damage calculation. | `Thunkers.cpp::PyLaunchMissile`, `MissileFollow`, `EvolveMissile` |
| Formations | Supply formation offsets; port reservations, release and leader-relative transformed following. | `AddFormation`, `SetBallFormation`, `FormationFollow`, `EvolveFormation`; Ball slot methods |
| Special physical modes | Port expanding mushroom lifetime/radius, delayed troll-to-rigid conversion, rigid state and field/harmonic behavior where consumed. | `AddMushroom`, `Evolve`, `SetBallTroll`, `TrollReady`, `PetrifyTroll`, `SetBallRigid`, `SetBallHarmonic` |
| Distance and volume queries | Port center/surface distance, range lists, cone/capsule/triangle queries and the separate scan API with each method's native filters. | `Thunkers.cpp::GetBallIdsInRange`, `GetBallIdsInRangeOfTriangle`, `GetBallIdsInCone`, `GetBallIdsInCapsule`, `PyScanCone` |
| Visibility | Reproduce native line-of-sight results and sentinels. The reviewed `CheckVisibility` uses main spheres, not detailed hulls. | `Ballpark.cpp::CheckVisibility`, `GetIntersection` |
| Proximity and tracking | Replace Blue event delivery with an explicit host adapter while preserving ranges, periods, shuffled sensor scheduling, transitions and cleanup. | `Ball.cpp::CheckForProximity*`, `Ballpark.cpp::HandleProximities`, `SetNotificationRange`, `SetTargetTracking` |
| Relative motion and accuracy | Port relative/radial/transversal/angular calculations and the source accuracy formula. Caller supplies tracking, falloff and signature parameters. | `Ball.cpp::CalculateRelativeVelocities`, `Ballpark.cpp::GetAccuracy`, corresponding Python wrappers |
| Cloaking and physical flags | Retain cloak modes and source-specific effects on target links, sensors, queries and collisions; do not turn cloak into a universal collision exemption. | `CloakBall`, `UncloakBall`, flag setters and their consumers |
| Interpolation and reference frames | Execute available ClientBall numeric code without rendering: interpolated position/rotation, time shifts, continuity, velocity/distance queries and reference-point deltas. | `Ball.cpp::ClientBall` methods; `Ballpark.cpp::Delta`, `DeltaVel`, `AdjustTimes` |
| ClientBall impact motion | Emulate its additional impulsive rotation and decay as optional derived state. Keep it distinct from authoritative collision impulses. | `ClientBall::ApplyImpulsiveForceAtPosition`, `ProcessImpact`, `ApplyAngularVelocityToRotation` |
| Simulation lifecycle and replay | Port start/pause/tick behavior, deferred deletion and state serialization needed to resume equivalent physics. An in-process host replaces Blue scheduling and transport. | `OnTick`, `Start`, `Pause`, `BringOutTheDeads`; `Thunkers.cpp` stream methods; `python/destiny/net` |

This inventory is the implementation scope, not a claim that every branch has
already been audited. Each phase starts by reading the corresponding headers,
implementation, Blue exposure, wrappers and tests together.

## Boundaries that must stay explicit

**Every movement mode needs a disposition.** GOTO, FOLLOW, STOP and ORBIT are
partially implemented. WARP, MISSILE and FORMATION have dedicated evolution
code to port. MUSHROOM and TROLL also depend on tick/lifecycle handling.
MINIBALL, FIELD and RIGID have shape/state/filter roles; they must not be
invented as independent steering algorithms. BOID is set by `PySetBoid`, but
the reviewed `EvolveBehaviorForBall` has no BOID steering branch. Reproduce its
observable source behavior after tracing all consumers; do not advertise flocking.

**Inputs are not client dependencies.** Mass, agility, signatures, warp factors,
formation offsets, world objects and authored collision shapes can be injected.
Synthetic values allow the algorithms to be completed before a game-data importer.
Matching a particular ship still requires its correct inputs. Radius-derived
fallback shapes must be labelled approximations, never represented as real hulls.

**Keep unavailable systems outside the parity claim.** Game AI, drone target
selection, aggression, weapon activation, damage, fitting/stat derivation,
inventory and permissions do not follow from porting Destiny movement. The
accuracy formula and physical missile events are included; a complete combat
system is not. Rendering, audio, UI and actual client connectivity are unnecessary.

There is no basis in this reviewed code for promising texture-based hull physics,
distance-refined collision geometry, arbitrary triangle-mesh rigid-body dynamics,
deformation, material-specific contact behavior or general gravitational dynamics.
Triangle intersection helpers alone do not establish mesh-body support. Detailed
Frontier-style hull visibility is a future extension unless corresponding donor
code is found. Keep it separate from the source-compatible sphere visibility API.

## Implementation rules

Continue using `CjsBallparkController` for Ballpark responsibilities and
`CjsDestinyBall` for Ball responsibilities. New donor-backed classes use the
approved temporary `CjsDestiny*` naming and declare their actual donor via schema
metadata. Candidate families include Partitionable, Partition, Box,
StaticCollidable, Capsule, OrientedBox, MiniBall/MiniCapsule/MiniBox,
CollisionBallProperties, SettingsConfiguration and ClientBall. These are planned
names, not existing exports. Preserve donor inheritance and method ownership;
do not move all behavior into new generic managers.

Preserve donor names and behavior, and document JavaScript adaptations at their implementation sites.
Use Stage-3 decorators, explicit method implementation status, declaration-site
defaults and native enum/sentinel values. Audit existing runtime math/geometry
owners before adding any helper. Keep large-coordinate calculations in f64 and
source f32 rounding where applicable. Resolve missing f64 container ownership
before introducing a second vector library. Test noncommuting quaternion and
matrix compositions; identity-only tests will miss reversed multiplication.

Port the legacy and optional algorithms as distinct paths. The reviewed defaults
disable iterative collision, dynamical orientation and new orbit, and set the
collision iteration cap to 20 (`src/Settings.h`). Preserve defaults and reproduce
setting interactions before offering an explicitly selected newer profile.

Existing documented corrections and native quirks remain regression cases.
Every additional departure requires source evidence, an implementation marker,
a test and an entry in the appropriate parity/defect record. Preserve exact error
and missing-ID behavior where supported; do not silently substitute another mode.

## Phase 1 Complete the simulation state and host boundary

Complete Ball/Ballpark fields, defaults, physical setters, mode transitions and
follower bookkeeping needed by later phases. Add old/new position, velocity,
orientation and timestamp contracts, cached derived values, local IDs, flags,
delayed removal, cleanup callbacks and the settings object. Confirm authoritative
`isMaster` paths separately from replica behavior.

Define a small explicit adapter for the native host services actually invoked:
clock/scheduling, event callbacks, formation data and world/shape inputs. Keep
callback names, arguments and ordering traceable to the donor. Implement a
deterministic manual-tick host first; no socket server, render loop or background
timer is needed. Preserve the native default step and separate `Evolve` from
`OnTick`, pause/start and timestamp adjustment semantics.

Implemented after fixture/API review: canonical signed-int64 BigInt identities
and native timestamps, with checked safe Number inputs and native local-ID
allocation. The same object is addressed by `1` and `1n`; simulation counters
and Actions stamps remain Numbers. Later interpolation must convert only bounded
timestamp differences to Number for integration, never absolute timestamps.
Native stream representation and remaining state/settings obligations are pending.

Exit checks: current trajectories still pass; property changes update caches;
creation/replacement/removal preserves links; missing objects and callback-driven
removal are safe; pause/resume and tick sequencing match `test_time.py`; extreme
and negative/local IDs round-trip without losing identity.

## Phase 2 Geometry and spatial partition

Translate and test the scalar geometry helpers first. Add static capsules and
oriented boxes, then compound mini-shapes and their actual source attachment
rules. Verify which shapes are active for free versus static owners and how
orientation, shape dimensions, replacement and removal alter membership; do not assume
every shape combination participates in both solvers.

Port Partitionable/Partition/Box membership, inflated swept bounds and candidate
enumeration. Use the explicit KeyHash in `src/Partition.h:104-123` from the current
baseline, not the removed implicit linear hash. Preserve key equality/clamping and
include `tests/TestPartition.cpp:5-13`; native unordered traversal is not a stable
ordering contract. Add bubble initialization, merging/conflict resolution, transitions,
interactive counts and keep-alive behavior. Keep partitioning and bubble activity
distinct: one reduces spatial searches; the other also affects simulation activity
and visibility/interest semantics.

Exit checks: native C++ geometry tests translated from `tests/TestAABB.cpp`,
`TestBoxShape.cpp`, `TestCollision.cpp`, `TestPlane.cpp`, `TestTriangle.cpp` and
relevant vector cases; Python mini-shape and box/bubble tests; degenerate capsules,
rotated boxes, negative coordinates, cell boundaries and rapid movement. Compare
partition candidate sets with an independent brute-force oracle on small synthetic
scenes to detect missed contacts; extra broad-phase candidates are acceptable.

## Phase 3 Legacy collision response

Port `Gradient`, `Potential`, static `CollideWithBall` paths and collision
notification accumulation. Reproduce native ordering, recursion limits and filters
for massiveness, space junk, owners, missiles, mini-shapes, warp and harmonic fields
where the selected source path uses them. Integrate collision and command forces
in the same phase order as the donor.

Exit checks: `test_simple_collision.py` and applicable mini-shape tests; unequal
masses, moving versus static objects, initial overlaps, glancing contact, high-speed
passage through thin obstacles, owner exclusions and removal during notification.
Compare donor fixtures where available. Do not assume conservation laws for the
complete update: drag and commanded thrust add or remove momentum and energy.

This phase is the first usable collision milestone: objects can bump into
synthetic obstacles using the source-default solver.

## Phase 4 Orientation and newer orbit

Current partial implementation: the non-dynamical new-orbit dependency chain
and its four native scenarios are ported. No new persistent Ball state was
needed for that path. Dynamical orientation and the heading-based orbital-plane
fallback remain unported; enabling them fails explicitly at execution sites.

Add legacy heading/roll outputs, dynamically oriented creation and setters,
angular agility/speed, torque, roll and quaternion evolution. Then implement
orbital normal selection, `GotoThrustFollow`, `OrbitThrust` and new-style orbit.
Check the missile orientation-disable setting without prematurely implementing
missile gameplay. Position and orientation sampling must share the same tick state.

Exit checks: the new-orbit scenarios in `test_orbit.py`; stable circular motion,
inside/outside approach, moving targets, speed changes, zero-speed and coincident
cases; normalized finite rotations; opposite headings; independent parks and all
relevant settings combinations. Record test tolerances by quantity and source test,
not one universal decimal threshold.

## Phase 5 Iterative collision response

Add collision location/impact records and their ordered intervals. Port earliest
impact discovery, static and free-body responses, propagation to neighbors,
invalidation of later impacts and re-integration. Include initial-overlap handling,
the iteration cap, time comparison tolerance and angular velocity changes when
dynamical orientation is enabled.

Preserve the donor's elastic impulse assumptions, inertia approximation and
approximate elliptical contact point. These are source behavior, not a general
material solver. Keep response caches owned by the park and invalidate them when
objects or physical parameters change according to the native lifecycle.

Exit checks: `test_iterative_collision.py`, including contact order, substeps,
multiple overlaps, unequal masses, capsule/box directions, zero-length capsules,
compound contacts, warp exclusions and non-massive objects. Test chains and
simultaneous impacts, rotational contacts, iteration exhaustion and stale-cache
cleanup. In symmetric ambiguous contacts, investigate native iteration order
before imposing a new sort and calling it parity.

## Phase 6 Remaining movement and special physical states

Implement warp alignment and entry predicates, phase constants, distance/velocity
evaluation, short and long warps, termination, entity warp-in and source destination
adjustment. Include bubble transitions and collision/proximity exclusions at each
warp phase. Caller-supplied world objects stand in for client/game-data loading.

Implement missile launch inputs, initial thrust interval, predictive pursuit,
target disappearance/cloaking and owner/target collision rules. Emit source-style
physical callbacks. Add formation loading, slot reservations and rotated offsets.
Complete mushroom growth/expiry, troll petrification, rigid/field state and the
remaining enum dispositions. Trace the source's collection membership for these
special states before assuming that all are ordinary free-ball integration.

Exit checks: `test_warp.py`, `test_missile.py`, formation cases in `test_follow.py`,
movement-control and lifecycle tests; target removal mid-flight, leader removal,
full/invalid formation slots, warp transition boundaries, expanding-shape expiry,
delayed rigid conversion and field filters. Maintain an explicit test/status entry
for every `DSTBALLMODE` member, including source modes with no dedicated steering.

## Phase 7 Spatial queries and physical events

Implement each distance, range, cone, capsule, triangle and scan API from its own
wrapper and core algorithm. Preserve sorting, boundary inclusion, sentinels,
cloaking/global/interactive filters and center-versus-surface semantics. Add the
native sphere-only visibility function; retain its actual implementation return
codes rather than relying on conflicting comments.

Add relative-motion calculations and `GetAccuracy`, including native wrapper
output values. Add notification ranges, target tracking and periodic sensors,
their entered/exited sets, and collision/bubble/cleanup event delivery. Supply
repeatable scheduling inputs where source sensor behavior shuffles work. Complete
cloak/uncloak and other setters' side effects instead of only storing flags.

Exit checks: visibility, getter/setter and callback donor tests; an independent
small-scene oracle for query inclusion; tangent and inside-origin rays; exact range
boundaries, coincident positions, zero tracking/falloff inputs, sensor expiry,
target deletion, dead bubbles and callbacks that mutate the park. Detailed hull
LOS remains outside the native visibility claim.

## Phase 8 Headless interpolation and replay

Port the numeric subset of ClientBall as its own donor-backed class, rather than
mixing presentation state into the authoritative Ball. Add timestamp shifting,
interpolated position/rotation, reference-point/unit conversion, continuity and
optional impact rotation/decay. Duck-type only the explicit time/reference/curve
interfaces these methods consume. No Trinity renderer is required to inspect the
resulting positions and rotations.

Port available full-state and ball-stream formats when needed to prove restart
equivalence, using existing organization binary I/O facilities where appropriate.
Review `python/destiny/net` for action timing and replica sequencing. Provide an
in-process replay harness; this does not require live network transport or EVE
protocol compatibility. Native snapshots may omit future-affecting transient
state: test that boundary and do not claim exact mid-tick restart from a format
that was never designed to provide it.

Exit checks: `test_stream_read_write.py`, time and applicable net ticker/action
tests; tick endpoints and intermediate samples, pause, time shifts, warp sampling,
object removal and changed parameters. Round-trip native fields byte-for-byte
where promised; compare uninterrupted and restored evolution at supported
checkpoint boundaries. Confirm derived impact animation never changes authoritative
collision outcomes.

## Phase 9 Data adapters and completion audit

Provide a headless integration example using synthetic moving ships, a compound
obstacle, warp, missiles, formations and sensors. Run it without rendering or game
assets. Add an optional shape/world-data adapter only after a real input format
and transform convention have been verified. Runtime asset readers remain with
their established owner; the server consumes their output rather than copying them.

Audit the full source surface, not just passing tests. Each physics-relevant
method, state, setting, callback and enum value receives one disposition:
implemented and verified; adapted with evidence; native no-op/passive state;
host/data-supplied; or excluded with a concrete reason. Unverified native paths
stay labelled unverified. Any unresolved emulable physics obligation prevents
calling the headless scope complete.

Measure CPU time, memory and allocation rate on recorded synthetic sparse, dense,
compound-shape and chain-collision scenes. Report object/shape counts, settings,
machine and results. Establish a baseline before setting budgets; do not promise
EVE-scale throughput or cross-platform bitwise determinism from small fixtures.
Run long simulations for finite state, link cleanup and bounded retained caches.

## Validation strategy

Use three evidence levels throughout: translated donor tests/golden trajectories;
independent mathematical or brute-force checks; and integrated scenario/replay
tests. A self-round-trip alone cannot establish native stream parity, and a
fixture comparison alone cannot establish every branch of a solver.

Keep `npm test` noninteractive and free of assets or a running client. Make large
stress scenes and native-oracle comparisons separate optional commands. A native
CPU oracle may be added if buildable from the public source, but must not become
a requirement for the ordinary JS suite. Do not generate expected trajectories
with the implementation being tested.

For every phase, run its focused tests and the complete server suite, update the
source correspondence, and check imports, schema registration, style and method
metadata. Keep native defects/corrections explicit. No runtime rebuild or edit is
part of ordinary server validation; a missing shared prerequisite gets its own
reviewed change in the correct owner.

## Recommended delivery order

The dependency order is phases 1 through 9. Geometry/query primitives can be
tested during phase 2, but their full bubble/filter/event behavior belongs to
phase 7. Orientation precedes angular collision response; compound shapes and
partitions precede either complete collision solver; replay follows authoritative
state semantics.

The first implementation task should be phase 1, followed by phase 2 and the
legacy collision milestone in phase 3. Keep each donor class or algorithm family
reviewable as it lands. Completion means source-backed headless physics with
explicit input adapters and documented limits, not the presence of thirteen enum
values or a substitute implementation for missing gameplay policy.
