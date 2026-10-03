# Destiny conversion status

Status: Evolving
Scope: Complete public Destiny donor, including native and Python behavior
Audience: Port maintainers
Summary: Current implementation and the families still required for completion.

The target is the whole public Destiny donor, not only features used by a racing
demo. Source baseline: `114e89fa584f0e1a81eb0a679aabf41af8870072`.
The current server suite has 112 passing CPU tests against runtime alpha.9.

| Family | Current status |
|---|---|
| Ball/Ballpark | Temporary movement subset: goto, follow, legacy orbit, stop and basic lifecycle/setters |
| Actions | Movement commands, timestamps, adjacent deduplication and pending queries |
| AABB/Planed/Triangle/Collision | Numeric primitives implemented; 44 native fixtures and seven additional cases |
| Clock/host boundary | Separate time/currentTime, Start/Pause, OnTick, AdjustTimes and deferred ball cleanup implemented; ClientBall/capsule/bubble dependencies and full int64 remain pending |
| BoxShape/RectangleShape, capsules/boxes and mini-shapes | Pending |
| Partition/Partitionable/Box, bubbles and activity | Pending; use the new KeyHash donor at Partition.h:104-123 |
| Legacy and iterative collision response | Pending |
| Orientation, new orbit, warp, missiles, formations and remaining modes | Pending |
| Visibility, range/volume queries, sensors and relative motion | Pending |
| ClientBall interpolation, snapshots and binary streams | Pending |
| Server tickers, bubble updates and recipient batching | Pending |
| Client history merging, wait rules, restore and replay | Pending |
| Signal, settings, timing and Python wrapper utilities | Pending |
| Native support containers, comparers, Random and full constants | Pending |
| Module lifecycle, interfaces and property notification semantics | Pending |

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
