import assert from "node:assert/strict";
import test from "node:test";
import { vec3d } from "../dist/destiny/math/vec3d.js";
import { CjsBallparkController } from "@carbonenginejs/server";

test("float64 vectors preserve large-world offsets and reuse complete views", () =>
{
    const value = 1e10 + 0.001;
    const owned = vec3d.fromValues(value, -value, 3);
    assert.equal(owned[0], value);
    assert.notEqual(Math.fround(value), value);
    const first = vec3d.alloc(), second = vec3d.alloc();
    assert.notEqual(first, second);
    first[0] = value;
    vec3d.unalloc(first);
    const reused = vec3d.alloc();
    assert.equal(reused, first);
    assert.equal(reused[0], value);
    vec3d.unalloc(reused);
    vec3d.unalloc(second);
    assert.equal(owned[0], value);
});

test("Potential balances pooled recursion frames on misses, overlaps and exceptions", () =>
{
    const park = new CjsBallparkController();
    const add = id => park.AddBall(id, 1e6, 2, 10, true, false, true, false, false,
        0, 0, 0, 0, 0, 0, 1, 1);
    const me = add(1), other = add(2);
    const originalAlloc = vec3d.alloc, originalUnalloc = vec3d.unalloc;
    const borrowed = new Set();
    let peak = 0;
    vec3d.alloc = () =>
    {
        const value = originalAlloc();
        assert.ok(!borrowed.has(value));
        borrowed.add(value);
        peak = Math.max(peak, borrowed.size);
        return value;
    };
    vec3d.unalloc = value =>
    {
        assert.ok(borrowed.delete(value));
        originalUnalloc(value);
    };
    try
    {
        park.Potential(me, other);
        assert.ok(peak > 11, "overlap must own distinct nested frames");
        assert.equal(borrowed.size, 0);
        other.x = 100;
        park.Potential(me, other);
        assert.equal(borrowed.size, 0);
        other.x = 0;
        const integrate = park.Integrate;
        let calls = 0;
        park.Integrate = function (...args)
        {
            if (++calls === 3) throw new Error("nested failure");
            return integrate.apply(this, args);
        };
        assert.throws(() => park.Potential(me, other), /nested failure/);
        assert.equal(me.x, 0);
        assert.equal(other.x, 0);
        assert.equal(borrowed.size, 0);
    }
    finally
    {
        vec3d.alloc = originalAlloc;
        vec3d.unalloc = originalUnalloc;
    }
});
