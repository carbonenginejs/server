import { s_globalSettings as settings } from "../Settings/CjsDestinyGlobalSettings.js";

// Source: destiny/python/destiny/_util/settings.py

/**
 * Reads the active native dynamical-orientation flag.
 *
 * @returns {boolean} Whether dynamical orientation is enabled.
 */
export function is_dynamical_orientation_enabled()
{
    const config = settings.Get();
    return config.useDynamicalOrientation;
}

/**
 * Enables native dynamical orientation while preserving the other settings.
 *
 * @returns {void} No return value.
 */
export function enable_dynamical_orientation()
{
    const config = settings.Get();
    config.useDynamicalOrientation = true;
    settings.Apply(config);
}

/**
 * Disables native dynamical orientation while preserving the other settings.
 *
 * @returns {void} No return value.
 */
export function disable_dynamical_orientation()
{
    const config = settings.Get();
    config.useDynamicalOrientation = false;
    settings.Apply(config);
}

/**
 * Restores native defaults by applying a fresh default configuration.
 *
 * @returns {void} No return value.
 */
export function reset_settings_to_default()
{
    const config = settings.GetDefault();
    settings.Apply(config);
}

/**
 * Enables native new orbit while preserving the other settings.
 *
 * @returns {void} No return value.
 */
export function enable_new_orbit()
{
    const config = settings.Get();
    config.useNewOrbit = true;
    settings.Apply(config);
}
