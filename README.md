# @carbonenginejs/server

Experimental server-side space simulation. The first implementation provides
generic Ball/Ballpark movement for ships, drones, and other space objects.
Gameplay chooses commands; Destiny evolves their movement.

## Install

This private experiment consumes the sibling runtime's existing `npm/` artifact
through a local file dependency. That artifact must exist before installation.
The server build compiles only this package's Stage-3 decorated source; it does
not build or modify runtime. Node 22 or later is required.

```sh
npm ci --install-links=true
npm test
```

`npm test` builds and runs the full CPU-only suite. No game assets, graphics
device, network service, or native Destiny installation is needed for tests.
`npm run build` alone produces the importable `dist/destiny/` modules.

## Quick start

After building, run this as an ES module from the repository:

```js
import { CjsBallparkController } from "@carbonenginejs/server/destiny";

const park = new CjsBallparkController();

// Native AddBall argument order:
// id, mass, radius, maxVelocity,
// isFree, isGlobal, isMassive, isInteractive, isSpaceJunk,
// x, y, z, vx, vy, vz, agility, speedFraction
const ship = park.AddBall(
    1, 13000000, 2, 10,
    true, false, false, false, false,
    600, 0, 0, 0, 0, 0, 0.9, 0.95
);
park.AddBall(
    2, 0, 20, 0,
    false, false, false, false, false,
    0, 0, 0, 0, 0, 0, 1, 0
);

park.Orbit(ship.id, 2, 500);
for (let tick = 0; tick < 60; tick++) park.Evolve();
console.log(park.currentTime, ship.x, ship.y, ship.z);

park.FollowBall(ship.id, 2, 100);
park.GotoPoint(ship.id, 1000, 0, 0);
park.Stop(ship.id); // Decelerates on subsequent ticks.
```

Each `Evolve()` advances the cached step, **one second** by default. The caller supplies
the clock; calling once per rendered frame would run the simulation too fast.
Distances are meters, velocity is meters/second, and mass is kilograms.
Ball IDs and 100ns timestamps are BigInts; safe integer Number inputs normalize
to the same values. Tick counters remain Numbers. See [Destiny basics](destiny/README.md)
for local-ID allocation and clock boundaries.

## Implemented

- Ball creation, lookup, replacement, removal, and clearing.
- Fixed-tick drag integration and goto point/direction, follow, legacy and new orbit,
  and stop behaviors.
- Position, velocity, mass, radius, agility, maximum speed, throttle, and free/static
  controls. Use controller setters to keep cached drag and previous state consistent.
- Native movement enum values, schema metadata, donor provenance, and tests against
  six CCP trajectory fixtures.

The temporary classes are `CjsBallparkController` (modelled on `Ballpark`) and
`CjsDestinyBall` (modelled on `Ball`). They do not claim or register complete native
Destiny identities. No general `CjsServer*` naming convention is established.

## Queued movement commands

`Actions`, exported from `@carbonenginejs/server/destiny/net/server`, queues the
existing movement commands using Carbon's tick-stamped history tuples. It
preserves command order, adjacent duplicate suppression and pending-value
queries. The caller applies each flushed batch before `Evolve()`. See
[Destiny action queue](docs/destiny-actions.md) for the API, example and limits.

This is an in-process movement subset, not a transport or automatic tick driver.
Native signals and the rest of the replication stack remain unported.

Native global settings select the orbit model and preserve detached configuration
snapshots. See [global settings](docs/destiny-settings.md) for the API and supported
collision/orientation branches.

## Collision geometry

The `@carbonenginejs/server/destiny/geometry` subpath provides the native
AABB, Planed, Triangle, RectangleShape and BoxShape operations plus all six Collision free functions,
using double-precision Number arrays. See [geometry](docs/destiny-geometry.md)
for output-reference adaptations and preserved source quirks. Capsule and
OrientedBox also supply static collision response and Ballpark ownership.

The `@carbonenginejs/server/destiny/partition` subpath provides the standalone
native partition, cell lifecycle, candidate filters and static membership bases.
Ball shares its native state with the partition and implements neighborhood
membership. Ballpark now maintains insertion, bubble transitions and activity. The
[partition guide](destiny/partition/README.md) records that boundary and its
representation adaptations. Native module `GetBoxCenter(level, x, y, z)` is also
available from the package root.

Replica parks now create `CjsDestinyClientBall`, exported at the package root. It
provides Number-tick position, velocity, acceleration and legacy/impact and dynamic rotation sampling with reusable
caller outputs. See [ClientBall curves](docs/destiny-client-curves.md) for the shared
scene clock and reference-origin contract.

## Current boundary

This is one region with movement, native clock phases, deferred ball/capsule cleanup,
legacy and iterative sphere/static-shape collision response and a separate movement-command queue.
Massive moving balls use native partition candidates and collision forces.
Optional dynamical orientation supplies steering, angular integration and client sampling.
[Mini shape ownership](docs/destiny-minis.md) supports fixed-parent colliders.
[Formation loading and following](docs/destiny-formations.md) are implemented.
Warp commands, evolution and client sampling are implemented; see [warp](docs/destiny-warp.md).
Python creation dispatch is exposed separately through `PyAddBall`.
[Missile launch, pursuit and collision events](docs/destiny-missiles.md) are implemented.
Visibility,
replication, combat, and drone command policy are not implemented. Unsupported
mobile movement modes throw before advancing the tick.

IDs use signed-int64 BigInts, with safe Number inputs accepted. Mobile balls require positive finite mass and
agility. Changes to physical fields should go through controller setters; the
data class is not a complete replacement for native Blue property hooks.

See [Destiny API](destiny/README.md) and [source correspondence and adaptations](docs/destiny-parity.md).

## Documentation

See the [documentation index](docs/README.md), [architecture](docs/architecture.md),
[port status](docs/port-status.md), and [source correspondence](docs/destiny-parity.md).

## License

The ported Carbon code and fixtures use the MIT license reproduced in [NOTICE](NOTICE).
No game assets are included. This package remains a private development experiment.
