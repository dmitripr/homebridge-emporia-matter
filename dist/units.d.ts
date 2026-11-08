/**
 * Emporia usage values are energy (kWh) over the requested scale window, not
 * power. These helpers convert them to the raw Matter units.
 */
export declare function scaleToSeconds(scale: string): number;
/**
 * Convert kWh measured over `scale` to average watts over that window.
 * For 1MIN this is `kWh * 60_000`.
 */
export declare function kwhToWatts(kwh: number, scale: string): number;
export declare function wattsToMilliwatts(watts: number): number;
export declare function kwhToMilliwattHours(kwh: number): number;
export declare function milliwattHoursToKwh(mwh: number): number;
/**
 * Convert active power (mW) to current (mA) at a known voltage (mV).
 * P(mW) = V(mV) * I(mA) / 1000, so I = P * 1000 / V.
 */
export declare function milliwattsToMilliamps(powerMw: number, voltageMv: number): number;
/**
 * True when a power change is large enough to be worth publishing.
 * Matter throttles power reports, so avoiding tiny churn keeps traffic down.
 */
export declare function powerChanged(previousMw: number | null | undefined, nextMw: number | null, minAbsoluteMw?: number): boolean;
/**
 * True when an energy total moved by at least `minDeltaMwh`.
 */
export declare function energyChanged(previousMwh: number | undefined, nextMwh: number, minDeltaMwh?: number): boolean;
