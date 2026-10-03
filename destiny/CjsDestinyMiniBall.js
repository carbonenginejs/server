import { meta } from "@carbonenginejs/runtime/schema";
import { vec3d } from "./math/vec3d.js";

// Source: destiny/src/MiniBall.h
// Source: destiny/src/MiniBall.cpp
// Source: destiny/src/Miniball_Blue.cpp
/**
 * Carbon MiniBall descriptor, separate from its materialized world collider.
 * Adaptation: owned f64 views and JS accessors replace native value fields;
 * GC replaces IRoot locking. Native Python constructors remain outside this surface.
 */
@meta.define({ className: "CjsDestinyMiniBall", modelledOn: "MiniBall" })
export class CjsDestinyMiniBall
{
    mId = 0n;

    mRadius = 0;

    mPos = vec3d.create();

    /**
     * Reads the native descriptor identity assigned after attachment.
     * Adaptation: a read-only JS accessor replaces the Blue field exposure.
     * @returns {bigint} Last materialized collider ID, initially zero.
     */
    @meta.type.int64
    @meta.adapted
    get id() { return this.mId; }

    /**
     * Reads the descriptor's radius component.
     * Adaptation: a JS accessor exposes native backing storage without schema APIs.
     * @returns {number} Stored descriptor value, independent of any world collider.
     */
    @meta.type.float32
    @meta.adapted
    get radius() { return this.mRadius; }

    /**
     * Writes the descriptor's radius component without updating existing colliders.
     * Adaptation: JS assignment replaces Blue field storage, narrowing to native float32.
     * @param {number} value New descriptor component.
     * @returns {void} Updates only the descriptor.
     */
    @meta.adapted
    set radius(value) { this.mRadius = Math.fround(value); }

    /**
     * Reads the descriptor's x component.
     * Adaptation: a JS accessor exposes native backing storage without schema APIs.
     * @returns {number} Stored descriptor value, independent of any world collider.
     */
    @meta.type.float64
    @meta.adapted
    get x() { return this.mPos[0]; }

    /**
     * Writes the descriptor's x component without updating existing colliders.
     * Adaptation: JS assignment replaces Blue field storage.
     * @param {number} value New descriptor component.
     * @returns {void} Updates only the descriptor.
     */
    @meta.adapted
    set x(value) { this.mPos[0] = value; }

    /**
     * Reads the descriptor's y component.
     * Adaptation: a JS accessor exposes native backing storage without schema APIs.
     * @returns {number} Stored descriptor value, independent of any world collider.
     */
    @meta.type.float64
    @meta.adapted
    get y() { return this.mPos[1]; }

    /**
     * Writes the descriptor's y component without updating existing colliders.
     * Adaptation: JS assignment replaces Blue field storage.
     * @param {number} value New descriptor component.
     * @returns {void} Updates only the descriptor.
     */
    @meta.adapted
    set y(value) { this.mPos[1] = value; }

    /**
     * Reads the descriptor's z component.
     * Adaptation: a JS accessor exposes native backing storage without schema APIs.
     * @returns {number} Stored descriptor value, independent of any world collider.
     */
    @meta.type.float64
    @meta.adapted
    get z() { return this.mPos[2]; }

    /**
     * Writes the descriptor's z component without updating existing colliders.
     * Adaptation: JS assignment replaces Blue field storage.
     * @param {number} value New descriptor component.
     * @returns {void} Updates only the descriptor.
     */
    @meta.adapted
    set z(value) { this.mPos[2] = value; }
}

// Native self-interface admission for BlueList<MiniBall>; no simulation schema lookup.
meta.blue.interfaceTable({ interfaces: [CjsDestinyMiniBall], chainTo: null })(CjsDestinyMiniBall, { kind: "class" });
