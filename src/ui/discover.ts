import type { EmporiaChannel, EmporiaDevice } from '../emporia/types.js';
import {
  channelLabel,
  resolveChannelName,
  resolveConfig,
  shouldExposeChannel,
} from '../config.js';

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

function channelRank(channelId: string): number {
  if (channelId === 'Mains') {
    return 0;
  }
  if (/^Mains_[A-Z]$/.test(channelId)) {
    return 1;
  }
  if (/^Branch_\d+$/.test(channelId)) {
    return 2;
  }
  if (/^Merged_\d+$/.test(channelId)) {
    return 3;
  }
  if (channelId === 'Balance') {
    return 4;
  }
  if (channelId === 'TotalUsage') {
    return 5;
  }
  return 6;
}

function channelNumber(channelId: string): number {
  const match = /(\d+)/.exec(channelId);
  return match ? Number(match[1]) : 0;
}

function compareChannels(a: EmporiaChannel, b: EmporiaChannel): number {
  const rank = channelRank(a.channelId) - channelRank(b.channelId);
  if (rank !== 0) {
    return rank;
  }
  const number = channelNumber(a.channelId) - channelNumber(b.channelId);
  if (number !== 0) {
    return number;
  }
  return a.channelId.localeCompare(b.channelId);
}

/**
 * Shapes Emporia devices for the plugin's custom settings page.
 *
 * The page shows one editable row per discovered channel. Exposure defaults
 * are computed with the user's current settings but without any channel
 * overrides, so the rows describe what the plugin would do if the override
 * list were empty.
 */
export function buildDiscovery(
  config: Record<string, unknown>,
  devices: readonly EmporiaDevice[],
): DiscoveryResult {
  const resolved = resolveConfig({ ...config, channels: [] });

  return {
    devices: devices.map((device) => {
      const hasMainTotal = device.channels.some((channel) => channel.channelId === 'Mains');
      return {
        deviceGid: device.deviceGid,
        deviceName: device.displayName,
        model: device.model,
        channels: [...device.channels].sort(compareChannels).map((channel) => ({
          channelId: channel.channelId,
          label: channelLabel(channel.channelId),
          defaultName: resolveChannelName(device, channel, undefined),
          defaultExposed: shouldExposeChannel(device, channel, resolved),
          hasData: channel.hasData !== false,
          hasMainTotal,
        })),
      };
    }),
  };
}
