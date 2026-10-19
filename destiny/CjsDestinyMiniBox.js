import { meta, blue, type } from "@carbonenginejs/runtime/schema";
import { vec3d } from "./math/vec3d.js";

// Source: destiny/src/MiniBox.h
// Source: destiny/src/MiniBox.cpp
// Source: destiny/src/MiniBox_Blue.cpp
/**
 * Carbon MiniBox descriptor, separate from its materialized world collider.
 * Adaptation: owned f64 views and JS accessors replace native value fields;
 * GC replaces IRoot locking. Native Python constructors remain outside this surface.
 * The parent ID stays undefined until assigned, matching native indeterminate storage.
 */
@meta.define({ className: "CjsDestinyMiniBox", modelledOn: "MiniBox" })
export class CjsDestinyMiniBox
{
    mId = 0n;

    mParentBallID = undefined;

    mCorner = vec3d.create();

    mLocalX = vec3d.create();

    mLocalY = vec3d.create();

    mLocalZ = vec3d.create();

    /**
     * Reads the native descriptor identity assigned after attachment.
     * Adaptation: a read-only JS accessor replaces the Blue field exposure.
     * Blue row: MiniBox_Blue.cpp:15 MAP_ATTRIBUTE READ.
     * @returns {bigint} Last materialized collider ID, initially zero.
     */
    @blue.read
    @type.int64
    @meta.adapted
    get id() { return this.mId; }

    /**
     * Reads the descriptor's c0 component.
     * Adaptation: a JS accessor exposes native backing storage without schema APIs.
     * Blue row: MiniBox_Blue.cpp:25 MAP_ATTRIBUTE READWRITE | NOTIFY | PERSIST.
     * @returns {number} Stored descriptor value, independent of any world collider.
     */
    @blue.notify
    @blue.readwrite
    @blue.persist
    @type.float64
    @meta.adapted
    get c0() { return this.mCorner[0]; }

    /**
     * Writes the descriptor's c0 component without updating existing colliders.
     * Adaptation: JS assignment replaces Blue field storage.
     * @param {number} value New descriptor component.
     * @returns {void} Updates only the descriptor.
     */
    @meta.adapted
    set c0(value) { this.mCorner[0] = value; }

    /**
     * Reads the descriptor's c1 component.
     * Adaptation: a JS accessor exposes native backing storage without schema APIs.
     * Blue row: MiniBox_Blue.cpp:33 MAP_ATTRIBUTE READWRITE | NOTIFY | PERSIST.
     * @returns {number} Stored descriptor value, independent of any world collider.
     */
    @blue.notify
    @blue.readwrite
    @blue.persist
    @type.float64
    @meta.adapted
    get c1() { return this.mCorner[1]; }

    /**
     * Writes the descriptor's c1 component without updating existing colliders.
     * Adaptation: JS assignment replaces Blue field storage.
     * @param {number} value New descriptor component.
     * @returns {void} Updates only the descriptor.
     */
    @meta.adapted
    set c1(value) { this.mCorner[1] = value; }

    /**
     * Reads the descriptor's c2 component.
     * Adaptation: a JS accessor exposes native backing storage without schema APIs.
     * Blue row: MiniBox_Blue.cpp:41 MAP_ATTRIBUTE READWRITE | NOTIFY | PERSIST.
     * @returns {number} Stored descriptor value, independent of any world collider.
     */
    @blue.notify
    @blue.readwrite
    @blue.persist
    @type.float64
    @meta.adapted
    get c2() { return this.mCorner[2]; }

    /**
     * Writes the descriptor's c2 component without updating existing colliders.
     * Adaptation: JS assignment replaces Blue field storage.
     * @param {number} value New descriptor component.
     * @returns {void} Updates only the descriptor.
     */
    @meta.adapted
    set c2(value) { this.mCorner[2] = value; }

    /**
     * Reads the descriptor's x0 component.
     * Adaptation: a JS accessor exposes native backing storage without schema APIs.
     * Blue row: MiniBox_Blue.cpp:51 MAP_ATTRIBUTE READWRITE | NOTIFY | PERSIST.
     * @returns {number} Stored descriptor value, independent of any world collider.
     */
    @blue.notify
    @blue.readwrite
    @blue.persist
    @type.float64
    @meta.adapted
    get x0() { return this.mLocalX[0]; }

    /**
     * Writes the descriptor's x0 component without updating existing colliders.
     * Adaptation: JS assignment replaces Blue field storage.
     * @param {number} value New descriptor component.
     * @returns {void} Updates only the descriptor.
     */
    @meta.adapted
    set x0(value) { this.mLocalX[0] = value; }

    /**
     * Reads the descriptor's x1 component.
     * Adaptation: a JS accessor exposes native backing storage without schema APIs.
     * Blue row: MiniBox_Blue.cpp:59 MAP_ATTRIBUTE READWRITE | NOTIFY | PERSIST.
     * @returns {number} Stored descriptor value, independent of any world collider.
     */
    @blue.notify
    @blue.readwrite
    @blue.persist
    @type.float64
    @meta.adapted
    get x1() { return this.mLocalX[1]; }

    /**
     * Writes the descriptor's x1 component without updating existing colliders.
     * Adaptation: JS assignment replaces Blue field storage.
     * @param {number} value New descriptor component.
     * @returns {void} Updates only the descriptor.
     */
    @meta.adapted
    set x1(value) { this.mLocalX[1] = value; }

    /**
     * Reads the descriptor's x2 component.
     * Adaptation: a JS accessor exposes native backing storage without schema APIs.
     * Blue row: MiniBox_Blue.cpp:67 MAP_ATTRIBUTE READWRITE | NOTIFY | PERSIST.
     * @returns {number} Stored descriptor value, independent of any world collider.
     */
    @blue.notify
    @blue.readwrite
    @blue.persist
    @type.float64
    @meta.adapted
    get x2() { return this.mLocalX[2]; }

    /**
     * Writes the descriptor's x2 component without updating existing colliders.
     * Adaptation: JS assignment replaces Blue field storage.
     * @param {number} value New descriptor component.
     * @returns {void} Updates only the descriptor.
     */
    @meta.adapted
    set x2(value) { this.mLocalX[2] = value; }

    /**
     * Reads the descriptor's y0 component.
     * Adaptation: a JS accessor exposes native backing storage without schema APIs.
     * Blue row: MiniBox_Blue.cpp:77 MAP_ATTRIBUTE READWRITE | NOTIFY | PERSIST.
     * @returns {number} Stored descriptor value, independent of any world collider.
     */
    @blue.notify
    @blue.readwrite
    @blue.persist
    @type.float64
    @meta.adapted
    get y0() { return this.mLocalY[0]; }

    /**
     * Writes the descriptor's y0 component without updating existing colliders.
     * Adaptation: JS assignment replaces Blue field storage.
     * @param {number} value New descriptor component.
     * @returns {void} Updates only the descriptor.
     */
    @meta.adapted
    set y0(value) { this.mLocalY[0] = value; }

    /**
     * Reads the descriptor's y1 component.
     * Adaptation: a JS accessor exposes native backing storage without schema APIs.
     * Blue row: MiniBox_Blue.cpp:85 MAP_ATTRIBUTE READWRITE | NOTIFY | PERSIST.
     * @returns {number} Stored descriptor value, independent of any world collider.
     */
    @blue.notify
    @blue.readwrite
    @blue.persist
    @type.float64
    @meta.adapted
    get y1() { return this.mLocalY[1]; }

    /**
     * Writes the descriptor's y1 component without updating existing colliders.
     * Adaptation: JS assignment replaces Blue field storage.
     * @param {number} value New descriptor component.
     * @returns {void} Updates only the descriptor.
     */
    @meta.adapted
    set y1(value) { this.mLocalY[1] = value; }

    /**
     * Reads the descriptor's y2 component.
     * Adaptation: a JS accessor exposes native backing storage without schema APIs.
     * Blue row: MiniBox_Blue.cpp:93 MAP_ATTRIBUTE READWRITE | NOTIFY | PERSIST.
     * @returns {number} Stored descriptor value, independent of any world collider.
     */
    @blue.notify
    @blue.readwrite
    @blue.persist
    @type.float64
    @meta.adapted
    get y2() { return this.mLocalY[2]; }

    /**
     * Writes the descriptor's y2 component without updating existing colliders.
     * Adaptation: JS assignment replaces Blue field storage.
     * @param {number} value New descriptor component.
     * @returns {void} Updates only the descriptor.
     */
    @meta.adapted
    set y2(value) { this.mLocalY[2] = value; }

    /**
     * Reads the descriptor's z0 component.
     * Adaptation: a JS accessor exposes native backing storage without schema APIs.
     * Blue row: MiniBox_Blue.cpp:103 MAP_ATTRIBUTE READWRITE | NOTIFY | PERSIST.
     * @returns {number} Stored descriptor value, independent of any world collider.
     */
    @blue.notify
    @blue.readwrite
    @blue.persist
    @type.float64
    @meta.adapted
    get z0() { return this.mLocalZ[0]; }

    /**
     * Writes the descriptor's z0 component without updating existing colliders.
     * Adaptation: JS assignment replaces Blue field storage.
     * @param {number} value New descriptor component.
     * @returns {void} Updates only the descriptor.
     */
    @meta.adapted
    set z0(value) { this.mLocalZ[0] = value; }

    /**
     * Reads the descriptor's z1 component.
     * Adaptation: a JS accessor exposes native backing storage without schema APIs.
     * Blue row: MiniBox_Blue.cpp:111 MAP_ATTRIBUTE READWRITE | NOTIFY | PERSIST.
     * @returns {number} Stored descriptor value, independent of any world collider.
     */
    @blue.notify
    @blue.readwrite
    @blue.persist
    @type.float64
    @meta.adapted
    get z1() { return this.mLocalZ[1]; }

    /**
     * Writes the descriptor's z1 component without updating existing colliders.
     * Adaptation: JS assignment replaces Blue field storage.
     * @param {number} value New descriptor component.
     * @returns {void} Updates only the descriptor.
     */
    @meta.adapted
    set z1(value) { this.mLocalZ[1] = value; }

    /**
     * Reads the descriptor's z2 component.
     * Adaptation: a JS accessor exposes native backing storage without schema APIs.
     * Blue row: MiniBox_Blue.cpp:119 MAP_ATTRIBUTE READWRITE | NOTIFY | PERSIST.
     * @returns {number} Stored descriptor value, independent of any world collider.
     */
    @blue.notify
    @blue.readwrite
    @blue.persist
    @type.float64
    @meta.adapted
    get z2() { return this.mLocalZ[2]; }

    /**
     * Writes the descriptor's z2 component without updating existing colliders.
     * Adaptation: JS assignment replaces Blue field storage.
     * @param {number} value New descriptor component.
     * @returns {void} Updates only the descriptor.
     */
    @meta.adapted
    set z2(value) { this.mLocalZ[2] = value; }
}

// Native self-interface admission for BlueList<MiniBox>; no simulation schema lookup.
blue.interface()(CjsDestinyMiniBox, { kind: "class" });
