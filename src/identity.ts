export type AccessoryType = 'outlet' | 'light' | 'switch';
export type AccessoryMode = 'split' | 'grouped';

export interface ChannelStructure {
  channelId: string;
  accessoryType: AccessoryType;
}

export interface StructureInput {
  deviceGid: number;
  mode: AccessoryMode;
  channels: readonly ChannelStructure[];
}

/**
 * A signature that changes whenever the accessory layout changes. The plugin
 * stores it per device and bumps the identity generation when it differs, so
 * a structural change never reuses a Matter endpoint identity.
 */
export function structureSignature(input: StructureInput): string {
  const channels = [...input.channels]
    .map((channel) => `${channel.channelId}:${channel.accessoryType}`)
    .sort()
    .join(',');
  return `${input.mode}|${channels}`;
}

export function splitIdentitySeed(
  deviceGid: number,
  channelId: string,
  accessoryType: AccessoryType,
  generation: number,
): string {
  return `emporia|${deviceGid}|${channelId}|${accessoryType}|g${generation}`;
}

export function groupedIdentitySeed(
  deviceGid: number,
  channels: readonly ChannelStructure[],
  generation: number,
): string {
  const tokens = [...channels]
    .map((channel) => `${channel.channelId}:${channel.accessoryType}`)
    .sort()
    .join(',');
  return `emporia|${deviceGid}|bridge|${tokens}|g${generation}`;
}

/**
 * Part IDs must not contain ':' and must be stable for a channel. They are
 * identity-bearing: renaming one would create a new endpoint.
 */
export function partIdForChannel(channelId: string): string {
  return `meter-${channelId.replace(/[^A-Za-z0-9_-]+/g, '-')}`;
}

export interface GenerationResult {
  generation: number;
  rotated: boolean;
}

export function resolveGeneration(
  previous: { generation: number; signature: string } | undefined,
  signature: string,
): GenerationResult {
  if (!previous) {
    return { generation: 1, rotated: false };
  }
  if (previous.signature === signature) {
    return { generation: previous.generation, rotated: false };
  }
  return { generation: previous.generation + 1, rotated: true };
}
