# Destiny basics

Import `CjsBallparkController` and `CjsDestinyBall` from
`@carbonenginejs/server/destiny` after `npm run build`.

## Commands

| Method | Behavior |
| --- | --- |
| `AddBall(id, mass, radius, maxVel, isFree, isGlobal, isMassive, isInteractive, isSpaceJunk, x, y, z, vx, vy, vz, agility, speedFraction)` | Creates a ball, or updates the same object for an existing ID; resets it to stop. |
| `GetBall(id)` | Returns the live ball or `null`. |
| `RemoveBall(id)` | Removes immediately and stops its followers/orbiters. |
| `ClearAll()` | Removes all balls; simulation time is retained. |
| `Evolve()` | Advances one second and increments `time` by one. |
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
same tick's positions. There is no variable-delta update, wall-clock scheduler,
interpolation API, collision, or replication in this pass.
