import { meta } from "@carbonenginejs/runtime/schema";

// Source: destiny/python/destiny/_util/timing.py:8-32.
/**
 * Wraps a synchronous function in the native tasklet timer entry/return sequence.
 * Adaptation: the caller supplies Blue's unavailable taskletTimer service; JS this
 * and argument tuples replace Python dispatch. Return happens when a promise is
 * returned, not when it settles. Name and __wrapped__ retain functools.wraps identity.
 * @param {string} context Native profiling label.
 * @param {Object} taskletTimer Host with EnterTasklet and ReturnFromTasklet methods.
 * @returns {Function} Decorator accepting and returning an ordinary function.
 */
export function TimedFunction(context, taskletTimer)
{
    return function decorator(fn)
    {
        function Wrapper(...args)
        {
            const token = taskletTimer.EnterTasklet(context);
            try { return Reflect.apply(fn, this, args); }
            finally { taskletTimer.ReturnFromTasklet(token); }
        }
        Object.defineProperty(Wrapper, "name", { value: fn.name, configurable: true });
        Wrapper.__wrapped__ = fn;
        return Wrapper;
    };
}

/** Native profiling context retaining the token returned by the host timer. */
@meta.define({ className: "DestinyTimer", carbon: "destiny._util.timing.Timer" })
export class Timer
{
    ctxt = null;
    _taskletTimer = null;

    /**
     * Retains context and the explicit external profiling service.
     * Adaptation: JS has no blue module global or Python __slots__ restriction.
     * @param {string} context Initial profiling label.
     * @param {Object} taskletTimer Synchronous EnterTasklet/ReturnFromTasklet host.
     * @returns {Timer} Context ready for explicit enter/exit with try/finally.
     */
    constructor(context, taskletTimer) { this.ctxt = context; this._taskletTimer = taskletTimer; }

    /**
     * Replaces the context with the returned host token.
     * Adaptation: explicit invocation replaces Python with-statement entry.
     * @returns {void} Does not return the context manager or token.
     */
    @meta.adapted
    __enter__() { this.ctxt = this._taskletTimer.EnterTasklet(this.ctxt); }

    /**
     * Returns the stored token without suppressing the caller's exception.
     * Adaptation: callers use finally; Python exception arguments are unused.
     * @returns {void} Keeps ctxt unchanged, including on a second entry.
     */
    @meta.adapted
    __exit__() { this._taskletTimer.ReturnFromTasklet(this.ctxt); }
}
