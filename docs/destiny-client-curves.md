# ClientBall renderer curves

Status: Evolving
Scope: Implemented ClientBall position, legacy rotation and impact sampling
Audience: Demo and renderer integrators
Summary: Tick clock, caller-owned outputs, reference frames and remaining native work.

## Construction and sampling

`CjsDestinyClientBall` is exported from `@carbonenginejs/server` and
`@carbonenginejs/server/destiny`. Its source is `destiny/CjsDestinyClientBall.js`;
the constructor takes no arguments. Normally let a replica
`CjsBallparkController` create and attach it through `AddBall`. Replica parks
default to `isMaster = false`; master parks create `CjsDestinyBall` instead.
Assign `park.ego` to the reference ball's ID.

The same ball can serve as both `translationCurve` and `rotationCurve`:

```js
import { vec3 } from "@carbonenginejs/runtime/math/vec3";
import { quat } from "@carbonenginejs/runtime/math/quat";

const position = vec3.create();
const rotation = quat.create();
const velocity = vec3.create();
// Reuse these outputs for subsequent frames. ball was returned by park.AddBall.
ball.Update(sceneTicks, position);
ball.GetValueAt(sceneTicks, rotation);
ball.GetValueDotAt(sceneTicks, velocity);
```

Time is an integer Number of 100ns ticks elapsed since the scene's Blue startup.
BigInt ticks on that same epoch are also accepted. Safe Number inputs convert
internally to BigInt; fractions, unsafe Numbers and signed-int64 overflow are
rejected. Supply the same clock to park evolution and scene sampling. There is
no conversion to absolute wallclock and no seconds overload in the JS surface.

Output length selects the native overload: three components for position or
velocity, four for rotation. Every method returns the supplied output. Sampling
uses retained state and class scratch; it creates no temporary vectors. Native
vector state remains double precision until renderer output is explicitly rounded
to float32. The server-owned float64 factory does not change runtime math settings.

## Native behavior retained

The donor baseline is `114e89fa584f0e1a81eb0a679aabf41af8870072`.

| Contract | Carbon source |
| --- | --- |
| Replica ClientBall versus master Ball allocation | `destiny/src/Ballpark.cpp:3336-3343` |
| Velocity-directed legacy yaw/pitch/roll; snap cache | `destiny/src/Ball.cpp:335-460,865-875` |
| Continuity and legacy rotation damping | `destiny/src/Ball.cpp:877-901,971-1091` |
| Absolute position integration and two-tick shift | `destiny/src/Ball.cpp:1208-1325` |
| Relative float32 position, ego zero and global scaling | `destiny/src/Ball.cpp:1350-1424` |
| Absolute mLastVel derivative; unchanged quaternion derivative | `destiny/src/Ball.cpp:1438-1457,1102-1116` |
| Fractional physical integration and collision-record dispatch | `destiny/src/Ballpark.cpp:2715-2741` |
| Reference cache and ego pointer cache | `destiny/src/Ballpark.cpp:3041-3066,6624-6645` |
| Client sample-cache time adjustment | `destiny/src/Ballpark.cpp:4414-4440` |

Interpolation uses native drag, not linear interpolation between endpoints. The
position parameter is elapsed seconds from the old state; rotation uses the
fraction of the old/new interval. Neither is clamped. Equal or backward shifted
times return cached values. A zero-span position sample updates position without
refreshing last velocity. Quaternion derivatives leave all output components
untouched. The first damped rotation sample has zero elapsed time and can set
yaw/pitch speed to NaN, as Carbon does.

Reference lookup samples the ego on the same clock. Ego position output is zero;
other positions subtract its absolute reference before float32 conversion.
Velocity remains the ball's absolute last velocity, with no ego subtraction.
The same-time reference cache survives ego changes, removal and AdjustTimes.
AdjustTimes shifts ClientBall position/rotation cache timestamps even when zero,
while zero motion-endpoint timestamps retain their native sentinel behavior.

## Impact rotation and additional queries

`ApplyImpulsiveForceAtPosition(impactForce, pos)` accepts float32 vectors. `pos`
is a local lever arm from the center, not an absolute world coordinate. The
method updates derived client rotation only; it does not alter authoritative
position, velocity or collision forces. The next legacy quaternion sample applies
impact growth and recovery through `ProcessImpact` and
`ApplyAngularVelocityToRotation` (`destiny/src/Ball.cpp:2000-2100`).

The native inverse inertia is cached as `5 / (2 * mass * radius)`, without radius
squared. It is calculated before the strict minimum-angular-velocity test.
Repeated impulses retarget the current velocity; growth and recovery can both run
in one sample. Even a zero-time sample advances the minimum deterioration. The
rotation cap is the nonlinear `angle * maxAngle / (angle + maxAngle)`. Zero physical
parameters can produce nonfinite quaternions, as in Carbon. Native ordered clamp
comparisons are preserved; JavaScript Math.min/max NaN propagation is not substituted.

Public Blue aliases `maxAngle`, `maxAngularVelocity`, `speedModifier` and
`minimumAngularVelocity` preserve float32 assignments without adding validation.
The implementation uses reusable scratch and owner-local adapters where runtime
quaternion behavior differs: native slerp threshold and linear branch, scaled
axis normalization, and unguarded zero-quaternion normalization. Quaternion products
reverse Carbon's operand order; shared runtime products have double intermediates
and float32 output, so this is not a claim of native bitwise identity.

Additional native methods now work:

- `GetValueDoubleDotAt(time, out)` computes endpoint velocity difference divided by
  park dt for a vec3; quaternion output is untouched. It does not interpolate.
- `GetDelta(time, out)` samples position, then writes cached mDeltaPos. Fixed/ego
  paths can therefore return a stale delta.
- `GetReferencePoint(time, out)` delegates to the park; a detached ball leaves
  output unchanged. `UpdateValue(seconds)` remains Carbon's intentional no-op.
- `centerDist`/`surfaceDist` call their native distance getters. Uncached center
  distance uses endpoints without populating the cache. Negative ego IDs permit
  center distance but force surface distance to zero. Uncached detached center
  access throws where native code dereferences a null park; surface access returns zero.
- `GetPartitionBoxes()` returns owned endpoint-relative geometry/flags.
  `showBoxes` enables `DoPartition` events during interpolation, relative to the
  sampled position. The optional PyOS bridge receives the native event and reused
  flag list; absent a bridge, there are no subscribers. Position sampling snapshots
  reference components before dispatch, so a nested callback sampling another ball
  cannot overwrite the outer reference scratch.

Sources: `destiny/src/Ball.cpp:1194-1200,1469-1487,1927-1998,2102-2124`,
`destiny/src/Ball.h:516,552-560` and `destiny/src/Ball_Blue.cpp:538-616`.

## Remaining work

This is a renderer-method subset, not complete native interface registration.
Warp remains explicitly unsupported. Its sampling branch throws rather than substituting
legacy motion. Iterative collision records can be consumed, but their production
is not implemented. The optional native Python callback for detached balls is
represented by console reporting. Relative-motion methods, complete interface mapping, snapshots, networking and
replay remain open in the full port plan.

Tests cover Number and BigInt ticks, large-coordinate subtraction, velocity,
reference caches, fixed/global paths, legacy rotation, time rebasing, output reuse
impact growth/recovery, noncommuting composition, distance/debug queries and
absence of vector/quaternion factory or pool calls during repeated sampling. These are
headless tests; renderer and weapons-demo integration have not been exercised.


## Dynamic orientation sampling

With useDynamicalOrientation enabled, quaternion sampling starts from mOldRot and
mOldAngVel and integrates the old/new timestamp fraction through native angular
drag. It does not apply visual impact rotation. First continuity initialization
copies old rotation and computes its derivative without changing mLastAngVel;
each quaternion sample then updates both cached rotation and angular velocity
(`destiny/src/Ball.cpp:877-902,1026-1043`). The derivative is maintained internally,
while the public quaternion derivative overload still leaves caller output alone.

The iterative setting dispatches to CalculateBallRotationVelocity and the
collision records produced by the park's iterative scheduler. The
client branch follows the global dynamic flag, including when physical dynamic
integration is disabled for missiles. Number/BigInt tick clock, two-tick shift,
fixed-ball and cache guards remain unchanged.
