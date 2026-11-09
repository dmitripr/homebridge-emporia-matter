import { describe, expect, it } from 'vitest';

import { parseDevices } from '../src/emporia/parse.js';
import { buildDiscovery } from '../src/ui/discover.js';
import { fixture } from './helpers.js';

const devices = parseDevices(fixture('devices_v1.json'));

describe('buildDiscovery', () => {
  it('returns one row per channel in a stable order', () => {
    const result = buildDiscovery({ email: 'user@example.com' }, devices);
    expect(result.devices).toHaveLength(2);
    expect(result.devices[0].deviceGid).toBe(1001);
    expect(result.devices[0].channels.map((channel) => channel.channelId)).toEqual([
      'Mains',
      'Mains_A',
      'Branch_1',
      'Branch_2',
      'Branch_3',
      'Merged_100',
      'Balance',
    ]);
    expect(result.devices[1].channels.map((channel) => channel.channelId)).toEqual(['Mains', 'Branch_1']);
  });

  it('uses the plugin defaults for names, visibility, and types', () => {
    const result = buildDiscovery({ email: 'user@example.com' }, devices);
    const channels = result.devices[0].channels;
    const byId = (id: string) => {
      const channel = channels.find((entry) => entry.channelId === id);
      if (!channel) {
        throw new Error(`Missing channel ${id}`);
      }
      return channel;
    };

    expect(byId('Branch_1').defaultName).toBe('Kitchen');
    expect(byId('Mains').defaultName).toBe('Test Home Mains');
    expect(byId('Mains_A').defaultName).toBe('Test Home Mains A');
    expect(byId('Mains').defaultExposed).toBe(true);
    expect(byId('Mains_A').defaultExposed).toBe(false);
    expect(byId('Branch_2').defaultExposed).toBe(true);
    expect(byId('Merged_100').defaultExposed).toBe(false);
    expect(byId('Balance').defaultExposed).toBe(false);
    expect(byId('Branch_1').hasData).toBe(true);
    expect(byId('Mains').hasMainTotal).toBe(true);
  });

  it('follows hideMains and the global accessory type', () => {
    const result = buildDiscovery({ email: 'user@example.com', hideMains: true, accessoryType: 'light' }, devices);
    const channels = result.devices[0].channels;
    expect(channels.find((entry) => entry.channelId === 'Mains')?.defaultExposed).toBe(false);
    expect(channels.find((entry) => entry.channelId === 'Branch_1')?.defaultExposed).toBe(true);
    expect(channels.find((entry) => entry.channelId === 'Branch_1')?.hasData).toBe(true);
    expect(result.devices[0].model).toBe('VUE002');
  });
});
