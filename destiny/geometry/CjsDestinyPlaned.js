import { meta } from "@carbonenginejs/runtime/schema";
import { vec3 } from "@carbonenginejs/runtime/math/vec3";
import { vec3d } from "../math/vec3d.js";

// Source: destiny/src/Plane.h; destiny/src/Plane.cpp
/** Carbon plane with an unnormalized, double-precision normal and dot offset. */
@meta.define({ className: "CjsDestinyPlaned", modelledOn: "Planed" })
export class CjsDestinyPlaned
{
    d = 0;

    normal = vec3d.create();

    /**
     * Copies the normal by value and calculates d without normalizing it.
     *
     * @param {number[]|Float64Array} point Point on the plane.
     * @param {number[]|Float64Array} normal Plane normal, copied without normalization.
     * @returns {CjsDestinyPlaned} New instance with its own native value fields.
     */
    constructor(point, normal)
    {
        this.d = vec3.dot(point, normal);
        vec3.copy(this.normal, normal);
    }
}
