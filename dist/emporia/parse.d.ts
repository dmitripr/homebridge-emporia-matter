import type { DeviceUsage, EmporiaDevice } from './types.js';
/**
 * Normalize the channel identifiers used by the v1 and legacy APIs.
 * Legacy responses identify channels by `channelNum` ("1,2,3", "1", "2"),
 * while v1 uses names like "Mains" and "Branch_1". Keeping one canonical
 * form makes Matter identities stable if the plugin falls back.
 */
export declare function normalizeChannelId(value: unknown, classification?: string): string | undefined;
export declare function parseDevices(payload: unknown): EmporiaDevice[];
export declare function parseUsage(payload: unknown): Map<number, DeviceUsage>;
