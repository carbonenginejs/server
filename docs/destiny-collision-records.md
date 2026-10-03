# Collision history records

Status: Evolving
Scope: `@carbonenginejs/server/destiny`
Audience: Maintainers and simulation integrators
Summary: Native collision history, impulse calculation and invalidation before iterative scheduling.

`CollisionImpact`, `CollisionItem`, `BallLocation` and `CollisionBallProperties`
are exported from the Destiny entry point. They implement the records in
`destiny/src/CollisionStructures.h` and the methods in
`destiny/src/CollisionBallProperties.cpp` at donor baseline `114e89f`.
Ballpark contact approximation, static/free impulses and recursive invalidation
are implemented. Collision discovery and iterative scheduling remain unported.
Selecting iterative collision still throws before movement.

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
a history exists in `mCollisionLocations`. Recursive impact propagation is implemented; automatic collision discovery,
ordering and cleanup by the iterative scheduler remain to be implemented.

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
