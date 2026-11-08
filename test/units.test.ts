import { describe, expect, it } from 'vitest';

import {
  energyChanged,
  kwhToMilliwattHours,
  kwhToWatts,
  milliwattsToMilliamps,
  powerChanged,
  scaleToSeconds,
  wattsToMilliwatts,
} from '../src/units.js';

describe('unit conversions', () => {
  it('converts kWh over one second to watts', () => {
    expect(kwhToWatts(0.001, '1S')).toBe(3600);
  });

  it('converts kWh over one minute to watts', () => {
    expect(kwhToWatts(0.05, '1MIN')).toBe(3000);
  });

  it('converts kWh over fifteen minutes to watts', () => {
    expect(kwhToWatts(0.25, '15MIN')).toBe(1000);
  });

  it('converts watts to milliwatts and kWh to milliwatt-hours', () => {
    expect(wattsToMilliwatts(12.345)).toBe(12345);
    expect(kwhToMilliwattHours(1.25)).toBe(1_250_000);
  });

  it('derives current from power and voltage', () => {
    expect(milliwattsToMilliamps(1_000_000, 120_000)).toBe(8333);
    expect(milliwattsToMilliamps(1_000_000, 0)).toBe(0);
  });

  it('rejects unknown scales', () => {
    expect(() => scaleToSeconds('2MIN')).toThrow(/Unsupported/);
  });
});

describe('change detection', () => {
  it('publishes the first value and ignores tiny changes', () => {
    expect(powerChanged(undefined, 1000)).toBe(true);
    expect(powerChanged(1000, 1500)).toBe(false);
    expect(powerChanged(1000, 2500)).toBe(true);
  });

  it('treats null as a distinct state', () => {
    expect(powerChanged(null, null)).toBe(false);
    expect(powerChanged(1000, null)).toBe(true);
    expect(powerChanged(null, 1000)).toBe(true);
  });

  it('publishes energy only after a meaningful delta', () => {
    expect(energyChanged(undefined, 0)).toBe(true);
    expect(energyChanged(1000, 1050)).toBe(false);
    expect(energyChanged(1000, 1200)).toBe(true);
  });
});
