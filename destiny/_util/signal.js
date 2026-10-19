import { meta } from "@carbonenginejs/runtime/schema";

// Source: destiny/python/destiny/_util/signal.py:8-97.
/** Weakly retains slots and snapshots their live callables before synchronous delivery. */
@meta.define({ className: "DestinySignal", carbon: "destiny._util.signal.Signal" })
export class Signal
{
    _signalName = null;
    _functions = [];
    _methods = [];

    /**
     * Creates independent weak slot collections.
     * Adaptation: iterable WeakRef records replace non-iterable JS weak collections.
     * @param {string|null} [signalName=null] Optional diagnostic name.
     * @returns {Signal} Empty signal; callers retain their callbacks elsewhere.
     */
    constructor(signalName = null) { this._signalName = signalName; }

    /**
     * Describes the signal and its currently live slots.
     * Adaptation: JS supplies no Python object address/repr, so a stable class label
     * replaces it; callback string conversion supplies the connected-slot labels.
     * @returns {string} Diagnostic representation.
     */
    @meta.adapted
    __repr__()
    {
        const name = this._signalName ? `${this._signalName} ` : "";
        const slots = Array.from(this.__iter__());
        return `${name}<Signal${slots.length ? ` connected to ${slots.map(String).join(",")}` : ""}>`;
    }

    /**
     * Monitors the emission before snapshotting and delivering each live slot.
     * Adaptation: callers explicitly invoke __call__ with a bounded positional tuple
     * and keyword object; JS functions receive nonempty keywords as a final options
     * argument, freshly copied per slot like a Python keyword dictionary. JS has
     * no Python callable-class/keyword dispatch. Console replaces
     * logging.exception; monitor failures propagate but handler failures do not.
     * @param {Array} [args=[]] Positional arguments, not an expanded data collection.
     * @param {Object} [kwargs={}] Named arguments translated to a trailing options object.
     * @returns {void} Executes synchronously; promises are not awaited and later rejections are not caught.
     */
    @meta.adapted
    __call__(args = [], kwargs = {})
    {
        if (Signal._monitor_enabled && Signal._monitor_callback)
            Signal._monitor_callback(this._signalName, args, kwargs);
        for (const slot of this.__iter__())
        {
            const parameters = Object.keys(kwargs).length ? args.concat([{ ...kwargs }]) : args;
            try { Reflect.apply(slot, undefined, parameters); }
            catch (error) { console.error("Exception in signal handler", slot, error); }
        }
    }

    /**
     * Counts live function and receiver/method pairs, pruning collected references.
     * Adaptation: JS collection notification is nondeterministic; deref decides liveness.
     * @returns {number} Current connected-slot count.
     */
    @meta.adapted
    __len__()
    {
        this._compact();
        let count = this._functions.length;
        for (const entry of this._methods) count += entry.functions.length;
        return count;
    }

    /**
     * Captures live free functions followed by bound receiver methods.
     * Adaptation: JS preserves insertion order within groups; native weak sets do
     * not promise that order. A strong snapshot retains slots through reentrant edits.
     * @returns {Iterator<Function>} Detached snapshot iterator.
     */
    @meta.adapted
    __iter__()
    {
        this._compact();
        const slots = [];
        for (const ref of this._functions) { const fn = ref.deref(); if (fn) slots.push(fn); }
        for (const entry of this._methods)
        {
            const receiver = entry.receiver.deref();
            if (!receiver) continue;
            for (const ref of entry.functions) { const fn = ref.deref(); if (fn) slots.push(fn.bind(receiver)); }
        }
        return slots[Symbol.iterator]();
    }

    /**
     * Adds one weak slot, deduplicated by function and optional receiver identity.
     * Adaptation: JS bound functions hide receiver/method identity, so callers pass
     * the unbound method and receiver separately. Arrow functions are accepted:
     * JS cannot reliably classify Python lambdas. Callable JS functions are required.
     * @param {Function} slot Function or unbound receiver method.
     * @param {Object|null} [receiver=null] Explicit weak method receiver.
     * @returns {void} Duplicate connections do not add another delivery.
     */
    @meta.adapted
    connect(slot, receiver = null)
    {
        if (typeof slot !== "function") throw new TypeError("Signal connect requires a callable slot");
        this._compact();
        let refs = this._functions;
        if (receiver !== null)
        {
            let entry = this._methods.find(item => item.receiver.deref() === receiver);
            if (!entry) { entry = { receiver: new WeakRef(receiver), functions: [] }; this._methods.push(entry); }
            refs = entry.functions;
        }
        if (!refs.some(ref => ref.deref() === slot)) refs.push(new WeakRef(slot));
    }

    /**
     * Discards one slot identity; missing connections do nothing.
     * Adaptation: explicit receiver pairs replace Python bound-method inspection.
     * @param {Function} slot Previously supplied callback or unbound method.
     * @param {Object|null} [receiver=null] Receiver passed to connect.
     * @returns {void} An already captured emission snapshot remains unchanged.
     */
    @meta.adapted
    disconnect(slot, receiver = null)
    {
        this._compact();
        if (receiver === null) this._functions = this._functions.filter(ref => ref.deref() !== slot);
        else
        {
            const entry = this._methods.find(item => item.receiver.deref() === receiver);
            if (entry) entry.functions = entry.functions.filter(ref => ref.deref() !== slot);
        }
    }

    /**
     * Drops all connections without invalidating existing snapshots.
     * @returns {void} Both native slot groups become empty.
     */
    @meta.implemented
    clear() { this._functions = []; this._methods = []; }

    /**
     * Exposes the native signal label.
     * @returns {string|null} Constructor-supplied name.
     */
    @meta.implemented
    get debugDisplayName() { return this._signalName; }

    /**
     * Removes collected WeakRef records from iterable JS storage.
     * JavaScript weak collections cannot be enumerated; native WeakSet and
     * WeakKeyDictionary prune these entries automatically.
     * @returns {void} Does not retain live callbacks beyond this synchronous job.
     */
    _compact()
    {
        this._functions = this._functions.filter(ref => ref.deref() !== undefined);
        this._methods = this._methods.filter(entry => entry.receiver.deref() !== undefined);
        for (const entry of this._methods) entry.functions = entry.functions.filter(ref => ref.deref() !== undefined);
    }

    /**
     * Enables the shared monitor invoked before slot collection.
     * @param {Function} callback Receives signal name, positional tuple and keyword object.
     * @returns {void} Replaces the prior monitor for every Signal.
     */
    @meta.implemented
    static StartSignalMonitoring(callback) { this._monitor_enabled = true; this._monitor_callback = callback; }

    /**
     * Disables monitoring and releases the shared callback.
     * @returns {void} Existing slot connections remain.
     */
    @meta.implemented
    static StopSignalMonitoring() { this._monitor_enabled = false; this._monitor_callback = null; }

    static _monitor_enabled = false;
    static _monitor_callback = null;
}
