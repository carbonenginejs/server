import { meta } from "@carbonenginejs/runtime/schema";
import {
    CjsDestinySettingsConfiguration, g_collisionMaxIterationsDefault,
    g_useIterativeCollisionDefault, g_useDynamicalOrientationDefault,
    g_disableDynamicalOrientationForMissilesDefault, g_useNewOrbitDefault
} from "./CjsDestinySettingsConfiguration.js";

// Source: destiny/src/Settings.h
// Source: destiny/src/Settings.cpp
// Source: destiny/src/Settings_Blue.cpp
export let g_collisionMaxIterations = g_collisionMaxIterationsDefault;
export let g_useIterativeCollision = g_useIterativeCollisionDefault;
export let g_useDynamicalOrientation = g_useDynamicalOrientationDefault;
export let g_disableDynamicalOrientationForMissiles = g_disableDynamicalOrientationForMissilesDefault;
export let g_useNewOrbit = g_useNewOrbitDefault;

/** Copies and resets the native Destiny globals shared by all ballparks. */
@meta.define({ className: "CjsDestinyGlobalSettings", modelledOn: "GlobalSettings" })
export class CjsDestinyGlobalSettings
{
    /**
     * Copies all five values from a native-shaped configuration into live globals.
     * Adaptation: direct JS arguments replace the Python tuple; a constructor brand
     * implements SettingsConfigurationPtr without simulation schema machinery.
     * Selecting an unported algorithm is allowed; execution reports that gap.
     *
     * @param {CjsDestinySettingsConfiguration} config Configuration whose values are copied.
     * @returns {void} No return value, corresponding to Python None.
     * @throws {TypeError} If config was not constructed as a SettingsConfiguration.
     */
    @meta.blue.method
    @meta.adapted
    ApplyConfiguration(config)
    {
        if (!CjsDestinySettingsConfiguration._isConfiguration(config))
        {
            throw new TypeError("Argument 1 is not a SettingsConfiguration");
        }
        g_collisionMaxIterations = config.m_collisionMaxIterations;
        g_useIterativeCollision = config.m_useIterativeCollision;
        g_useDynamicalOrientation = config.m_useDynamicalOrientation;
        g_disableDynamicalOrientationForMissiles = config.m_disableDynamicalOrientationForMissiles;
        g_useNewOrbit = config.m_useNewOrbit;
    }

    /**
     * Returns a fresh snapshot of the active native globals.
     * Adaptation: a JS instance replaces allocation plus BlueWrapObjectForPython.
     *
     * @returns {CjsDestinySettingsConfiguration} Detached active configuration.
     */
    @meta.blue.method
    @meta.adapted
    GetConfiguration()
    {
        const config = new CjsDestinySettingsConfiguration();
        config.collisionMaxIterations = g_collisionMaxIterations;
        config.useIterativeCollision = g_useIterativeCollision;
        config.useDynamicalOrientation = g_useDynamicalOrientation;
        config.disableDynamicalOrientationForMissiles = g_disableDynamicalOrientationForMissiles;
        config.useNewOrbit = g_useNewOrbit;
        return config;
    }

    /**
     * Returns a fresh default configuration independent of active globals.
     * Adaptation: the JS constructor supplies the same native field defaults.
     *
     * @returns {CjsDestinySettingsConfiguration} Detached default configuration.
     */
    @meta.blue.method
    @meta.adapted
    GetDefaultConfiguration()
    {
        return new CjsDestinySettingsConfiguration();
    }

    /**
     * Restores every global to its native default without changing snapshots.
     *
     * @returns {void} No return value, corresponding to Python None.
     */
    @meta.blue.method
    @meta.implemented
    ResetConfiguration()
    {
        g_collisionMaxIterations = g_collisionMaxIterationsDefault;
        g_useIterativeCollision = g_useIterativeCollisionDefault;
        g_useDynamicalOrientation = g_useDynamicalOrientationDefault;
        g_disableDynamicalOrientationForMissiles = g_disableDynamicalOrientationForMissilesDefault;
        g_useNewOrbit = g_useNewOrbitDefault;
    }

    /**
     * Exposes the native Blue Apply spelling on the same owner.
     * Adaptation: an explicit JS delegate replaces MAP_METHOD_AS_METHOD aliasing.
     *
     * @param {CjsDestinySettingsConfiguration} config Configuration to copy.
     * @returns {void} No return value.
     */
    @meta.renamed("ApplyConfiguration")
    @meta.adapted
    Apply(config)
    {
        this.ApplyConfiguration(config);
    }

    /**
     * Exposes the native Blue Get spelling on the same owner.
     * Adaptation: an explicit JS delegate replaces native method aliasing.
     *
     * @returns {CjsDestinySettingsConfiguration} Fresh active snapshot.
     */
    @meta.renamed("GetConfiguration")
    @meta.adapted
    Get()
    {
        return this.GetConfiguration();
    }

    /**
     * Exposes the native Blue GetDefault spelling on the same owner.
     * Adaptation: an explicit JS delegate replaces native method aliasing.
     *
     * @returns {CjsDestinySettingsConfiguration} Fresh default snapshot.
     */
    @meta.renamed("GetDefaultConfiguration")
    @meta.adapted
    GetDefault()
    {
        return this.GetDefaultConfiguration();
    }

    /**
     * Exposes the native Blue Reset spelling on the same owner.
     * Adaptation: an explicit JS delegate replaces native method aliasing.
     *
     * @returns {void} No return value.
     */
    @meta.renamed("ResetConfiguration")
    @meta.adapted
    Reset()
    {
        this.ResetConfiguration();
    }
}

export const s_globalSettings = new CjsDestinyGlobalSettings();
