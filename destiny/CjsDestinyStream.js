import { meta } from "@carbonenginejs/runtime/schema";
import { CjsByteReader } from "@carbonenginejs/runtime/resource/format";
import { asUint8Array } from "@carbonenginejs/runtime/utils/bytes";

// Source: destiny/src/Thunkers.cpp:2083-2257,2897-3377
/** Server-owned seekable byte adapter for Destiny's native Blue stream consumers. */
@meta.define({ className: "CjsDestinyStream" })
export class CjsDestinyStream extends CjsByteReader
{
    /**
     * Creates an owned byte stream using the runtime's checked read cursor.
     * Adaptation: bytes replace IBlueStream; capacity grows independently of length.
     * @param {ArrayBuffer|ArrayBufferView} [bytes] Initial contents, copied.
     * @returns {CjsDestinyStream} Independent stream positioned at zero.
     */
    constructor(bytes = new ArrayBuffer(0))
    {
        super(bytes);
        this.bytes = Uint8Array.from(this.bytes);
        this.view = new DataView(this.bytes.buffer);
    }

    /**
     * Seeks to an absolute position, retaining contents and logical length.
     * Adaptation: Destiny only requires absolute seeks within existing data.
     * @param {number} offset Byte position from the start.
     * @returns {void} Updates the runtime cursor without truncating.
     */
    Seek(offset)
    {
        if (!Number.isSafeInteger(offset) || offset < 0 || offset > this.end)
            throw new RangeError("Destiny stream seek is outside its contents");
        this.offset = offset;
    }

    /**
     * Copies up to the requested unread bytes, like a Python stream Read.
     * Adaptation: returned Uint8Array owns its bytes rather than aliasing the cursor.
     * @param {number} [size=this.remaining] Maximum bytes to consume.
     * @returns {Uint8Array} Owned byte payload; empty at EOF.
     */
    Read(size = this.remaining)
    {
        if (!Number.isSafeInteger(size) || size < 0) throw new RangeError("Invalid Destiny read size");
        return this.ReadRaw(Math.min(size, this.remaining)).slice();
    }

    /**
     * Overwrites bytes at the cursor without shortening an existing stream.
     * Adaptation: byte views replace native source pointers.
     * @param {ArrayBuffer|ArrayBufferView} data Bytes to copy.
     * @returns {number} Number of bytes written.
     */
    Write(data)
    {
        const bytes = asUint8Array(data), offset = this._AdvanceWrite(bytes.byteLength);
        this.bytes.set(bytes, offset);
        return bytes.byteLength;
    }

    /**
     * Copies all logical stream bytes without changing position.
     * Adaptation: provides the owned payload consumed by transports and fixtures.
     * @returns {Uint8Array} Copy excluding unused capacity.
     */
    GetBytes() { return this.bytes.slice(0, this.end); }

    /**
     * Reads a signed 64-bit field through the checked runtime cursor.
     * Adaptation: BigInt preserves IDs and raw warp-range bits exactly.
     * @returns {bigint} Little-endian signed value.
     */
    ReadInt64() { const offset = this.offset; this.Skip(8); return this.view.getBigInt64(offset, true); }

    /**
     * Reads a double field through the checked runtime cursor.
     * Adaptation: DataView supplies the runtime reader's missing float64 primitive.
     * @returns {number} Little-endian floating value.
     */
    ReadFloat64() { const offset = this.offset; this.Skip(8); return this.view.getFloat64(offset, true); }

    /**
     * Fills a caller-owned double vector in native component order.
     * Adaptation: bounded scalar reads replace a native Vector3d pointer read.
     * @param {Float64Array} out Retained vector or caller-owned pool slot.
     * @returns {Float64Array} Supplied storage, with any successful prefix retained on error.
     */
    ReadVector3d(out)
    {
        out[0] = this.ReadFloat64(); out[1] = this.ReadFloat64(); out[2] = this.ReadFloat64();
        return out;
    }

    /**
     * Writes a byte through DataView, retaining native low-bit narrowing.
     * Adaptation: replaces the native pointer write for one field.
     * @param {number} value Field value.
     * @returns {void} Advances by one byte.
     */
    WriteUint8(value) { const offset = this._AdvanceWrite(1); this.view.setUint8(offset, value); }

    /**
     * Writes a native uint16 field with low-bit narrowing.
     * Adaptation: DataView makes little-endian wire order explicit.
     * @param {number} value Field value.
     * @returns {void} Advances by two bytes.
     */
    WriteUint16(value) { const offset = this._AdvanceWrite(2); this.view.setUint16(offset, value, true); }

    /**
     * Writes a native int32 field with low-bit narrowing.
     * Adaptation: DataView makes little-endian wire order explicit.
     * @param {number} value Field value.
     * @returns {void} Advances by four bytes.
     */
    WriteInt32(value) { const offset = this._AdvanceWrite(4); this.view.setInt32(offset, value, true); }

    /**
     * Writes signed-int64 state without Number conversion.
     * Adaptation: DataView preserves native ID and warp bit patterns.
     * @param {bigint} value Signed field value.
     * @returns {void} Advances by eight bytes.
     */
    WriteInt64(value) { const offset = this._AdvanceWrite(8); this.view.setBigInt64(offset, value, true); }

    /**
     * Writes float32 without normalizing NaN or negative zero.
     * Adaptation: DataView avoids the runtime writer's falsy-value normalization.
     * @param {number} value Native float field.
     * @returns {void} Advances by four bytes.
     */
    WriteFloat32(value) { const offset = this._AdvanceWrite(4); this.view.setFloat32(offset, value, true); }

    /**
     * Writes float64 without normalizing NaN or negative zero.
     * Adaptation: DataView avoids the runtime writer's falsy-value normalization.
     * @param {number} value Native double field.
     * @returns {void} Advances by eight bytes.
     */
    WriteFloat64(value) { const offset = this._AdvanceWrite(8); this.view.setFloat64(offset, value, true); }

    /**
     * Writes a caller-owned vector's components in their native double order.
     * Adaptation: indexed scalar writes replace contiguous Vector3d memory.
     * @param {Float64Array} value Three double components.
     * @returns {void} Advances by 24 bytes without a temporary vector.
     */
    WriteVector3d(value)
    {
        const x = value[0], y = value[1], z = value[2];
        this.WriteFloat64(x); this.WriteFloat64(y); this.WriteFloat64(z);
    }

    /**
     * Reserves an overwrite span, growing data-sized storage as necessary.
     * Adaptation: a growable Uint8Array replaces native memory allocation.
     * @param {number} size Byte count.
     * @returns {number} Previous write position.
     */
    _AdvanceWrite(size)
    {
        const offset = this.offset, end = offset + size;
        if (!Number.isSafeInteger(end) || size < 0) throw new RangeError("Invalid Destiny write size");
        if (end > this.bytes.length)
        {
            const bytes = new Uint8Array(Math.max(end, this.bytes.length * 2, 64));
            bytes.set(this.bytes);
            this.bytes = bytes;
            this.view = new DataView(bytes.buffer);
        }
        this.offset = end;
        if (end > this.end) this.end = end;
        return offset;
    }
}
