# Destiny relative motion and accuracy

Status: Evolving
Scope: Ball and ClientBall relative velocities and Ballpark accuracy
Audience: Simulation hosts and port maintainers
Summary: Output ownership, sample timing, precision and native formula boundaries.

## Relative velocities

Ball and ClientBall expose CalculateRelativeVelocities(target, calcRelative,
calcRadial, calcTransversal, calcAngular, out). The caller supplies a record with
a retained float64 relVel vector and scalar radVel, shortDist, transVel and angVel
fields. This replaces Carbon's reference parameters and returns the same record.
The server-owned vec3d factory in destiny/math/vec3d.js supplies float64 storage;
runtime's float32 factory is not a substitute for relVel.

Each flag implies the earlier calculations: angular implies transversal, which
implies radial, which implies relative. A null target or all-false flags leave
everything unchanged. Coincident centers update only relVel. Unrequested fields
remain untouched. Surface distance is clamped to zero; radial velocity is signed.
With dynamic orientation enabled, angular speed subtracts source spin from
transversal motion. The reported transVel remains the uncompensated speed.

Ball reads committed mNewPos, mNewVel and mNewAngVel. ClientBall first samples
source velocity and then target velocity at one time: the maximum of source
old, position-update and rotation-update times and target position-update time,
plus two tick intervals. Target old and rotation-update times do not participate.
Time uses elapsed 100 ns ticks on the scene's Blue-start epoch.

Client velocity samples and their subtraction are float32 before relVel widens
to float64. Distances use cached absolute mLastPos after both samples, without
float32 reference subtraction. Dynamic angular calculations then sample source
rotation and use mLastAngVel, retaining the radial/transversal locals computed
before that sample. Pooled vec3/quat temporaries survive nested sampling and are
returned in finally, including exceptions. No shared class scratch spans sampling.

The two-tick offset widens to BigInt, matching GetShiftedTime. Native int32
offset arithmetic overflows for tick intervals above 107374 ms; that undefined
behavior is not reproduced. Final sample-time overflow outside signed int64
throws before either curve is sampled.

## Accuracy

GetAccuracy(srcID, dstID, optimalRange, falloff, trackingSpeed, signatureRadius,
optimalSignatureRadius) accepts seven scalar arguments and returns the native
Python result list: [accuracy, outputRange, outputTrackingSpeed]. PyGetAccuracy
exposes the same wrapper. All seven arguments are required. Scalar parameters
accept Number, Boolean or BigInt, rejecting integer-to-double overflow and
string coercion. Arbitrary Python numeric objects are not represented. Successful output
range is clamped surface distance; output tracking is angular speed from the
committed position and velocity states, without client interpolation or spin
compensation.

For the native core form, pass {value} records at the optimalRange and
trackingSpeed positions. This returns numeric accuracy and updates those
records in that order. Aliasing the records leaves the tracking write last.
Same/missing IDs, negative optimal range, zero tracking/signature/falloff and
coincident centers return zero without modifying either reference. Other
negative nonzero parameters are not rejected.

The donor computes angular speed squared by subtracting radial-speed squared
from relative-speed squared. Roundoff can make that negative: returned tracking
then becomes NaN, and accuracy can exceed one. The port preserves this formula
without clamping or substituting a cross-product calculation.

## Evidence and remaining work

Baseline: 114e89fa584f0e1a81eb0a679aabf41af8870072.
Sources: destiny/src/Ball.cpp:161-222,1118-1191,1318-1325;
destiny/src/Ball.h:365-375,469-481; destiny/src/Ballpark.cpp:5156-5217;
destiny/src/Thunkers.cpp:2044-2076; destiny/src/Ballpark_Blue.cpp:549-555.
Tests include all seven accuracy fixtures from
destiny/python/destiny/test/ballpark/test_getters_and_setters.py:168-279,
independent relative-motion examples, real cached-curve sampling, float precision,
dirty pools, nested calls, exceptions, time overflow and reference aliasing.
Runtime remains unchanged. Interfaces, streams, network batches and replay are
still tracked in [port status](port-status.md).
