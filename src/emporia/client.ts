import type { TokenProvider } from './auth.js';
import { parseDevices, parseUsage } from './parse.js';
import type { DeviceUsage, EmporiaDevice } from './types.js';
import { errorMessage, sleep as defaultSleep } from '../util.js';

export interface ClientLogger {
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export interface EmporiaClientOptions {
  auth: TokenProvider;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  log?: ClientLogger;
  maxRetries?: number;
  timeoutMs?: number;
}

export class EmporiaApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'EmporiaApiError';
  }
}

type AuthStyle = 'bearer' | 'authtoken';

// Statuses that mean the v1 endpoint itself is not usable for this account or
// request, so the legacy endpoint is worth trying. A 401 is handled separately
// by refreshing the token.
const FALLBACK_STATUSES = new Set([400, 403, 404, 405]);

export class EmporiaClient {
  private readonly auth: TokenProvider;
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly log?: ClientLogger;
  private readonly maxRetries: number;
  private readonly timeoutMs: number;
  // Primary endpoints that returned a fallback-worthy status. Once a v1
  // endpoint has failed, use the legacy endpoint directly instead of repeating
  // the same rejected request on every poll.
  private readonly legacyEndpoints = new Set<string>();

  constructor(options: EmporiaClientOptions) {
    this.auth = options.auth;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.baseUrl = (options.baseUrl ?? 'https://api.emporiaenergy.com').replace(/\/+$/, '');
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? defaultSleep;
    this.log = options.log;
    this.maxRetries = Math.max(0, options.maxRetries ?? 3);
    this.timeoutMs = options.timeoutMs ?? 20_000;
  }

  async getDevices(): Promise<EmporiaDevice[]> {
    const payload = await this.requestWithFallback('/v1/customers/devices', '/customers/devices', 'bearer');
    return parseDevices(payload);
  }

  async getUsage(deviceGids: readonly number[], instant: Date = new Date(this.now())): Promise<Map<number, DeviceUsage>> {
    if (deviceGids.length === 0) {
      return new Map();
    }

    const v1Params: Record<string, string> = {
      device_gids: deviceGids.join(','),
      instant: instant.toISOString(),
      // The v1 API takes enum names, unlike the legacy API's `1MIN`.
      scale: 'MINUTE',
      energy_unit: 'KILOWATT_HOURS',
    };
    const legacyQuery = new URLSearchParams({
      apiMethod: 'getDeviceListUsages',
      deviceGids: deviceGids.join('+'),
      instant: instant.toISOString(),
      scale: '1MIN',
      energyUnit: 'KilowattHours',
    });

    const payload = await this.requestWithFallback(
      '/v1/customers/devices/usages',
      `/AppAPI?${legacyQuery.toString()}`,
      'bearer',
      v1Params,
    );
    return parseUsage(payload);
  }

  private async requestWithFallback(
    primaryPath: string,
    fallbackPath: string,
    style: AuthStyle,
    params?: Record<string, string>,
  ): Promise<unknown> {
    if (this.legacyEndpoints.has(primaryPath)) {
      return this.request(fallbackPath, 'authtoken');
    }

    try {
      return await this.request(primaryPath, style, params);
    } catch (error) {
      if (error instanceof EmporiaApiError && FALLBACK_STATUSES.has(error.status)) {
        this.legacyEndpoints.add(primaryPath);
        this.log?.warn(`Emporia v1 endpoint unavailable; using the legacy API. ${error.message}`);
        return this.request(fallbackPath, 'authtoken');
      }
      throw error;
    }
  }

  private async request(path: string, style: AuthStyle, params?: Record<string, string>): Promise<unknown> {
    let refreshed = false;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const token = await this.auth.getIdToken();
      const url = new URL(`${this.baseUrl}${path}`);
      if (params) {
        for (const [key, value] of Object.entries(params)) {
          url.searchParams.set(key, value);
        }
      }

      const headers: Record<string, string> = {
        accept: 'application/json',
        ...(style === 'bearer' ? { authorization: `Bearer ${token}` } : { authtoken: token }),
      };

      let response: Response;
      try {
        const signal = typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(this.timeoutMs) : undefined;
        response = await this.fetchImpl(url, { headers, signal });
      } catch (error) {
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
        throw new EmporiaApiError(response.status, await this.describeFailure(response, path));
      }

      const text = await response.text();
      if (!text) {
        return {};
      }
      try {
        return JSON.parse(text) as unknown;
      } catch {
        throw new EmporiaApiError(response.status, 'Emporia API returned a response that was not valid JSON.');
      }
    }

    throw new EmporiaApiError(0, 'Emporia API request failed after retries.');
  }

  private backoff(attempt: number): number {
    return Math.min(1000 * 2 ** attempt, 30_000);
  }

  /**
   * Builds an error message that includes the failing endpoint and a short
   * response body. Emporia sometimes explains a 400 in the body, and that
   * detail is what makes a support report actionable.
   */
  private async describeFailure(response: Response, path: string): Promise<string> {
    let body = '';
    try {
      const text = await response.text();
      const compact = text.replace(/\s+/g, ' ').trim();
      body = compact.length > 300 ? `${compact.slice(0, 300)}...` : compact;
    } catch {
      // The body is optional; keep the status line either way.
    }

    const status = response.statusText ? `${response.status} ${response.statusText}` : `${response.status}`;
    return `Emporia API request failed (${status}) at ${path}${body ? `: ${body}` : ''}`;
  }

  private retryDelay(response: Response, attempt: number): number {
    const retryAfter = Number(response.headers.get('retry-after'));
    if (Number.isFinite(retryAfter) && retryAfter > 0) {
      return Math.min(retryAfter * 1000, 60_000);
    }
    return this.backoff(attempt);
  }
}
