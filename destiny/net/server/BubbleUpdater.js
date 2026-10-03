import { meta } from "@carbonenginejs/runtime/schema";

// Source: destiny/python/destiny/net/server/_bubbleupdater.py:6-54.
/** Collects native bubble deltas once per simulation tick before acknowledging them. */
@meta.define({ className: "DestinyServerBubbleUpdater", carbon: "destiny.net.server.BubbleUpdater" })
export class BubbleUpdater
{
    _park = null;
    _tick = null;
    additions_per_player = new Map();
    deletions_per_player = new Map();
    additions_per_bubble = new Map();
    deletions_per_bubble = new Map();

    /**
     * Retains the native ballpark dependency.
     * Adaptation: Maps replace Python dictionaries; no user list exists until processing.
     * @param {CjsBallparkController} park Park whose tracking maps are consumed.
     * @returns {BubbleUpdater} Updater with no acknowledged tick.
     */
    constructor(park) { this._park = park; }

    /**
     * Calculates deltas, acknowledges markers, then caches the current tick.
     * @returns {void} Repeated calls in the same tick retain the previous outputs.
     */
    @meta.implemented
    additions_and_deletions()
    {
        if (this._tick !== this._park.currentTime)
        {
            this._process_additions_and_deletions_for_tick();
            this._park.CopyBubbles();
            this._tick = this._park.currentTime;
        }
    }

    /**
     * Flattens interactive membership and replaces output maps before calculation.
     * Adaptation: nested iteration replaces itertools.chain without argument spread;
     * Maps and arrays retain native dictionary/list identities and order.
     * @returns {void} Failures leave the new maps installed and the tick unacknowledged.
     */
    @meta.adapted
    _process_additions_and_deletions_for_tick()
    {
        this.user_balls = [];
        for (const entries of this._park.bubbleInteractives.values())
            for (const id of entries) this.user_balls.push(id);
        this.additions_per_player = new Map(); this.deletions_per_player = new Map();
        this.additions_per_bubble = new Map(); this.deletions_per_bubble = new Map();
        this._park.AdditionsAndDeletions(this.additions_per_player, this.deletions_per_player,
            this.additions_per_bubble, this.deletions_per_bubble, this.user_balls);
    }
}
