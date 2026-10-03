import { meta } from "@carbonenginejs/runtime/schema";
import { MapOfLongLongs } from "./MapOfLongLongs.js";

// Source: destiny/src/Ball.h:31-40
/** Stores periodic sensor timing and contacts; Ball scans and Ballpark schedules checks. */
@meta.define({ className: "ProximitySensor", modelledOn: "ProximitySensor" })
export class ProximitySensor
{
    @meta.type.float32
    range = 0;

    @meta.type.float64
    period = 2;

    @meta.type.float64
    elapsed = 0;

    @meta.type.boolean
    active = false;

    @meta.type.boolean
    onlyInteractives = false;

    balls = new MapOfLongLongs();
}
