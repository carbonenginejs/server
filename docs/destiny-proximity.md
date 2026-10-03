# Destiny proximity event integration

Status: Evolving
Scope: Ball sensors and Ballpark tick integration
Audience: Simulation hosts and port maintainers
Summary: How proximity state, spatial candidates and host events interact.

## Using proximity events

Configure an existing ball with AddProximitySensor, SetNotificationRange or
SetTargetTracking on CjsBallparkController. Supply the park's native-shaped
PyOS bridge to receive DoProximity, DoRange and DoTargetTracking through
SendEvent; failed delivery calls PyError. Method JSDoc owns argument and unit
details. These are simulation events; transport and gameplay responses belong
to the host.

Evolve checks registered balls after motion commits and troll petrification,
before incrementing currentTime. Each ball checks destination range, target
tracking and then its active sensor. Destination/tracking boundaries are strict;
periodic sensors include their distance boundary. Ordinary sensors exclude fixed
balls through Partition; cloaked and onlyInteractives paths retain their native
filter differences.

The park snapshots registrations before callbacks. Additions wait until the next
pass, while existing entries retain native moribund and dead-bubble checks.
Dead bubbles with remembered contacts receive a forced check, then clear contacts.
Sensor scans restore their temporary radius and zeroed velocity before delivery.
Owned candidate arrays allow nested callbacks without shared scratch corruption.

## Native quirks and JavaScript adaptations

Reconfiguring without shuffle retains elapsed time; scans discard period overshoot.
Removing a sensor disables it without clearing contacts. Cancelling target
tracking clears its pointer/range but leaves registration and the previous within
flag until another registration update. Removing a target does not clear other
balls' retained tracking pointers or contacts.

A callback disabling a sensor during vanished-contact processing can still be
followed by one eligible candidate event. Notification callbacks do not introduce
an extra moribund check before tracking. These source behaviors are preserved.

JavaScript Map iteration uses insertion order instead of native unordered order.
Ball.floatrand uses Math.random instead of CRT rand/RAND_MAX, so shuffle sequences
and endpoint distribution differ. Tests can replace this helper. Strong references
replace native locking; local event-host references survive callback detachment.
Exceptions propagate, with temporary geometry and the evolution guard restored
in finally. No class scratch remains live across host callbacks.

## Scope and evidence

The source baseline is 114e89fa584f0e1a81eb0a679aabf41af8870072. Sensor state and
checks come from destiny/src/Ball.h:31-40 and
destiny/src/Ball.cpp:244-288,494-775. Registration, commands, cleanup and tick
ordering come from destiny/src/Ballpark.cpp:641-655,5026-5068,5120-5150,5576-5579,5822-5867,5947.
Candidate filters come from destiny/src/Partition.cpp:283-295,427-455.
The 17 callback scenarios in destiny/python/destiny/test/ballpark/test_callbacks.py:7-183
are translated alongside numeric and callback-lifetime cases in proximity.test.js.

Cloak/uncloak commands, general spatial queries, relative-motion calculations and
network replication remain unfinished. See [port status](port-status.md) for the
full boundary and [warp](destiny-warp.md) for existing sensor activity transitions.
