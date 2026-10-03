# Destiny spatial and bubble lifecycle

Status: Evolving
Scope: Automatic Ball membership, causal regions and native activity tracking
Audience: Simulation maintainers
Summary: Native insertion and activity semantics, before network recipient batching.

AddBall, SetBallPosition, SetBallRadius, SetMaxSpeed and free-to-fixed transitions
maintain spatial membership. Evolve reinserts a committed ball only when its
displacement squared is at least 0.1. Velocity, mass, agility and throttle setters
do not directly reinsert. The native membership cache and inflated-radius rules
are described in the [partition guide](../destiny/partition/README.md).

Replica parks retain bubble -1 during ordinary insertion. Master parks use an
assigned top cell, then the first assigned neighboring cell, then a new signed
32-bit bubble ID. This does not merge neighboring regions every tick. Explicit
InitializeBubbles flood-fills connected top cells. InitializeBubbles(id) instead
uses the native single-ball proximity helper and updates only that ball's new ID.
GetBubbleAtCoordinates returns -1 for an existing unassigned cell and null for
an absent cell. Ball exposes read-only newBubbleId/oldBubbleId aliases.

## Tracking and activity

The Python dictionaries become Maps. Bubble IDs are Numbers and ball IDs are
BigInts. `bubbles` maps each bubble to a Map of IDs and action markers:

| Marker | Meaning |
|---|---|
| 1 | Added since the last acknowledgment |
| 0 | Established member |
| -1 | Removal pending acknowledgment |

CopyBubbles changes 1 to 0, removes -1 entries and then empty bubbles. Evolve
does not call it. Network recipient batching and its once-per-tick acknowledgment
workflow remain unported.

`bubbleInteractives` and `bubbleKeepAlives` map bubble IDs to ID Sets.
`bubbleKeepAliveBalls` is the global Set of IDs whose keep-alive membership follows
transitions. AddKeepAliveBall and RemoveKeepAliveBall update a particular bubble;
SetBallInteractive maintains interactive membership using native flag ordering.
ClearBubbles clears all four collections, including automatic keep-alive IDs,
while retaining the subscription map and bubble counter. ClearAll uses that
operation and clears spatial memberships and owned ball collections.

Replica balls always simulate. Master balls outside warp freeze in bubbles with
neither interactive nor keep-alive members. Position, velocity, forces, timestamps
and memberships stay unchanged for that tick; the park counter still advances.
Warp's activity exemption does not imply warp movement is implemented.

## Events and execution order

`bubbleSubs` exposes the mutable native subscription Map. Key presence enables a
subscription even when its value is false or zero. AddToBubble updates the new
bubble and sends DoBubbleAdd, then updates the old bubble and sends DoBubbleDel,
then updates activity/keep-alive sets. The existing injected PyOS host receives
the native `(iL)` arguments: bubble Number and ball BigInt. A false dispatch
result calls PyError. There is no new event bus.

Initial AddBall registration occurs after insertion callbacks. A callback can
therefore see no registered ball for the new ID. The free-ball map uses native
insert-if-absent semantics, including reentrant creation of the same ID.
Evolution traverses free balls in signed-ID order. Integration stages vector
results until each ball's commit so callbacks see the same phase boundary as
Carbon. A sorted BigInt key index now supplies live upper-bound lookup after each
yield. A complete traversal costs O(n log n); inserting/removing a key can shift
O(n) array entries. The Map owns Ball references, and the index stores only keys.
Only the controller's lifecycle methods mutate this internal collection.
Removal of the currently yielded node safely continues in JS, whereas it
invalidates the native iterator; that continuation is an explicit adaptation.

## Retained quirks and unfinished work

AddToBubble adds before removing, even when old and new bubble IDs are equal.
Consequently repeated initialization can erase a freshly rebuilt tracking entry
and its activity membership. Same-bubble AddBall replacement does not repair an
interactive set after directly replacing the flag. Use SetBallInteractive for
ordinary changes. The port preserves these behaviors rather than silently
repairing Carbon bookkeeping. Signed counter overflow is rejected because native
signed overflow has no defined result.

Sixteen bubble tests include both native initialization fixtures, the native
two-region distribution, activity changes, delta acknowledgment, callbacks,
reentrant registration and staged movement. Four additional ordered-iteration
tests cover wide signed IDs, live changes and lifecycle cleanup. The complete
suite has 270 tests.
These are donor/source-derived JS checks, not native-executable bubble evidence.

Conflict resolution, proximity notifications, static-shape Ballpark ownership,
AdditionsAndDeletions, transition batches and server/client tickers remain open.
The native conflict-resolution call in OnTick is commented out; the port does
not invent an automatic replacement. Collision response is still unported.

Source baseline: `114e89fa584f0e1a81eb0a679aabf41af8870072`.
Native definitions: Ballpark.h:60,124-129,150; Ballpark.cpp:86-150,417-660,
3115-3207,5872-5890,5959-6002,6154-6277,6337-6618,6745-6804;
Thunkers.cpp:1123-1142,2011-2031; Ball_Blue.cpp:415-433.
