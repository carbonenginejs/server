# Mini collision shapes

Status: Evolving
Scope: `@carbonenginejs/server/destiny`
Audience: Maintainers and simulation integrators
Summary: Native Mini descriptors, fixed-parent collider ownership and lifecycle.

`CjsDestinyMiniBall`, `CjsDestinyMiniCapsule` and `CjsDestinyMiniBox` are
exported from the Destiny entry point. They mirror the descriptor records in
`destiny/src/MiniBall.*`, `MiniCapsule.*` and `MiniBox.*` at baseline `114e89f`.
They are separate from the actual collision objects owned by a Ballpark.

## Descriptors and creation

Each Ball owns three runtime `BlueList` instances: `miniBalls`, `miniCapsules`
and `miniBoxes` (`Ball.h:170-175`, `Ball_Blue.cpp:444-468`). These aliases are
readonly, but their lists are mutable. Descriptor identity is readonly; position,
axes and endpoints retain float64 storage, while sphere/capsule radii narrow to
float32. New IDs are zero; capsule/box parent IDs remain undefined until assigned,
representing the native uninitialized fields. Each vector owns its storage.

Metadata declares typed properties and each descriptor's self interface so the
existing BlueList can admit its native element type. Complete IRoot lifecycle,
Blue persistence and notification parity remain unfinished. Direct list edits
do not create or remove actual colliders. Descriptor edits do not update them.

Ball exposes the native creation methods (`Ball.cpp:1634-1879`):

| Method | Arguments |
|---|---|
| `AddMiniBall` | Local x, y, z and radius |
| `AddMiniCapsule` | Local endpoint A, endpoint B and radius, as seven scalars |
| `AddMiniBox` | Four vectors: local corner and three edge axes |

The `PyAddMiniBall`, `PyAddMiniCapsule` and `PyAddMiniBox` wrappers accept direct
JS scalar arguments instead of Python tuples (`Ball.cpp:2129-2189`). Box takes
twelve scalars. Only the capsule wrapper checks a strictly positive float32
radius before appending; its native core remains unchecked. This is not complete
CPython argument coercion. Box wrapper vectors come from the server float64
pool and return in `finally`, including nested callbacks and exceptions.

Default descriptor construction works. Python positional `Py__init__` dispatch
is not implemented. In particular, the sphere/capsule native initializers pass
a float radius address to a double parser (`MiniBall.cpp:38`,
`MiniCapsule.cpp:38-41`), which is undefined native behavior. The port does not
invent deterministic results for that memory overwrite.

## Materialization

Creation appends a descriptor first. A free parent retains it without creating
an actual collider. A fixed parent creates a sphere, capsule or oriented box,
adding its position to the local coordinates. Parent rotation is not applied;
box axes are copied unchanged. Existing world-space colliders do not follow
later parent movement, rotation or descriptor edits.

`AddActualMiniball`, `AddActualMinicapsule` and `AddActualMiniBox` store the new
ID after park insertion returns. The dedicated `Ballpark.AddMiniball` path
sets owner, fixed flags and MINIBALL mode before insertion, with zero movement
parameters (`Ballpark.cpp:3559-3636`). It does not use ordinary AddBall's agility
repair or duplicate cleanup. A generated duplicate ID still allocates a new
object and reports the collision, preserving the donor's displacement hazard.

`SetMode` sends exit-warp before mode-change and stores the mode after callbacks
(`Ball.cpp:905-938`). Creation, goto, follow, orbit, formation and `Stop` use it, including child removal.
See [movement transitions](destiny-formations.md) for callback ordering.
No warp behavior is implied by exposing the exit-warp notification.

## Lifecycle and callbacks

Bulk `AddMiniBalls`, `AddMiniCapsules` and `AddMiniBoxes` capture the initial list
length and attach in forward order. Repeating them creates fresh objects and
overwrites descriptor IDs without removing earlier copies. Their `RemoveMini*`
counterparts remove actual objects but retain descriptors and IDs.

Becoming free removes the actuals and samples the park clock after cleanup
callbacks; becoming fixed recreates them with fresh IDs (`Ballpark.cpp:4887-4930`).
Fixed-parent removal processes each family in reverse order and clears its list
before parent delay handling (`Ballpark.cpp:5496-5528`). Freedom is checked again
for each family because callbacks can change it. Free-parent removal and
`ClearAll` retain descriptors on externally held handles. The existing native
undrained oriented-box deletion queue is preserved; see the
[geometry guide](destiny-geometry.md).

`SetBallNotInParkCallback` replaces one process-global callback shared by every
park and detached Ball (`Ball.cpp:144-155`, `Ballpark.cpp:6730-6742`). Free Mini
parents return before reporting a missing park. Null disables the callback;
registration does not validate callability. JS callback exceptions propagate,
leaving already-appended descriptors in place. This differs from native unchecked
Python error state. Private backing on Ball avoids a Ball-to-Controller module
cycle; the public static remains `CjsBallparkController.s_ballNotInParkCallback`.
`ClearAll` does not reset it. Native destructor reset is still unported.

## Verification boundary

Donor local-coordinate and legacy MiniBall scenarios run through these APIs.
Capsule/box legacy and iterative trajectories now use real Mini owners. Thirty
active iterative scenarios pass, including the fixed-parent MiniBall-target case;
warp remains the active gap and one further MiniBall case is disabled in the donor.
Additional tests cover pool reentry/throw balance, callback phase ordering,
descriptor copies, repeated attachment and cleanup quirks. Expected trajectories
come from donor assertions; no native executable oracle has run. Free-parent
descriptors do not imply a moving compound-shape solver.
