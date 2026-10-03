// Source: destiny/python/destiny/net/client/_util.py:6-68.
/**
 * Merges stamped events into the native mutable history list.
 * Adaptation: Map and arrays replace Python dictionaries/lists. The live list
 * iteration, append-loop wait propagation and empty-input indexing failure are
 * retained; this is not a replacement sorted-merge algorithm.
 * @param {Array} state Events shaped [stamp, [method, args]].
 * @param {Array} history_list Mutable [events, waitForBubble] entries.
 * @param {boolean} wait_for_bubble Whether the incoming group awaits bubble events.
 * @returns {void} Mutates history, retaining event references.
 */
export function merge_state_into_history(state, history_list, wait_for_bubble)
{
    const entries_by_time = new Map();
    for (const entry of state)
    {
        if (!entries_by_time.has(entry[0])) entries_by_time.set(entry[0], []);
        entries_by_time.get(entry[0]).push(entry);
    }
    const time_list = Array.from(entries_by_time.keys()).sort((a, b) => a - b);
    let time_list_idx = 0;
    for (let history_idx = 0; history_idx < history_list.length; ++history_idx)
    {
        const history_time_entries = history_list[history_idx], history_time = history_time_entries[0][0][0];
        if (time_list_idx >= time_list.length) throw new RangeError("Empty incoming timestamp list with nonempty history");
        const entry_time = time_list[time_list_idx];
        if (history_time < entry_time) { wait_for_bubble = false; continue; }
        if (history_time === entry_time)
        {
            for (const entry of entries_by_time.get(entry_time)) history_time_entries[0].push(entry);
            history_time_entries[1] = false;
        }
        else
        {
            history_list.splice(history_idx, 0, [entries_by_time.get(entry_time), wait_for_bubble]);
            wait_for_bubble = false;
        }
        ++time_list_idx;
        if (time_list_idx >= time_list.length) break;
    }
    for (let i = time_list_idx; i < time_list.length; ++i)
        history_list.push([entries_by_time.get(time_list[i]), wait_for_bubble]);
}
