export interface EmporiaChannel {
    channelId: string;
    name?: string;
    multiplier?: number;
    channelTypeGid?: number | null;
    parentChannelId?: string | null;
    channelClassification?: string | null;
    hasData?: boolean | null;
}
export interface EmporiaDevice {
    deviceGid: number;
    deviceId: string;
    displayName: string;
    model?: string;
    firmware?: string;
    deviceType?: string;
    category?: string;
    timeZone?: string;
    parentDeviceId?: string | null;
    netMetering?: unknown;
    channels: EmporiaChannel[];
}
export interface ChannelUsage {
    channelId: string;
    usageKwh: number | null;
    hasData?: boolean | null;
    percentage?: number | null;
}
export interface DeviceUsage {
    deviceGid: number;
    instant: Date;
    channels: Map<string, ChannelUsage>;
}
