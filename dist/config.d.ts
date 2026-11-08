import type { AccessoryType } from './identity.js';
import type { EmporiaChannel, EmporiaDevice } from './emporia/types.js';
export interface ChannelOverride {
    deviceGid?: number;
    channelId: string;
    name?: string;
    hide?: boolean;
    accessoryType?: AccessoryType;
}
export interface ResolvedConfig {
    name: string;
    email: string;
    password?: string;
    pollInterval: number;
    splitChannels: boolean;
    hideMains: boolean;
    solar: boolean;
    nominalVoltage?: number;
    accessoryType: AccessoryType;
    channels: ChannelOverride[];
}
export declare const DEFAULT_POLL_INTERVAL = 60;
export declare const MIN_POLL_INTERVAL = 60;
export declare const MAX_POLL_INTERVAL = 300;
export declare function parseAccessoryType(value: unknown): AccessoryType | undefined;
export declare function channelKey(deviceGid: number, channelId: string): string;
export declare function resolveConfig(raw: Record<string, unknown>): ResolvedConfig;
export declare function isMainsChannel(channelId: string): boolean;
export declare function isBranchChannel(channelId: string): boolean;
export declare function isDerivedChannel(channelId: string): boolean;
export declare function channelLabel(channelId: string): string;
export declare function overrideFor(config: ResolvedConfig, deviceGid: number, channelId: string): ChannelOverride | undefined;
export declare function deviceHasMainTotal(device: EmporiaDevice): boolean;
export declare function shouldExposeChannel(device: EmporiaDevice, channel: EmporiaChannel, config: ResolvedConfig): boolean;
export declare function resolveAccessoryType(config: ResolvedConfig, deviceGid: number, channelId: string): AccessoryType;
export declare function resolveChannelName(device: EmporiaDevice, channel: EmporiaChannel, override: ChannelOverride | undefined): string;
