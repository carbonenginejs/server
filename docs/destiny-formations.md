# Movement transitions and formations

Status: Evolving
Scope: `@carbonenginejs/server/destiny`
Audience: Maintainers and simulation integrators
Summary: Native command ordering, follower cleanup and formation ownership/steering.

The implementation follows Destiny baseline `114e89f`. GOTO, FOLLOW, ORBIT,
STOP and FORMATION can evolve with the existing legacy or dynamic orientation
paths. [Warp](destiny-warp.md) is also implemented; missiles and other special modes remain unfinished.

## Command transitions

`GotoPoint`, `GotoDirection` and `Stop` accept their native ID overloads and
Ball-reference overloads. Reference goto calls take a vector instead of three
scalars. Caller references survive callback changes to park membership; the
methods do not resolve the ID again after a callback. Temporary vectors use
the server float64 pool and return on every exit, including nested throws.
Ordinary AddBall replacement retains its earlier explicit follower-detachment
adaptation; complete replacement-state and callback-phase parity remains open.

Native direction normalization skips multiplication when its computed length is
zero. This preserves tiny nonzero components whose squared length underflows.
The destination is current position plus the resulting direction times `1e17`
(`Ballpark.cpp:4471-4548`, `Vector3d.h:62-72`). Goto stops the old order, then
stores its destination and restarts zero throttle before entering GOTO.

Follow/orbit reject nonfinite float32 ranges, self/missing targets, moribund
targets, different bubbles and cloaked targets before stopping the old order
(`Ballpark.cpp:3879-3941,4007-4066`). A valid transition stops, sets follow
fields, calls `SetMode`, then inserts the follower ID. Mode-change callbacks
therefore see the new fields before the leader's membership set is updated.
The core methods accept negative target IDs; `PyFollowBall` and `PyOrbit`
implement the Python wrappers' negative-ID rejection using RangeError. Their
default range is one (`Thunkers.cpp:244-269,330-355`). Full CPython argument
coercion and error-object handling are not implemented.

The ID `Stop` overload returns immediately for STOP; the reference overload
still reaches `SetMode`. Only FOLLOW, ORBIT, MISSILE and FORMATION clear target,
owner, range and effect stamp. Replicas validate map/pointer agreement before
erasing target membership; masters use the pointer directly. A master also
releases a FORMATION slot (`Ballpark.cpp:4556-4643`). Broken native pointer
assertions become JS errors. Diagnostic output uses console methods.

`StopAllFollowers` snapshots incoming IDs and validates each current relationship.
Missiles become nonmassive; missiles and interactive orbiters switch to GOTO
along their velocity. Other followers stop. New links added during callbacks
are not part of the snapshot (`Ballpark.cpp:5416-5469`). `ClearAll` calls neither
Stop nor mode/final-cleanup events; retained handles keep movement, reservation
and follower state, while their park and spatial membership are removed.

## Formation data and ownership

| API | Native behavior |
|---|---|
| `park.LoadFormations([[name, offsets], ...])` | Clears and reloads definitions; names are ignored. Existing ball IDs and reservations are retained. |
| `park.AddFormation(offsets)` | Appends owned float64 copies of three-component local offsets. |
| `park.SetBallFormation(id, formationID)` | Sets a signed-char formation index; `-1` removes leadership. |
| `ball.formationID` | Readonly Blue unsigned-byte view: native `-1` reads as `255`. |
| `ball.ReserveFormationSlot()` | Returns the first unreserved index, or `-1`; formations larger than 16 cannot reserve slots. |
| `ball.FreeFormationSlot(slot)` | Clears the bit without stopping a follower. |
| `park.FormationFollow(id, targetId, slot)` | Links a follower; does not implicitly reserve a slot. |

Definitions belong to Ballpark's `mFormations`; each Ball owns `mFormationID`
and a 16-bit reservation mask. This Number mask adapts native `std::bitset<16>`.
Sources are `Ballpark.h:148`, `Ball.h:112,151`, `Ball.cpp:2275-2351`,
`Ballpark.cpp:6651-6727` and `Thunkers.cpp:1921-1945`.

Formation changes store the new ID last. Removing leadership stops all follower
modes and clears reservations. Shrinking definitions first snapshots the
formation followers whose slots no longer fit, then stops them while callbacks
still see the old formation ID. The native reversed bit-reset loop is retained:
reservations without active followers can survive shrinking and later expansion.

`FormationFollow` checks leader/slot availability, stops the previous order,
then checks bubble equality and cloak. It does not reject a moribund leader or
check slot occupancy (`Ballpark.cpp:3947-4001`). Signed-char narrowing applies
to formation IDs and slots. Negative indices can pass native upper-bound-only
checks; subsequent invalid vector access raises in JS instead of reading memory.
Reloading a smaller definition table can likewise leave existing IDs invalid.

`FreeFormationSlot` preserves the native unsigned empty-size underflow: for an
empty formation, indices below 16 still reset bits and higher indices throw
RangeError in place of `std::out_of_range`. Definitions above 16 are loadable,
but reservation returns `-1`. `ClearAll` retains the definition table.

## Steering and verification

`EvolveFormation` scales the chosen offset by both radii plus offset length,
using the native reciprocal-multiply division order. It narrows the result to
float32, rotates through the leader's `GetRotatedVector`, adds the leader's
double-precision position, stores `mGoto`, then calls `GotoThrust`
(`Ballpark.cpp:1023-1061`). Zero offset uses length one. The float32 temporary
is pooled independently across nested rotation calls and returned on exceptions.

Both ten-tick formation trajectories from `test_follow.py:16-71` pass using
literal donor expectations and an absolute `5e-5` comparison corresponding to
the donor's four-decimal check. Setup supplies the donor helper's final state
through AddBall instead of reproducing Python property-dispatch plumbing.
Additional tests cover callback phases, slot exhaustion/reuse, shrinking,
signed/unsigned boundaries, rotated targets and nested pool cleanup. No native
executable oracle or networked master/replica comparison has run.

The donor itself warns that this abandoned formation code can differ between
client and server because orientation snaps on creation; it is distinct from
EVE's later Python formation flight (`Thunkers.cpp:1888-1897`). The JS port keeps
that source behavior rather than claiming synchronized formation flight.
