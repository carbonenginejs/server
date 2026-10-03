# Destiny cloaking and sphere visibility

Status: Evolving
Scope: Cloak commands, sensors, follower transitions and sphere visibility
Audience: Simulation hosts and port maintainers
Summary: How cloak mode affects simulation state and the native visibility query.

## Cloak lifecycle

CjsBallparkController.CloakBall and UncloakBall apply simulation side effects.
Use DSTCONSTANTS from the package root or /destiny export for normal, restore and
GM cloak modes. The enum keeps Carbon's numeric values in one object instead of
Python's flattened module constants. Method JSDoc owns parameter conversions.

Normal cloak on a master park installs a two-second proximity sensor, stops
incoming followers, stores the cloak mode and makes the ball non-massive.
Replica parks and other positive modes skip sensor creation. Own movement stays
unchanged. Incoming missiles become non-massive and fly along their velocity;
interactive orbiters also retain their velocity direction; other followers stop.
Follower callbacks observe the new sensor but the old cloak/massiveness state.

Uncloak removes the ball's own sensor only for a normal master cloak. Outside
proper warp it makes the ball massive and silently forgets its ID from eligible
same-bubble proximity maps, allowing another enter event on the next scan.
Alignment-stage warp follows this ordinary path; proper warp retains massiveness
and remembered contacts. Uncloak does not emit proximity leave events directly.

Reapplying normal cloak clears contacts but retains elapsed time. Switching from
normal to restore/GM cloak keeps the old sensor, including after uncloak. A rejected
sensor range does not cancel the remaining cloak effects. These are native quirks.
Direct isCloaked assignment only writes the byte; it does not execute commands.

## Visibility scope

CheckVisibility returns an exact BigInt: an occluder ID, 0n for clear, or -2n for
missing endpoints/different bubbles. It tests ball spheres on the open segment
between endpoint centers, in aggregate-map traversal order. The first qualifying
sphere wins, not the nearest. It skips endpoints, other bubbles, non-massive and
cloaked balls; moribund state alone does not exclude a sphere.

Tangency inside the segment blocks visibility. The near intersection must lie
strictly between endpoints, so a sphere containing the source does not block it.
Coincident endpoints return clear. Capsules, oriented boxes, Mini descriptors
and detailed meshes are not queried by this native function. This is not
hull-accurate line of sight or recipient selection.

## Evidence and remaining work

Sources: destiny/src/IDstConstants.h:74-80; destiny/src/Ballpark.cpp:5223-5366;
destiny/src/Thunkers.cpp:1824-1886; destiny/src/Ball.h:113;
destiny/src/Ball_Blue.cpp:106-113; blueexposure/BlueVariable.cpp:945-953.
Tests translate destiny/python/destiny/test/ballpark/test_visibility.py:8-82 and
queued cloak cases in destiny/python/destiny/test/net/server/test_actions.py:400-417,441-495,
with additional boundary, byte, callback and sensor integration cases.

[Actions](destiny-actions.md) retain bubble delivery hints; native ticker routing,
signals, visibility-based recipient batches and cloak/uncloak conflict handling
remain unported. General volume queries and relative-motion calculations remain
separate work. See [proximity](destiny-proximity.md) and [port status](port-status.md).
