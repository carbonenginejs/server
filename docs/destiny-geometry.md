# Destiny numeric geometry

Status: Evolving
Scope: AABB, Planed, Triangle, RectangleShape, BoxShape and Collision free functions
Audience: Simulation maintainers
Summary: Native double-precision queries with explicit JavaScript output parameters.

Import from `@carbonenginejs/server/destiny/geometry`. Class exports are
`CjsDestinyAABB`, `CjsDestinyPlaned`, `CjsDestinyTriangle`,
`CjsDestinyRectangleShape` and `CjsDestinyBoxShape`, with explicit
donor metadata. Their field and method names follow the native owners.

Vectors are three-element Number arrays or caller-provided Float64Array values.
No f32 allocation defaults are used. Constructors copy native value arguments.
`Triangle.GetNormal(out)`, `Triangle.GetClosestPoint(out, point)` and
`GetPointOnBallThatFirstIntersectsPlane(out, ...)` write a supplied vector in
place of native vector returns. Retained vectors belong to their instance or
caller; class scratch does not escape.

`IntersectSegmentPlane`, `IntersectSegmentSphere` and
`IntersectSphereTriangle` take one final output record replacing C++ references:

```js
const out = { collisionPoint: [0, 0, 0], collisionTime: 0, normal: [0, 0, 0] };
```

Only the triangle function requires normal. It snapshots the native by-value
inputs before output writes, including aliased caller storage. Boolean returns
and partial writes are preserved: false does not promise untouched outputs.
`Quadratic(out, a, b, c)` writes `out.v1` and `out.v2`.
`CollideTwoSpheres(p0, p1, q0, q1, combinedRadius)` returns a contact fraction
or the native -1 miss sentinel. Sphere velocity in the triangle query denotes
the displacement over its tested interval, as in the source.

## Preserved source quirks

- `Collision.cpp:137`: the linear Quadratic branch falls through into division
  by zero. Its nonfinite results are preserved, not corrected silently.
- `Collision.cpp:29`: a stationary segment on a sphere surface reports true
  with NaN contact time and point. Ordinary stationary overlap still returns 0.
- `Triangle.cpp:80`: containment excludes the u+v==1 edge and does not test
  coplanarity. This is not a general point-on-triangle predicate.
- `AABB.cpp:45`: touching bounds cannot be excluded. A false broad-phase
  result is only a candidate, not proof of contact.

The matching five native test files provide 69 copied fixtures. Additional
independent/source-derived cases cover precision, aliases, partial writes and
quadratic/swept-sphere behavior. No native binary was executed. Static shape
wrappers and their direct response methods are described below; Ballpark collision
scheduling and compound mini-shapes remain unported.

## Box and rectangle composition

The `BoxShape/` family follows the native header's declaration order. Its shared
`BoxCorner` and `BoxSide` objects preserve the global native enum names and values.
Box faces own copies of corner coordinates, and default constructors retain
independent zero Vector3d values. No schema hydration participates in queries.

Both shapes' `CollideWithSphere(position, radius, velocity, out)` use the collision
record above. Box overlap produces a displacement in `normal`, time zero and no
write to `collisionPoint`. Swept face tests use the same record, including writes
from failed attempts; callers must not assume a miss preserves it. Rectangle
chooses one triangle, while Box tests the closest corner's three connected faces
in native order. Neither searches all faces for the globally earliest collision.

`BoxShape.GetCenter(out)` and `GetClosestPointOnBox(out, point)` use caller-owned
vector storage. `RayIntersect(origin, direction, out)` replaces four native
references with `{ side1, d1, side2, d2 }`; it tests an infinite line rather than
clamping to positive times or a segment. Distances change on failure; sides do not.

Two native bugs are retained explicitly: `BoxShape.cpp:183` chooses the exit side
from the entry axis, although its exit distance comes from the exit axis;
`BoxShape.cpp:166-170` omits parallel-outside-slab rejection. Zero direction thus
reports an interval from negative to positive `Number.MAX_VALUE`. These behaviors
have source-derived regression fixtures alongside the 25 native BoxShape tests.

## Static capsule and oriented box

The geometry export now includes `CjsDestinyCapsule` and `CjsDestinyOrientedBox`.
Both extend the existing `StaticCollidable` port. Their native declarations and
implementations are `Capsule.h:12-33`, `Capsule.cpp:11-581`,
`OrientedBox.h:11-39` and `OrientedBox.cpp:6-322`, at baseline `114e89f`.

`Initialize` retains the donor scalar argument order. IDs use exact BigInts;
endpoint/corner/edge vectors retain double precision. Radius casts and capsule
remaining-length arithmetic explicitly round to float32. The primitive radius
fields have NaN placeholders before initialization because the donor leaves them
uninitialized; construct and initialize before using a shape. `GetCenter(out)`
replaces native value return with caller-owned output storage.

`CheckCollision(p0, p1, radius, out)` uses
`{ normal: [0, 0, 0], timeOfImpact: -1 }`. Capsule misses preserve both outputs.
Box AABB rejection also preserves them, but failed narrow-phase attempts can write
partial results. Successful box normals are normalized; direct `CollideWithBall`
instead retains BoxShape's penetration-depth vector for response. Degenerate
capsule queries use a sphere fallback and +Z for a tiny normal; nondegenerate
axis overlap retains the native zero normal.

Blue aliases follow `Capsule_Blue.cpp:8-28` and `OrientedBox_Blue.cpp:11-29`.
Capsule endpoint writes update only the components, leaving cached axis/center
and spatial membership unchanged. Its radius and ID aliases likewise do not
rebuild derived state. The box exposes only `id`, `park`, `corner_x` and the
inherited `isMoribund` from that Blue surface.

`InsertInBoxes` implements each shape's native strategy. Boxes choose a base
using half the AABB's longest width, cache three overlap modifiers, and use the
cached bounding diameter for the huge-object 27-cell branch. Capsules sample
diameter-spaced spheres along the axis. Their same-key check precedes the
nonpositive-radius check; both can retain old membership. Native sampling does
not force a final endpoint neighborhood: an unvisited far cap can overlap a cell
missing from the membership set. This source quirk is retained and tested.

One deliberate exception to capsule sampling: if subtracting the diameter cannot
decrease the float32 remaining length, JS throws rather than entering the native
infinite loop (`Capsule.cpp:578-579`). This occurs at extreme length/radius ratios.
It is not an iteration budget or a silent geometric approximation.

Both `CollideWithBall` and `ReactToCollision` are implemented for direct use with
native-shaped Ball state and a park reference. They preserve distinct box/capsule
overlap distances, speculative starting states, and the capsule-only outward
acceleration rejection. Equal-time responses select the stronger acceleration;
different-time responses overwrite it. Every accepted response appends its ID.
Capsule's legacy path still uses endpoint velocity for its cylinder quadratic,
including its zero-axis singular behavior; the iterative query has a separate
degenerate-axis branch. No solver correction is implied by this port.

Ball now carries `mLastC`, `mLastCollision` and `mCollisions` from
`Ball.h:138,163,185`; behavior evaluation clears acceleration/IDs. Native
`Ballpark.Integrate(p, v, a, m, k, timeFactor, t)` replaces the temporary one-Ball
method. It updates mutable vectors, skips zero duration, uses the supplied cache
for a full tick and recomputes it for fractional durations (`Ballpark.cpp:751-777`).
Small-friction arithmetic and zero-friction singularities remain native-shaped.

Twenty-three additional source-derived tests cover geometry, aliases, response,
fractional integration and actual partition memberships. The complete suite has
293 passing tests. These are direct class/algorithm tests, not the donor's full
Python collision trajectories: Ballpark static ownership, Gradient/Potential,
collision scheduling, notification dispatch, compound mini-shapes and the
iterative solver remain required before tick-driven collisions work.
