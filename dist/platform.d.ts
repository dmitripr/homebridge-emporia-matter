import type { API, DynamicPlatformPlugin, Logging, MatterAccessory, PlatformAccessory, PlatformConfig } from 'homebridge';
import { type TokenProvider } from './emporia/auth.js';
import { EmporiaClient } from './emporia/client.js';
import { EnergyTracker } from './energy.js';
import { StateStore, TokenStore } from './storage.js';
export interface PlatformDependencies {
    auth?: TokenProvider;
    client?: Pick<EmporiaClient, 'getDevices' | 'getUsage'>;
    tokenStore?: TokenStore;
    stateStore?: StateStore;
    energy?: EnergyTracker;
    now?: () => number;
}
export declare class EmporiaMatterPlatform implements DynamicPlatformPlugin {
    private readonly api;
    private readonly log;
    private readonly config;
    private readonly matter;
    private readonly auth;
    private readonly client;
    private readonly stateStore;
    private readonly energy;
    private readonly now;
    private readonly cached;
    private readonly registered;
    private readonly published;
    private definitions;
    private devices;
    private state;
    private pollTimer?;
    private lastMetadataMs;
    private lastSuccessMs;
    private lastSaveMs;
    private polling;
    private started;
    private stopped;
    constructor(log: Logging, config: PlatformConfig, api: API, dependencies?: PlatformDependencies);
    /** HAP accessories are not used by this plugin. */
    configureAccessory(accessory: PlatformAccessory): void;
    configureMatterAccessory(accessory: MatterAccessory): void;
    start(): Promise<void>;
    stop(): Promise<void>;
    /** Visible for tests and for a manual refresh. */
    poll(): Promise<void>;
    private refreshDevices;
    private buildDefinitions;
    private reconcile;
    private publishAll;
    private publishStale;
    private publish;
    private scheduleNext;
    private saveState;
}
