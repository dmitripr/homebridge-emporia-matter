/**
 * Emporia usage values are energy (kWh) over the requested scale window, not
 * power. These helpers convert them to the raw Matter units.
 */

const SCALE_SECONDS: Record<string, number> = {
  '1S': 1,
  '1MIN': 60,
  '15MIN': 15 * 60,
  '1H': 60 * 60,
  '1D': 24 * 60 * 60,
  '1W': 7 * 24 * 60 * 60,
  '1MON': 30 * 24 * 60 * 60,
  '1Y': 365 * 24 * 60 * 60,
};

export function scaleToSeconds(scale: string): number {
  const seconds = SCALE_SECONDS[scale];
  if (!seconds) {
    throw new Error(`Unsupported Emporia scale: ${scale}`);
  }
  return seconds;
}

/**
 * Convert kWh measured over `scale` to average watts over that window.
 * For 1MIN this is `kWh * 60_000`.
 */
export function kwhToWatts(kwh: number, scale: string): number {
  return (kwh * 3_600_000) / scaleToSeconds(scale);
}

export function wattsToMilliwatts(watts: number): number {
  return Math.round(watts * 1000);
}

export function kwhToMilliwattHours(kwh: number): number {
  return Math.round(kwh * 1_000_000);
}

export function milliwattHoursToKwh(mwh: number): number {
  return mwh / 1_000_000;
}

/**
 * Convert active power (mW) to current (mA) at a known voltage (mV).
 * P(mW) = V(mV) * I(mA) / 1000, so I = P * 1000 / V.
 */
export function milliwattsToMilliamps(powerMw: number, voltageMv: number): number {
  if (voltageMv <= 0) {
    return 0;
  }
  return Math.round((powerMw * 1000) / voltageMv);
}

/**
 * True when a power change is large enough to be worth publishing.
 * Matter throttles power reports, so avoiding tiny churn keeps traffic down.
 */
export function powerChanged(previousMw: number | null | undefined, nextMw: number | null, minAbsoluteMw = 1000): boolean {
  if (previousMw === undefined) {
    return true;
  }
  if (previousMw === null || nextMw === null) {
    return previousMw !== nextMw;
  }
  return Math.abs(nextMw - previousMw) >= minAbsoluteMw;
}

/**
 * True when an energy total moved by at least `minDeltaMwh`.
 */
export function energyChanged(previousMwh: number | undefined, nextMwh: number, minDeltaMwh = 100): boolean {
  if (previousMwh === undefined) {
    return true;
  }
  return Math.abs(nextMwh - previousMwh) >= minDeltaMwh;
}
