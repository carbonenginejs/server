import { meta } from "@carbonenginejs/runtime/schema";
import { vec3 } from "@carbonenginejs/runtime/math/vec3";
import { quat } from "@carbonenginejs/runtime/math/quat";
import { vec3d } from "./math/vec3d.js";

// Source: destiny/src/CollisionStructures.h:11-48
// Source: destiny/src/CollisionStructures.cpp:6-19
/**
 * Native collision impulse with owned linear and angular changes.
 * Adaptation: scalar defaults model the value-initialized new CollisionImpact()
 * used by Ballpark, including collider zero rather than the no-collision -1.
 */
@meta.define({ className: "CollisionImpact", carbon: "CollisionImpact" })
export class CollisionImpact
{
    timeOfImpact = 0;
    collider = 0n;
    velocityChange = vec3d.create();
    angularVelocityChange = vec3.create();
}

/** Native earliest-contact candidate, borrowing its collider and owning its impact. */
@meta.define({ className: "CollisionItem", carbon: "CollisionItem" })
export class CollisionItem
{
    timeOfImpact = -1;
    normal = vec3d.create();
    collider = null;
    mbIndex1 = -2;
    mbIndex2 = -2;
    impact = null;
}

/** Native collision history point with independently owned position, velocity and rotation. */
@meta.define({ className: "BallLocation", carbon: "BallLocation" })
export class BallLocation
{
    time = -1;
    collider = -1n;
    p = vec3d.create();
    v = vec3d.create();
    omega = vec3.create();
    rot = quat.create();
}
