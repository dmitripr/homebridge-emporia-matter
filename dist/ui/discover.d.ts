import type { EmporiaDevice } from '../emporia/types.js';
export interface DiscoveryChannel {
    channelId: string;
    label: string;
    defaultName: string;
    defaultExposed: boolean;
    hasData: boolean;
    hasMainTotal: boolean;
}
export interface DiscoveryDevice {
    deviceGid: number;
    deviceName: string;
    model?: string;
    channels: DiscoveryChannel[];
}
export interface DiscoveryResult {
    devices: DiscoveryDevice[];
}
/**
 * Shapes Emporia devices for the plugin's custom settings page.
 *
 * The page shows one editable row per discovered channel. Exposure defaults
 * are computed with the user's current settings but without any channel
 * overrides, so the rows describe what the plugin would do if the override
 * list were empty.
 */
export declare function buildDiscovery(config: Record<string, unknown>, devices: readonly EmporiaDevice[]): DiscoveryResult;
