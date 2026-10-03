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
action queue, and standalone collision geometry. It has no implicit clock,
socket, renderer or provider connection. Importing the package does not start
services. Controls and authoritative world synchronization are the priority;
human messaging and external stream-provider I/O remain separate consumers.

Commands in Actions are native-shaped internal history entries. They are not
an authenticated remote invocation protocol. The host will provide transport,
tick admission and recovery around the donor's explicit interfaces.

Geometry uses Number arrays for double-precision Vector3d values; runtime vec3
operations receive explicit destinations. No alternate vector library or global
allocation-mode change is introduced. Source functions keep their native owners.

Current implementation boundaries and remaining native families are listed in
[port status](port-status.md). Native DLL loading, refcounts and operating-system
integration need explicit JavaScript dispositions; absent emulable behavior
remains unfinished port work.

The movement park now consumes an injected Blue tick host and optional native-shaped
PyOS event bridge. It owns counter/timestamp separation and native tick/cleanup
ordering; the host owns clock sampling and event-handler failures. Full replication,
ClientBall clocks and spatial lifecycle remain outside the implemented boundary.
