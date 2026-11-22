import { be } from "@carbonenginejs/runtime/schema";
import { IRoot } from "@carbonenginejs/runtime/blue";
import { vec3d } from "./math/vec3d.js";

// Source: destiny/src/MiniBall.h
// Source: destiny/src/MiniBall.cpp
// Source: destiny/src/Miniball_Blue.cpp
/**
 * Carbon MiniBall descriptor, separate from its materialized world collider.
 * Adaptation: owned f64 views and JS accessors replace native value fields;
 * GC replaces IRoot locking. Native Python constructors remain outside this surface.
 *
 * Carbon: MiniBall (destiny/src/MiniBall.h:14-31)
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

// Miniball_Blue.cpp:9-71, in Carbon's order; IRoot is the C++ base (MiniBall.h:14-15). The class's own MAP_INTERFACE entry lets
// BlueList<MiniBall> admit it. MAP_METHOD_AS_METHOD __init__ (Py__init__) is Python's constructor and is not mapped.
be.define({
  name: "MiniBall",
  inherit: [ IRoot ],
  interfaces: [ IRoot, CjsDestinyMiniBall ],
  members: [
    [ be.ATTR, "id", be.READ, "mId" ],
    [ be.ATTR, "radius", be.READWRITE | be.NOTIFY | be.PERSIST, "mRadius" ],
    [ be.ATTR_INDEX, "x", be.READWRITE | be.NOTIFY | be.PERSIST, 0, "mPos" ],
    [ be.ATTR_INDEX, "y", be.READWRITE | be.NOTIFY | be.PERSIST, 1, "mPos" ],
    [ be.ATTR_INDEX, "z", be.READWRITE | be.NOTIFY | be.PERSIST, 2, "mPos" ]
  ]
})(CjsDestinyMiniBall);
