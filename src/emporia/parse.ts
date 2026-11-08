import type { ChannelUsage, DeviceUsage, EmporiaChannel, EmporiaDevice } from './types.js';
import { asBoolean, asNumber, asString, isRecord } from '../util.js';

function findArray(record: Record<string, unknown>, keys: readonly string[]): unknown[] | undefined {
  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value)) {
      return value;
    }
  }
  return undefined;
}

function parseInstant(value: unknown): Date {
  const text = asString(value);
  if (text) {
    const date = new Date(text);
    if (!Number.isNaN(date.getTime())) {
      return date;
    }
  }
  return new Date();
}

/**
 * Normalize the channel identifiers used by the v1 and legacy APIs.
 * Legacy responses identify channels by `channelNum` ("1,2,3", "1", "2"),
 * while v1 uses names like "Mains" and "Branch_1". Keeping one canonical
 * form makes Matter identities stable if the plugin falls back.
 */
export function normalizeChannelId(value: unknown, classification?: string): string | undefined {
  const text = asString(value);
  if (!text) {
    if (classification?.toLowerCase().includes('main')) {
      return 'Mains';
    }
    return undefined;
  }

  if (text === '1,2,3' || /^mains$/i.test(text)) {
    return 'Mains';
  }

  const mainsPhase = /^mains[_-]?([abc])$/i.exec(text);
  if (mainsPhase) {
    return `Mains_${mainsPhase[1].toUpperCase()}`;
  }

  const branch = /^branch[_-]?(\d+)$/i.exec(text);
  if (branch) {
    return `Branch_${Number(branch[1])}`;
  }

  const merged = /^merged[_-]?(\d+)$/i.exec(text);
  if (merged) {
    return `Merged_${Number(merged[1])}`;
  }

  if (/^balance$/i.test(text)) {
    return 'Balance';
  }

  if (/^total[_-]?usage$/i.test(text)) {
    return 'TotalUsage';
  }

  if (/^\d+$/.test(text)) {
    return `Branch_${Number(text)}`;
  }

  return text;
}

function parseChannel(raw: unknown): EmporiaChannel | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }

  const classification = asString(raw.channel_classification ?? raw.channelClassification ?? raw.type);
  const channelId = normalizeChannelId(
    raw.channel_id ?? raw.channelId ?? raw.channel_num ?? raw.channelNum,
    classification,
  );
  if (!channelId) {
    return undefined;
  }

  const parent = raw.parent_channel_id ?? raw.parentChannelId ?? raw.parent_channel_num ?? raw.parentChannelNum;

  return {
    channelId,
    name: asString(raw.name) ?? asString(raw.display_name) ?? asString(raw.displayName),
    multiplier: asNumber(raw.multiplier ?? raw.channelMultiplier ?? raw.channel_multiplier),
    channelTypeGid: asNumber(raw.channel_type_gid ?? raw.channelTypeGid) ?? null,
    parentChannelId: normalizeChannelId(parent) ?? null,
    channelClassification: classification ?? null,
    hasData: asBoolean(raw.has_data ?? raw.hasData) ?? null,
  };
}

function parseDevice(raw: unknown): EmporiaDevice[] {
  if (!isRecord(raw)) {
    return [];
  }

  const deviceGid = asNumber(raw.device_gid ?? raw.deviceGid);
  if (deviceGid === undefined) {
    return [];
  }

  const location = isRecord(raw.locationProperties) ? raw.locationProperties : {};
  const displayName =
    asString(location.deviceName)
    ?? asString(raw.display_name)
    ?? asString(raw.displayName)
    ?? asString(location.displayName)
    ?? asString(raw.name)
    ?? `Emporia ${deviceGid}`;

  const rawChannels = findArray(raw, ['channels', 'channel']) ?? [];
  const channels = rawChannels
    .map(parseChannel)
    .filter((channel): channel is EmporiaChannel => channel !== undefined);

  const device: EmporiaDevice = {
    deviceGid,
    deviceId:
      asString(raw.device_id)
      ?? asString(raw.deviceId)
      ?? asString(raw.manufacturerDeviceId)
      ?? String(deviceGid),
    displayName,
    model: asString(raw.model),
    firmware: asString(raw.firmware),
    deviceType: asString(raw.device_type ?? raw.deviceType),
    category: asString(raw.category),
    timeZone: asString(raw.time_zone ?? raw.timeZone) ?? asString(location.timeZone),
    parentDeviceId: asString(raw.parent_device_id ?? raw.parentDeviceId ?? raw.parentDeviceGid) ?? null,
    netMetering: raw.net_metering ?? raw.netMetering,
    channels,
  };

  const nested = findArray(raw, ['devices']) ?? [];
  const devices = [device];
  for (const child of nested) {
    devices.push(...parseDevice(child));
  }
  return devices;
}

export function parseDevices(payload: unknown): EmporiaDevice[] {
  const rawDevices = Array.isArray(payload)
    ? payload
    : isRecord(payload)
      ? findArray(payload, ['devices', 'data']) ?? []
      : [];

  const byGid = new Map<number, EmporiaDevice>();
  for (const raw of rawDevices) {
    for (const device of parseDevice(raw)) {
      const existing = byGid.get(device.deviceGid);
      if (!existing) {
        byGid.set(device.deviceGid, device);
        continue;
      }
      const channelIds = new Set(existing.channels.map((channel) => channel.channelId));
      for (const channel of device.channels) {
        if (!channelIds.has(channel.channelId)) {
          existing.channels.push(channel);
          channelIds.add(channel.channelId);
        }
      }
    }
  }
  return [...byGid.values()];
}

function parseChannelUsage(raw: unknown): ChannelUsage | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }

  const channelId = normalizeChannelId(
    raw.channel_id ?? raw.channelId ?? raw.channel_num ?? raw.channelNum,
    asString(raw.channel_classification ?? raw.channelClassification),
  );
  if (!channelId) {
    return undefined;
  }

  const usage = asNumber(raw.usage);
  const rawUsage = asNumber(raw.raw_usage ?? raw.rawUsage);
  // `raw_usage` is watt-hours in the fixtures, while `usage` is kWh.
  const usageKwh = usage ?? (rawUsage === undefined ? null : rawUsage / 1000);

  return {
    channelId,
    usageKwh,
    hasData: asBoolean(raw.has_data ?? raw.hasData) ?? null,
    percentage: asNumber(raw.percentage) ?? null,
  };
}

function parseUsageDevice(raw: unknown, instant: Date, into: Map<number, DeviceUsage>): void {
  // Usage payloads nest devices inside channel usages. Walk the tree with an
  // explicit queue so the two parsers do not need to call each other.
  const pending: unknown[] = [raw];
  while (pending.length > 0) {
    const next = pending.shift();
    if (!isRecord(next)) {
      continue;
    }

    const deviceGid = asNumber(next.device_gid ?? next.deviceGid);
    if (deviceGid === undefined) {
      continue;
    }

    const rawChannels = findArray(next, ['channel_usages', 'channelUsages', 'channels']) ?? [];
    const existing = into.get(deviceGid);
    const usage: DeviceUsage = existing ?? { deviceGid, instant, channels: new Map() };
    if (!existing) {
      into.set(deviceGid, usage);
    }

    for (const rawChannel of rawChannels) {
      const channel = parseChannelUsage(rawChannel);
      if (channel) {
        usage.channels.set(channel.channelId, channel);
      }
      if (isRecord(rawChannel)) {
        pending.push(...(findArray(rawChannel, ['nested_devices', 'nestedDevices']) ?? []));
      }
    }
  }
}

export function parseUsage(payload: unknown): Map<number, DeviceUsage> {
  const root = isRecord(payload) ? payload : {};
  const deviceList = isRecord(root.deviceListUsages) ? root.deviceListUsages : root;
  const instant = parseInstant(root.instant ?? deviceList.instant);
  const rawDevices =
    findArray(deviceList, ['device_usages', 'deviceUsages', 'devices'])
    ?? findArray(root, ['device_usages', 'deviceUsages', 'devices'])
    ?? [];

  const usages = new Map<number, DeviceUsage>();
  for (const raw of rawDevices) {
    parseUsageDevice(raw, instant, usages);
  }
  return usages;
}
