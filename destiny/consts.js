// Source: destiny/src/IDstConstants.h:74-80
// Source: destiny/src/DstConstants.h:16-39
// Source: destiny/src/IDstConstants.h:28-45
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

/** Native packet vocabulary shared by Destiny state readers and writers. */
export const DESTINYPACKETS = Object.freeze({ DESTINY_FULLSTATE: 0, DESTINY_BALLS: 1 });

/** Native ball flags shared by state encoding and its consumers. */
export const BALLFLAGS = Object.freeze({
    DSTBALL_ISFREE: 0x01,
    DSTBALL_ISGLOBAL: 0x02,
    DSTBALL_ISMASSIVE: 0x04,
    DSTBALL_ISINTERACTIVE: 0x08,
    DSTBALL_ISSPACEJUNK: 0x10,
    DSTBALL_HASMINIBOXES: 0x20,
    DSTBALL_HASMINIBALLS: 0x40,
    DSTBALL_HASMINICAPSULES: 0x80
});
