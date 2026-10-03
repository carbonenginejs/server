# Collision history records

Status: Evolving
Scope: `@carbonenginejs/server/destiny`
Audience: Maintainers and simulation integrators
Summary: Native collision history, discovery, impulse calculation and iterative scheduling.

`CollisionImpact`, `CollisionItem`, `BallLocation` and `CollisionBallProperties`
are exported from the Destiny entry point. They implement the records in
`destiny/src/CollisionStructures.h` and the methods in
`destiny/src/CollisionBallProperties.cpp` at donor baseline `114e89f`.
Ballpark contact approximation, static/free impulses, recursive invalidation,
collision discovery and iterative scheduling are implemented for supported
movement modes. [Mini ownership](destiny-minis.md) and [warp integration](destiny-warp.md) are implemented.

## Ownership and time

Each location owns float64 position/velocity vectors and float32 rotation/angular
velocity values. No vector aliases the source Ball. A history borrows its Ball,
which must remain attached to a park for integration. `Initialize(ball, endTime)`
discards previous impacts and samples the current physical state at zero and at
the supplied end time. Times are relative seconds. `IgnoreCollision` alone takes
a fraction of the current search interval.

The JavaScript adaptation grows records on demand instead of reserving
`collisionMaxIterations + 2` native vector slots. Removed entries stay in an
instance-owned pool with their math storage. Surviving entries keep their values;
regrown entries reset all fields to the native defaults. Callers must not retain
removed history entries. ID inputs normalize safe Number values and BigInts to
signed-int64 BigInts when an impact is accepted or queried.

Invalidation results are caller-owned arrays of `[time, colliderID]` pairs. They
remain valid across nested removals. Integration temporaries use balanced pools,
including exception paths; samplers write caller-owned outputs after calculation.
No simulation schema APIs participate, and runtime allocation settings are unchanged.

## Mutation and sampling

| Method | Native behavior |
|---|---|
| `Initialize` | Creates two live endpoints, preserving surviving angular slots and cached angular time constant while dynamic orientation is off. |
| `AddImpact` | Rejects times at or after current `m_tEnd`; keeps equal-time records already in history; reports removed collisions newest first. Changes only the search end time. |
| `RemoveImpact` | Removes the first collider/time match within a strict fuzzy threshold; reports later collisions oldest first and rebuilds the endpoint. |
| `CalculateEnd` | Appends an endpoint only when the tail precedes `m_maxTime`; only then updates search start/end times. |
| `IgnoreCollision` | Searches backward from the penultimate record within the fuzzy window; ignores the final record and permits negative interval fractions. |
| `FindLocationsIndex` | Selects the preceding segment around a fuzzy boundary, including the pre-impact segment at an exact impact time. |
| `CalculatePosition` | Copies a segment's position/velocity and integrates when absolute elapsed time is at least `1e-4`. Extrapolation is permitted. |
| `CalculateRotation` | Copies angular state and integrates only when absolute elapsed time exceeds `1e-4`. |

The park's existing `CalculateBallPositionVelocity` and
`CalculateBallRotationVelocity` dispatch directly to these sampling methods when
a history exists in `mCollisionLocations`, even after disabling the iterative
setting. Discovery, ordering and cleanup follow the scheduler described below.

## Preserved donor quirks

`RemoveImpact` initializes its found flag to true. A missing match therefore
resets history from index zero, restoring the current Ball velocity while retaining
the first position, rotation and timestamp (`CollisionBallProperties.cpp:120-165`).
The port deliberately preserves this behavior.

Angular calls pass elapsed seconds directly to `ApplyTorque`, which treats that
argument as a fraction and multiplies by the park tick duration. For a two-second
tick, initialization to two seconds therefore integrates angular motion over four
seconds (`CollisionBallProperties.cpp:51,108,188,257`; `Ballpark.cpp:1936-1942`).
The port does not divide by the tick duration to repair it.

A value-initialized `CollisionImpact` has collider zero, while a `BallLocation`
defaults to collider minus one. A zero-time impact appends another zero-time record;
an impact earlier than the first location instead replaces index zero. These
sentinels and branches are kept distinct.

Tests independently solve terminal-speed motion and exponential impulse decay,
verify both invalidation orders, fuzzy boundaries, extrapolation, dynamic-off
storage reuse, angular integration, ID normalization and pool cleanup. These are
source-derived and analytic checks, not a native executable oracle.


## Contact impulses and recursive propagation

`ApproximateEllipsePointOfImpact(ball, location, collision, out)` writes a
caller-owned float64 contact offset. Static and free impulse calculations retain
native `CollisionItem`/`CollisionImpact` ownership. Temporary locations and vectors
come from balanced complete-frame pools, allowing sampling to reenter an impulse
calculation without overwriting live state.

`CalculateCollisionImpactStatic` fills a candidate once when `mbIndex2 === -2`.
`CalculateCollisionImpactFree` fills a pair and returns the owned reciprocal
candidate. Both include angular surface velocity and the donor's approximate
inertia when dynamic orientation is enabled. Static overlap acceleration updates
before position sampling when time equals the search start. Free overlap updates
after sampling and only at absolute time zero.

`AddImpact` caps the caller's impulse, updates its existing history and recursively
removes invalidated contacts from other free balls. Linear and angular limits use
squared ratios directly; this does not clamp a vector to the nominal limit length.
Native float32 numerator arithmetic is preserved. `RemoveImpactFromFree` walks
the invalidation graph depth first after rebuilding each history. Repeated visits
to a ball are required; a visited set would change the result. Missing histories
log and return, matching the native error path.

Preserved contact quirks (`Ballpark.cpp:2323-2672`):

- Dynamic exact-zero, axial, out-of-range and unordered cosine branches return
  the outward normal without radius scaling. Quaternion matrix arithmetic is
  staged as native float32 because rounding can select a different branch.
- A zero axis in the native Rodrigues matrix produces a cosine-scaled diagonal;
  converting through an axis-angle quaternion would change this case.
- Negative impulses leave allocated zero impacts with collider zero; exactly
  zero impulses receive actual collider IDs.
- The reciprocal free candidate copies the original collider pointer even though
  its impact's collider ID names the first ball. Miniball indices swap.
- Zero radius/mass divisions retain native nonfinite results; no epsilon is added.

Tests cover unequal-mass elastic responses, independently derived oblique angular
contacts, exact float branch boundaries, singular inputs, mutation order, squared
caps and a four-ball invalidation graph that must visit one ball twice.

## Discovery, scheduling and cleanup

`CalculateCollisionResponse` creates a history when needed and fetches partition
candidates only on pass zero. Static shapes are searched first, followed by fixed
balls and then free balls. Candidate order is retained; equal-time contacts do
not introduce a new tie-breaker. Free searches use exact signed BigInt IDs and
split the interval at the other ball's recorded impacts. A missile can search
lower IDs, while ownership, target, junk and mass exclusions retain their native
asymmetry (`Ballpark.cpp:1988-2320,2675-2682`).

`CalculateIterativeCollisionResponses` reinitializes every cached history and
clears candidate arrays in place. It first visits free balls in signed-ID order,
then deduplicated ordered worklists containing impacted balls and free neighbors.
Moribund, dead-bubble and nonmassive balls are skipped. Pass zero runs even when
the iteration cap is zero (`Ballpark.cpp:332-402`). JS Maps plus reusable key
arrays replace ordered native dictionaries; history initialization uses Map
insertion order instead of unspecified native hash order. Balanced frame pools
replace stack math values and the donor's static search scratch.

Evolution completes behavior for all balls before solving. It samples position
at `dt` and iterative rotation at fraction `1`, stages results, then commits all
balls (`Ballpark.cpp:425-519`). The committed positions therefore include the
solved impacts and remain available to ClientBall sampling.

Preserved discovery and settings quirks:

- Fixed-sphere discovery compares a segment fraction against the current
  absolute impact time before storing the converted time (`Ballpark.cpp:2158`).
  A later sphere can replace an earlier shape when the search start is nonzero.
- An ignored free contact skips advancing the segment starting positions
  (`Ballpark.cpp:2276`), so the following segment can use an earlier position.
- Static hits leave `mbIndex2` untouched; fresh candidates supply `-2`. Free
  hits leave the normal untouched until impulse calculation fills it.
- Final removal and `ClearAll` erase collision caches only while iterative
  collisions are enabled (`Ballpark.cpp:5556-5562,5912-5917`). Disabling the
  setting retains histories, and sampling still consults them. Removing balls
  while disabled can therefore retain detached references; later initialization
  may fail. This is native behavior, not a supported cache-reset operation.

Regression tests distinguish source-derived discovery/control-flow cases from
the donor Python scenario assertions. Thirty collision scenarios
from `test_iterative_collision.py` pass: thirteen sphere, eight capsule and nine box
cases, including the MiniBall-target scenario. The separate warp pass-through
scenario also passes; one further
miniball multicollision test is already disabled in the donor. Static scenarios
now use actual Mini owners through their native attachment APIs. Changed physical values use controller setters to reproduce
Blue notifications, including spatial reinsertion after velocity changes in the
three-phase oblique box scenario. Donor decimal-place assertions use equivalent
absolute half-unit bounds; no fixture expectations are generated by the JS port.
No native executable oracle is claimed.
