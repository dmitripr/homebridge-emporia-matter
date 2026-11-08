import type { PersistedChannelEnergy } from './storage.js';

export type ChannelEnergy = PersistedChannelEnergy;

/**
 * Integrates live power into cumulative imported/exported energy.
 *
 * The Emporia API reports energy over a short window, not a lifetime counter,
 * so the plugin keeps the running total itself. The total is persisted by the
 * platform and is intentionally monotonic for imported energy.
 */
export class EnergyTracker {
  private readonly channels = new Map<string, ChannelEnergy>();

  constructor(private readonly maxElapsedMs = 10 * 60 * 1000) {}

  restore(state: Record<string, PersistedChannelEnergy>): void {
    this.channels.clear();
    for (const [key, value] of Object.entries(state)) {
      if (
        Number.isFinite(value.importedMwh)
        && Number.isFinite(value.exportedMwh)
        && Number.isFinite(value.lastMs)
      ) {
        this.channels.set(key, { ...value });
      }
    }
  }

  serialize(): Record<string, PersistedChannelEnergy> {
    return Object.fromEntries([...this.channels.entries()].map(([key, value]) => [key, { ...value }]));
  }

  get(key: string): ChannelEnergy | undefined {
    const value = this.channels.get(key);
    return value ? { ...value } : undefined;
  }

  /**
   * Add the energy represented by `powerWatts` since the previous update.
   * A `null` power means "no reading": the timestamp advances but nothing is
   * integrated, so a later reading does not fill the gap with stale power.
   */
  update(key: string, powerWatts: number | null, nowMs: number, solar: boolean): ChannelEnergy {
    const current = this.channels.get(key) ?? { importedMwh: 0, exportedMwh: 0, lastMs: nowMs };

    if (powerWatts === null || !Number.isFinite(powerWatts)) {
      current.lastMs = nowMs;
      this.channels.set(key, current);
      return { ...current };
    }

    const elapsedMs = current.lastMs > 0 ? Math.min(Math.max(0, nowMs - current.lastMs), this.maxElapsedMs) : 0;
    if (elapsedMs > 0) {
      const energyMwh = (powerWatts * 1000 * elapsedMs) / 3_600_000;
      if (energyMwh >= 0) {
        current.importedMwh += energyMwh;
      } else if (solar) {
        current.exportedMwh += -energyMwh;
      }
    }

    current.lastMs = nowMs;
    this.channels.set(key, current);
    return { ...current };
  }
}
