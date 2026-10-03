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
quadratic/swept-sphere behavior. No native binary was executed. Capsules,
oriented shape wrappers, partitioning and ballpark collision response remain unported.

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
