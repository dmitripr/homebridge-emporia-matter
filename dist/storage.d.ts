export interface KeyValueStore {
    read(): Promise<string | undefined>;
    write(data: string): Promise<void>;
}
export declare class FileStore implements KeyValueStore {
    private readonly filePath;
    constructor(filePath: string);
    read(): Promise<string | undefined>;
    write(data: string): Promise<void>;
}
export declare class MemoryStore implements KeyValueStore {
    value: string | undefined;
    constructor(value?: string | undefined);
    read(): Promise<string | undefined>;
    write(data: string): Promise<void>;
}
export interface StoredTokens {
    idToken: string;
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
    email?: string;
}
export declare class TokenStore {
    private readonly store;
    constructor(store: KeyValueStore);
    load(): Promise<StoredTokens | undefined>;
    save(tokens: StoredTokens): Promise<void>;
    clear(): Promise<void>;
}
export interface PersistedChannelEnergy {
    importedMwh: number;
    exportedMwh: number;
    lastMs: number;
}
export interface PersistedDeviceState {
    generation: number;
    signature: string;
}
export interface PersistedState {
    version: 1;
    devices: Record<string, PersistedDeviceState>;
    energy: Record<string, PersistedChannelEnergy>;
}
export declare function emptyState(): PersistedState;
export declare class StateStore {
    private readonly store;
    constructor(store: KeyValueStore);
    load(): Promise<PersistedState>;
    save(state: PersistedState): Promise<void>;
}
