import { parseDevices, parseUsage } from './parse.js';
import { errorMessage, sleep as defaultSleep } from '../util.js';
export class EmporiaApiError extends Error {
    status;
    constructor(status, message) {
        super(message);
        this.status = status;
        this.name = 'EmporiaApiError';
    }
}
export class EmporiaClient {
    auth;
    fetchImpl;
    baseUrl;
    now;
    sleep;
    log;
    maxRetries;
    timeoutMs;
    constructor(options) {
        this.auth = options.auth;
        this.fetchImpl = options.fetchImpl ?? fetch;
        this.baseUrl = (options.baseUrl ?? 'https://api.emporiaenergy.com').replace(/\/+$/, '');
        this.now = options.now ?? Date.now;
        this.sleep = options.sleep ?? defaultSleep;
        this.log = options.log;
        this.maxRetries = Math.max(0, options.maxRetries ?? 3);
        this.timeoutMs = options.timeoutMs ?? 20_000;
    }
    async getDevices() {
        const payload = await this.requestWithFallback('/v1/customers/devices', '/customers/devices', 'bearer');
        return parseDevices(payload);
    }
    async getUsage(deviceGids, instant = new Date(this.now())) {
        if (deviceGids.length === 0) {
            return new Map();
        }
        const v1Params = {
            device_gids: deviceGids.join(','),
            instant: instant.toISOString(),
            scale: '1MIN',
            energy_unit: 'KILOWATT_HOURS',
        };
        const legacyQuery = new URLSearchParams({
            apiMethod: 'getDeviceListUsages',
            deviceGids: deviceGids.join('+'),
            instant: instant.toISOString(),
            scale: '1MIN',
            energyUnit: 'KilowattHours',
        });
        const payload = await this.requestWithFallback('/v1/customers/devices/usages', `/AppAPI?${legacyQuery.toString()}`, 'bearer', v1Params);
        return parseUsage(payload);
    }
    async requestWithFallback(primaryPath, fallbackPath, style, params) {
        try {
            return await this.request(primaryPath, style, params);
        }
        catch (error) {
            if (error instanceof EmporiaApiError && (error.status === 404 || error.status === 405)) {
                this.log?.warn(`Emporia v1 endpoint unavailable (${error.status}); falling back to the legacy API.`);
                return this.request(fallbackPath, 'authtoken');
            }
            throw error;
        }
    }
    async request(path, style, params) {
        let refreshed = false;
        for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
            const token = await this.auth.getIdToken();
            const url = new URL(`${this.baseUrl}${path}`);
            if (params) {
                for (const [key, value] of Object.entries(params)) {
                    url.searchParams.set(key, value);
                }
            }
            const headers = {
                accept: 'application/json',
                ...(style === 'bearer' ? { authorization: `Bearer ${token}` } : { authtoken: token }),
            };
            let response;
            try {
                const signal = typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(this.timeoutMs) : undefined;
                response = await this.fetchImpl(url, { headers, signal });
            }
            catch (error) {
                if (attempt < this.maxRetries) {
                    const delay = this.backoff(attempt);
                    this.log?.debug(`Emporia request failed (${errorMessage(error)}); retrying in ${delay} ms.`);
                    await this.sleep(delay);
                    continue;
                }
                throw new EmporiaApiError(0, `Could not reach the Emporia API: ${errorMessage(error)}`);
            }
            if (response.status === 401 && !refreshed) {
                refreshed = true;
                this.log?.debug('Emporia API returned 401; refreshing the session token.');
                await this.auth.refresh();
                continue;
            }
            if (response.status === 429 || response.status >= 500) {
                if (attempt < this.maxRetries) {
                    const delay = this.retryDelay(response, attempt);
                    this.log?.debug(`Emporia API returned ${response.status}; retrying in ${delay} ms.`);
                    await this.sleep(delay);
                    continue;
                }
            }
            if (!response.ok) {
                throw new EmporiaApiError(response.status, `Emporia API request failed (${response.status} ${response.statusText})`.trim());
            }
            const text = await response.text();
            if (!text) {
                return {};
            }
            try {
                return JSON.parse(text);
            }
            catch {
                throw new EmporiaApiError(response.status, 'Emporia API returned a response that was not valid JSON.');
            }
        }
        throw new EmporiaApiError(0, 'Emporia API request failed after retries.');
    }
    backoff(attempt) {
        return Math.min(1000 * 2 ** attempt, 30_000);
    }
    retryDelay(response, attempt) {
        const retryAfter = Number(response.headers.get('retry-after'));
        if (Number.isFinite(retryAfter) && retryAfter > 0) {
            return Math.min(retryAfter * 1000, 60_000);
        }
        return this.backoff(attempt);
    }
}
//# sourceMappingURL=client.js.map