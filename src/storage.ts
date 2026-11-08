import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { asNumber, asString, isRecord, safeJsonParse } from './util.js';

export interface KeyValueStore {
  read(): Promise<string | undefined>;
  write(data: string): Promise<void>;
}

export class FileStore implements KeyValueStore {
  constructor(private readonly filePath: string) {}

  async read(): Promise<string | undefined> {
    try {
      return await readFile(this.filePath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return undefined;
      }
      throw error;
    }
  }

  async write(data: string): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.tmp`;
    await writeFile(temporary, data, { encoding: 'utf8', mode: 0o600 });
    try {
      await rename(temporary, this.filePath);
    } catch {
      await writeFile(this.filePath, data, { encoding: 'utf8', mode: 0o600 });
      await rm(temporary, { force: true });
    }
  }
}

export class MemoryStore implements KeyValueStore {
  constructor(public value: string | undefined = undefined) {}

  async read(): Promise<string | undefined> {
    return this.value;
  }

  async write(data: string): Promise<void> {
    this.value = data;
  }
}

export interface StoredTokens {
  idToken: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  email?: string;
}

export class TokenStore {
  constructor(private readonly store: KeyValueStore) {}

  async load(): Promise<StoredTokens | undefined> {
    const parsed = safeJsonParse<unknown>(await this.store.read());
    if (!isRecord(parsed)) {
      return undefined;
    }
    const idToken = asString(parsed.idToken);
    const accessToken = asString(parsed.accessToken);
    const refreshToken = asString(parsed.refreshToken);
    const expiresAt = asNumber(parsed.expiresAt);
    if (!idToken || !accessToken || !refreshToken || expiresAt === undefined) {
      return undefined;
    }
    return {
      idToken,
      accessToken,
      refreshToken,
      expiresAt,
      email: asString(parsed.email),
    };
  }

  async save(tokens: StoredTokens): Promise<void> {
    await this.store.write(JSON.stringify(tokens));
  }

  async clear(): Promise<void> {
    await this.store.write('');
  }
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

export function emptyState(): PersistedState {
  return { version: 1, devices: {}, energy: {} };
}

export class StateStore {
  constructor(private readonly store: KeyValueStore) {}

  async load(): Promise<PersistedState> {
    const parsed = safeJsonParse<unknown>(await this.store.read());
    if (!isRecord(parsed)) {
      return emptyState();
    }

    const state = emptyState();
    if (isRecord(parsed.devices)) {
      for (const [key, value] of Object.entries(parsed.devices)) {
        if (!isRecord(value)) {
          continue;
        }
        const generation = asNumber(value.generation);
        const signature = asString(value.signature);
        if (generation !== undefined && signature !== undefined) {
          state.devices[key] = { generation, signature };
        }
      }
    }
    if (isRecord(parsed.energy)) {
      for (const [key, value] of Object.entries(parsed.energy)) {
        if (!isRecord(value)) {
          continue;
        }
        const importedMwh = asNumber(value.importedMwh);
        const exportedMwh = asNumber(value.exportedMwh);
        const lastMs = asNumber(value.lastMs);
        if (importedMwh !== undefined && exportedMwh !== undefined && lastMs !== undefined) {
          state.energy[key] = { importedMwh, exportedMwh, lastMs };
        }
      }
    }
    return state;
  }

  async save(state: PersistedState): Promise<void> {
    await this.store.write(JSON.stringify(state));
  }
}
