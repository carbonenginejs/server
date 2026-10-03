# Destiny client history and replay

Status: Evolving
Scope: Client tick callbacks, native snapshots and received action application
Audience: Simulation hosts and demo integrators
Summary: Current client ticker behavior, external dependencies and native replay limits.

## Current API

The package subpath @carbonenginejs/server/destiny/net/client exports Ticker,
BaseTicker, ClientTickerInterface, TickErrorHandlerInterface and
merge_state_into_history. Python method names are preserved. Registry names
DestinyClientTicker and DestinyClientBaseTicker distinguish these classes from
the server classes with the same native short names.

Construct Ticker(errorHandler, clientCallbacks, dependencies), then call
set_ballpark(park). The callback interfaces declare the native application
contracts: scene cleanup, local-action notifications, destruction delays and
fatal/recoverable desynchronization handling. JS abstract calls throw rather
than enforcing Python ABC construction rules. Delay dictionaries are Maps.

dependencies optionally supplies marshal and logger. marshal.Load(payload)
must decode Carbon Blue packaged actions; the Blue codec is outside Destiny
and is not implemented here. No JSON replacement encoding is introduced.
logger uses info/warn/error operations; an optional numeric level above 20 skips
history dumps. Console is the default. Verbose Python logging/profiling is not
a simulation dependency.

Incoming updates have the native shape [stamp, [methodName, args]]. Pass an
array of these to update(state, wait_for_bubble). Ordinary argument tuples have
the bounded arity of their corresponding native method; collection-valued
arguments remain one array or Map. PackagedAction decoding expands one level.
A failed package, including a missing decoder, is logged and dropped while
other actions remain. A null active park ignores incoming updates entirely.

## Host integration and dispatch

The application routes its existing Destiny::DoPreTick callback to
do_pre_tick(), and DoPostTick to do_post_tick(stamp). These calls are synchronous.
The ticker does not own a socket, timer or asynchronous scheduler. Full SetState
calls park.Start(), which requires the existing injected Blue tick host.
The first native OnTick evolution retains its special no-pre/post-callback path.

SetState calls application cleanup, ClearAll, full stream restoration, ego
assignment and Start, then marks state valid and rebases snapshots. AddBallsToPark
uses partial=2. RemoveBall gets a destruction delay, invokes native removal,
then runs cleanup; RemoveBalls runs group cleanup before delay lookup/removal.
The ballpark exposes its native writable balls dictionary as a Map with BigInt
keys. Replacing that dictionary does not rebuild the other native registries.

Carbon's _parent_ dispatch bypasses Python game overrides. Here the ballpark's
blueMethods table mirrors its Blue exposure names, selecting existing Py bindings
where the JS port separates them. Entry dispatch and calls between exposed
nonvirtual native methods use the owner's prototype, while PyOS/game callbacks
remain the extension points. Unknown names, inherited Object methods and internal
helpers cannot be dispatched as Blue actions. Named but still unported bindings
fail and log; the table does not claim they are implemented. Existing combined
core/binding adaptations remain documented at their owning methods.

Each ordinary action synchronizes to its event tick before application. Failed
synchronization invokes on_recoverable_desync and ends the batch. Individual
action exceptions are logged and later actions continue. Initial SetState sits
outside that catch. Successful nonlocal actions notify on_ballpark_local_action;
cloaking a non-ego ball then triggers its local removal.

## History and snapshots

History groups are ordered by timestamp. Equal-time arrivals append and clear
the bubble-wait flag. A SetState discards groups older than its arriving stamp;
later ordinary updates older than that stamp are ignored. Mixed timestamps
report fatal desync but still merge. Waiting groups block application. Events
one or two ticks ahead defer; a gap of three or more synchronizes immediately.

store_state(mid_tick=false) saves a native full-state stream while the park is
running. Rewind selects the last eligible snapshot in list order, restores with
partial=1, then calls Evolve(0) to reach the requested tick. Integer range counts
must be exactly representable as Numbers; fractional/nonfinite counts throw.
flush_simulation_history preserves only a last mid-tick snapshot from the previous
tick, then stores a new base. Post-tick rebases after applied actions or stores
periodically when stamp exceeds last_stamp+10.

The native quirks remain:

- More than ten snapshots prune to the first plus last five; the donor's [3:3]
  slice is empty.
- The extra pre-tick Evolve requires more than one history group remaining.
- When mixed-stamp input appends to empty history, every group can remain waiting.
  The merge helper rejects empty input with nonempty history; update filters empty
  batches before calling it.
- Rewind is partial restoration: absent balls, existing minis and old samples can
  survive. Removed fixed balls recreated from snapshots do not recreate minis.
  Local IDs omitted by the writer are not covered by the snapshot.
- release clears balls and histories but does not pause/detach the park or reset
  last_stamp/should_rebase. set_ballpark also preserves ticker history.

These are native semantics, not a general rollback guarantee. See
[state streams](destiny-streams.md) for layout, orientation-setting agreement,
checked-read behavior and finite-input limitations.

## Evidence and remaining work

Donor baseline: 114e89fa584f0e1a81eb0a679aabf41af8870072.
Sources: destiny/python/destiny/net/client/_util.py:6-68;
_baseticker.py:12-140; _ticker.py:14-415; _interface.py:6-118;
destiny/src/Ballpark_Blue.cpp:180-188,292-753;
destiny/src/Thunkers.cpp:1244-1251.

The suite includes all 11 donor merge tests and ten donor ticker tests, plus
19 regressions/integration cases: large merges, native quirks, decoding failures,
callback ordering, entry/internal override bypass, binding admission, delayed
numeric replay and synchronous OnTick routing. All 809 server tests pass.
The numeric replay check compares a supported ordinary-motion tick boundary;
it does not establish exact restart for all modes or transient state.

Server ticker/batching, full Actions coverage, additional Blue bindings and a
real Blue marshal provider remain separate obligations. Network delivery and
game interest/identity policy remain application-owned. See [port status](port-status.md).
