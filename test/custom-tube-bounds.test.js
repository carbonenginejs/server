import test from "node:test";
import assert from "node:assert/strict";
import { CjsTubeBounds } from "../dist/destiny/custom/index.js";

const square = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
const section = (z, centerX = 0, angle = 0) => ({ center: [centerX, 0, z],
    right: [Math.cos(angle), Math.sin(angle), 0], up: [-Math.sin(angle), Math.cos(angle), 0], halfWidth: 10, halfHeight: 10 });
const asset = (start = 0, end = 100) => CjsTubeBounds.generate([section(start), section(end)], square);
const output = () => ({ position: [0, 0, 0], velocity: [0, 0, 0] });
const close = (actual, expected, epsilon = 1e-7) => assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`);

test("generated tube includes an invisible ceiling and accounts for ship radius", () =>
{
    const bounds = new CjsTubeBounds(asset());
    assert.equal(bounds.ContainsSphere([0, 0, 50], 9), true);
    assert.equal(bounds.ContainsSphere([0, 0, 50], 11), false);
    assert.equal(bounds.ContainsSphere([0, 9, 50], 1), true);
    assert.equal(bounds.ContainsSphere([0, 9.1, 50], 1), false);
    assert.equal(bounds.ContainsSphere([0, 20, 50], 1), false);
});

test("fast wall collision preserves tangential motion and has no tunnelling", () =>
{
    const bounds = new CjsTubeBounds(asset()), out = output();
    bounds.MoveSphere([0, 0, 50], [100000, 0, 20], 1, 1, out);
    assert.equal(out.status, "complete");
    close(out.position[0], 9); close(out.position[2], 70);
    close(out.velocity[0], 0); close(out.velocity[2], 20);
    assert.equal(bounds.ContainsSphere(out.position, 1), true);
});

test("two wall contacts slide into a corner without adding energy", () =>
{
    const bounds = new CjsTubeBounds(asset()), out = output();
    bounds.MoveSphere([0, 0, 50], [100, 100, 5], 1, 1, out);
    assert.equal(out.status, "complete");
    close(out.position[0], 9); close(out.position[1], 9); close(out.position[2], 55);
    close(Math.hypot(...out.velocity), 5);
});

test("touching a wall permits tangent movement and movement away", () =>
{
    const bounds = new CjsTubeBounds(asset()), out = output();
    bounds.MoveSphere([9, 0, 50], [0, 0, 5], 1, 1, out);
    assert.equal(out.status, "complete"); close(out.position[2], 55);
    bounds.MoveSphere([9, 0, 50], [-4, 0, 0], 1, 1, out);
    assert.equal(out.status, "complete"); close(out.position[0], 5);
});

test("parallel-plane edge and vertex contacts are detected", () =>
{
    const bounds = new CjsTubeBounds(asset()), hit = { normal: [0, 0, 0] };
    assert.equal(bounds.SweepSphere([-14, 12, 50], [8, 0, 0], 3, hit), true);
    close(hit.time, (4 - Math.sqrt(5)) / 8);
    assert.equal(bounds.SweepSphere([-14, 12, 102], [8, 0, 0], 3, hit), true);
    close(hit.time, 3 / 8);
    close(Math.hypot(...hit.normal), 1);
});

test("invalid starts are explicit and never teleported into another track", () =>
{
    const bounds = new CjsTubeBounds(asset()), out = output();
    bounds.MoveSphere([20, 0, 50], [-10, 0, 0], 1, 1, out);
    assert.equal(out.status, "invalid-start");
    assert.deepEqual(out.position, [20, 0, 50]); close(out.remainingTime, 1);
    bounds.MoveSphere([0, 0, 50], [1, 0, 0], 11, 1, out);
    assert.equal(out.status, "invalid-start");
});

test("contact budget exhaustion reports unspent time at a safe contact", () =>
{
    const bounds = new CjsTubeBounds(asset()), out = output();
    bounds.MoveSphere([0, 0, 50], [100, 100, 0], 1, 1, out, 1);
    assert.equal(out.status, "contact-limit"); assert.ok(out.remainingTime > 0);
    assert.equal(bounds.ContainsSphere(out.position, 1), true);
});

test("joined pieces remove internal caps and link guide segments", () =>
{
    const joined = CjsTubeBounds.join([asset(), asset(100, 200)], [{ a: [0, "exit"], b: [1, "entry"] }]);
    const bounds = new CjsTubeBounds(joined), out = output();
    assert.equal(joined.ports.length, 2);
    assert.deepEqual(joined.guides[0].neighbours, [1]);
    assert.deepEqual(joined.guides[1].neighbours, [0]);
    assert.equal(bounds.ContainsSphere([0, 0, 100], 9), true);
    bounds.MoveSphere([0, 0, 50], [0, 0, 100], 1, 1, out);
    assert.equal(out.status, "complete"); assert.equal(out.contacts, 0); close(out.position[2], 150);
    bounds.MoveSphere([0, 0, 50], [0, 0, 1000], 1, 1, out);
    close(out.position[2], 199);
});

test("unjoined caps stay solid and mismatched or reused joins fail", () =>
{
    const bounds = new CjsTubeBounds(asset()), out = output();
    bounds.MoveSphere([0, 0, 50], [0, 0, 100], 1, 1, out);
    close(out.position[2], 99);
    assert.throws(() => CjsTubeBounds.join([asset(), asset(101, 200)], [{ a: [0, "exit"], b: [1, "entry"] }]), /coincide/);
    const connection = { a: [0, "exit"], b: [1, "entry"] };
    assert.throws(() => CjsTubeBounds.join([asset(), asset(100, 200)], [connection, connection]), /reused/);
});

test("authored JSON follows the same admission and solver path", async () =>
{
    // Independently authored rectangular chamber; no generator or guide data.
    const authored = { version: 1, units: "metres",
        vertices: [[-10,-10,0],[10,-10,0],[10,10,0],[-10,10,0],[-10,-10,100],[10,-10,100],[10,10,100],[-10,10,100]],
        triangles: [[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[1,2,6],[1,6,5],[2,3,7],[2,7,6],[3,0,4],[3,4,7]] };
    const server = new CjsTubeBounds(authored), client = new CjsTubeBounds(JSON.parse(JSON.stringify(server.GetAsset())));
    assert.equal(await server.GetHash(), await client.GetHash());
    const a = output(), b = output();
    server.MoveSphere([0, 0, 50], [300, 5, 0], 2, 1, a);
    client.MoveSphere([0, 0, 50], [300, 5, 0], 2, 1, b);
    assert.deepEqual(a, b); close(a.position[0], 8); close(a.position[1], 5);
    authored.vertices[0][0] = 999;
    assert.equal(await server.GetHash(), await client.GetHash());
});

test("open, flipped and degenerate boundary data fail admission", () =>
{
    const open = asset(); open.triangles.pop();
    assert.throws(() => new CjsTubeBounds(open), /closed/);
    const flipped = asset(); flipped.triangles[0].reverse();
    assert.throws(() => new CjsTubeBounds(flipped), /wound/);
    const degenerate = asset(); degenerate.triangles[0][1] = degenerate.triangles[0][0];
    assert.throws(() => new CjsTubeBounds(degenerate), /Degenerate/);
    assert.throws(() => CjsTubeBounds.generate([section(0), section(100)], square.toReversed()), /counterclockwise/);
});

test("guide frames preserve authored banking and explicit segment identity", () =>
{
    const bounds = new CjsTubeBounds(CjsTubeBounds.generate([section(0, 0, Math.PI / 4), section(100, 0, Math.PI / 4)], square));
    const out = { center: [0,0,0], forward: [0,0,0], up: [0,0,0], right: [0,0,0] };
    bounds.GetGuide([0, 0, 50], 0, out);
    close(out.fraction, 0.5); close(out.up[0], -Math.SQRT1_2); close(out.up[1], Math.SQRT1_2);
    assert.deepEqual(out.forward, [0, 0, 1]);
    assert.throws(() => bounds.GetGuide([0, 0, 50], 1, out), /Unknown guide/);
});

test("bent variable-width sections provide a closed containment surface", () =>
{
    const sections = [section(0), section(50), section(100, 20)];
    sections[1].halfWidth = 15;
    const bounds = new CjsTubeBounds(CjsTubeBounds.generate(sections, square)), out = output();
    assert.equal(bounds.ContainsSphere([10, 0, 75], 1), true);
    bounds.MoveSphere([0, 0, 25], [0, 0, 100], 1, 0.5, out);
    assert.equal(bounds.ContainsSphere(out.position, 1), true);
});

test("large translated coordinates retain metre-scale clearance", () =>
{
    const data = asset(), origin = [1e9, -1e9, 1e9];
    for (const vertex of data.vertices) for (let i = 0; i < 3; i++) vertex[i] += origin[i];
    data.guides = []; data.ports = [];
    const bounds = new CjsTubeBounds(data), out = output();
    bounds.MoveSphere([1e9, -1e9, 1e9 + 50], [1000, 0, 20], 1, 1, out);
    close(out.position[0] - 1e9, 9, 1e-6); close(out.position[2] - 1e9, 70, 1e-6);
    assert.equal(bounds.ContainsSphere(out.position, 1), true);
});

test("deterministic varied motions stay inside and do not gain speed", () =>
{
    const bounds = new CjsTubeBounds(asset());
    for (let i = 1; i <= 80; i++)
    {
        const position = [Math.sin(i) * 7, Math.cos(i * 3) * 7, 5 + i];
        const velocity = [Math.sin(i * 7) * 500, Math.cos(i * 13) * 500, Math.sin(i * 11) * 500];
        const out = output(); bounds.MoveSphere(position, velocity, 1, 0.2, out);
        assert.notEqual(out.status, "invalid-start");
        assert.equal(bounds.ContainsSphere(out.position, 1), true, `sample ${i}: ${JSON.stringify({position, velocity, out})}`);
        assert.ok(Math.hypot(...out.velocity) <= Math.hypot(...velocity) + 1e-6);
    }
});

test("default polygonal tube keeps repeated sliding motion inside", () =>
{
    const bounds = new CjsTubeBounds(CjsTubeBounds.generate([section(0), section(100)]));
    const out = output();
    for (let i = 1; i <= 40; i++)
    {
        const velocity = [Math.cos(i) * 300, Math.sin(i) * 300, Math.cos(i * 5) * 40];
        bounds.MoveSphere([0, 0, 50], velocity, 1, 0.2, out);
        assert.equal(bounds.ContainsSphere(out.position, 1), true, JSON.stringify(out));
        assert.ok(Math.hypot(...out.velocity) <= Math.hypot(...velocity) + 1e-6);
    }
});

test("quarter-turn track contains high-speed trajectories across curved walls", () =>
{
    const sections = Array.from({ length: 9 }, (_, i) =>
    {
        const angle = i * Math.PI / 16;
        return { center: [100 * (1 - Math.cos(angle)), 0, 100 * Math.sin(angle)],
            right: [Math.cos(angle), 0, -Math.sin(angle)], up: [0,1,0], halfWidth: 10, halfHeight: 10 };
    });
    const bounds = new CjsTubeBounds(CjsTubeBounds.generate(sections, square));
    for (let i = 1; i < sections.length - 1; i++)
    {
        const out = output();
        bounds.MoveSphere(sections[i].center, [400, 50, 700], 2, 0.2, out);
        assert.notEqual(out.status, "invalid-start");
        assert.equal(bounds.ContainsSphere(out.position, 2), true, JSON.stringify(out));
    }
});

test("collision result supports in-place output and zero-duration movement", () =>
{
    const bounds = new CjsTubeBounds(asset());
    const state = { position: [0,0,50], velocity: [100,0,0] };
    bounds.MoveSphere(state.position, state.velocity, 1, 0, state);
    assert.deepEqual(state.position, [0,0,50]); assert.equal(state.contacts, 0);
    bounds.MoveSphere(state.position, state.velocity, 1, 1, state);
    close(state.position[0], 9); close(state.velocity[0], 0);
});

test("asset identity changes with geometry and returned asset edits cannot mutate the solver", async () =>
{
    const bounds = new CjsTubeBounds(asset()), copy = bounds.GetAsset();
    const before = await bounds.GetHash();
    for (const vertex of copy.vertices) vertex[0] *= 2;
    assert.notEqual(await new CjsTubeBounds(copy).GetHash(), before);
    assert.equal(await bounds.GetHash(), before);
    assert.equal(bounds.ContainsSphere([15,0,50], 1), false);
});
