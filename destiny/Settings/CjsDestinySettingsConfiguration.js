import { meta, blue, type } from "@carbonenginejs/runtime/schema";

// Source: destiny/src/Settings.h
// Source: destiny/src/Settings_Blue.cpp
// Source: blueexposure/include/BlueTypeTraits.h
// Source: blueexposure/BlueVariable.cpp
// Source: blueexposure/BlueExtractArgument.cpp
const configurations = new WeakSet();

export const g_collisionMaxIterationsDefault = 20n;
export const g_useIterativeCollisionDefault = false;
export const g_useDynamicalOrientationDefault = false;
export const g_disableDynamicalOrientationForMissilesDefault = false;
export const g_useNewOrbitDefault = false;

/** Mutable, detached configuration of Carbon's five global Destiny settings. */
@meta.define({ className: "CjsDestinySettingsConfiguration", modelledOn: "SettingsConfiguration" })
export class CjsDestinySettingsConfiguration
{
    m_collisionMaxIterations = g_collisionMaxIterationsDefault;
    m_useIterativeCollision = g_useIterativeCollisionDefault;
    m_useDynamicalOrientation = g_useDynamicalOrientationDefault;
    m_disableDynamicalOrientationForMissiles = g_disableDynamicalOrientationForMissilesDefault;
    m_useNewOrbit = g_useNewOrbitDefault;

    /**
     * Initializes native defaults independently of the currently applied settings.
     * Adaptation: a weak brand implements the native SettingsConfigurationPtr cast
     * without RTTI, schema casting or hydration. Subclasses retain the native base identity.
     *
     * @returns {CjsDestinySettingsConfiguration} Fresh default configuration.
     */
    constructor()
    {
        configurations.add(this);
    }

    /**
     * Checks the constructed native configuration identity for ApplyConfiguration.
     * JS adaptation: the weak brand replaces the native Blue interface cast.
     *
     * @param {unknown} value Candidate configuration.
     * @returns {boolean} Whether construction established the configuration identity.
     */
    static _isConfiguration(value)
    {
        return configurations.has(value);
    }

    /**
     * Reads the native collision iteration cap without enforcing its recommendation.
     * Adaptation: the Windows64 size_t boundary uses exact unsigned BigInt storage.
     *
     * Blue row: Settings_Blue.cpp:27 MAP_ATTRIBUTE READWRITE.
     * @returns {bigint} Maximum iterative-collision iterations; zero is accepted.
     */
    @blue.readwrite
    @type.uint64
    @meta.adapted
    get collisionMaxIterations()
    {
        return this.m_collisionMaxIterations;
    }

    /**
     * Writes the native Windows64 unsigned-size_t field.
     * Adaptation: BigInt and safe integer Numbers replace Python integers; booleans
     * retain Python's integer-subtype conversion. No minimum of ten is imposed.
     *
     * @param {bigint|number|boolean} value Unsigned 64-bit iteration count.
     * @returns {void} No return value.
     * @throws {RangeError} If an integer is unsafe, negative or outside uint64.
     * @throws {TypeError} If the value has no supported integer representation.
     */
    @meta.adapted
    set collisionMaxIterations(value)
    {
        if (typeof value === "boolean") value = value ? 1n : 0n;
        if (typeof value === "number")
        {
            if (!Number.isSafeInteger(value)) throw new RangeError("Iteration count must be an exact integer");
            value = BigInt(value);
        }
        if (typeof value !== "bigint") throw new TypeError("Iteration count must be an integer");
        if (value < 0n || value > 18446744073709551615n) throw new RangeError("Iteration count must fit uint64");
        this.m_collisionMaxIterations = value;
    }

    /**
     * Reads the native iterative-collision switch.
     *
     * Blue row: Settings_Blue.cpp:35 MAP_ATTRIBUTE READWRITE.
     * @returns {boolean} Whether iterative collision is selected globally when applied.
     */
    @blue.readwrite
    @type.boolean
    @meta.implemented
    get useIterativeCollision()
    {
        return this.m_useIterativeCollision;
    }

    /**
     * Writes the iterative-collision switch using the native integer-to-bool rule.
     * Adaptation: the checked JS boundary rejects unsupported Python-long overflow.
     *
     * @param {boolean|number|bigint} value Boolean or signed-int32 integer; nonzero means true.
     * @returns {void} No return value.
     */
    @meta.adapted
    set useIterativeCollision(value)
    {
        this.m_useIterativeCollision = CjsDestinySettingsConfiguration._toBoolean(value);
    }

    /**
     * Reads the native dynamical-orientation switch.
     *
     * Blue row: Settings_Blue.cpp:42 MAP_ATTRIBUTE READWRITE.
     * @returns {boolean} Whether dynamical orientation is selected when applied.
     */
    @blue.readwrite
    @type.boolean
    @meta.implemented
    get useDynamicalOrientation()
    {
        return this.m_useDynamicalOrientation;
    }

    /**
     * Writes the dynamical-orientation switch using the native integer-to-bool rule.
     * Adaptation: the checked JS boundary rejects unsupported Python-long overflow.
     *
     * @param {boolean|number|bigint} value Boolean or signed-int32 integer; nonzero means true.
     * @returns {void} No return value.
     */
    @meta.adapted
    set useDynamicalOrientation(value)
    {
        this.m_useDynamicalOrientation = CjsDestinySettingsConfiguration._toBoolean(value);
    }

    /**
     * Reads the native missile-only dynamical-orientation exception.
     *
     * Blue row: Settings_Blue.cpp:49 MAP_ATTRIBUTE READWRITE.
     * @returns {boolean} Whether missiles bypass dynamical orientation when it is enabled.
     */
    @blue.readwrite
    @type.boolean
    @meta.implemented
    get disableDynamicalOrientationForMissiles()
    {
        return this.m_disableDynamicalOrientationForMissiles;
    }

    /**
     * Writes the missile exception using the native integer-to-bool rule.
     * Adaptation: the checked JS boundary rejects unsupported Python-long overflow.
     *
     * @param {boolean|number|bigint} value Boolean or signed-int32 integer; nonzero means true.
     * @returns {void} No return value.
     */
    @meta.adapted
    set disableDynamicalOrientationForMissiles(value)
    {
        this.m_disableDynamicalOrientationForMissiles = CjsDestinySettingsConfiguration._toBoolean(value);
    }

    /**
     * Reads the native choice between new and legacy orbit.
     *
     * Blue row: Settings_Blue.cpp:56 MAP_ATTRIBUTE READWRITE.
     * @returns {boolean} Whether the new orbit algorithm is selected when applied.
     */
    @blue.readwrite
    @type.boolean
    @meta.implemented
    get useNewOrbit()
    {
        return this.m_useNewOrbit;
    }

    /**
     * Writes the orbit switch using the native integer-to-bool rule.
     * Adaptation: the checked JS boundary rejects unsupported Python-long overflow.
     *
     * @param {boolean|number|bigint} value Boolean or signed-int32 integer; nonzero means true.
     * @returns {void} No return value.
     */
    @meta.adapted
    set useNewOrbit(value)
    {
        this.m_useNewOrbit = CjsDestinySettingsConfiguration._toBoolean(value);
    }

    /**
     * Converts the native Windows Python-long bool boundary without JS truthiness.
     * JS adaptation: booleans and exact signed-int32 integers are accepted; strings,
     * fractions and containers are not. Out-of-range values throw before mutation
     * instead of reproducing blueexposure/BlueExtractArgument.cpp:54-65's unchecked error result.
     *
     * @param {boolean|number|bigint} value Native boolean or supported integer.
     * @returns {boolean} Whether the native integer is nonzero.
     * @throws {TypeError} If the input is not boolean or an integer.
     * @throws {RangeError} If the integer is outside signed int32.
     */
    static _toBoolean(value)
    {
        if (typeof value === "boolean") return value;
        if (typeof value === "number" && Number.isInteger(value)) value = BigInt(value);
        if (typeof value !== "bigint") throw new TypeError("Setting flags require boolean or integer values");
        if (value < -2147483648n || value > 2147483647n) throw new RangeError("Setting flags require signed-int32 integers");
        return value !== 0n;
    }
}
