# Destiny spatial partition

Status: Evolving
Scope: Native Partition, Box, ordering and static membership prerequisites
Audience: Simulation maintainers
Summary: Spatial indexing and shared Ball membership, with automatic Ball lifecycle and native bubble activity.

Import the classes from `@carbonenginejs/server/destiny/partition`. Their
`CjsDestiny` names identify the temporary port; metadata names each Carbon donor.
`Partition/` mirrors the multi-class `Partition.h` include unit, and
`SortedSets/` owns the three native ordering predicates. `Partition.NearbyCriteria`
retains its nested native ownership and one-bit assignment behavior.

The partition creates cells and ancestors on demand. Boxes own sorted occupant
and child collections; their comparers determine both order and equivalence.
Removing the final occupant can synchronously release an entire ancestor chain.
Partitionable supplies shared spatial state and abstract obligations;
StaticCollidable implements both directions of static-shape membership.

Ball inherits Partitionable and uses native vector/identity storage. Existing
scalar accessors forward to that storage, so movement and candidates observe the
same values. Ball implements its native neighborhood insertion method, inflated
radius, activity mask and reciprocal cleanup. Each controller owns a partition;
replacement/removal clears memberships. Automatic Ballpark insertion and bubble
activity are implemented; collision consumers and static-shape ownership remain unfinished. Kernel tests use native-shaped
records; separate integration tests now enumerate actual live Balls.

Native Ball shadows Partitionable's mPark and mHandled members; the JS port
deliberately uses one logical slot for each. Native object layout is not exposed.
Bare Ball construction now has the native position [1e10,1e10,1e10]; AddBall still
assigns the requested position. Old/new vectors remain independent per instance.

## JavaScript representation

Coordinates and IDs use BigInts at int64 boundaries; physical positions and cell
widths retain double-precision Numbers. Harmonic values are int64 BigInts, while
corporation/alliance IDs and bubble counters are native 32-bit Numbers.
Checked conversions reject undefined native signed overflow and nonfinite casts.
`GetBoxKey` uses one output record for its three native references.

Sorted arrays replace C++ comparator-aware sets. Equivalent insertions retain the
existing object, even when the incoming pointer differs. JS Map cannot use native
value-object equality, so internal keys combine the donor hash with the full
coordinate tuple. Hash collisions therefore never merge unequal keys. The hash
is the current `Partition.h:104-123` implementation, with Windows x64 MSVC's
eight-byte, little-endian FNV-1a integer hashing explicitly implemented. Its
integers are not a portable wire contract.

JS garbage collection replaces BoxAllocator's raw allocation cache and placement
new; Box.Dispose still runs native membership teardown synchronously. Released
boxes are invalid for further use. JS references replace Python reference counts
for Box.mObject. False-valued objects remain valid stored values. Console output
replaces native diagnostic log channels.

Native unordered-map order is unspecified; GetActiveBoxes and DumpPartition use
JS Map insertion order. Candidate enumeration instead preserves the native
sorted membership/discovery order. It appends into existing output arrays, uses
native handled flags for deduplication and does not apply the final sort described
by the native comment. Interactive-only, missile, field and static-object filter
branches retain their distinct rules. See the method JSDoc for output semantics.

The module-level `GetBoxCenter(level, x, y, z)` is exported from the root and the
partition subpath. It returns the native center tuple as an array and preserves
the Python binding's TypeError for illegal levels. The class method retains
native in-place vector output. The unused native `isNotMissile` helper has no
call sites or header declaration and adds no exported JS surface; active filters
retain their source predicates at their original methods.

## Evidence and remaining work

Baseline: `114e89fa584f0e1a81eb0a679aabf41af8870072`. Forty partition tests include
the native TestPartition hash-separation fixture, source-derived key/grid and
membership cases, all candidate filter families, and an independent multilevel
cell-volume overlap oracle. A header-only MSVC 14.50 x64 executable using the actual
donor Partition.h verified the two hash integers. This is not execution evidence
for the native partition implementation or the complete simulation.

The source quirks retained include zero-grid lower-first key clamping, removal
on an empty-set miss, edge-clamped neighbor self-aliases, and top-level-only
traversal reset. Capsule/OrientedBox insertion, collision integration and remaining native Python
query/replication trajectories are
still required before calling the spatial simulation complete.

Sixteen additional Ball tests cover shared state, strict tangency, native
insertion order, master bubble restoration, deferred cleanup and an independent
small-cell overlap oracle. The native membership cache compares only the base
key and boundary modifiers: it can retain eight memberships after a physical
radius change would otherwise select the 27-cell branch. The port preserves
that early return, including its skipped activity repair and bubble restoration.
The full JS suite has 266 passing tests. See [bubble lifecycle](../../docs/destiny-bubbles.md)
for automatic insertion, activity, callback ordering and remaining network obligations.
