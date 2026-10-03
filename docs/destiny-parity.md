# Destiny source correspondence

Status: Evolving
Scope: Implemented Destiny subsets and declared JavaScript adaptations
Audience: Server maintainers
Summary: Maps current movement, action and numeric geometry behavior to the donor.

## Source and ownership

Reviewed the local `carbonengine/destiny` donor at
`ef738406b61ad06bae2f402857e464735ab106a2`. No donor fetch or changes were performed.
The public source lives at <https://github.com/carbonengine/destiny>.

The user-approved temporary server experiment owns `CjsDestinyBall` and
`CjsBallparkController`. Their schema definitions use `modelledOn: "Ball"` and
`modelledOn: "Ballpark"`, not claims of full native class parity. All methods remain
on the corresponding donor's class. No existing runtime class is duplicated or moved.
`DSTBALLMODE` is a static enum on the local Ball model; no cross-package enum owner
has been introduced. Nothing was promoted from generated source or regenerated.

| Source | Implemented correspondence |
| --- | --- |
| `src/Ball.h`, `Ball.cpp`, `Ball_Blue.cpp` | Movement state and public scalar position/velocity. |
| `src/IDstConstants.h:11` | Full `DSTBALLMODE` member vocabulary and numeric values. |
| `src/Ballpark.cpp:85` | Default one-second tick and friction coefficient `1e6`. |
| `src/Ballpark.cpp:421,751,789` | Evaluate forces before integration; exact drag equations. |
| `src/Ballpark.cpp:956,1073,1246,1339,1398` | Goto, follow, old orbit, stop and homing thrust. |
| `src/Ballpark.cpp:3302,3879,4007,4470,4511,4556` | Ball creation and movement commands. |
| `src/Ballpark.cpp:4651–5024` | Relevant property setters and cached drag. |
| `src/Ballpark.cpp:5471,5896` | Removal and clearing responsibilities. |
| `src/Settings.h:11–13` | Dynamical orientation and new orbit default to disabled. |
| `src/Thunkers.cpp:244,330` | Follow/orbit default range of one. |
| `python/destiny/test/helpers.py:207` | Fixture mass, agility, radius, speed and throttle. |

## Adaptations and constraints

- Native `Vector3d` movement values are scalar JS Numbers, following the Blue
  position/velocity surface. This preserves double precision without allocating
  f32 runtime vectors. No alternative vector library or typed-array allocator exists.
- Native float parameters are rounded with `Math.fround` at controller boundaries.
  Setters maintain the cached drag factor. Direct field writes bypass native-like
  validation and hooks, so physical changes must use the controller.
- IDs must be safe JS integers. Full signed 64-bit IDs and automatic native local-ID
  allocation are outside this temporary model. Explicit negative safe IDs are ordinary
  map keys here; Blue-specific negative-target rejection is not implemented.
- There is a single implicit region, immediate removal, and no Blue callbacks,
  collision forces, tombstones, networking, orientation, interpolation or notifications.
  Boolean flags are retained as data; only `isFree`/`isMoribund` affect tick participation,
  and follow/orbit validate target cloaking/death when receiving a command.
- Mobile balls with nonpositive or nonfinite mass/agility fail before tick mutation.
  Static balls may have zero mass. This avoids pretending the native zero-mass thrust
  division is a supported movement case. Unknown/unsupported mobile modes also throw.
- Nonfinite input is rejected or ignored, as documented by the method. This extends
  native guards to finite f32 conversions and position/velocity setters.
- Re-adding a follower explicitly detaches its previous target. Re-adding a target
  retains its object identity and valid incoming follower references.
- The legacy orbit zero-distance, zero-total-radius tangent computes `0/0` in the
  donor (`Ballpark.cpp:1291–1295`). This port skips that undefined tangent and applies
  zero thrust. This deliberate correction is covered by a regression test.
- Native stopping's extra Y-axis damping (`Ballpark.cpp:1339–1345`) is retained, as
  are orbit's seven-decimal truncation and goto's inertial overshoot. This is the
  local donor's default movement, not a claim about current EVE Frontier behavior.

## Action queue subset

`Actions` now ports the movement-command subset of
`python/destiny/net/server/_actions.py`. Its Python method spellings and history
tuples are preserved. Native signals, unsupported commands, tick dispatch and
replication remain excluded. The JS park's `time` and `GetBall` replace the
native counter and dictionary access at explicitly annotated sites. See
[Destiny action queue](destiny-actions.md) for exact behavior and adaptations.

The new tests translate donor `test_actions.py` fixtures and cover stamp/order
semantics, adjacent tuple deduplication, local position metadata, pending state,
and queued-versus-direct movement application. The full server suite now has
38 passing tests, including the original 17 movement/schema tests.

## Validation and remaining work

The original movement suite contains seventeen tests, including six numeric trajectories copied directly
from CCP's `test_goto.py`, `test_follow.py`, `test_orbit.py` and `test_stop.py`.
All coordinates/velocities match those fixtures within absolute `1e-10` tolerance.
Moving-target follow is also tested in both insertion orders. Other tests exercise
command transitions, radii, coincident centers, target removal/replacement, static
objects, parameter changes, precision at large coordinates, failure boundaries and
schema registration. These are fixture comparisons; the native binary was not run.

The next source areas are spatial queries/partitions, collision shapes and forces,
new orbit/orientation, additional movement modes, then state replication. None of
those capabilities is implied by this movement subset. Higher-level combat and
drone policy remain separate consumers of the ballpark.

## Numeric geometry

The geometry subpath implements `AABB`, `Planed`, `Triangle`, and all six
`Collision` free functions from the matching native headers and implementations.
The 44 tests from `TestAABB.cpp`, `TestPlane.cpp`, `TestTriangle.cpp` and
`TestCollision.cpp` are transcribed with their native names and expectations.
Seven additional cases cover aliasing, partial output writes, large coordinates,
swept spheres and source quirks. There are 89 passing tests in the current suite.
See [geometry](destiny-geometry.md) for the exact value/reference adaptations.
