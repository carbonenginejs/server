# Destiny special movement modes

Status: Evolving
Scope: Mushroom, troll, rigid, field, boid and MiniBall mode dispatch
Audience: Simulation and gameplay integrators
Summary: Use the donor's special lifecycle and collision-affiliation controls.

## Mushroom growth

`AddMushroom(ownerId, range, time)` creates a massive, fixed ball at the owner's
position. Range is float32 meters; time is double seconds. Nonpositive arguments
and missing owners cancel creation. The owner lookup uses the exact signed ID.
The native creation request is ID zero: replicas reuse zero, while masters
allocate local IDs. Dynamic creation retains its existing double-ID consumption.
The method returns no value. `PyAddMushroom` enforces three required arguments.

Set the created ball free with `SetBallFree` to enable growth. Each active tick
integrates first, then updates timestamps and its fourth-root growth radius.
Growth reinserts spatial membership but skips position, velocity and orientation
sample commits. At fraction one or an unordered NaN fraction it queues removal,
retaining the previous radius. Fixed mushrooms never grow. Legacy collision
excludes the mushroom when its owner queries neighbors. The iterative free-pair
filter is asymmetric: a lower-ID mushroom querying its owner can still produce
an owner contact and separation. No new bilateral exclusion is added.
With a replica mushroom at zero, owner one and neighbor two, subsequent separating
owner contacts retain default collider zero. Repeated earliest hits can then
consume the iteration cap before the neighbor is processed.
NaN range/time pass the donor's
nonpositive guards. Existing creation scalar checks still apply to owner position.

For range 10 and time 5, six one-second ticks produce radii
`0, 6.687403202056885, 7.952707290649414, 8.801117897033691,
9.457415580749512, 9.457415580749512`; the last tick marks it moribund.
The float32 intermediate power is observable and retained.

## Troll and rigid state

`SetBallTroll(id, delay)` stops the old command, makes the ball free and
interactive, stores `currentTime + max(delay, 1)`, then enters TROLL mode.
Velocity is retained. Delay is a tick count, not seconds. Evolve collects ready
troll references before sample commits, finishes all commits and missile events,
then calls `PetrifyTroll`, which rechecks readiness. Later callbacks can therefore
cancel or postpone the pending transition.

Petrification makes the ball fixed, zeroes velocity through SetBallFree, disables
interaction and selects RIGID. The native header's STOP description disagrees
with its implementation. Direct `SetBallRigid(id)` only stops the old command
and selects RIGID; it does not change freedom, velocity or interaction.
`PySetBallTroll` and `PySetBallRigid` enforce their two/one required arguments.

SetBallFree invokes ordinary Mini creation/cleanup. Native insertion during
Evolve skips aggregate map registration: a MiniBall created by petrification has
spatial membership but is absent from the ball map. This quirk is preserved;
no additional registration or native reference-count lifetime is simulated.

## Field affiliation and passive modes

`SetBallHarmonic(id, harmonic, corporationID, allianceID, field)` stores all three
affiliations before callbacks. True stops the old command and enters FIELD.
False stops an existing FIELD, leaving other modes unchanged. Harmonic uses
signed-int64 BigInt; corporation/alliance use checked signed-int32 Numbers.
The five-argument `PySetBallHarmonic` converts its integer field flag to boolean.

Ball properties `harmonic`, `corporationID` and `allianceID` store first, then
notify the attached park with field=false. Even an unchanged assignment stops a
FIELD ball. Detached balls store silently. Controller writes use backing fields
to avoid recursively issuing property notifications.

`SetBoid(id, turnOn)` aliases `PySetBoid`. Enabling selects BOID directly without
Stop; disabling stops it. Native stale follower links therefore survive enabling
from a follow mode. There is no flocking algorithm in this donor's dispatcher.
BOID, FIELD, RIGID, MINIBALL, TROLL and MUSHROOM receive zero intrinsic steering
and the common drag/collision/angular processing while free. Their explicit
lifecycle branches are described above. Unknown numeric modes still throw as a
documented JS admission check; all thirteen native enum values are admitted.

`Actions.set_ball_troll` queues the delayed command. `Actions.set_ball_harmonic`
conditionally queues SetBallMassive before affiliation; the direct controller
method does not change massiveness. See [action queue](destiny-actions.md).

## Sources and remaining boundaries

At Destiny `114e89f`: `Ballpark.cpp:543-648,3719-3789,4852-4880,6278-6337`
defines lifecycle and commands; `791-900` defines common passive processing;
`3187-3204` guards map registration. Blue affiliation fields and notification
branches are `Ball_Blue.cpp:126-154` and `Ball.cpp:1617-1628`.
Python bindings are `Thunkers.cpp:306-325,510-547,952-975,1003-1028`.
Queue methods are `python/destiny/net/server/_actions.py:133-148,475-508`.

Tests translate the mushroom trajectory and special setter fixtures, then check
phase ordering, nested callbacks, Mini insertion, integer overflow and action
ordering. Signed arithmetic overflow throws instead of assigning meaning to
native undefined overflow. No native executable oracle ran. Stream persistence,
troll transition-list suppression during network export and
the broader AddBall replacement/notification audit remain separate unfinished work.
