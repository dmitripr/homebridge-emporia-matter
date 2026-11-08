import type { API, MatterAccessory } from 'homebridge';
import type { AccessoryType } from './identity.js';
export interface ChannelSpec {
    channelId: string;
    displayName: string;
    accessoryType: AccessoryType;
    solar: boolean;
    nominalVoltage?: number;
}
export interface SplitAccessorySpec extends ChannelSpec {
    uuid: string;
    deviceGid: number;
    deviceId: string;
    model?: string;
    firmware?: string;
}
export interface GroupedAccessorySpec {
    uuid: string;
    displayName: string;
    deviceGid: number;
    deviceId: string;
    model?: string;
    firmware?: string;
    channels: ChannelSpec[];
}
export declare function buildSplitAccessory(api: API, spec: SplitAccessorySpec): MatterAccessory;
export declare function buildGroupedAccessory(api: API, spec: GroupedAccessorySpec): MatterAccessory;
