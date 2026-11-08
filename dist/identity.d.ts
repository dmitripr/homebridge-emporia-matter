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
export declare function structureSignature(input: StructureInput): string;
export declare function splitIdentitySeed(deviceGid: number, channelId: string, accessoryType: AccessoryType, generation: number): string;
export declare function groupedIdentitySeed(deviceGid: number, channels: readonly ChannelStructure[], generation: number): string;
/**
 * Part IDs must not contain ':' and must be stable for a channel. They are
 * identity-bearing: renaming one would create a new endpoint.
 */
export declare function partIdForChannel(channelId: string): string;
export interface GenerationResult {
    generation: number;
    rotated: boolean;
}
export declare function resolveGeneration(previous: {
    generation: number;
    signature: string;
} | undefined, signature: string): GenerationResult;
