# Server architecture

Status: Evolving
Scope: Headless Destiny simulation and its JavaScript host boundary
Audience: Maintainers
Summary: Preserve Carbon responsibilities while making platform adaptations explicit.

The package owns the Destiny port. The existing runtime supplies decorator
metadata and numeric operations through narrow imports. Simulation code does
not call schema APIs, hydration or values-export machinery. Decorators record
Carbon provenance and implementation status; they are not a simulation engine.

The current implementation is a movement ballpark, an independent movement
action queue, legacy collision response and spatial/bubble lifecycle. It has no implicit clock,
socket, renderer or provider connection. Importing the package does not start
services. Controls and authoritative world synchronization are the priority;
human messaging and external stream-provider I/O remain separate consumers.

Commands in Actions are native-shaped internal history entries. They are not
an authenticated remote invocation protocol. The host will provide transport,
tick admission and recovery around the donor's explicit interfaces.

Geometry uses Number arrays for double-precision Vector3d values; runtime vec3
operations receive explicit destinations. Server-owned float64 factories and a whole-view pool supply ClientBall state and
collision temporaries without changing runtime allocation settings. Source functions keep their native owners.

The partition owns keys, sorted membership, cell lifecycle and candidate filters.
Ball inherits Partitionable and shares native vector/identity storage with its
existing scalar accessors. Ball and static objects implement membership. Ballpark maintains automatic Ball
insertion, native bubble bookkeeping, subscriptions and activity counts. See the [partition guide](../destiny/partition/README.md)
for integer, allocation, ordering and reference-output adaptations.

Current implementation boundaries and remaining native families are listed in
[port status](port-status.md). Native DLL loading, refcounts and operating-system
integration need explicit JavaScript dispositions; absent emulable behavior
remains unfinished port work.

The movement park now consumes an injected Blue tick host and optional native-shaped
PyOS event bridge. It owns counter/timestamp separation and native tick/cleanup
ordering; the host owns clock sampling and event-handler failures. Proximity
events run after movement commits and troll petrification; full replication
remains unfinished. Replica ClientBall curves share the host/scene tick epoch;
[their sampling contract](destiny-client-curves.md) documents Number conversion,
reference caching and legacy orientation.

Destiny settings preserve the donor's module-global ownership. Apply copies
configuration values; Get returns detached snapshots. Existing parks read live
globals at native decision sites. New orbit, dynamic steering, angular tick
integration and client sampling are implemented for supported movement modes.
Collision records, contact impulses, discovery, recursive invalidation and the
iterative scheduler are implemented. Evolution samples the solved trajectories
before committing any ball's state. See [settings](destiny-settings.md).
