import { meta } from "@carbonenginejs/runtime/schema";
import { vec3d } from "./math/vec3d.js";

// Source: destiny/src/MiniCapsule.h
// Source: destiny/src/MiniCapsule.cpp
// Source: destiny/src/MiniCapsule_Blue.cpp
/**
 * Carbon MiniCapsule descriptor, separate from its materialized world collider.
 * Adaptation: owned f64 views and JS accessors replace native value fields;
 * GC replaces IRoot locking. Native Python constructors remain outside this surface.
 * The parent ID stays undefined until assigned, matching native indeterminate storage.
 */
@meta.define({ className: "CjsDestinyMiniCapsule", modelledOn: "MiniCapsule" })
export class CjsDestinyMiniCapsule
{
    mId = 0n;

    mParentBallID = undefined;

    mRadius = 0;

    mHemisphereA = vec3d.create();

    mHemisphereB = vec3d.create();

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
     * Reads the descriptor's ax component.
     * Adaptation: a JS accessor exposes native backing storage without schema APIs.
     * @returns {number} Stored descriptor value, independent of any world collider.
     */
    @meta.type.float64
    @meta.adapted
    get ax() { return this.mHemisphereA[0]; }

    /**
     * Writes the descriptor's ax component without updating existing colliders.
     * Adaptation: JS assignment replaces Blue field storage.
     * @param {number} value New descriptor component.
     * @returns {void} Updates only the descriptor.
     */
    @meta.adapted
    set ax(value) { this.mHemisphereA[0] = value; }

    /**
     * Reads the descriptor's ay component.
     * Adaptation: a JS accessor exposes native backing storage without schema APIs.
     * @returns {number} Stored descriptor value, independent of any world collider.
     */
    @meta.type.float64
    @meta.adapted
    get ay() { return this.mHemisphereA[1]; }

    /**
     * Writes the descriptor's ay component without updating existing colliders.
     * Adaptation: JS assignment replaces Blue field storage.
     * @param {number} value New descriptor component.
     * @returns {void} Updates only the descriptor.
     */
    @meta.adapted
    set ay(value) { this.mHemisphereA[1] = value; }

    /**
     * Reads the descriptor's az component.
     * Adaptation: a JS accessor exposes native backing storage without schema APIs.
     * @returns {number} Stored descriptor value, independent of any world collider.
     */
    @meta.type.float64
    @meta.adapted
    get az() { return this.mHemisphereA[2]; }

    /**
     * Writes the descriptor's az component without updating existing colliders.
     * Adaptation: JS assignment replaces Blue field storage.
     * @param {number} value New descriptor component.
     * @returns {void} Updates only the descriptor.
     */
    @meta.adapted
    set az(value) { this.mHemisphereA[2] = value; }

    /**
     * Reads the descriptor's bx component.
     * Adaptation: a JS accessor exposes native backing storage without schema APIs.
     * @returns {number} Stored descriptor value, independent of any world collider.
     */
    @meta.type.float64
    @meta.adapted
    get bx() { return this.mHemisphereB[0]; }

    /**
     * Writes the descriptor's bx component without updating existing colliders.
     * Adaptation: JS assignment replaces Blue field storage.
     * @param {number} value New descriptor component.
     * @returns {void} Updates only the descriptor.
     */
    @meta.adapted
    set bx(value) { this.mHemisphereB[0] = value; }

    /**
     * Reads the descriptor's by component.
     * Adaptation: a JS accessor exposes native backing storage without schema APIs.
     * @returns {number} Stored descriptor value, independent of any world collider.
     */
    @meta.type.float64
    @meta.adapted
    get by() { return this.mHemisphereB[1]; }

    /**
     * Writes the descriptor's by component without updating existing colliders.
     * Adaptation: JS assignment replaces Blue field storage.
     * @param {number} value New descriptor component.
     * @returns {void} Updates only the descriptor.
     */
    @meta.adapted
    set by(value) { this.mHemisphereB[1] = value; }

    /**
     * Reads the descriptor's bz component.
     * Adaptation: a JS accessor exposes native backing storage without schema APIs.
     * @returns {number} Stored descriptor value, independent of any world collider.
     */
    @meta.type.float64
    @meta.adapted
    get bz() { return this.mHemisphereB[2]; }

    /**
     * Writes the descriptor's bz component without updating existing colliders.
     * Adaptation: JS assignment replaces Blue field storage.
     * @param {number} value New descriptor component.
     * @returns {void} Updates only the descriptor.
     */
    @meta.adapted
    set bz(value) { this.mHemisphereB[2] = value; }
}

// Native self-interface admission for BlueList<MiniCapsule>; no simulation schema lookup.
meta.blue.interfaceTable({ interfaces: [CjsDestinyMiniCapsule], chainTo: null })(CjsDestinyMiniCapsule, { kind: "class" });
