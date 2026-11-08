import { asBoolean, asNumber, asString, clamp, isRecord } from './util.js';
export const DEFAULT_POLL_INTERVAL = 60;
export const MIN_POLL_INTERVAL = 60;
export const MAX_POLL_INTERVAL = 300;
export function parseAccessoryType(value) {
    return value === 'outlet' || value === 'light' || value === 'switch' ? value : undefined;
}
export function channelKey(deviceGid, channelId) {
    return `${deviceGid}:${channelId}`;
}
function parseChannelOverrides(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    const byKey = new Map();
    for (const raw of value) {
        if (!isRecord(raw)) {
            continue;
        }
        const channelId = asString(raw.channelId);
        if (!channelId) {
            continue;
        }
        const deviceGid = asNumber(raw.deviceGid);
        const override = {
            deviceGid,
            channelId,
            name: asString(raw.name),
            hide: asBoolean(raw.hide),
            accessoryType: parseAccessoryType(raw.accessoryType),
        };
        byKey.set(`${deviceGid ?? '*'}:${channelId}`, override);
    }
    return [...byKey.values()];
}
export function resolveConfig(raw) {
    const pollInterval = clamp(Math.round(asNumber(raw.pollInterval) ?? DEFAULT_POLL_INTERVAL), MIN_POLL_INTERVAL, MAX_POLL_INTERVAL);
    const nominalVoltageRaw = asNumber(raw.nominalVoltage);
    const nominalVoltage = nominalVoltageRaw !== undefined && nominalVoltageRaw >= 100 && nominalVoltageRaw <= 300
        ? nominalVoltageRaw
        : undefined;
    return {
        name: asString(raw.name) ?? 'Emporia Matter',
        email: asString(raw.email) ?? '',
        password: asString(raw.password),
        pollInterval,
        splitChannels: asBoolean(raw.splitChannels) ?? true,
        hideMains: asBoolean(raw.hideMains) ?? false,
        solar: asBoolean(raw.solar) ?? false,
        nominalVoltage,
        accessoryType: parseAccessoryType(raw.accessoryType) ?? 'outlet',
        channels: parseChannelOverrides(raw.channels),
    };
}
export function isMainsChannel(channelId) {
    return channelId === 'Mains' || /^Mains_[A-Z]$/.test(channelId);
}
export function isBranchChannel(channelId) {
    return /^Branch_\d+$/.test(channelId);
}
export function isDerivedChannel(channelId) {
    return channelId === 'Balance' || channelId === 'TotalUsage' || /^Merged_\d+$/.test(channelId);
}
export function channelLabel(channelId) {
    if (channelId === 'Mains') {
        return 'Mains';
    }
    if (/^Mains_[A-Z]$/.test(channelId)) {
        return `Mains ${channelId.slice(-1)}`;
    }
    if (/^Branch_\d+$/.test(channelId)) {
        return `Branch ${channelId.slice('Branch_'.length)}`;
    }
    if (/^Merged_\d+$/.test(channelId)) {
        return `Merged ${channelId.slice('Merged_'.length)}`;
    }
    if (channelId === '1,2,3') {
        return 'Phase total';
    }
    return channelId;
}
export function overrideFor(config, deviceGid, channelId) {
    return (config.channels.find((override) => override.deviceGid === deviceGid && override.channelId === channelId)
        ?? config.channels.find((override) => override.deviceGid === undefined && override.channelId === channelId));
}
export function deviceHasMainTotal(device) {
    return device.channels.some((channel) => channel.channelId === 'Mains');
}
export function shouldExposeChannel(device, channel, config) {
    const override = overrideFor(config, device.deviceGid, channel.channelId);
    if (override?.hide === true) {
        return false;
    }
    if (override?.hide === false) {
        return true;
    }
    if (channel.channelId === 'Mains') {
        return !config.hideMains;
    }
    if (isMainsChannel(channel.channelId)) {
        // A total Mains channel already covers its phases. Expose phases only
        // when the monitor has no total or the user opted in explicitly.
        return !deviceHasMainTotal(device) && !config.hideMains;
    }
    if (isBranchChannel(channel.channelId)) {
        return true;
    }
    return false;
}
export function resolveAccessoryType(config, deviceGid, channelId) {
    return overrideFor(config, deviceGid, channelId)?.accessoryType ?? config.accessoryType;
}
export function resolveChannelName(device, channel, override) {
    if (override?.name) {
        return override.name;
    }
    if (channel.name) {
        return channel.name;
    }
    return `${device.displayName} ${channelLabel(channel.channelId)}`;
}
//# sourceMappingURL=config.js.map