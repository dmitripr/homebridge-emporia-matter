import { describe, expect, it } from 'vitest';

import { normalizeChannelId, parseDevices, parseUsage } from '../src/emporia/parse.js';
import { fixture } from './helpers.js';

describe('normalizeChannelId', () => {
  it('normalizes v1 and legacy names to one canonical form', () => {
    expect(normalizeChannelId('Mains')).toBe('Mains');
    expect(normalizeChannelId('1,2,3')).toBe('Mains');
    expect(normalizeChannelId('Mains_A')).toBe('Mains_A');
    expect(normalizeChannelId('branch_2')).toBe('Branch_2');
    expect(normalizeChannelId('2')).toBe('Branch_2');
    expect(normalizeChannelId('Merged_100')).toBe('Merged_100');
    expect(normalizeChannelId('Balance')).toBe('Balance');
    expect(normalizeChannelId('TotalUsage')).toBe('TotalUsage');
  });

  it('falls back to the classification when the value is missing', () => {
    expect(normalizeChannelId(undefined, 'MAIN')).toBe('Mains');
    expect(normalizeChannelId(undefined, 'FIFTY_AMP')).toBeUndefined();
  });
});

describe('parseDevices (v1)', () => {
  const devices = parseDevices(fixture('devices_v1.json'));

  it('parses every monitor and channel', () => {
    expect(devices).toHaveLength(2);
    expect(devices[0].deviceGid).toBe(1001);
    expect(devices[0].displayName).toBe('Test Home');
    expect(devices[0].channels.map((channel) => channel.channelId)).toEqual([
      'Mains',
      'Mains_A',
      'Branch_1',
      'Branch_2',
      'Branch_3',
      'Merged_100',
      'Balance',
    ]);
  });

  it('keeps channel metadata without applying the multiplier', () => {
    const garage = devices[0].channels.find((channel) => channel.channelId === 'Branch_2');
    expect(garage?.name).toBe('Garage');
    expect(garage?.multiplier).toBe(2);
    expect(garage?.hasData).toBe(true);

    const unused = devices[0].channels.find((channel) => channel.channelId === 'Branch_3');
    expect(unused?.hasData).toBe(false);
  });

  it('keeps the parent channel id', () => {
    const phase = devices[0].channels.find((channel) => channel.channelId === 'Mains_A');
    expect(phase?.parentChannelId).toBe('Mains');
  });
});

describe('parseDevices (legacy)', () => {
  const devices = parseDevices(fixture('devices_legacy.json'));

  it('maps legacy channel numbers to the v1 names', () => {
    expect(devices).toHaveLength(1);
    expect(devices[0].displayName).toBe('Main Panel');
    expect(devices[0].channels.map((channel) => channel.channelId)).toEqual([
      'Mains',
      'Branch_1',
      'Branch_2',
    ]);
  });

  it('maps legacy parents and keeps the multiplier as metadata', () => {
    const oven = devices[0].channels.find((channel) => channel.channelId === 'Branch_2');
    expect(oven?.parentChannelId).toBe('Mains');
    expect(oven?.multiplier).toBe(2);
  });
});

describe('parseDevices (nested)', () => {
  it('flattens nested devices and merges duplicate channels', () => {
    const devices = parseDevices({
      devices: [
        {
          device_gid: 1,
          device_id: 'parent',
          display_name: 'Parent',
          channels: [{ channel_id: 'Mains' }],
          devices: [
            {
              device_gid: 2,
              device_id: 'child',
              display_name: 'Child',
              channels: [{ channel_id: 'Branch_1' }],
            },
          ],
        },
        {
          device_gid: 1,
          device_id: 'parent',
          display_name: 'Parent duplicate',
          channels: [{ channel_id: 'Mains' }, { channel_id: 'Branch_2' }],
        },
      ],
    });

    expect(devices).toHaveLength(2);
    expect(devices.find((device) => device.deviceGid === 1)?.channels.map((channel) => channel.channelId)).toEqual([
      'Mains',
      'Branch_2',
    ]);
    expect(devices.find((device) => device.deviceGid === 2)?.displayName).toBe('Child');
  });
});

describe('parseUsage (v1)', () => {
  const usage = parseUsage(fixture('usages_v1.json'));

  it('parses channel readings and the response timestamp', () => {
    expect(usage.size).toBe(2);
    const main = usage.get(1001);
    expect(main?.instant.toISOString()).toBe('2026-11-01T20:10:20.657Z');
    expect(main?.channels.get('Mains')?.usageKwh).toBe(0.05);
    expect(main?.channels.get('Branch_2')?.usageKwh).toBe(0.02);
  });

  it('keeps a null reading and the has_data flag', () => {
    const unused = usage.get(1001)?.channels.get('Branch_3');
    expect(unused?.usageKwh).toBeNull();
    expect(unused?.hasData).toBe(false);
  });
});

describe('parseUsage (legacy)', () => {
  it('parses legacy channel numbers', () => {
    const usage = parseUsage(fixture('usages_legacy.json'));
    const main = usage.get(2001);
    expect(main?.channels.get('Mains')?.usageKwh).toBe(0.06);
    expect(main?.channels.get('Branch_1')?.usageKwh).toBe(0.01);
    expect(main?.channels.get('Branch_2')?.usageKwh).toBe(0.02);
  });
});

describe('parseUsage edge cases', () => {
  it('falls back to raw_usage in watt-hours when usage is missing', () => {
    const usage = parseUsage({
      instant: '2026-11-01T20:10:20.657Z',
      device_usages: [
        {
          device_gid: 3,
          channel_usages: [{ channel_id: 'Branch_1', raw_usage: 50 }],
        },
      ],
    });
    expect(usage.get(3)?.channels.get('Branch_1')?.usageKwh).toBe(0.05);
  });

  it('parses nested devices under a channel', () => {
    const usage = parseUsage({
      instant: '2026-11-01T20:10:20.657Z',
      device_usages: [
        {
          device_gid: 4,
          channel_usages: [
            {
              channel_id: 'Mains',
              usage: 0.1,
              nested_devices: [
                {
                  device_gid: 5,
                  channel_usages: [{ channel_id: 'Mains', usage: 0.01 }],
                },
              ],
            },
          ],
        },
      ],
    });
    expect(usage.get(5)?.channels.get('Mains')?.usageKwh).toBe(0.01);
  });

  it('returns an empty map for malformed payloads', () => {
    expect(parseUsage(null).size).toBe(0);
    expect(parseUsage({ device_usages: [{}] }).size).toBe(0);
  });
});
