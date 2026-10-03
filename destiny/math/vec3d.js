/**
 * Server-owned storage for Carbon Vector3d values. Runtime vec3 operations accept
 * these outputs without narrowing them. The runtime's default vector factories
 * and pool use float32; this helper keeps float64 storage local to Destiny.
 */
export const vec3d = {
    /**
     * Creates an owned, zero-filled double-precision vector.
     * @returns {Float64Array} Storage retained by the caller.
     */
    create()
    {
        return new Float64Array(3);
    },

    /**
     * Creates an owned double-precision vector with the given components.
     * @param {number} x First component.
     * @param {number} y Second component.
     * @param {number} z Third component.
     * @returns {Float64Array} Storage retained by the caller.
     */
    fromValues(x, y, z)
    {
        const out = vec3d.create();
        out[0] = x;
        out[1] = y;
        out[2] = z;
        return out;
    },

    /**
     * Borrows dirty storage, reusing the complete view as well as its buffer.
     * @returns {Float64Array} Return with unalloc on every exit path.
     */
    alloc()
    {
        return vec3d._pool.pop() || vec3d.create();
    },

    /**
     * Returns one borrowed vector after its last use.
     * @param {Float64Array} value Storage obtained from alloc.
     * @returns {void} The caller relinquishes ownership.
     */
    unalloc(value)
    {
        vec3d._pool.push(value);
    },

    _pool: []
};
