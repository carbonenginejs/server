import { meta, type } from "@carbonenginejs/runtime/schema";
import { MapOfLongLongs } from "./MapOfLongLongs.js";

// Source: destiny/src/Ball.h:31-40
/** Stores periodic sensor timing and contacts; Ball scans and Ballpark schedules checks. */
@meta.define({ className: "ProximitySensor", modelledOn: "ProximitySensor" })
export class ProximitySensor
{
    @type.float32
    range = 0;

    @type.float64
    period = 2;

    @type.float64
    elapsed = 0;

    @type.boolean
    active = false;

    @type.boolean
    onlyInteractives = false;

    balls = new MapOfLongLongs();
}
