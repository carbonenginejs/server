# Custom tube bounds

Status: Experimental
Scope: Game-specific sphere containment under destiny/custom
Audience: Track authors and simulation integrators
Summary: Authored and generated closed boundaries share one asset and continuous collision path.

`CjsTubeBounds` is an original game extension, not a native Destiny port.
It does not modify Ballpark, its settings, native collision response or renderer
resources. Import it from `@carbonenginejs/server/destiny/custom` after building.

## Generate or author

```js
import { CjsTubeBounds } from "@carbonenginejs/server/destiny/custom";

const sections = [0, 100, 200].map(z => ({
    center: [0, 0, z], right: [1, 0, 0], up: [0, 1, 0],
    halfWidth: 20, halfHeight: 10
}));
const asset = CjsTubeBounds.generate(sections);
const bounds = new CjsTubeBounds(asset);
const out = { position: [0, 0, 0], velocity: [0, 0, 0] };
bounds.MoveSphere([0, 0, 50], [40, 0, 30], 2, 1 / 60, out);
```

Generation sweeps a strictly convex counterclockwise 2D profile through explicit
orthonormal section frames. The default is a 16-sided unit circle scaled by each
section's half extents. This is a polygonal approximation, not an analytic ellipse:
its inscribed clearance is slightly smaller than the section extents. Ramps,
curves and banks need enough sections to describe the intended surface. There is
no visual-mesh inference, spline fitting, or automatic self-intersection repair.
Profile axes are right/up; right cross up points along section ordering.

Authored assets have this same JSON shape:

- `version: 1`, `units: "metres"`.
- `vertices`: finite `[x,y,z]` arrays, in common simulation coordinates.
- `triangles`: three vertex indices per face. Welded, closed, consistently wound
  manifold boundary; faces enclose the permitted space. A trough needs a ceiling.
- `guides`: `{a,b,upA,upB,neighbours}` segment records, optional for collision-only assets.
- `ports`: `{name,loop,faces,guide}` records, optional. Loop follows its cap's winding;
  `faces` identifies exactly the cap triangulation, and `guide` its adjacent segment.

Constructor admission checks finite data, triangles, edge manifoldness and cap
topology. It does **not** prove absence of overlapping/self-intersecting surfaces
or validate that a guide lies inside. Those remain authoring responsibilities.
Supply simple enclosing shells; correctly wound interior obstacle shells can be
authored but require author validation. Degenerate sections/faces are rejected.
The authored mesh is physics data, not an implicit CPU copy of a render resource.

## Join pieces

Place geometry and guides in a common coordinate space before joining. Baking
transforms belongs to the generator/exporter; ship radii remain metre values.

```js
const joined = CjsTubeBounds.join([pieceA, pieceB], [
    { a: [0, "exit"], b: [1, "entry"] }
]);
```

Opposite cap loops must match vertex for vertex, allowing a cyclic offset and
the supplied metre tolerance. Only matching port vertices are welded. Internal
caps disappear; unused caps remain walls. Guides gain explicit neighbour links.
No global proximity welding or nearest-track reassignment takes place. Matching
cross-sections with different tessellation must be reconciled by the authoring
tool. Join types and connector compatibility policy are future game rules.

`GetGuide(position, segment, out)` samples only the supplied segment, with a
clamped fraction and orthonormal `center`, `forward`, `up`, `right` outputs.
The caller tracks progress and chooses adjacent segments; a nearby overpass does
not become the current segment automatically. Strongly opposed up vectors need
additional authored sections. This provides a frame, not a banking controller.

## Movement contract

`MoveSphere(position, velocity, radius, dt, out, maxContacts = 8)` accepts metres,
metres/second and seconds. Position and velocity are copied before output writes.
Only linear motion is swept; integrate thrust separately at a fixed simulation
step and apply containment once at the chosen game-integration boundary. Do not
silently add another native Ballpark evolution or use SetBallVelocity per frame
without accounting for its orientation-snapping semantics.

The native `CjsDestinyTriangle.GetClosestPoint` and `CjsDestinyAABB` are reused.
The custom sweep tests faces, finite edges and vertices. It deliberately does
not reuse native `IntersectSphereTriangle`: its plane-intersection gate can miss
edge contact for plane-parallel movement. Native helpers remain unchanged.
Contact normals point toward the approaching sphere. Response removes inward
normal velocity, retaining tangential motion; bounce, friction and damage are
not implemented. The sphere is orientation-independent and conservative for long ships.

`out` owns `position` and `velocity` vectors and receives `contacts`,
`remainingTime`, and `status`:

- `complete`: the interval was consumed.
- `invalid-start`: outside, initially penetrating beyond tolerance, or unable
  to fit. Position/velocity remain unchanged; the whole interval is unspent.
- `contact-limit`: safe progress stops at a contact with unspent time. The
  caller must not apply the remaining movement unconstrained.

`ContainsSphere` checks solid angle and distance to every triangle. `SweepSphere`
is a lower-level query with an explicit displacement and `{normal,time,face}`
output; it does not validate starting containment. There is a linear triangle
scan with per-triangle native AABB rejection, no BVH yet. Query math uses retained
double-precision scratch; it is not a performance-qualified collision backend.
The default contact tolerance is 1e-6 metres; select one appropriate to authored
scale and distribute it as part of the simulation configuration.

## Client distribution and checks

`GetAsset()` returns an owned JSON copy. `GetHash()` returns SHA-256 over its
canonical JSON using Web Crypto. Generate/bake once and distribute these exact
values to clients; geometry and topology have the same identity regardless of
which machine loads them. Equivalent meshes with different indexing have
different hashes. Solver version, tolerances and tick configuration must also
match; an asset hash alone is not a guarantee of cross-engine determinism.
No network transport, cache or replay integration is introduced here.

Focused validation after `npm run build`:

```sh
node --test test/custom-tube-bounds.test.js
```

Cases cover radius clearance, high-speed wall sweeps, parallel edge/vertex hits,
sliding, corner contacts, invalid starts, budget exhaustion, joins, authored-data
round trips, banking frames and double-precision translated geometry.
