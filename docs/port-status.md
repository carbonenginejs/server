# Destiny conversion status

Status: Evolving
Scope: Complete public Destiny donor, including native and Python behavior
Audience: Port maintainers
Summary: Current implementation and the families still required for completion.

The target is the whole public Destiny donor, not only features used by a racing
demo. Source baseline: `114e89fa584f0e1a81eb0a679aabf41af8870072`.
The current server suite has 720 passing CPU tests against runtime alpha.9.

| Family | Current status |
|---|---|
| Ball/Ballpark | Movement subset: goto, follow, legacy/new orbit, formation, native stop transitions and basic lifecycle/setters, exact signed-int64 IDs/timestamps and native local-ID allocation |
| Actions | Movement commands, timestamps, adjacent deduplication and pending queries |
| AABB/Planed/Triangle/Collision | Numeric primitives implemented; 44 native fixtures and seven additional cases |
| Clock/host boundary | Separate time/currentTime, Start/Pause, OnTick, AdjustTimes and deferred ball/capsule cleanup implemented; ClientBall sample caches shift with the clock; network batches pending |
| BoxShape/RectangleShape | Numeric geometry implemented; all 25 native fixtures and 18 additional cases |
| Capsules/oriented boxes | Geometry, Blue aliases, memberships, response, Ballpark ownership and legacy scheduling implemented; native cleanup quirks retained |
| Mini-shapes | Descriptors, typed BlueLists, native/Python-shaped add methods, fixed-parent attachment and lifecycle implemented; Python constructors and full IRoot/persistence pending |
| Partition/Partitionable/Box/StaticCollidable | Keys/hash, cells, ordering, filters and static membership implemented; Ball shares state and implements neighborhoods/cleanup; automatic Ballpark insertion implemented |
| Bubbles and activity | Insertion, initialization, delta bookkeeping, subscriptions and activity implemented; conflict resolution and network batches pending |
| Legacy and iterative collision response | Fractional integration, both response paths, collision records, discovery, impulses, recursive invalidation, scheduling, conditional cache cleanup and warp integration implemented |
| New orbit | Both orientation paths implemented; all four native scenarios pass; physical-heading fallback implemented |
| Formations | Loading, 16-bit reservations, leader assignment, native follow transitions and rotated steering implemented; both donor trajectories pass |
| Orientation and movement modes | Legacy/dynamic steering/evolution/sampling, impact rotation and oriented creation implemented; warp and missile paths implemented; mushroom growth/expiry, troll petrification, rigid/boid/field controls and passive native mode dispatch implemented; mode stream/export semantics pending |
| Visibility, range/volume queries, sensors and relative motion | Periodic sensors, destination notifications, target tracking, cloak/uncloak, sphere visibility, range/triangle/cone/capsule queries, full-map scan, distances, relative motion and accuracy implemented |
| ClientBall interpolation, snapshots and binary streams | Number/BigInt tick position, velocity, acceleration, legacy/impact/dynamic rotation, relative motion, deltas and ego reference implemented; interface registration, snapshots and streams pending |
| Server tickers, bubble updates and recipient batching | Pending |
| Client history merging, wait rules, restore and replay | Pending |
| Settings and settings utility functions | Native globals, configuration snapshots, bindings and aliases implemented |
| Signal, remaining timing and Python wrapper utilities | Pending; native-long counter bounds/wrapping are not yet modeled |
| Native support containers, comparers, Random and full constants | Three sorted-set comparers and DSTCONSTANTS implemented; other support families pending |
| Module lifecycle, interfaces and property notification semantics | Angular and harmonic/affiliation Blue store-before-notify implemented; other notification branches, module lifecycle and interface identity pending |

The source inventory contains 32 native implementation files, 33 source headers,
two public interfaces and 20 production Python files. These counts do not measure
completion. Every observable member needs an implemented, adapted or explicit
platform disposition. Emulable missing behavior is not excluded because a demo
does not use it.

The [physics plan](destiny-physics-plan.md) covers the simulation phases. Full
conversion additionally requires server action/tick/bubble/batch behavior,
client receive/merge/wait/apply/snapshot-restore behavior, native stream and
packaged-action compatibility, utility/module semantics and integrated
master/replica tests with delayed, reordered and duplicate deliveries.

Decorators use only the current meta namespaces. The simulation imports no
CjsSchema/schema APIs and performs no schema hydration or values export. The
runtime is consumed as an existing package, never rebuilt by the server script.
