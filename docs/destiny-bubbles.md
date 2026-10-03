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
does not call it. The server BubbleUpdater calculates deltas before acknowledgment,
once per currentTime; recipient batching remains unported.

## Server delta collection

`BubbleUpdater`, exported from `@carbonenginejs/server/destiny/net/server`,
collects user IDs from bubbleInteractives, then calls AdditionsAndDeletions with
four output Maps. Ball IDs are BigInts and bubble IDs are Numbers. The per-player
Maps contain either explicit lists or a numeric bubble ID indexing the shared
per-bubble Maps. A player who stays in a tracked bubble normally receives that
shared ID. Moving players receive explicit lists calculated from both bubbles.

Tracking markers matter: presence with marker -1 still counts as membership in
the opposite bubble. New-bubble scans can include IDs missing from the aggregate
ball dictionary; same-bubble scans cannot add them. Existing global removals
survive same/old-bubble filtering but are excluded from the new-bubble scan.
Cloaked entries are excluded, and only IDs strictly below DSTLOCALBALLS are local
minis. Interactive-map key existence enables prebuilding even for an empty set.

The controller mutates caller-owned output Maps and updates each existing user's
old bubble immediately. Duplicate user IDs are processed repeatedly, potentially
replacing an earlier explicit result with a shared ID. After processing, it sends
DoBubbleTransitions through the PyOS host, including an empty batch. Transition
tuples retain the previous IDs; trolls are excluded from these tuples only.

BubbleUpdater replaces its output Maps when processing a new tick. Calls within
the same tick preserve the previous outputs and their identities. Failed
calculation leaves that tick unacknowledged. GetRemoteFollowers supplies the
sorted free-ball IDs whose FOLLOW/ORBIT/MISSILE/FORMATION target is missing or in
another bubble; it neither stops the balls nor filters out moribund followers.

JavaScript adaptations are explicit: malformed IDs throw immediately rather than
leaving a pending Python error; JS retains aliased output lists where native
reference counting can leave dangling pointers. Cross-domain output aliases keep
Number and BigInt keys distinct, unlike Python integer keys. These alias cases
are not native parity guarantees. Use four distinct output Maps in ordinary use.
No Blue schema machinery or runtime changes are required.

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
[Warp movement](destiny-warp.md) uses this activity exemption during alignment and travel.

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
suite has 321 tests, including subsequent ownership and legacy collision fixtures.
These are donor/source-derived JS checks, not native-executable bubble evidence.

Proximity notifications now use bubble activity and the native final populated
scan in dead bubbles; see [proximity integration](destiny-proximity.md).
Conflict resolution and server ticker/batch orchestration remain open.
AdditionsAndDeletions, transition batches, BubbleUpdater and the
[client ticker](destiny-client-ticker.md) are implemented.
The native conflict-resolution call in OnTick is commented out; the port does
not invent an automatic replacement. Legacy/iterative collision response and static ownership work; [Mini ownership](destiny-minis.md) is now implemented.

Source baseline: `114e89fa584f0e1a81eb0a679aabf41af8870072`.
Native definitions: Ballpark.h:60,124-129,150; Ballpark.cpp:86-150,417-660,
3115-3207,5872-5890,5959-6002,6154-6277,6337-6618,6745-6804;
Thunkers.cpp:1123-1142,2011-2031; Ball_Blue.cpp:415-433.

The delta/updater checkpoint adds 34 tests, bringing the complete suite to 843.
It includes all 16 donor lifecycle-transition, remote-follower and BubbleUpdater
cases, plus marker/filter/error/alias and movement integration regressions.
Position-property writes now notify the attached park, as native Ball::OnModified
does; core position initialization writes backing storage directly. The isolated
InsertInBoxes fixture also writes backing storage to test that method alone.
Other unported property-notification branches remain listed in the port status.

Additional evidence: destiny/src/Thunkers.cpp:1193-1240,2509-2895;
destiny/src/Ballpark.cpp:68,4738-4764,6009-6057;
destiny/src/Ball.cpp:1506-1537; destiny/src/Ball_Blue.cpp:155-183;
destiny/python/destiny/net/server/_bubbleupdater.py:6-54.
