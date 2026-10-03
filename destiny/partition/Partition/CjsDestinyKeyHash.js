import { meta } from "@carbonenginejs/runtime/schema";

// Source: destiny/src/Partition.h:104-123
/** Carbon KeyHash with the Windows x64 MSVC integral-hash dependency made explicit. */
@meta.define({ className: "CjsDestinyKeyHash", modelledOn: "KeyHash" })
export class CjsDestinyKeyHash
{
    /**
     * Combines ix, iy, iz and n in donor order with uint64 size_t arithmetic.
     * Adaptation: Call represents C++ operator(); BigInt preserves wrapping.
     * std::hash is ABI-specific: this implements MSVC's little-endian eight-byte
     * FNV-1a hash (offset 14695981039346656037, prime 1099511628211), matching
     * Carbon's x64-windows-145 target. Other native STL hash values are not promised.
     *
     * @param {CjsDestinyKey} key Native key to hash.
     * @returns {bigint} Windows x64 size_t hash.
     */
    @meta.adapted
    Call(key)
    {
        let seed = 0n;
        for (let i = 0; i < 4; ++i)
        {
            const value = i === 0 ? key.ix : i === 1 ? key.iy : i === 2 ? key.iz : key.n;
            let bytes = BigInt.asUintN(64, value);
            let hash = 14695981039346656037n;
            for (let byte = 0; byte < 8; ++byte)
            {
                hash = BigInt.asUintN(64, (hash ^ (bytes & 255n)) * 1099511628211n);
                bytes >>= 8n;
            }
            seed = BigInt.asUintN(64, seed ^ (hash + 0x9e3779b9n + (seed << 6n) + (seed >> 2n)));
        }
        return seed;
    }
}
