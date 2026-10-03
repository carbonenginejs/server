# Destiny spatial queries

Status: Evolving
Scope: Range, triangle, cone, capsule, distance and ray-sphere queries
Audience: Simulation hosts and port maintainers
Summary: Native inclusion rules, return values and JavaScript adaptations.

## Bubble queries

GetBallIdsInRange accepts (ballID, range, includeCloaked=0) or
(x, y, z, range, includeCloaked=0). GetBallIdsAndDistInRange accepts the same
arguments and returns [squaredCenterDistance, ballID] pairs. Neither sorts its
result. Coordinate lookup visits an existing partition cell without creating
cells. The reference ball is excluded from the ID form.

GetBallIdsInRangeOfTriangle takes a reference ID, two three-component offsets
from its center, and a query radius. GetBallIdsInCapsule takes a reference ID,
a three-component segment offset and a query radius. Each includes a candidate
when its center is within query radius plus candidate radius of the primitive,
including equality. The reference ball's radius is not added. Negative query
radii remain unclamped before squaring, as in Carbon.

GetBallIdsInCone takes a reference ID, a three-component axis whose length sets
the height, and a half-angle in radians. It uses Carbon's sphere-cone test with
a rounded bottom, strict forward test, and float32 candidate-radius square.
It is distinct from ScanCone below.

These methods traverse the reference ball's active bubble map (or the coordinate
cell's bubble). They skip invalid keys, absent balls, moribund balls and the
reference ball. They ignore map values and do not recheck current bubble IDs:
a live entry awaiting bubble cleanup can still be returned. Only range queries
apply the optional cloak filter; triangle, capsule and cone include cloaked balls.
Map insertion order replaces native dictionary traversal.

GetActiveBubbleForBall returns a fresh empty Map for bubble -1 and null for a
missing ordinary bubble, while missing bubble storage throws. Iteration helpers
use a Map iterator and a caller-owned output record in place of native pointers.
They preserve partial writes and leave exhausted output state intact.

## Full-map scan and distances

ScanCone(ballID, angle, range, x, y, z) scans the entire ball map by center.
Its angle is the full angle, halved internally. It ignores candidate radii and
bubble membership, skipping the source, negative IDs and cloaked balls. Moribund
balls remain eligible. Missing source, nonpositive range and zero direction
return null. Range and angular boundaries are inclusive. The spherical shortcut
requires an angle strictly greater than 2 pi; exactly 2 pi still uses the cone
test and its forward-half-space restriction.

GetCenterDist returns center distance; GetSurfaceDist subtracts both radii and
may return a negative value for overlap. Missing balls return null. IDs in query
results use the port's exact BigInt representation.

GetIntersection operates on a supplied ray and sphere, assuming a unit ray
without normalizing it. It returns 0, 1 or 2 roots and optionally writes mutable
{value} outputs. Tangency writes only the first output. Two-root ordering and
aliased-output writes follow Carbon, including source-inside cases.

## Evidence and limits

Baseline: 114e89fa584f0e1a81eb0a679aabf41af8870072.
Sources: destiny/src/Thunkers.cpp:1329-1820,2379-2461;
destiny/src/Ballpark.cpp:5368-5413;
destiny/src/Ballpark_Blue.cpp:583-588,605-622.
Tests translate destiny/python/destiny/test/ballpark/test_boxes_and_bubbles.py:25-321,
destiny/python/destiny/test/ballpark/test_visibility.py:85-114 and
destiny/python/destiny/test/ballpark/test_getters_and_setters.py:282-321.
Additional cases exercise an independent grid oracle, stale bubble entries,
float32 boundaries, output aliasing and degenerate inputs. No native executable
oracle is required or claimed.

Class-owned float64 scratch is used only within synchronous geometry methods;
returned result arrays belong to the caller. Runtime is unchanged. Relative
motion, accuracy, native network batching and replay remain separate work.
See [visibility](destiny-visibility.md) and [port status](port-status.md).
