# Destiny basics

Import `CjsBallparkController` and `CjsDestinyBall` from
`@carbonenginejs/server/destiny` after `npm run build`.

## Commands

| Method | Behavior |
| --- | --- |
| `AddBall(id, mass, radius, maxVel, isFree, isGlobal, isMassive, isInteractive, isSpaceJunk, x, y, z, vx, vy, vz, agility, speedFraction)` | Creates a ball, or updates the same object for an existing ID; resets it to stop. |
| `GetBall(id)` | Returns the live ball or `null`. |
| `RemoveBall(id, delay = 0)` | Detaches followers; queues deletion when delayed or inside evolution. Interactive orbiters keep flying. |
| `ClearAll()` | Removes all balls; simulation time is retained. |
| `Evolve(timestamp = 0)` | Advances the cached step and increments `currentTime`; zero leaves ball timestamps unchanged. |
| `Start()` / `Pause()` | Registers/unregisters the injected Blue host without resetting clocks. |
| `OnTick(realTime, simTime, cookie)` | Cleans dead balls and evolves whole intervals from the 100ns simulation clock. |
| `AdjustTimes(delta)` | Shifts park and nonzero ball timestamps without changing the counter. |
| `GotoPoint(id, x, y, z)` | Accelerates toward a fixed point. Does not clamp arrival or eliminate overshoot. Restarts zero throttle at one. |
| `GotoDirection(id, x, y, z)` | Normalizes direction and chooses a point `1e17` meters away. |
| `FollowBall(id, targetId, range = 1)` | Keeps the specified surface separation, including both radii. |
| `Orbit(id, targetId, range = 1)` | Uses the source-default legacy orbit with an ID-dependent orbital plane. |
| `Stop(id)` | Detaches its target and removes thrust; velocity decays through drag. |
| `SetBallPosition(id, x, y, z)` | Sets current and previous position. |
| `SetBallVelocity(id, vx, vy, vz)` | Sets current and previous velocity. |
| `SetBallMass(id, mass)` | Changes positive mass and recalculates drag. |
| `SetBallAgility(id, agility)` | Changes positive agility and recalculates drag. |
| `SetBallRadius(id, radius)` | Changes nonnegative radius. |
| `SetMaxSpeed(id, speed)` | Changes nonnegative maximum velocity. |
| `SetSpeedFraction(id, fraction)` | Clamps throttle to `[0, 1]`. |
| `SetBallFree(id, isFree)` | Enables movement or makes the object static, stopping and zeroing its velocity. |

Missing-ID commands are ignored. Follow/orbit requests for self, missing,
cloaked, or moribund targets leave the existing order unchanged. Changing a target's
flags directly does not emit gameplay events or cancel existing commands.

The ball exposes scalar `x/y/z`, `vx/vy/vz`, `gotoX/gotoY/gotoZ`, `mode`,
`followId`, `followRange`, physical parameters and flags. `agility` follows org
camelCase naming; native Blue also exposes it under `Agility`.
Private `_` fields contain previous tick state, forces, cached drag and target links.
Use controller methods for mutation; this subset does not install native property hooks.

`CjsDestinyBall.DSTBALLMODE` retains all thirteen source enum members and values.
Only GOTO, FOLLOW, STOP, and ORBIT are supported movement modes. Enum presence does
not mean a behavior is implemented.

Internal native-named evolution methods are exposed for source correspondence,
but callers should drive the simulation with `Evolve()` so all forces observe the
same tick's positions. The Blue host owns pumping; the park creates no background timer.
Interpolation, collision response and replication remain unported.

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
quirk is intentional. Use safe integer Number timestamps for exact arithmetic;
full signed-int64 representation remains pending.

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
Capsule cleanup, ClientBall timestamp caches and bubble lifecycle remain pending.
