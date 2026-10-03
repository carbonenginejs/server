# Destiny global settings

Status: Evolving
Scope: Native configuration and supported orbit selection
Audience: Server and simulation maintainers
Summary: Apply Carbon's shared Destiny settings without implying support for unported algorithms.

Import `settings`, `CjsDestinySettingsConfiguration` and
`CjsDestinyGlobalSettings` from `@carbonenginejs/server/destiny`.
All parks and GlobalSettings instances in the same module instance share the
native globals. Applying settings copies values; it does not retain the supplied
configuration or attach a separate configuration to each park.

```js
import { settings } from "@carbonenginejs/server/destiny";

const config = settings.Get();
config.useNewOrbit = true;
settings.Apply(config);
// Existing and subsequently created parks now use the newer orbit algorithm.
// Restore defaults when this simulation run no longer owns the global choice.
settings.Reset();
```

`Get()` returns a fresh active snapshot. `GetDefault()` and construction of
`CjsDestinySettingsConfiguration` always return defaults, independent of active
settings. Mutating either snapshot has no effect until `Apply()`. `Reset()`
restores all five defaults. The C++ names `ApplyConfiguration`, `GetConfiguration`,
`GetDefaultConfiguration` and `ResetConfiguration` remain on the same owner;
the shorter names are the native Blue aliases. There is no `Configure` method.

| Field | Default | Current consumer support |
|---|---|---|
| `collisionMaxIterations` | `20n` | Stored/copied; iterative collision is unported. Zero and values below ten are accepted as in Carbon. |
| `useIterativeCollision` | `false` | Accepted by Apply; Evolve throws before movement when enabled. The legacy sphere/static-shape path works; iterative response remains unported. |
| `useDynamicalOrientation` | `false` | Selects heading/roll steering, dynamic thrust, staged angular evolution and client sampling for supported modes. |
| `disableDynamicalOrientationForMissiles` | `false` | Retains the native missile-only exception, not a global orientation disable. Missile movement itself is unported. |
| `useNewOrbit` | `false` | Selects the native new orbit dependency chain, including the physical-heading fallback. |

The existing AddBall API corresponds to C++ AddBall. The native Python wrapper's
different oriented-creation dispatch remains unported. Enabling orientation
does not silently switch this API to a different argument contract.

## Integer bindings and ownership

The iteration count models the Windows64 native unsigned-size_t binding with
BigInt storage. Safe integer Number inputs and booleans are accepted; negative,
unsafe, fractional and out-of-uint64 inputs are rejected. Carbon's recommendation
of at least ten iterations is not a validation rule. Other platform bindings
are not implied by this Windows64 boundary.

Flags accept booleans or signed-int32 Number/BigInt integers, with nonzero true.
They do not apply generic JavaScript truthiness to strings or containers.
The signed-int32 limit makes the Windows Python-long overflow boundary explicit;
it rejects overflow before mutation instead of propagating the donor's unchecked
Python error result. Integral JS Numbers cannot distinguish Python int from float.

Apply requires a constructed configuration or subclass, matching Carbon's interface
cast. An internal weak brand supplies that check without schema APIs. Apply reads
native backing fields, so overriding public getters does not change what is copied.
Use the public properties for mutation; direct backing-field writes bypass the
typed native-style boundary. Decorators record metadata without driving simulation.

The five native helpers are also available from
`@carbonenginejs/server/destiny/_util/settings`:
`is_dynamical_orientation_enabled`, `enable_dynamical_orientation`,
`disable_dynamical_orientation`, `reset_settings_to_default`, `enable_new_orbit`.
They read/copy/apply the same global values.

## Orbit behavior and validation

New orbit uses the native predicted target direction, orbital plane fallback,
exponential spiral and blended position/velocity thrust. Double-precision
intermediates, strict deadbands and native arithmetic association are retained.
The dynamical-heading fallback uses the current physical quaternion. Legacy orbit remains the
default and its existing trajectory fixtures are unchanged.

The native zero-speed, exact-radius case can store NaN goto coordinates while
returning zero thrust. This source quirk is retained and tested. The new-orbit
method's unused currentTime argument is also retained; fallback normals use
the park's counter.

Tests translate all six native configuration cases and all four new-orbit scenarios,
including approach from inside/outside and a moving target. Additional tests cover
snapshots, bindings, globals, alias metadata, unsupported execution, plane outputs,
thrust thresholds and nonfinite behavior. These are source/fixture checks; no native
binary was run. See [source correspondence](destiny-parity.md) and
[port status](port-status.md) for remaining obligations.
