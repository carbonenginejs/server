import { meta } from "@carbonenginejs/runtime/schema";
import { vec3 } from "@carbonenginejs/runtime/math/vec3";
import { vec3d } from "../math/vec3d.js";
import { CjsDestinyTriangle } from "../geometry/CjsDestinyTriangle.js";
import { CjsDestinyAABB } from "../geometry/CjsDestinyAABB.js";

/** Checks geometry at the authored-data boundary. */
function requireValue(condition, message)
{
    if (!condition) throw new RangeError(message);
}

/** Copies a finite tuple without narrowing to float32. */
function vector(value, length = 3)
{
    checkVector(value, length);
    return Array.from(value);
}

/** Validates a coordinate without allocating query-time copies. */
function checkVector(value, length = 3)
{
    requireValue(value?.length === length, "Expected a coordinate tuple.");
    for (let i = 0; i < length; i++) requireValue(Number.isFinite(value[i]), "Expected finite coordinates.");
}

/** Finds the first approaching root of a squared-distance equation. */
function firstRoot(a, b, c)
{
    if (c <= 0) return 0;
    if (a <= 0 || b >= 0) return Infinity;
    const discriminant = b * b - 4 * a * c;
    if (discriminant < 0) return Infinity;
    // The alternative quadratic expression avoids cancellation at near contact.
    return 2 * c / (-b + Math.sqrt(discriminant));
}

/**
 * Game-specific enclosed track boundary, independent of native Ballpark evolution.
 * This is an extension, not a Carbon class or a replacement for its collision solvers.
 */
@meta.define({ className: "CjsTubeBounds" })
export class CjsTubeBounds
{
    _asset = null;
    _faces = [];
    tolerance = 1e-6;

    /**
     * Validates and copies a version-1 metre-based closed triangle boundary.
     * Authored surfaces must be non-self-intersecting; topology checks cannot prove that.
     * @param {Object} asset Plain data from generate, join, or an authoring exporter.
     * @param {number} tolerance Contact tolerance in metres.
     */
    constructor(asset, tolerance = 1e-6)
    {
        requireValue(Number.isFinite(tolerance) && tolerance > 0, "Tolerance must be positive.");
        requireValue(asset.version === 1 && asset.units === "metres", "Unsupported tube asset version or units.");
        this.tolerance = tolerance;
        const vertices = asset.vertices.map(value => vector(value));
        const triangles = asset.triangles.map(value => vector(value));
        requireValue(vertices.length >= 4 && triangles.length >= 4, "A closed boundary needs vertices and faces.");
        const edges = new Map();
        for (const indices of triangles)
        {
            requireValue(indices.every(index => Number.isSafeInteger(index) && index >= 0 && index < vertices.length), "Invalid triangle index.");
            const [a, b, c] = indices.map(index => vertices[index]);
            const triangle = new CjsDestinyTriangle(a, b, c);
            const normal = vec3d.create();
            triangle.GetNormal(normal);
            requireValue(Math.hypot(...normal) > 0.99, "Degenerate triangle.");
            const bounds = new CjsDestinyAABB(a, a);
            bounds.Update(b); bounds.Update(c);
            this._faces.push({ triangle, normal, bounds });
            for (let side = 0; side < 3; side++)
            {
                const from = indices[side], to = indices[(side + 1) % 3];
                const key = `${Math.min(from, to)}:${Math.max(from, to)}`;
                const edge = edges.get(key) ?? { count: 0, direction: 0 };
                edge.count++; edge.direction += from < to ? 1 : -1;
                edges.set(key, edge);
            }
        }
        requireValue(Array.from(edges.values()).every(edge => edge.count === 2 && edge.direction === 0),
            "Boundary must be closed, manifold and consistently wound; weld shared vertices before import.");
        const guides = (asset.guides ?? []).map(guide => ({ a: vector(guide.a), b: vector(guide.b),
            upA: vector(guide.upA), upB: vector(guide.upB), neighbours: Array.from(guide.neighbours) }));
        for (const guide of guides)
        {
            requireValue(vec3.distance(guide.a, guide.b) > tolerance, "Guide segment has no length.");
            requireValue(guide.neighbours.every(index => Number.isSafeInteger(index) && index >= 0 && index < guides.length), "Invalid guide neighbour.");
            for (const up of [guide.upA, guide.upB])
            {
                const direction = guide.b.map((value, axis) => value - guide.a[axis]);
                const cross = vec3d.create(); vec3.cross(cross, direction, up);
                requireValue(Math.hypot(...cross) > tolerance, "Guide up must not be zero or parallel to travel.");
            }
        }
        const names = new Set(), portFaces = new Set();
        const ports = (asset.ports ?? []).map(port =>
        {
            requireValue(typeof port.name === "string" && port.name.length > 0 && !names.has(port.name), "Port names must be unique.");
            names.add(port.name);
            const loop = Array.from(port.loop), faces = Array.from(port.faces);
            requireValue(loop.length >= 3 && new Set(loop).size === loop.length && loop.every(index => Number.isSafeInteger(index) && index >= 0 && index < vertices.length), "Invalid port loop.");
            requireValue(faces.length === loop.length - 2 && faces.every(index => Number.isSafeInteger(index) && index >= 0 && index < triangles.length && !portFaces.has(index)), "Invalid or reused port faces.");
            const boundary = new Set();
            for (const index of faces)
            {
                portFaces.add(index);
                const triangle = triangles[index];
                requireValue(triangle.every(vertex => loop.includes(vertex)), "Port cap contains vertices outside its loop.");
                for (let side = 0; side < 3; side++)
                {
                    const from = triangle[side], to = triangle[(side + 1) % 3];
                    if (!boundary.delete(`${to}:${from}`)) boundary.add(`${from}:${to}`);
                }
            }
            requireValue(boundary.size === loop.length && loop.every((from, index) => boundary.has(`${from}:${loop[(index + 1) % loop.length]}`)), "Port loop must follow its cap winding.");
            requireValue(Number.isSafeInteger(port.guide) && port.guide >= 0 && port.guide < guides.length, "Port requires a guide segment.");
            return { name: port.name, loop, faces, guide: port.guide };
        });
        this._asset = { version: 1, units: "metres", vertices, triangles, guides, ports };
    }

    /**
     * Builds a closed tube from explicit banked sections and a convex CCW profile.
     * Sections use metre half-width/half-height and orthonormal right/up axes.
     * @param {Object[]} sections Ordered {center,right,up,halfWidth,halfHeight} records.
     * @param {number[][]} profile CCW 2D outline; defaults to a 16-sided unit circle.
     * @returns {Object} Plain versioned collision asset, including capped entry/exit ports.
     */
    @meta.ours
    static generate(sections, profile = Array.from({ length: 16 }, (_, i) => [Math.cos(i * Math.PI / 8), Math.sin(i * Math.PI / 8)]))
    {
        requireValue(sections.length >= 2 && profile.length >= 3, "Need at least two sections and three profile vertices.");
        profile = profile.map(value => vector(value, 2));
        for (let i = 0; i < profile.length; i++)
        {
            const a = profile[i], b = profile[(i + 1) % profile.length];
            for (let j = 0; j < profile.length; j++)
            {
                if (j === i || j === (i + 1) % profile.length) continue;
                const c = profile[j];
                requireValue((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) > 0, "Profile must be strictly convex and counterclockwise.");
            }
        }
        const vertices = [], triangles = [], guides = [], ports = [], count = profile.length;
        const rings = sections.map(section =>
        {
            const center = vector(section.center), right = vector(section.right), up = vector(section.up);
            requireValue(Math.abs(vec3.length(right) - 1) < 1e-6 && Math.abs(vec3.length(up) - 1) < 1e-6 && Math.abs(vec3.dot(right, up)) < 1e-6, "Section axes must be orthonormal.");
            requireValue(Number.isFinite(section.halfWidth) && section.halfWidth > 0 && Number.isFinite(section.halfHeight) && section.halfHeight > 0, "Section extents must be positive.");
            for (const [x, y] of profile) vertices.push(center.map((value, axis) => value + right[axis] * x * section.halfWidth + up[axis] * y * section.halfHeight));
            return { center, right, up };
        });
        for (let ring = 0; ring < rings.length - 1; ring++)
        {
            const a = rings[ring], b = rings[ring + 1], forward = vec3d.create(), delta = vec3d.create();
            vec3.cross(forward, a.right, a.up); vec3.subtract(delta, b.center, a.center);
            requireValue(vec3.dot(forward, delta) > 0, "Section ordering must follow right cross up.");
            vec3.cross(forward, b.right, b.up);
            requireValue(vec3.dot(forward, delta) > 0, "Section turns must be subdivided before reversing a frame.");
            for (let side = 0; side < count; side++)
            {
                const i = ring * count + side, j = ring * count + (side + 1) % count;
                triangles.push([i, j, j + count], [i, j + count, i + count]);
            }
            guides.push({ a: a.center, b: b.center, upA: a.up, upB: b.up,
                neighbours: [ring - 1, ring + 1].filter(index => index >= 0 && index < rings.length - 1) });
        }
        for (const end of [0, rings.length - 1])
        {
            const loop = Array.from({ length: count }, (_, i) => end * count + i);
            if (end === 0) loop.reverse();
            const faces = [];
            for (let i = 1; i < count - 1; i++)
            {
                faces.push(triangles.length); triangles.push([loop[0], loop[i], loop[i + 1]]);
            }
            ports.push({ name: end === 0 ? "entry" : "exit", loop, faces, guide: end === 0 ? 0 : guides.length - 1 });
        }
        return new CjsTubeBounds({ version: 1, units: "metres", vertices, triangles, guides, ports }).GetAsset();
    }

    /**
     * Joins already placed assets by matching opposite cap loops and welding only those loops.
     * Positions are baked by the caller in common simulation coordinates; no render matrices are read.
     * @param {Object[]} assets Versioned assets; unconnected end caps remain physical walls.
     * @param {Object[]} connections {a:[assetIndex,portName],b:[assetIndex,portName]} records.
     * @param {number} tolerance Maximum matching-vertex distance in metres.
     * @returns {Object} Closed asset with internal caps removed and guide adjacency connected.
     */
    @meta.ours
    static join(assets, connections, tolerance = 1e-6)
    {
        requireValue(Number.isFinite(tolerance) && tolerance > 0, "Join tolerance must be positive.");
        const vertices = [], triangles = [], guides = [], ports = [], maps = [];
        for (const value of assets)
        {
            const asset = new CjsTubeBounds(value).GetAsset();
            const vertexOffset = vertices.length, faceOffset = triangles.length, guideOffset = guides.length;
            for (const vertex of asset.vertices) vertices.push(vertex);
            for (const face of asset.triangles) triangles.push(face.map(index => index + vertexOffset));
            for (const guide of asset.guides) guides.push({ ...guide, neighbours: guide.neighbours.map(index => index + guideOffset) });
            const map = new Map();
            for (const port of asset.ports)
            {
                const mapped = { name: `${maps.length}:${port.name}`, loop: port.loop.map(index => index + vertexOffset),
                    faces: port.faces.map(index => index + faceOffset), guide: port.guide + guideOffset };
                map.set(port.name, mapped); ports.push(mapped);
            }
            maps.push(map);
        }
        const parent = vertices.map((_, i) => i), removed = new Set(), used = new Set();
        const root = index =>
        {
            while (parent[index] !== index) index = parent[index];
            return index;
        };
        for (const connection of connections)
        {
            const a = maps[connection.a[0]]?.get(connection.a[1]), b = maps[connection.b[0]]?.get(connection.b[1]);
            requireValue(a && b && a !== b && !used.has(a) && !used.has(b), "Unknown or reused join port.");
            requireValue(a.loop.length === b.loop.length, "Join profiles have different vertex counts.");
            const count = a.loop.length;
            let offset = -1;
            for (let candidate = 0; candidate < count; candidate++)
            {
                if (a.loop.every((index, i) => vec3.distance(vertices[index], vertices[b.loop[(candidate - i + count) % count]]) <= tolerance))
                {
                    offset = candidate;
                    break;
                }
            }
            requireValue(offset !== -1, "Join profiles must coincide with opposite winding.");
            for (let i = 0; i < count; i++) parent[root(b.loop[(offset - i + count) % count])] = root(a.loop[i]);
            for (const face of a.faces) removed.add(face);
            for (const face of b.faces) removed.add(face);
            guides[a.guide].neighbours.push(b.guide); guides[b.guide].neighbours.push(a.guide);
            used.add(a); used.add(b);
        }
        const compact = [], indices = new Map(), faces = [], faceMap = new Map();
        for (let i = 0; i < triangles.length; i++)
        {
            if (removed.has(i)) continue;
            faceMap.set(i, faces.length);
            faces.push(triangles[i].map(index =>
            {
                const canonical = root(index);
                if (!indices.has(canonical))
                {
                    indices.set(canonical, compact.length);
                    compact.push(vertices[canonical]);
                }
                return indices.get(canonical);
            }));
        }
        return new CjsTubeBounds({ version: 1, units: "metres", vertices: compact, triangles: faces, guides,
            ports: ports.filter(port => !used.has(port)).map(port => ({ ...port,
                loop: port.loop.map(index => indices.get(root(index))), faces: port.faces.map(index => faceMap.get(index)) })) }).GetAsset();
    }

    /** Returns an owned JSON-compatible canonical asset for server/client distribution. */
    @meta.ours
    GetAsset()
    {
        return JSON.parse(JSON.stringify(this._asset));
    }

    /** Returns the SHA-256 identity of the canonical asset, using browser/Node Web Crypto. */
    @meta.ours
    async GetHash()
    {
        const bytes = new TextEncoder().encode(JSON.stringify(this._asset));
        const hash = await globalThis.crypto.subtle.digest("SHA-256", bytes);
        return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("");
    }

    /**
     * Tests enclosed space and sphere clearance using solid angle and native closest points.
     * Cost is linear in faces; topology validity is checked when the asset is admitted.
     * @param {number[]} position Sphere centre in simulation metres.
     * @param {number} radius Nonnegative ship radius.
     * @returns {boolean} True when inside and no deeper than tolerance into a surface.
     */
    @meta.ours
    ContainsSphere(position, radius)
    {
        checkVector(position); requireValue(Number.isFinite(radius) && radius >= 0, "Radius must be nonnegative.");
        const { vec3_3, vec3_4, vec3_5, vec3_6 } = CjsTubeBounds.scratch;
        let angle = 0;
        for (const { triangle } of this._faces)
        {
            triangle.GetClosestPoint(vec3_3, position);
            const distance = vec3.distance(vec3_3, position);
            if (distance + this.tolerance < radius) return false;
            // A point exactly on a boundary is accepted only for the zero-radius query.
            if (distance <= this.tolerance && radius === 0) return true;
            vec3.subtract(vec3_3, triangle.a, position);
            vec3.subtract(vec3_4, triangle.b, position);
            vec3.subtract(vec3_5, triangle.c, position);
            const a = vec3.length(vec3_3), b = vec3.length(vec3_4), c = vec3.length(vec3_5);
            vec3.cross(vec3_6, vec3_4, vec3_5);
            angle += 2 * Math.atan2(vec3.dot(vec3_3, vec3_6), a * b * c +
                vec3.dot(vec3_3, vec3_4) * c + vec3.dot(vec3_4, vec3_5) * a + vec3.dot(vec3_5, vec3_3) * b);
        }
        return Math.abs(angle) > 2 * Math.PI;
    }

    /**
     * Sweeps against faces, finite edges and vertices; does not alter native sweep semantics.
     * @param {number[]} position Sphere start (must already fit inside for containment).
     * @param {number[]} displacement Complete proposed movement, not velocity per second.
     * @param {number} radius Positive sphere radius.
     * @param {Object} out Caller-owned {normal:[0,0,0],time,face}; time is a fraction in [0,1].
     * @returns {boolean} Whether movement approaches a boundary contact.
     */
    @meta.ours
    SweepSphere(position, displacement, radius, out)
    {
        checkVector(position); checkVector(displacement);
        requireValue(Number.isFinite(radius) && radius > 0, "Sweep radius must be positive.");
        const { vec3_6, vec3_7 } = CjsTubeBounds.scratch;
        vec3.add(vec3_7, position, displacement);
        out.time = 1; out.face = -1; vec3.zero(out.normal);
        const speed2 = vec3.squaredLength(displacement);
        if (speed2 === 0) return false;
        for (let face = 0; face < this._faces.length; face++)
        {
            const { triangle, normal, bounds } = this._faces[face];
            if (bounds.CanExcludeCollision(position, vec3_7, radius + this.tolerance)) continue;
            vec3.subtract(vec3_6, position, triangle.a);
            const height = vec3.dot(vec3_6, normal), approach = vec3.dot(displacement, normal);
            if (approach !== 0)
            {
                this._Consider((radius - height) / approach, face, position, displacement, radius, out, true);
                this._Consider((-radius - height) / approach, face, position, displacement, radius, out, true);
            }
            for (let edge = 0; edge < 3; edge++)
            {
                const a = edge === 0 ? triangle.a : edge === 1 ? triangle.b : triangle.c;
                const b = edge === 0 ? triangle.b : edge === 1 ? triangle.c : triangle.a;
                const ex = b[0] - a[0], ey = b[1] - a[1], ez = b[2] - a[2];
                const mx = position[0] - a[0], my = position[1] - a[1], mz = position[2] - a[2];
                const dd = ex * ex + ey * ey + ez * ez;
                const me = (mx * ex + my * ey + mz * ez) / dd;
                const de = (displacement[0] * ex + displacement[1] * ey + displacement[2] * ez) / dd;
                const px = mx - me * ex, py = my - me * ey, pz = mz - me * ez;
                const dx = displacement[0] - de * ex, dy = displacement[1] - de * ey, dz = displacement[2] - de * ez;
                const time = firstRoot(dx * dx + dy * dy + dz * dz, 2 * (px * dx + py * dy + pz * dz), px * px + py * py + pz * pz - radius * radius);
                const along = me + de * time;
                if (along >= 0 && along <= 1) this._Consider(time, face, position, displacement, radius, out);
                this._Consider(firstRoot(speed2, 2 * (mx * displacement[0] + my * displacement[1] + mz * displacement[2]),
                    mx * mx + my * my + mz * mz - radius * radius), face, position, displacement, radius, out);
            }
        }
        return out.face !== -1;
    }

    /** Validates a candidate against the actual finite triangle, including edges. */
    @meta.ours
    _Consider(time, face, position, displacement, radius, out, faceContact = false)
    {
        if (!Number.isFinite(time) || time > out.time || time * vec3.length(displacement) < -this.tolerance) return;
        // A preceding contact can round a few ulps into its plane. Retain it at
        // time zero instead of losing that wall during the following slide.
        time = Math.max(0, time);
        const { vec3_3, vec3_4, vec3_5 } = CjsTubeBounds.scratch;
        vec3.scaleAndAdd(vec3_3, position, displacement, time);
        this._faces[face].triangle.GetClosestPoint(vec3_4, vec3_3);
        vec3.subtract(vec3_5, vec3_3, vec3_4);
        const distance = vec3.length(vec3_5);
        if (Math.abs(distance - radius) > this.tolerance * 4 || distance === 0) return;
        vec3.scale(vec3_5, vec3_5, 1 / distance);
        if (faceContact)
        {
            // On a face, the plane normal is exact enough to avoid inventing
            // tangential velocity from closest-point subtraction roundoff.
            const normal = this._faces[face].normal;
            vec3.scale(vec3_5, normal, vec3.dot(normal, vec3_5) < 0 ? -1 : 1);
        }
        if (vec3.dot(displacement, vec3_5) >= 0) return;
        out.time = time; out.face = face; vec3.copy(out.normal, vec3_5);
    }

    /**
     * Slides a sphere through a fixed interval, preserving tangential velocity.
     * @param {number[]} position Valid starting centre; not mutated.
     * @param {number[]} velocity Metres per second; not mutated.
     * @param {number} radius Positive ship radius.
     * @param {number} dt Seconds, finite and nonnegative.
     * @param {Object} out Caller-owned {position,velocity}; receives remainingTime, contacts and status.
     * @param {number} maxContacts Positive integer solver budget.
     * @returns {Object} Output; status is complete, invalid-start or contact-limit.
     */
    @meta.ours
    MoveSphere(position, velocity, radius, dt, out, maxContacts = 8)
    {
        checkVector(position); checkVector(velocity);
        requireValue(Number.isFinite(dt) && dt >= 0 && Number.isFinite(radius) && radius > 0 && Number.isSafeInteger(maxContacts) && maxContacts > 0, "Invalid movement interval, radius or budget.");
        const { vec3_0, vec3_1, vec3_2, hit } = CjsTubeBounds.scratch;
        vec3.copy(vec3_0, position); vec3.copy(vec3_1, velocity);
        let remaining = dt, contacts = 0, status = "complete";
        if (!this.ContainsSphere(position, radius)) status = "invalid-start";
        else
        {
            while (remaining > 0 && contacts < maxContacts)
            {
                vec3.scale(vec3_2, vec3_1, remaining);
                if (!this.SweepSphere(vec3_0, vec3_2, radius, hit))
                {
                    vec3.add(vec3_0, vec3_0, vec3_2);
                    remaining = 0;
                    break;
                }
                vec3.scaleAndAdd(vec3_0, vec3_0, vec3_2, hit.time);
                remaining *= 1 - hit.time;
                const intoWall = vec3.dot(vec3_1, hit.normal);
                vec3.scaleAndAdd(vec3_1, vec3_1, hit.normal, -intoWall);
                contacts++;
            }
            if (remaining > 0) status = "contact-limit";
        }
        vec3.copy(out.position, vec3_0); vec3.copy(out.velocity, vec3_1);
        out.remainingTime = remaining; out.contacts = contacts; out.status = status;
        return out;
    }

    /**
     * Samples a caller-selected guide segment; never jumps to a nearby overlapping track.
     * @param {number[]} position Query position.
     * @param {number} segment Segment index; caller follows the asset's explicit neighbours.
     * @param {Object} out Owned {center,forward,up,right} vectors; receives fraction.
     * @returns {Object} Orthonormal track frame with clamped longitudinal fraction.
     */
    @meta.ours
    GetGuide(position, segment, out)
    {
        const guide = this._asset.guides[segment];
        requireValue(guide !== undefined, "Unknown guide segment.");
        vec3.subtract(out.forward, guide.b, guide.a);
        const length2 = vec3.squaredLength(out.forward);
        const fraction = Math.max(0, Math.min(1, ((position[0] - guide.a[0]) * out.forward[0] +
            (position[1] - guide.a[1]) * out.forward[1] + (position[2] - guide.a[2]) * out.forward[2]) / length2));
        vec3.scaleAndAdd(out.center, guide.a, out.forward, fraction);
        vec3.scale(out.forward, out.forward, 1 / Math.sqrt(length2));
        vec3.lerp(out.up, guide.upA, guide.upB, fraction);
        vec3.cross(out.right, out.up, out.forward);
        requireValue(vec3.length(out.right) > this.tolerance, "Subdivide an antipodal guide-up transition.");
        vec3.normalize(out.right, out.right); vec3.cross(out.up, out.forward, out.right);
        out.fraction = fraction;
        return out;
    }

    static scratch = {
        vec3_0: vec3d.create(), vec3_1: vec3d.create(), vec3_2: vec3d.create(), vec3_3: vec3d.create(),
        vec3_4: vec3d.create(), vec3_5: vec3d.create(), vec3_6: vec3d.create(), vec3_7: vec3d.create(),
        hit: { normal: vec3d.create(), time: 0, face: -1 }
    };
}
