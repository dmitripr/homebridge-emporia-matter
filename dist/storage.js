import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { asNumber, asString, isRecord, safeJsonParse } from './util.js';
export class FileStore {
    filePath;
    constructor(filePath) {
        this.filePath = filePath;
    }
    async read() {
        try {
            return await readFile(this.filePath, 'utf8');
        }
        catch (error) {
            if (error.code === 'ENOENT') {
                return undefined;
            }
            throw error;
        }
    }
    async write(data) {
        await mkdir(dirname(this.filePath), { recursive: true });
        const temporary = `${this.filePath}.tmp`;
        await writeFile(temporary, data, { encoding: 'utf8', mode: 0o600 });
        try {
            await rename(temporary, this.filePath);
        }
        catch {
            await writeFile(this.filePath, data, { encoding: 'utf8', mode: 0o600 });
            await rm(temporary, { force: true });
        }
    }
}
export class MemoryStore {
    value;
    constructor(value = undefined) {
        this.value = value;
    }
    async read() {
        return this.value;
    }
    async write(data) {
        this.value = data;
    }
}
export class TokenStore {
    store;
    constructor(store) {
        this.store = store;
    }
    async load() {
        const parsed = safeJsonParse(await this.store.read());
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
    async save(tokens) {
        await this.store.write(JSON.stringify(tokens));
    }
    async clear() {
        await this.store.write('');
    }
}
export function emptyState() {
    return { version: 1, devices: {}, energy: {} };
}
export class StateStore {
    store;
    constructor(store) {
        this.store = store;
    }
    async load() {
        const parsed = safeJsonParse(await this.store.read());
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
    async save(state) {
        await this.store.write(JSON.stringify(state));
    }
}
//# sourceMappingURL=storage.js.map