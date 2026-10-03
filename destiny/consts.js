// Source: destiny/src/IDstConstants.h:74-80
// Source: destiny/src/DstConstants.h:16-39
/**
 * Native Destiny constants shared by ballpark commands and their consumers.
 * Adaptation: the named enum object replaces Python's flattened module constants.
 * The local-ID seed stays a Number enum value; counters convert it to BigInt.
 */
export const DSTCONSTANTS = Object.freeze({
    DSTLOCALBALLS: -1073741824,
    DSTNORMALCLOAK: 1,
    DSTRESTORECLOAK: 2,
    DSTGMCLOAK: 3
});
