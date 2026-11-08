import type { TokenProvider } from './auth.js';
import type { DeviceUsage, EmporiaDevice } from './types.js';
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
export declare class EmporiaApiError extends Error {
    readonly status: number;
    constructor(status: number, message: string);
}
export declare class EmporiaClient {
    private readonly auth;
    private readonly fetchImpl;
    private readonly baseUrl;
    private readonly now;
    private readonly sleep;
    private readonly log?;
    private readonly maxRetries;
    private readonly timeoutMs;
    private readonly legacyEndpoints;
    constructor(options: EmporiaClientOptions);
    getDevices(): Promise<EmporiaDevice[]>;
    getUsage(deviceGids: readonly number[], instant?: Date): Promise<Map<number, DeviceUsage>>;
    private requestWithFallback;
    private request;
    private backoff;
    /**
     * Builds an error message that includes the failing endpoint and a short
     * response body. Emporia sometimes explains a 400 in the body, and that
     * detail is what makes a support report actionable.
     */
    private describeFailure;
    private retryDelay;
}
