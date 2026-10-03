import assert from "node:assert/strict";
import test from "node:test";
import {
    CjsDestinyAABB as AABB, CjsDestinyPlaned as Planed, CjsDestinyTriangle as Triangle,
    GetPointOnBallThatFirstIntersectsPlane, IntersectSegmentPlane,
    IntersectSegmentSphere, IntersectSphereTriangle
} from "@carbonenginejs/server/destiny/geometry";

// Numeric inputs and expected values transcribed from the donor C++ tests.
// JavaScript outputs replace C++ return-by-value and reference arguments.
// Source revision: ef738406b61ad06bae2f402857e464735ab106a2.
// See NOTICE for the source license. Expected results never call the implementation.

// Source: destiny/tests/TestAABB.cpp:5
test("TestAABB.cpp: Constructor.DefaultConstructor", () =>
{

    const b = new AABB();
    assert.deepEqual([0.0, 0.0, 0.0], b.mLowCorner);
    assert.deepEqual([0.0, 0.0, 0.0], b.mHighCorner);
});

// Source: destiny/tests/TestAABB.cpp:12
test("TestAABB.cpp: Constructor.ConstructorWithParameters", () =>
{

    const b = new AABB([1.0, 2.0, 3.0], [4.0, 5.0, 6.0]);
    assert.deepEqual([1.0, 2.0, 3.0], b.mLowCorner);
    assert.deepEqual([4.0, 5.0, 6.0], b.mHighCorner);
});

// Source: destiny/tests/TestAABB.cpp:19
test("TestAABB.cpp: Update.High", () =>
{

    const b = new AABB();
    b.Update([1.0, 2.0, 3.0]);
    assert.deepEqual([1.0, 2.0, 3.0], b.mHighCorner);
});

// Source: destiny/tests/TestAABB.cpp:26
test("TestAABB.cpp: Update.Low", () =>
{

    const b = new AABB();
    b.Update([-1.0, -2.0, -3.0]);
    assert.deepEqual([-1.0, -2.0, -3.0], b.mLowCorner);
});

// Source: destiny/tests/TestAABB.cpp:33
test("TestAABB.cpp: Update.HighIgnore", () =>
{

    const b = new AABB([0.0, 0.0, 0.0], [5.0, 5.0, 5.0]);
    b.Update([1.0, 2.0, 3.0]);
    assert.deepEqual([5.0, 5.0, 5.0], b.mHighCorner);
});

// Source: destiny/tests/TestAABB.cpp:40
test("TestAABB.cpp: Update.LowIgnore", () =>
{

    const b = new AABB([-5.0, -5.0, -5.0], [0.0, 0.0, 0.0]);
    b.Update([-1.0, -2.0, -3.0]);
    assert.deepEqual([-5.0, -5.0, -5.0], b.mLowCorner);
});

// Source: destiny/tests/TestAABB.cpp:47
test("TestAABB.cpp: CanExcludeCollision.ExcludeReturnsFalseWhenRadiusIntersects", () =>
{

    const aabb = new AABB([0.0, 0.0, 0.0], [1.0, 1.0, 1.0]);
    const p0 = [-1.0, -1.0, 0.0];
    const p1 = [-1.0, 1.0, 0.0];
    const radius = 1.0;
    assert.equal(aabb.CanExcludeCollision(p0, p1, radius), false);
});

// Source: destiny/tests/TestAABB.cpp:56
test("TestAABB.cpp: CanExcludeCollision.ExcludeLeft", () =>
{

    const aabb = new AABB([0.0, 0.0, 0.0], [1.0, 1.0, 1.0]);
    const p0 = [-1.0, -1.0, 0.0];
    const p1 = [-1.0, 1.0, 0.0];
    const radius = 0.5;
    assert.equal(aabb.CanExcludeCollision(p0, p1, radius), true);
});

// Source: destiny/tests/TestAABB.cpp:65
test("TestAABB.cpp: CanExcludeCollision.ExcludeRight", () =>
{

    const aabb = new AABB([0.0, 0.0, 0.0], [1.0, 1.0, 1.0]);
    const p0 = [2.0, -1.0, 0.0];
    const p1 = [2.0, 1.0, 0.0];
    const radius = 0.5;
    assert.equal(aabb.CanExcludeCollision(p0, p1, radius), true);
});

// Source: destiny/tests/TestAABB.cpp:74
test("TestAABB.cpp: CanExcludeCollision.ExcludeTop", () =>
{

    const aabb = new AABB([0.0, 0.0, 0.0], [1.0, 1.0, 1.0]);
    const p0 = [-1.0, 2.0, 0.0];
    const p1 = [1.0, 2.0, 0.0];
    const radius = 0.5;
    assert.equal(aabb.CanExcludeCollision(p0, p1, radius), true);
});

// Source: destiny/tests/TestAABB.cpp:83
test("TestAABB.cpp: CanExcludeCollision.ExcludeBottom", () =>
{

    const aabb = new AABB([0.0, 0.0, 0.0], [1.0, 1.0, 1.0]);
    const p0 = [-1.0, -1.0, 0.0];
    const p1 = [1.0, -1.0, 0.0];
    const radius = 0.5;
    assert.equal(aabb.CanExcludeCollision(p0, p1, radius), true);
});

// Source: destiny/tests/TestAABB.cpp:92
test("TestAABB.cpp: CanExcludeCollision.ExcludeFront", () =>
{

    const aabb = new AABB([0.0, 0.0, 0.0], [1.0, 1.0, 1.0]);
    const p0 = [-1.0, 0.0, 2.0];
    const p1 = [1.0, 0.0, 2.0];
    const radius = 0.5;
    assert.equal(aabb.CanExcludeCollision(p0, p1, radius), true);
});

// Source: destiny/tests/TestAABB.cpp:101
test("TestAABB.cpp: CanExcludeCollision.ExcludeBack", () =>
{

    const aabb = new AABB([0.0, 0.0, 0.0], [1.0, 1.0, 1.0]);
    const p0 = [-1.0, 0.0, -1.0];
    const p1 = [1.0, 0.0, -1.0];
    const radius = 0.5;
    assert.equal(aabb.CanExcludeCollision(p0, p1, radius), true);
});

// Source: destiny/tests/TestAABB.cpp:110
test("TestAABB.cpp: CanExcludeCollision.InsideBox", () =>
{

    const aabb = new AABB([0.0, 0.0, 0.0], [1.0, 1.0, 1.0]);
    const p0 = [0.5, 0.5, 0.5];
    const p1 = [0.5, 0.5, 0.5];
    const radius = 0.5;
    assert.equal(aabb.CanExcludeCollision(p0, p1, radius), false);
});

// Source: destiny/tests/TestAABB.cpp:119
test("TestAABB.cpp: GetLongestWidth.ZeroSize", () =>
{

    const aabb = new AABB();
    assert.deepEqual(0.0, aabb.GetLongestWidth());
});

// Source: destiny/tests/TestAABB.cpp:125
test("TestAABB.cpp: GetLongestWidth.XAxisIsLongest", () =>
{

    const aabb = new AABB([-0.5, -0.5, -0.5], [1.0, 0.5, 0.5]);
    assert.deepEqual(1.5, aabb.GetLongestWidth());
});

// Source: destiny/tests/TestAABB.cpp:131
test("TestAABB.cpp: GetLongestWidth.YAxisIsLongest", () =>
{

    const aabb = new AABB([-0.5, -0.5, -0.5], [0.5, 1.0, 0.5]);
    assert.deepEqual(1.5, aabb.GetLongestWidth());
});

// Source: destiny/tests/TestAABB.cpp:137
test("TestAABB.cpp: GetLongestWidth.ZAxisIsLongest", () =>
{

    const aabb = new AABB([-0.5, -0.5, -0.5], [0.5, 0.5, 1.0]);
    assert.deepEqual(1.5, aabb.GetLongestWidth());
});

// Source: destiny/tests/TestPlane.cpp:5
test("TestPlane.cpp: Plane.CanCreate", () =>
{

    const point = [1.0, 2.0, 3.0];
    const normal = [0.0, 1.0, 0.0];
    const plane = new Planed(point, normal);
    assert.deepEqual(2.0, plane.d);
    assert.deepEqual(normal, plane.normal);
});

// Source: destiny/tests/TestTriangle.cpp:5
test("TestTriangle.cpp: Triangle.CanCreate", () =>
{

    const a = [1.0, 2.0, 3.0];
    const b = [4.0, 5.0, 6.0];
    const c = [7.0, 8.0, 9.0];
    const t = new Triangle(a, b, c);
    assert.deepEqual(a, t.a);
    assert.deepEqual(b, t.b);
    assert.deepEqual(c, t.c);
});

// Source: destiny/tests/TestTriangle.cpp:16
test("TestTriangle.cpp: Triangle.GetNormal", () =>
{

    const a = [0.0, 0.0, 1.0];
    const b = [1.0, 0.0, 2.0];
    const c = [2.0, 0.0, 1.0];
    const t = new Triangle(a, b, c);
    const expected = [0.0, 1.0, 0.0];
    const actual = t.GetNormal([0, 0, 0]);
    assert.deepEqual(expected[0], actual[0]);
    assert.deepEqual(expected[1], actual[1]);
    assert.deepEqual(expected[2], actual[2]);
});

// Source: destiny/tests/TestTriangle.cpp:29
test("TestTriangle.cpp: PointInTriangle.CenterOfTriangle", () =>
{

    const a = [0.0, 0.0, 1.0];
    const b = [1.0, 0.0, 2.0];
    const c = [2.0, 0.0, 1.0];
    const t = new Triangle(a, b, c);
    const p = [1.0, 0.0, 1.0];
    assert.equal(t.ContainsPoint(p), true);
});

// Source: destiny/tests/TestTriangle.cpp:39
test("TestTriangle.cpp: PointInTriangle.OutsideAB", () =>
{

    const a = [0.0, 0.0, 1.0];
    const b = [1.0, 0.0, 2.0];
    const c = [2.0, 0.0, 1.0];
    const t = new Triangle(a, b, c);
    const p = [1.5, 0.0, 2.0];
    assert.equal(t.ContainsPoint(p), false);
});

// Source: destiny/tests/TestTriangle.cpp:49
test("TestTriangle.cpp: PointInTriangle.OutsideAC", () =>
{

    const a = [0.0, 0.0, 1.0];
    const b = [1.0, 0.0, 2.0];
    const c = [2.0, 0.0, 1.0];
    const t = new Triangle(a, b, c);
    const p = [1.0, 0.0, 0.5];
    assert.equal(t.ContainsPoint(p), false);
});

// Source: destiny/tests/TestTriangle.cpp:59
test("TestTriangle.cpp: PointInTriangle.OutsideBC", () =>
{

    const a = [0.0, 0.0, 1.0];
    const b = [1.0, 0.0, 2.0];
    const c = [2.0, 0.0, 1.0];
    const t = new Triangle(a, b, c);
    const p = [2.5, 2.0, 0.0];
    assert.equal(t.ContainsPoint(p), false);
});

// Source: destiny/tests/TestTriangle.cpp:69
test("TestTriangle.cpp: GetClosestPoint.PointAboveTriangle", () =>
{

    const a = [0.0, 1.0, 0.0];
    const b = [1.0, 2.0, 0.0];
    const c = [2.0, 1.0, 0.0];
    const t = new Triangle(a, b, c);
    const p = [1.0, 1.5, 1.0];
    const expected = [1.0, 1.5, 0.0];
    const actual = t.GetClosestPoint([0, 0, 0], p);
    assert.deepEqual(expected, actual);
});

// Source: destiny/tests/TestTriangle.cpp:81
test("TestTriangle.cpp: GetClosestPoint.PointBelowTriangle", () =>
{

    const a = [0.0, 1.0, 0.0];
    const b = [1.0, 2.0, 0.0];
    const c = [2.0, 1.0, 0.0];
    const t = new Triangle(a, b, c);
    const p = [1.0, 1.5, -1.0];
    const expected = [1.0, 1.5, 0.0];
    const actual = t.GetClosestPoint([0, 0, 0], p);
    assert.deepEqual(expected, actual);
});

// Source: destiny/tests/TestTriangle.cpp:93
test("TestTriangle.cpp: GetClosestPoint.PointLeftOfTriangle", () =>
{

    const a = [10.0, 10.0, 0.0];
    const b = [0.0, 10.0, 0.0];
    const c = [0.0, 0.0, 0.0];
    const t = new Triangle(a, b, c);
    const p = [-1.0, 5.0, 0.0];
    const expected = [0.0, 5.0, 0.0];
    const actual = t.GetClosestPoint([0, 0, 0], p);
    assert.deepEqual(expected, actual);
});

// Source: destiny/tests/TestTriangle.cpp:105
test("TestTriangle.cpp: GetClosestPoint.PointBottomOfTriangle", () =>
{

    const a = [0.0, 0.0, 0.0];
    const b = [10.0, 0.0, 0.0];
    const c = [10.0, 10.0, 0.0];
    const t = new Triangle(a, b, c);
    const p = [5.0, -1.0, 0.0];
    const expected = [5.0, 0.0, 0.0];
    const actual = t.GetClosestPoint([0, 0, 0], p);
    assert.deepEqual(expected, actual);
});

// Source: destiny/tests/TestTriangle.cpp:117
test("TestTriangle.cpp: GetClosestPoint.PointRightOfTriangle", () =>
{

    const a = [0.0, 0.0, 0.0];
    const b = [10.0, 0.0, 0.0];
    const c = [10.0, 10.0, 0.0];
    const t = new Triangle(a, b, c);
    const p = [11.0, 5.0, 0.0];
    const expected = [10.0, 5.0, 0.0];
    const actual = t.GetClosestPoint([0, 0, 0], p);
    assert.deepEqual(expected, actual);
});

// Source: destiny/tests/TestTriangle.cpp:129
test("TestTriangle.cpp: GetClosestPoint.PointTopOfTriangle", () =>
{

    const a = [0.0, 0.0, 0.0];
    const b = [0.0, 10.0, 0.0];
    const c = [10.0, 10.0, 0.0];
    const t = new Triangle(a, b, c);
    const p = [5.0, 11.0, 0.0];
    const expected = [5.0, 10.0, 0.0];
    const actual = t.GetClosestPoint([0, 0, 0], p);
    assert.deepEqual(expected, actual);
});

// Source: destiny/tests/TestTriangle.cpp:141
test("TestTriangle.cpp: GetClosestPoint.PointOffTheLongSide", () =>
{

    const a = [0.0, 0.0, 0.0];
    const b = [10.0, 0.0, 0.0];
    const c = [10.0, 10.0, 0.0];
    const t = new Triangle(a, b, c);
    const p = [0.0, 10.0, 0.0];
    const expected = [5.0, 5.0, 0.0];
    const actual = t.GetClosestPoint([0, 0, 0], p);
    assert.deepEqual(expected, actual);
});

// Source: destiny/tests/TestCollision.cpp:5
test("TestCollision.cpp: GetPointOnBallThatFirstIntersectsPlane.ArbitraryPoint", () =>
{
    const result = { collisionPoint: [0, 0, 0], collisionTime: 0, normal: [0, 0, 0] };

    const ball_pos = [0.0, 3.0, 0.0];
    const ball_radius = 1.0;
    const plane_normal = [0.0, 1.0, 0.0];
    const expected = [0.0, 2.0, 0.0];
    const actual = GetPointOnBallThatFirstIntersectsPlane([0, 0, 0], ball_pos, ball_radius, plane_normal);
    assert.deepEqual(expected, actual);
});

// Source: destiny/tests/TestCollision.cpp:15
test("TestCollision.cpp: IntersectSegmentPlane.IntersectionExists", () =>
{
    const result = { collisionPoint: [0, 0, 0], collisionTime: 0, normal: [0, 0, 0] };

    const plane_point = [0.0, 0.0, 0.0];
    const plane_normal = [0.0, 1.0, 0.0];
    const plane = new Planed(plane_point, plane_normal);
    const a = [0.0, 1.0, 0.0];
    const b = [0.0, -1.0, 0.0];




    const collision_exists = IntersectSegmentPlane(a, b, plane, result);
    assert.equal(collision_exists, true);
    assert.deepEqual([0.0, 0.0, 0.0], result.collisionPoint);
    assert.deepEqual(0.5, result.collisionTime);
});

// Source: destiny/tests/TestCollision.cpp:32
test("TestCollision.cpp: IntersectSegmentPlane.NoIntersection", () =>
{
    const result = { collisionPoint: [0, 0, 0], collisionTime: 0, normal: [0, 0, 0] };

    const plane_point = [0.0, 0.0, 0.0];
    const plane_normal = [0.0, 1.0, 0.0];
    const plane = new Planed(plane_point, plane_normal);
    const a = [0.0, 3.0, 0.0];
    const b = [0.0, 2.0, 0.0];



    const collision_exists = IntersectSegmentPlane(a, b, plane, result);
    assert.equal(collision_exists, false);
});

// Source: destiny/tests/TestCollision.cpp:46
test("TestCollision.cpp: IntersectSegmentPlane.ParallelLineSegment", () =>
{
    const result = { collisionPoint: [0, 0, 0], collisionTime: 0, normal: [0, 0, 0] };

    const plane_point = [0.0, 0.0, 0.0];
    const plane_normal = [0.0, 0.0, 1.0];
    const plane = new Planed(plane_point, plane_normal);
    const a = [0.0, 1.0, 0.0];
    const b = [0.0, -1.0, 0.0];



    const collision_exists = IntersectSegmentPlane(a, b, plane, result);
    assert.equal(collision_exists, false);
});

// Source: destiny/tests/TestCollision.cpp:60
test("TestCollision.cpp: IntersectSegmentSphere.HeadOn", () =>
{
    const result = { collisionPoint: [0, 0, 0], collisionTime: 0, normal: [0, 0, 0] };

    const sphere_pos = [0.0, 0.0, 0.0];
    const sphere_rad = 1.0;
    const a = [10.0, 0.0, 0.0];
    const b = [0.0, 0.0, 0.0];




    const collision_exists = IntersectSegmentSphere(a, b, sphere_pos, sphere_rad, result);

    assert.equal(collision_exists, true);
    assert.deepEqual([1.0, 0.0, 0.0], result.collisionPoint);
    assert.deepEqual(0.9, result.collisionTime);
});

// Source: destiny/tests/TestCollision.cpp:77
test("TestCollision.cpp: IntersectSegmentSphere.FromInside", () =>
{
    const result = { collisionPoint: [0, 0, 0], collisionTime: 0, normal: [0, 0, 0] };

    const sphere_pos = [0.0, 0.0, 0.0];
    const sphere_rad = 1.0;
    const a = [0.0, 0.0, 0.0];
    const b = [10.0, 0.0, 0.0];




    const collision_exists = IntersectSegmentSphere(a, b, sphere_pos, sphere_rad, result);

    assert.equal(collision_exists, true);
    assert.deepEqual(a, result.collisionPoint);
    assert.deepEqual(0.0, result.collisionTime);
});

// Source: destiny/tests/TestCollision.cpp:94
test("TestCollision.cpp: IntersectSegmentSphere.CompleteMiss", () =>
{
    const result = { collisionPoint: [0, 0, 0], collisionTime: 0, normal: [0, 0, 0] };

    const sphere_pos = [0.0, 0.0, 0.0];
    const sphere_rad = 1.0;
    const a = [0.0, 0.0, 7.0];
    const b = [0.0, 0.0, 8.0];




    const collision_exists = IntersectSegmentSphere(a, b, sphere_pos, sphere_rad, result);

    assert.equal(collision_exists, false);
});

// Source: destiny/tests/TestCollision.cpp:109
test("TestCollision.cpp: IntersectSphereTriangle.CenterOfSphereIntersectsTriangle", () =>
{
    const result = { collisionPoint: [0, 0, 0], collisionTime: 0, normal: [0, 0, 0] };

    const a = [0.0, 0.0, 0.0];
    const b = [2.0, 0.0, 0.0];
    const c = [1.0, 2.0, 0.0];
    const t = new Triangle(a, b, c);

    const sphere_position = [1.0, 1.0, 2.0];
    const sphere_velocity = [0.0, 0.0, -2.0];
    const sphere_radius = 1.0;





    const collision_exists = IntersectSphereTriangle(sphere_position, sphere_radius, sphere_velocity, t, result);

    assert.equal(collision_exists, true);
    assert.deepEqual([1.0, 1.0, 0.0], result.collisionPoint);
    assert.deepEqual(result.collisionTime, 0.5);
    assert.deepEqual([0.0, 0.0, 1.0], result.normal);
});

// Source: destiny/tests/TestCollision.cpp:133
test("TestCollision.cpp: IntersectSphereTriangle.SphereGrazesTriangleEdge", () =>
{
    const result = { collisionPoint: [0, 0, 0], collisionTime: 0, normal: [0, 0, 0] };

    const a = [0.0, 0.0, 0.0];
    const b = [2.0, 0.0, 0.0];
    const c = [1.0, 2.0, 0.0];
    const t = new Triangle(a, b, c);

    const sphere_position = [0.0, -1.0, 2.0];
    const sphere_velocity = [0.0, 0.0, -2.0];
    const sphere_radius = 1.0;





    const collision_exists = IntersectSphereTriangle(sphere_position, sphere_radius, sphere_velocity, t, result);

    assert.equal(collision_exists, true);
    assert.deepEqual([0.0, 0.0, 0.0], result.collisionPoint);
    assert.deepEqual(result.collisionTime, 1.0);
    assert.deepEqual([0.0, -1.0, 0.0], result.normal);
});

// Source: destiny/tests/TestCollision.cpp:156
test("TestCollision.cpp: IntersectSphereTriangle.CenterOfSphereIntersectsTriangleFromTheWrongSide", () =>
{
    const result = { collisionPoint: [0, 0, 0], collisionTime: 0, normal: [0, 0, 0] };

    const a = [0.0, 0.0, 0.0];
    const b = [2.0, 0.0, 0.0];
    const c = [1.0, 2.0, 0.0];
    const t = new Triangle(c, b, a);

    const sphere_position = [1.0, 1.0, 2.0];
    const sphere_velocity = [0.0, 0.0, -2.0];

    const sphere_radius = 1.0;




    const collision_exists = IntersectSphereTriangle(sphere_position, sphere_radius, sphere_velocity, t, result);

    assert.equal(collision_exists, false);
});

// Source: destiny/tests/TestCollision.cpp:176
test("TestCollision.cpp: IntersectSphereTriangle.SphereDoesNotIntersectPlane", () =>
{
    const result = { collisionPoint: [0, 0, 0], collisionTime: 0, normal: [0, 0, 0] };

    const a = [0.0, 0.0, 0.0];
    const b = [2.0, 0.0, 0.0];
    const c = [1.0, 2.0, 0.0];
    const t = new Triangle(a, b, c);

    const sphere_position = [1.0, 1.0, 2.0];
    const sphere_velocity = [0.0, 100.0, 0.0];
    const sphere_radius = 1.0;





    const collision_exists = IntersectSphereTriangle(sphere_position, sphere_radius, sphere_velocity, t, result);

    assert.equal(collision_exists, false);
});

// Source: destiny/tests/TestCollision.cpp:196
test("TestCollision.cpp: IntersectSphereTriangle.SphereDoesNotIntersectTriangle", () =>
{
    const result = { collisionPoint: [0, 0, 0], collisionTime: 0, normal: [0, 0, 0] };

    const a = [0.0, 0.0, 0.0];
    const b = [2.0, 0.0, 0.0];
    const c = [1.0, 2.0, 0.0];
    const t = new Triangle(a, b, c);

    const sphere_position = [100.0, 1.0, 1.0];
    const sphere_velocity = [0.0, 0.0, -2.0];
    const sphere_radius = 1.0;





    const collision_exists = IntersectSphereTriangle(sphere_position, sphere_radius, sphere_velocity, t, result);

    assert.equal(collision_exists, false);
});
