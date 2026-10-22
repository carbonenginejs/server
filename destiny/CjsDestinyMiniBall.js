import { blue } from "@carbonenginejs/runtime/schema";
import { vec3d } from "./math/vec3d.js";

// Source: destiny/src/MiniBall.h
// Source: destiny/src/MiniBall.cpp
// Source: destiny/src/Miniball_Blue.cpp
/**
 * Carbon MiniBall descriptor, separate from its materialized world collider.
 * Adaptation: owned f64 views and JS accessors replace native value fields;
 * GC replaces IRoot locking. Native Python constructors remain outside this surface.
 *
 * Modelled on: MiniBall (destiny/src/MiniBall.h:14-31)
 */
export class CjsDestinyMiniBall
{
    mId = 0n;

    mRadius = 0;

    mPos = vec3d.create();

    /**
     * Reads the native descriptor identity assigned after attachment.
     * Adaptation: a read-only JS accessor replaces the Blue field exposure.
     * Blue row: Miniball_Blue.cpp:15 MAP_ATTRIBUTE READ.
     * @returns {bigint} Last materialized collider ID, initially zero.
     */
    get id() { return this.mId; }

    /**
     * Reads the descriptor's radius component.
     * Adaptation: a JS accessor exposes native backing storage without schema APIs.
     * Blue row: Miniball_Blue.cpp:25 MAP_ATTRIBUTE READWRITE | NOTIFY | PERSIST.
     * @returns {number} Stored descriptor value, independent of any world collider.
     */
    get radius() { return this.mRadius; }

    /**
     * Writes the descriptor's radius component without updating existing colliders.
     * Adaptation: JS assignment replaces Blue field storage, narrowing to native float32.
     * @param {number} value New descriptor component.
     * @returns {void} Updates only the descriptor.
     */
    set radius(value) { this.mRadius = Math.fround(value); }

    /**
     * Reads the descriptor's x component.
     * Adaptation: a JS accessor exposes native backing storage without schema APIs.
     * Blue row: Miniball_Blue.cpp:35 MAP_ATTRIBUTE READWRITE | NOTIFY | PERSIST.
     * @returns {number} Stored descriptor value, independent of any world collider.
     */
    get x() { return this.mPos[0]; }

    /**
     * Writes the descriptor's x component without updating existing colliders.
     * Adaptation: JS assignment replaces Blue field storage.
     * @param {number} value New descriptor component.
     * @returns {void} Updates only the descriptor.
     */
    set x(value) { this.mPos[0] = value; }

    /**
     * Reads the descriptor's y component.
     * Adaptation: a JS accessor exposes native backing storage without schema APIs.
     * Blue row: Miniball_Blue.cpp:45 MAP_ATTRIBUTE READWRITE | NOTIFY | PERSIST.
     * @returns {number} Stored descriptor value, independent of any world collider.
     */
    get y() { return this.mPos[1]; }

    /**
     * Writes the descriptor's y component without updating existing colliders.
     * Adaptation: JS assignment replaces Blue field storage.
     * @param {number} value New descriptor component.
     * @returns {void} Updates only the descriptor.
     */
    set y(value) { this.mPos[1] = value; }

    /**
     * Reads the descriptor's z component.
     * Adaptation: a JS accessor exposes native backing storage without schema APIs.
     * Blue row: Miniball_Blue.cpp:55 MAP_ATTRIBUTE READWRITE | NOTIFY | PERSIST.
     * @returns {number} Stored descriptor value, independent of any world collider.
     */
    get z() { return this.mPos[2]; }

    /**
     * Writes the descriptor's z component without updating existing colliders.
     * Adaptation: JS assignment replaces Blue field storage.
     * @param {number} value New descriptor component.
     * @returns {void} Updates only the descriptor.
     */
    set z(value) { this.mPos[2] = value; }
}

// Native self-interface admission for BlueList<MiniBall>; no simulation schema lookup.
// BlueList admits items through the runtime exposure table, which has no non-schema registration API.
blue.interface()(CjsDestinyMiniBall, { kind: "class" });
