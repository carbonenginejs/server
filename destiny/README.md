# Destiny basics

Import `CjsBallparkController` and `CjsDestinyBall` from
`@carbonenginejs/server/destiny` after `npm run build`.

## Commands

| Method | Behavior |
| --- | --- |
| `AddBall(id, mass, radius, maxVel, isFree, isGlobal, isMassive, isInteractive, isSpaceJunk, x, y, z, vx, vy, vz, agility, speedFraction)` | Creates a ball, or updates the same object for an existing ID; resets it to stop. |
| `GetBall(id)` | Returns the live ball or `null`. |
| `RemoveBall(id, delay = 0)` | Detaches followers; queues deletion when delayed or inside evolution. Interactive orbiters keep flying. |
| `ClearAll()` | Removes all balls and resets local-ID counters; simulation time is retained. |
| `Evolve(timestamp = 0)` | Advances the cached step and increments `currentTime`; zero leaves ball timestamps unchanged. |
| `Start()` / `Pause()` | Registers/unregisters the injected Blue host without resetting clocks. |
| `OnTick(realTime, simTime, cookie)` | Cleans dead balls and evolves whole intervals from the 100ns simulation clock. |
| `AdjustTimes(delta)` | Shifts park and nonzero ball timestamps without changing the counter. |
| `GotoPoint(id, x, y, z)` | Accelerates toward a fixed point. Does not clamp arrival or eliminate overshoot. Restarts zero throttle at one. |
| `GotoDirection(id, x, y, z)` | Normalizes direction and chooses a point `1e17` meters away. |
| `FollowBall(id, targetId, range = 1)` | Keeps the specified surface separation, including both radii. |
| `Orbit(id, targetId, range = 1)` | Selects native legacy/new orbit through the global setting; legacy is the default. |
| `Stop(id)` | Detaches its target and removes thrust; velocity decays through drag. |
| `SetBallPosition(id, x, y, z)` | Sets current and previous position. |
| `SetBallVelocity(id, vx, vy, vz)` | Sets current and previous velocity. |
| `SetBallMass(id, mass)` | Changes positive mass and recalculates drag. |
| `SetBallAgility(id, agility)` | Changes positive agility and recalculates drag. |
| `SetBallRadius(id, radius)` | Changes nonnegative radius. |
| `SetMaxSpeed(id, speed)` | Changes nonnegative maximum velocity. |
| `SetSpeedFraction(id, fraction)` | Clamps throttle to `[0, 1]`. |
| `SetBallFree(id, isFree)` | Enables movement or makes the object static, stopping and zeroing its velocity. |

Missing valid-ID commands are ignored; invalid integer representations throw. Follow/orbit requests for self, missing,
cloaked, or moribund targets leave the existing order unchanged. Changing a target's
flags directly does not emit gameplay events or cancel existing commands.

The ball exposes scalar `x/y/z`, `vx/vy/vz`, `gotoX/gotoY/gotoZ`, `mode`,
`followId`, `followRange`, physical parameters and flags. `agility` follows org
camelCase naming; native Blue also exposes it under `Agility`.
These are accessors over native fields: position is `mNewPos`, velocity is
`mNewVel`, and identity is inherited `mId`. The retained private `_` accessors
forward previous tick state, forces, cached drag and target links to native storage.
Use controller methods for mutation; this subset does not install native property hooks.

Ball now inherits Partitionable and implements native radius queries and cell
membership operations. Each park owns `mPartition`, `mFriction` and cached `dt`;
the former private `_friction`/`_dt` names have been replaced. AddBall assigns the
owning park. Replacement, final removal and ClearAll remove existing membership;
deferred removal retains it until final cleanup. Automatic neighborhood updates,
bubble bookkeeping and activity now follow native insertion/setter/Evolve hooks.
See the [bubble lifecycle](../docs/destiny-bubbles.md) and [partition guide](partition/README.md).

`CjsDestinyBall.DSTBALLMODE` retains all thirteen source enum members and values.
Only GOTO, FOLLOW, STOP, and ORBIT are supported movement modes. Both orbit
algorithms work with dynamical orientation disabled; see [global settings](../docs/destiny-settings.md). Enum presence does
not mean a behavior is implemented.

Internal native-named evolution methods are exposed for source correspondence,
but callers should drive the simulation with `Evolve()` so all forces observe the
same tick's positions. The Blue host owns pumping; the park creates no background timer.
ClientBall interpolation and iterative collision response are implemented;
replication and compound-shape ownership remain unported.

## Clock and host boundaries

`new CjsBallparkController(blueOS = null, pyOS = null)` injects the native
host boundaries. The existing runtime CjsBlueOS supplies tick registration and
manual PumpOS; its elapsed Number clocks are not full native absolute-time parity.
No simulation method calls schema APIs. The IBlueEvents declaration is metadata.

`time` is the last simulation timestamp in 100ns units; `currentTime` is the
integer simulation counter. Actions use the latter. `tickInterval` is in
milliseconds (default 1000). Evolve uses cached dt; changing tickInterval refreshes
dt only at an eligible OnTick, and does not refresh existing balls' cached drag.
Mass/agility setters or AddBall refresh drag at their native sites. This donor
quirk is intentional. Timestamps use signed-int64 BigInt storage; method inputs
and the time setter also accept safe integer Numbers. Zero timestamps remain
unset sentinels. Unsafe Numbers, coercible strings/booleans and signed overflow
are rejected. Direct writes to internal timestamp fields must already be BigInts.
Tick intervals must be positive integer milliseconds no greater than 214748,
so the donor's int multiplication by 10000 fits signed int32. Ordinary catch-up
counts above signed-int32 capacity are rejected after the native first/master
branches. These guards make unsupported native arithmetic explicit. Counter
wrapping/bounds for currentTime and mEffectStamp are separate, unfinished native-long
obligations; the checked-int64 contract does not cover them.

IDs use the same checked signed-int64 representation. Stored id/followId, map
keys and Actions ID slots are always BigInts; 1 and 1n identify the same ball.
Use AddBall's returned id after allocation: masters allocate -2n, -3n, ... for
zero requests, and -1073741825n, -1073741826n, ... for any negative request.
Replicas allocate from the latter sequence only for -1; other negatives and
zero are explicit IDs. Allocation does not skip collisions with explicit IDs.
ClearAll resets both counters. GetBall and commands use resolved IDs and do not
allocate. Controller methods own identity and follower bookkeeping; do not
mutate stored IDs or follower sets directly.

The optional PyOS bridge supplies synchronous SendEvent(target, context, name,
null, format, ...args) and PyError(). The only formats used here are `(i)`
for pre/post tick counters and `()` for final cleanup. A missing handler is
successful dispatch; handler return values do not determine dispatch success.
The host catches handler exceptions and returns false; the park calls PyError
and continues. A null bridge means no Python subscribers. Async handlers are
not part of this contract.

The first eligible OnTick evolves once without pre/post events. Subsequent
ticks emit DoPreTick before evolution and DoPostTick after the counter increments.
A master drops backlogs of at least six whole intervals to one; a replica catches
up all intervals. Pause only stops host registration, not direct method calls.
Cleanup happens before interval eligibility, even for a subinterval tick.

RemoveBall marks delayed balls moribund immediately, stopping their participation.
Cleanup removes all overdue balls, plus up to seven within the two-counter buffer
per call. Selection among equally eligible buffered balls uses JS Set insertion
order instead of native unordered pointer hashing. Re-add cancels pending deletion.
ClearAll releases references without final-cleanup callbacks or resetting clocks.
Capsule cleanup, automatic bubble membership and ClientBall timestamp-cache
shifts now work. See [geometry and ownership](../docs/destiny-geometry.md)
for native shape cleanup quirks.
