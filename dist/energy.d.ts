import type { PersistedChannelEnergy } from './storage.js';
export type ChannelEnergy = PersistedChannelEnergy;
/**
 * Integrates live power into cumulative imported/exported energy.
 *
 * The Emporia API reports energy over a short window, not a lifetime counter,
 * so the plugin keeps the running total itself. The total is persisted by the
 * platform and is intentionally monotonic for imported energy.
 */
export declare class EnergyTracker {
    private readonly maxElapsedMs;
    private readonly channels;
    constructor(maxElapsedMs?: number);
    restore(state: Record<string, PersistedChannelEnergy>): void;
    serialize(): Record<string, PersistedChannelEnergy>;
    get(key: string): ChannelEnergy | undefined;
    /**
     * Add the energy represented by `powerWatts` since the previous update.
     * A `null` power means "no reading": the timestamp advances but nothing is
     * integrated, so a later reading does not fill the gap with stale power.
     */
    update(key: string, powerWatts: number | null, nowMs: number, solar: boolean): ChannelEnergy;
}
