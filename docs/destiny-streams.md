# Destiny state streams

Status: Evolving
Scope: Native state-packet writing and planned restoration
Audience: Simulation hosts and port maintainers
Summary: Binary layout, filters, stream ownership and the remaining reader obligations.

## Current writer API

CjsDestinyStream is a server-owned byte adapter around runtime's bounded reader.
It supplies the seek/write and float64/int64 operations needed by Destiny,
without implementing Blue persistence or changing runtime. Construct it with
optional bytes, then pass it to CjsBallparkController.WriteFullStateToStream
(stream, optionalSourceID) or WriteBallsToStream(ballIDs, stream). The Py-prefixed
methods expose the same wrappers. WriteBallToStream(ball, stream) writes one
record at the current position. All classes are exported from the package root
and /destiny subpath.

The packet writers seek to zero before and after writing. They do not truncate:
reusing a longer stream retains its old suffix. Use a new stream when a fresh
payload is required. Read() returns owned unread bytes; GetBytes() copies all
logical bytes without moving the cursor. Input bytes, including Buffer subranges,
are copied. Seek is deliberately limited to absolute positions within existing
contents; the native stream's broader seek/grow API is outside this adapter.

Scalar writes use little-endian DataView operations and preserve negative zero
and NaN values. They avoid runtime's writer float normalization. Arbitrary native
NaN payload-bit preservation is not promised after conversion to JavaScript Number.
No fixed math arrays are allocated while writing a ball; capacity grows with data.

## Layout

The header is uint8 DESTINYPACKETS followed by int32 currentTime. It has no
version, ball count, record lengths, alignment padding or terminator. The exported
DESTINYPACKETS and BALLFLAGS objects preserve the native enums.

| Condition | Fields in order |
|---|---|
| Every ball | int64 ID, uint8 mode, float32 radius, float64 position[3], uint8 flags |
| Except RIGID | float64 mass, int8 cloak, int64 harmonic, int32 corporation, int32 alliance |
| Free | float32 max velocity, float64 velocity[3], float32 agility, float32 speed fraction |
| Free with dynamic orientation enabled | float32 quaternion[4], max angular velocity, angular velocity[3], rotational agility |
| Every ball | int8 formation ID |

Mode payloads then follow:

| Mode | Fields |
|---|---|
| FOLLOW, ORBIT | int64 follow ID, float32 follow range |
| FORMATION | follow ID/range, int32 effect stamp |
| MISSILE | follow ID/range, int64 owner, int32 stamp, float64 goto[3] |
| GOTO | float64 goto[3] |
| WARP | goto[3], int32 stamp, float64 last collision, int64 follow-ID raw bits, int64 owner |
| MUSHROOM | float32 range, float64 goto.x, int32 stamp, int64 owner |
| TROLL | int32 stamp |
| STOP, FIELD, RIGID | No mode payload |

The global dynamic-orientation setting changes the free-ball layout by 36 bytes
without adding a marker. Producers and consumers must share that setting.
WARP follow-ID bytes are the stored range bit pattern, not an integer conversion
of the numerical range. Native integer narrowing is retained for timestamps,
formation IDs and affiliation IDs.

Mini sections follow in ball, capsule, box order. Each nonempty section has a
uint16 count, then records of 28, 52 or 96 bytes respectively: ball center/radius,
capsule endpoints/radius, or box corner/three local axes. Vectors are float64;
radii are float32. Descriptor IDs and parent IDs are omitted. Counts narrow to
uint16 before flags and traversal: 65536 entries serialize no section.

## Selection and native limitations

Full-state writing excludes IDs strictly below DSTLOCALBALLS. Bubble and cloak
filtering applies only on a master with an existing source ID: other bubbles
are excluded unless global, and cloaked balls are excluded except the source.
A missing source disables that filter. Selected-ball writing preserves list
order and duplicates, skips malformed/missing IDs, and includes local IDs.
Both omit moribund balls. Map insertion order replaces native dictionary traversal.

BOID and MINIBALL have no native serialization case. Their common prefix is
written, then the writer logs and returns before mini sections. This behavior
is preserved; such output is not claimed to be a restorable state packet.

## Restoration still to implement

The bounded scalar reader exists in the adapter, but Ballpark restoration is
not yet implemented. The native full-state wrapper clears only free/proximity
registries and bubbleInteractives when partial is zero; absent aggregate balls
remain. The client ticker supplies ClearAll separately when replacing a scene.
Packet type does not determine partial behavior.

The body reader assigns currentTime, creates balls through the oriented add
methods, applies streamed state directly, then resolves follow pointers in a
second pass. Missing targets change mode directly to GOTO. Existing AddBall's
Stop-on-replacement behavior differs from the donor and must be corrected or
explicitly resolved before claiming reader parity; it prematurely unlinks old
targets and can fail on duplicate follow records before fixup.

For partial==1, mini bytes are consumed without changing existing descriptors
or actual shapes. Otherwise fixed incoming balls remove old shapes in reverse
descriptor order and replace lists, while free incoming balls append descriptors.
Partial==2 preserves registries but still replaces fixed minis. Restoration
must not add SetBallFree, cloak, harmonic or movement-command side effects.
Native unchecked short reads require an explicit bounded-error adaptation.

## Evidence

Destiny baseline: 114e89fa584f0e1a81eb0a679aabf41af8870072.
Sources: destiny/src/IDstConstants.h:28-45;
destiny/src/Thunkers.cpp:2083-2257,2463-2509,2897-3377;
destiny/src/Ballpark.cpp:3303-3462;
destiny/python/destiny/net/client/_ticker.py:124-144.
The stream overwrite behavior was independently checked in Carbon Blue's
MemStream implementation. Nineteen writer/adapter tests cover native empty
headers, an independent literal rigid packet, every defined mode payload,
mini layouts/count wrapping, filtering, float values, owned buffers and nested
stream writes that must retain native stack snapshots.
The donor's five read/write round-trip fixtures remain reader work:
destiny/python/destiny/test/ballpark/test_stream_read_write.py:8-75.
See [port status](port-status.md) for the full remaining scope.
