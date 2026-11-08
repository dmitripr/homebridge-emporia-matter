import { describe, expect, it } from 'vitest';

import { EnergyTracker } from '../src/energy.js';

describe('EnergyTracker', () => {
  it('integrates power over elapsed time in milliwatt-hours', () => {
    const tracker = new EnergyTracker();
    tracker.update('a', 1000, 1_000_000, false);
    const result = tracker.update('a', 1000, 1_060_000, false);
    expect(result.importedMwh).toBeCloseTo(16_666.67, 1);
    expect(result.exportedMwh).toBe(0);
  });

  it('does not integrate while the reading is unavailable, and does not fill the gap later', () => {
    const tracker = new EnergyTracker();
    tracker.update('a', 1000, 1_000_000, false);
    tracker.update('a', null, 1_060_000, false);
    const result = tracker.update('a', 1000, 1_120_000, false);
    expect(result.importedMwh).toBeCloseTo(16_666.67, 1);
  });

  it('caps a long gap so a sleep or outage does not create a huge jump', () => {
    const tracker = new EnergyTracker(60_000);
    tracker.update('a', 1000, 1_000_000, false);
    const result = tracker.update('a', 1000, 10_000_000, false);
    expect(result.importedMwh).toBeCloseTo(16_666.67, 1);
  });

  it('clamps negative power for import-only circuits', () => {
    const tracker = new EnergyTracker();
    tracker.update('a', 1000, 1_000_000, false);
    tracker.update('a', 1000, 1_060_000, false);
    const result = tracker.update('a', -1000, 1_120_000, false);
    expect(result.importedMwh).toBeCloseTo(16_666.67, 1);
    expect(result.exportedMwh).toBe(0);
  });

  it('tracks exported energy when solar is enabled', () => {
    const tracker = new EnergyTracker();
    tracker.update('a', 1000, 1_000_000, true);
    tracker.update('a', 1000, 1_060_000, true);
    const result = tracker.update('a', -1000, 1_120_000, true);
    expect(result.importedMwh).toBeCloseTo(16_666.67, 1);
    expect(result.exportedMwh).toBeCloseTo(16_666.67, 1);
  });

  it('restores and serializes state', () => {
    const tracker = new EnergyTracker();
    tracker.restore({
      a: { importedMwh: 1234, exportedMwh: 56, lastMs: 1000 },
    });
    expect(tracker.get('a')).toEqual({ importedMwh: 1234, exportedMwh: 56, lastMs: 1000 });
    expect(tracker.serialize()).toEqual({
      a: { importedMwh: 1234, exportedMwh: 56, lastMs: 1000 },
    });
  });

  it('ignores malformed restored entries', () => {
    const tracker = new EnergyTracker();
    tracker.restore({
      good: { importedMwh: 1, exportedMwh: 0, lastMs: 1000 },
      bad: { importedMwh: Number.NaN, exportedMwh: 0, lastMs: 1000 },
    });
    expect(tracker.get('good')).toBeDefined();
    expect(tracker.get('bad')).toBeUndefined();
  });
});
