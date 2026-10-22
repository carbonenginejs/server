import { MapOfLongLongs } from "./MapOfLongLongs.js";

// Source: destiny/src/Ball.h:31-40
/** Stores periodic sensor timing and contacts; Ball scans and Ballpark schedules checks. */
/**
 * Modelled on: ProximitySensor (destiny/src/Ball.h:31-40)
 */
export class ProximitySensor
{
    range = 0;

    period = 2;

    elapsed = 0;

    active = false;

    onlyInteractives = false;

    balls = new MapOfLongLongs();
}
