import { meta } from "@carbonenginejs/runtime/schema";
import { MapOfLongLongs } from "./MapOfLongLongs.js";

// Source: destiny/src/Ball.h:31-40
/** Native sensor state; owning Ballpark scanning and notification remain separate obligations. */
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
