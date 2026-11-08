import { describe, expect, it } from 'vitest';

import {
  groupedIdentitySeed,
  partIdForChannel,
  resolveGeneration,
  splitIdentitySeed,
  structureSignature,
} from '../src/identity.js';

describe('structure signatures', () => {
  it('is order-independent for channels', () => {
    const a = structureSignature({
      deviceGid: 1,
      mode: 'split',
      channels: [
        { channelId: 'Branch_2', accessoryType: 'outlet' },
        { channelId: 'Branch_1', accessoryType: 'outlet' },
      ],
    });
    const b = structureSignature({
      deviceGid: 1,
      mode: 'split',
      channels: [
        { channelId: 'Branch_1', accessoryType: 'outlet' },
        { channelId: 'Branch_2', accessoryType: 'outlet' },
      ],
    });
    expect(a).toBe(b);
  });

  it('changes when the mode or an accessory type changes', () => {
    const base = structureSignature({
      deviceGid: 1,
      mode: 'split',
      channels: [{ channelId: 'Branch_1', accessoryType: 'outlet' }],
    });
    const typeChanged = structureSignature({
      deviceGid: 1,
      mode: 'split',
      channels: [{ channelId: 'Branch_1', accessoryType: 'light' }],
    });
    const modeChanged = structureSignature({
      deviceGid: 1,
      mode: 'grouped',
      channels: [{ channelId: 'Branch_1', accessoryType: 'outlet' }],
    });
    expect(typeChanged).not.toBe(base);
    expect(modeChanged).not.toBe(base);
  });
});

describe('identity seeds', () => {
  it('is deterministic for the same device, channel, type, and generation', () => {
    expect(splitIdentitySeed(1001, 'Branch_1', 'outlet', 1)).toBe(
      splitIdentitySeed(1001, 'Branch_1', 'outlet', 1),
    );
  });

  it('changes when the channel, type, or generation changes', () => {
    const base = splitIdentitySeed(1001, 'Branch_1', 'outlet', 1);
    expect(splitIdentitySeed(1001, 'Branch_2', 'outlet', 1)).not.toBe(base);
    expect(splitIdentitySeed(1001, 'Branch_1', 'light', 1)).not.toBe(base);
    expect(splitIdentitySeed(1001, 'Branch_1', 'outlet', 2)).not.toBe(base);
  });

  it('makes grouped identities independent of channel order', () => {
    const a = groupedIdentitySeed(
      1001,
      [
        { channelId: 'Branch_2', accessoryType: 'outlet' },
        { channelId: 'Branch_1', accessoryType: 'outlet' },
      ],
      1,
    );
    const b = groupedIdentitySeed(
      1001,
      [
        { channelId: 'Branch_1', accessoryType: 'outlet' },
        { channelId: 'Branch_2', accessoryType: 'outlet' },
      ],
      1,
    );
    expect(a).toBe(b);
  });
});

describe('part ids', () => {
  it('never contains a colon and is stable', () => {
    expect(partIdForChannel('Branch_1')).toBe('meter-Branch_1');
    expect(partIdForChannel('1,2,3')).toBe('meter-1-2-3');
    expect(partIdForChannel('Mains_A')).toBe('meter-Mains_A');
  });
});

describe('generation resolution', () => {
  it('starts at 1 and keeps the generation for an unchanged signature', () => {
    expect(resolveGeneration(undefined, 'sig')).toEqual({ generation: 1, rotated: false });
    expect(resolveGeneration({ generation: 3, signature: 'sig' }, 'sig')).toEqual({
      generation: 3,
      rotated: false,
    });
  });

  it('rotates when the signature changes', () => {
    expect(resolveGeneration({ generation: 3, signature: 'old' }, 'new')).toEqual({
      generation: 4,
      rotated: true,
    });
  });
});
