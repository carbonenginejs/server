# Collision history records

Status: Evolving
Scope: `@carbonenginejs/server/destiny`
Audience: Maintainers and simulation integrators
Summary: Native collision history storage, invalidation and sampling before iterative scheduling.

`CollisionImpact`, `CollisionItem`, `BallLocation` and `CollisionBallProperties`
are exported from the Destiny entry point. They implement the records in
`destiny/src/CollisionStructures.h` and the methods in
`destiny/src/CollisionBallProperties.cpp` at donor baseline `114e89f`.
The iterative scheduler and impulse producer remain unported. Selecting iterative
collision still throws before movement; these classes do not enable that solver.

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
a history exists in `mCollisionLocations`. Automatic creation, impact propagation,
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
