import { describe, expect, it } from 'vitest';

import {
  overrideFor,
  resolveAccessoryType,
  resolveChannelName,
  resolveConfig,
  shouldExposeChannel,
} from '../src/config.js';
import { parseDevices } from '../src/emporia/parse.js';
import { fixture } from './helpers.js';

const device = parseDevices(fixture('devices_v1.json'))[0];
const channel = (id: string) => {
  const found = device.channels.find((entry) => entry.channelId === id);
  if (!found) {
    throw new Error(`Missing fixture channel ${id}`);
  }
  return found;
};

describe('resolveConfig', () => {
  it('applies safe defaults', () => {
    const config = resolveConfig({ name: 'Emporia', email: 'user@example.com' });
    expect(config.pollInterval).toBe(60);
    expect(config.splitChannels).toBe(true);
    expect(config.hideMains).toBe(false);
    expect(config.solar).toBe(false);
    expect(config.accessoryType).toBe('outlet');
    expect(config.nominalVoltage).toBeUndefined();
    expect(config.channels).toEqual([]);
  });

  it('clamps the poll interval to 60-300 seconds', () => {
    expect(resolveConfig({ email: 'a@b.c', pollInterval: 5 }).pollInterval).toBe(60);
    expect(resolveConfig({ email: 'a@b.c', pollInterval: 999 }).pollInterval).toBe(300);
    expect(resolveConfig({ email: 'a@b.c', pollInterval: 120 }).pollInterval).toBe(120);
  });

  it('validates the nominal voltage and accessory type', () => {
    expect(resolveConfig({ email: 'a@b.c', nominalVoltage: 120 }).nominalVoltage).toBe(120);
    expect(resolveConfig({ email: 'a@b.c', nominalVoltage: 50 }).nominalVoltage).toBeUndefined();
    expect(resolveConfig({ email: 'a@b.c', accessoryType: 'light' }).accessoryType).toBe('light');
    expect(resolveConfig({ email: 'a@b.c', accessoryType: 'dimmer' }).accessoryType).toBe('outlet');
  });

  it('parses channel overrides and ignores malformed entries', () => {
    const config = resolveConfig({
      email: 'a@b.c',
      channels: [
        { deviceGid: 1001, channelId: 'Branch_1', name: 'Fridge', accessoryType: 'light', hide: false },
        { channelId: 'Branch_2', hide: true },
        { name: 'No channel id' },
        null,
      ],
    });
    expect(config.channels).toHaveLength(2);
    expect(overrideFor(config, 1001, 'Branch_1')?.name).toBe('Fridge');
    expect(overrideFor(config, 9999, 'Branch_2')?.hide).toBe(true);
  });
});

describe('channel selection', () => {
  const config = resolveConfig({ email: 'a@b.c' });

  it('exposes mains and branch circuits by default', () => {
    expect(shouldExposeChannel(device, channel('Mains'), config)).toBe(true);
    expect(shouldExposeChannel(device, channel('Branch_1'), config)).toBe(true);
    expect(shouldExposeChannel(device, channel('Branch_3'), config)).toBe(true);
  });

  it('hides phase, merged, and balance channels by default', () => {
    expect(shouldExposeChannel(device, channel('Mains_A'), config)).toBe(false);
    expect(shouldExposeChannel(device, channel('Merged_100'), config)).toBe(false);
    expect(shouldExposeChannel(device, channel('Balance'), config)).toBe(false);
  });

  it('honours hideMains', () => {
    const hidden = resolveConfig({ email: 'a@b.c', hideMains: true });
    expect(shouldExposeChannel(device, channel('Mains'), hidden)).toBe(false);
  });

  it('honours per-channel overrides in both directions', () => {
    const config = resolveConfig({
      email: 'a@b.c',
      channels: [
        { channelId: 'Mains_A', hide: false },
        { channelId: 'Merged_100', hide: false },
        { channelId: 'Branch_1', hide: true },
      ],
    });
    expect(shouldExposeChannel(device, channel('Mains_A'), config)).toBe(true);
    expect(shouldExposeChannel(device, channel('Merged_100'), config)).toBe(true);
    expect(shouldExposeChannel(device, channel('Branch_1'), config)).toBe(false);
  });
});

describe('names and types', () => {
  it('uses the channel name, then the device name and label', () => {
    expect(resolveChannelName(device, channel('Branch_1'), undefined)).toBe('Kitchen');
    expect(resolveChannelName(device, channel('Mains'), undefined)).toBe('Test Home Mains');
    expect(resolveChannelName(device, channel('Mains_A'), undefined)).toBe('Test Home Mains A');
  });

  it('lets an override rename a channel', () => {
    const config = resolveConfig({
      email: 'a@b.c',
      channels: [{ channelId: 'Branch_1', name: 'Refrigerator' }],
    });
    expect(resolveChannelName(device, channel('Branch_1'), overrideFor(config, 1001, 'Branch_1'))).toBe('Refrigerator');
  });

  it('uses the global type and a per-channel override', () => {
    const config = resolveConfig({ email: 'a@b.c', accessoryType: 'switch' });
    expect(resolveAccessoryType(config, 1001, 'Branch_1')).toBe('switch');
    const overridden = resolveConfig({
      email: 'a@b.c',
      channels: [{ channelId: 'Branch_1', accessoryType: 'light' }],
    });
    expect(resolveAccessoryType(overridden, 1001, 'Branch_1')).toBe('light');
    expect(resolveAccessoryType(overridden, 1001, 'Branch_2')).toBe('outlet');
  });
});
