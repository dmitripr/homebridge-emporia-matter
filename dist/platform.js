import { buildGroupedAccessory, buildSplitAccessory } from './accessory.js';
import { channelKey, overrideFor, resolveAccessoryType, resolveChannelName, resolveConfig, shouldExposeChannel, } from './config.js';
import { EmporiaAuth } from './emporia/auth.js';
import { EmporiaClient } from './emporia/client.js';
import { EnergyTracker } from './energy.js';
import { groupedIdentitySeed, partIdForChannel, resolveGeneration, splitIdentitySeed, structureSignature, } from './identity.js';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js';
import { emptyState, FileStore, StateStore, TokenStore, } from './storage.js';
import { energyChanged, kwhToWatts, milliwattsToMilliamps, powerChanged } from './units.js';
import { errorMessage } from './util.js';
const METADATA_REFRESH_MS = 30 * 60 * 1000;
const SAVE_INTERVAL_MS = 5 * 60 * 1000;
export class EmporiaMatterPlatform {
    api;
    log;
    config;
    matter;
    auth;
    client;
    stateStore;
    energy;
    now;
    cached = new Map();
    registered = new Set();
    published = new Map();
    definitions = new Map();
    devices = new Map();
    state = emptyState();
    pollTimer;
    lastMetadataMs = 0;
    lastSuccessMs = 0;
    lastSaveMs = 0;
    polling = false;
    started = false;
    stopped = false;
    constructor(log, config, api, dependencies = {}) {
        this.log = log;
        this.api = api;
        this.now = dependencies.now ?? Date.now;
        this.config = resolveConfig(config);
        if (!api.versionGreaterOrEqual?.('2.5.0')) {
            log.error(`This plugin requires Homebridge v2.5.0 or later (you are running v${api.serverVersion}). `
                + 'Update Homebridge before enabling this plugin.');
            this.matter = undefined;
            this.auth = undefined;
            this.client = undefined;
            this.stateStore = undefined;
            this.energy = new EnergyTracker();
            return;
        }
        if (!api.isMatterAvailable?.() || !api.matter || !api.isMatterEnabled?.()) {
            log.warn('Matter is not enabled on this bridge. This is a Matter-only plugin: open its bridge settings '
                + 'in the Homebridge UI and turn on "Enable Matter" (HAP can be turned off).');
            this.matter = undefined;
            this.auth = undefined;
            this.client = undefined;
            this.stateStore = undefined;
            this.energy = new EnergyTracker();
            return;
        }
        if (api.isMatterExternalsOnly?.()) {
            log.warn('This bridge is in Matter externals-only mode. Bridged accessories are not published, '
                + 'so this plugin cannot expose its meters here. Use a normal Matter bridge instead.');
            this.matter = undefined;
            this.auth = undefined;
            this.client = undefined;
            this.stateStore = undefined;
            this.energy = new EnergyTracker();
            return;
        }
        if (!this.config.email) {
            log.error('No Emporia account email is configured. Add it in the plugin settings.');
        }
        this.matter = api.matter;
        const storagePath = api.user.storagePath();
        const tokenStore = dependencies.tokenStore ?? new TokenStore(new FileStore(`${storagePath}/emporia-matter-tokens.json`));
        this.stateStore = dependencies.stateStore ?? new StateStore(new FileStore(`${storagePath}/emporia-matter-state.json`));
        this.energy = dependencies.energy ?? new EnergyTracker();
        this.auth =
            dependencies.auth
                ?? new EmporiaAuth({
                    email: this.config.email,
                    password: this.config.password,
                    tokenStore,
                    log,
                });
        this.client =
            dependencies.client
                ?? new EmporiaClient({
                    auth: this.auth,
                    log,
                });
        api.on('didFinishLaunching', () => void this.start());
        api.on('shutdown', () => void this.stop());
    }
    /** HAP accessories are not used by this plugin. */
    configureAccessory(accessory) {
        void accessory;
    }
    configureMatterAccessory(accessory) {
        this.cached.set(accessory.UUID, accessory);
        this.log.debug(`Restored cached Matter accessory ${accessory.displayName} (${accessory.UUID}).`);
    }
    async start() {
        if (this.started || this.stopped || !this.matter) {
            return;
        }
        this.started = true;
        try {
            this.state = await this.stateStore.load();
            this.energy.restore(this.state.energy);
            await this.refreshDevices();
            this.definitions = this.buildDefinitions();
            await this.reconcile();
            await this.publishAll(null);
            await this.poll();
        }
        catch (error) {
            this.log.error(`Emporia startup failed: ${errorMessage(error)}`);
        }
        this.scheduleNext();
    }
    async stop() {
        this.stopped = true;
        if (this.pollTimer) {
            clearTimeout(this.pollTimer);
            this.pollTimer = undefined;
        }
        await this.saveState(true);
    }
    /** Visible for tests and for a manual refresh. */
    async poll() {
        if (this.polling || this.stopped || !this.matter) {
            return;
        }
        this.polling = true;
        const now = this.now();
        try {
            if (this.devices.size === 0 || now - this.lastMetadataMs > METADATA_REFRESH_MS) {
                await this.refreshDevices();
                this.definitions = this.buildDefinitions();
                await this.reconcile();
            }
            const gids = [...new Set([...this.definitions.values()].map((definition) => definition.deviceGid))];
            if (gids.length === 0) {
                return;
            }
            const usage = await this.client.getUsage(gids, new Date(now));
            this.lastSuccessMs = now;
            for (const definition of this.definitions.values()) {
                const deviceUsage = usage.get(definition.deviceGid);
                for (const binding of definition.channels) {
                    const channelUsage = deviceUsage?.channels.get(binding.channelId);
                    let powerWatts = null;
                    if (channelUsage
                        && channelUsage.hasData !== false
                        && channelUsage.usageKwh !== null
                        && Number.isFinite(channelUsage.usageKwh)) {
                        powerWatts = kwhToWatts(channelUsage.usageKwh, '1MIN');
                    }
                    if (powerWatts !== null && powerWatts < 0 && !this.config.solar) {
                        powerWatts = 0;
                    }
                    const energy = this.energy.update(channelKey(definition.deviceGid, binding.channelId), powerWatts, now, this.config.solar);
                    await this.publish(definition, binding, powerWatts, energy.importedMwh, energy.exportedMwh);
                }
            }
            await this.saveState(false);
        }
        catch (error) {
            this.log.warn(`Emporia poll failed: ${errorMessage(error)}`);
            try {
                await this.publishStale(now);
            }
            catch (staleError) {
                this.log.debug(`Could not mark Emporia readings unavailable: ${errorMessage(staleError)}`);
            }
        }
        finally {
            this.polling = false;
        }
    }
    async refreshDevices() {
        const devices = await this.client.getDevices();
        this.devices = new Map(devices.map((device) => [device.deviceGid, device]));
        this.lastMetadataMs = this.now();
        this.log.info(`Found ${devices.length} Emporia monitor(s).`);
    }
    buildDefinitions() {
        const definitions = new Map();
        if (!this.matter) {
            return definitions;
        }
        for (const device of this.devices.values()) {
            const exposed = device.channels.filter((channel) => shouldExposeChannel(device, channel, this.config));
            if (exposed.length === 0) {
                continue;
            }
            const mode = this.config.splitChannels ? 'split' : 'grouped';
            const layoutKey = `layout:${device.deviceGid}`;
            const layout = resolveGeneration(this.state.devices[layoutKey], mode);
            this.state.devices[layoutKey] = { generation: layout.generation, signature: mode };
            if (this.config.splitChannels) {
                for (const channel of exposed) {
                    const accessoryType = resolveAccessoryType(this.config, device.deviceGid, channel.channelId);
                    const signature = structureSignature({
                        deviceGid: device.deviceGid,
                        mode: 'split',
                        channels: [{ channelId: channel.channelId, accessoryType }],
                    });
                    const key = `split:${device.deviceGid}:${channel.channelId}`;
                    const generation = resolveGeneration(this.state.devices[key], signature);
                    this.state.devices[key] = { generation: generation.generation, signature };
                    const uuid = this.matter.uuid.generate(splitIdentitySeed(device.deviceGid, channel.channelId, accessoryType, layout.generation * 1_000_000 + generation.generation));
                    const displayName = resolveChannelName(device, channel, overrideFor(this.config, device.deviceGid, channel.channelId));
                    const accessory = buildSplitAccessory(this.api, {
                        uuid,
                        displayName,
                        deviceGid: device.deviceGid,
                        deviceId: device.deviceId,
                        model: device.model,
                        firmware: device.firmware,
                        channelId: channel.channelId,
                        accessoryType,
                        solar: this.config.solar,
                        nominalVoltage: this.config.nominalVoltage,
                    });
                    definitions.set(uuid, {
                        uuid,
                        deviceGid: device.deviceGid,
                        displayName,
                        accessory,
                        channels: [{ channelId: channel.channelId }],
                    });
                }
                continue;
            }
            const structure = exposed.map((channel) => ({
                channelId: channel.channelId,
                accessoryType: resolveAccessoryType(this.config, device.deviceGid, channel.channelId),
            }));
            const signature = structureSignature({
                deviceGid: device.deviceGid,
                mode: 'grouped',
                channels: structure,
            });
            const key = `grouped:${device.deviceGid}`;
            const generation = resolveGeneration(this.state.devices[key], signature);
            this.state.devices[key] = { generation: generation.generation, signature };
            const uuid = this.matter.uuid.generate(groupedIdentitySeed(device.deviceGid, structure, layout.generation * 1_000_000 + generation.generation));
            const displayName = device.displayName;
            const accessory = buildGroupedAccessory(this.api, {
                uuid,
                displayName,
                deviceGid: device.deviceGid,
                deviceId: device.deviceId,
                model: device.model,
                firmware: device.firmware,
                channels: exposed.map((channel) => ({
                    channelId: channel.channelId,
                    displayName: resolveChannelName(device, channel, overrideFor(this.config, device.deviceGid, channel.channelId)),
                    accessoryType: resolveAccessoryType(this.config, device.deviceGid, channel.channelId),
                    solar: this.config.solar,
                    nominalVoltage: this.config.nominalVoltage,
                })),
            });
            definitions.set(uuid, {
                uuid,
                deviceGid: device.deviceGid,
                displayName,
                accessory,
                channels: exposed.map((channel) => ({
                    channelId: channel.channelId,
                    partId: partIdForChannel(channel.channelId),
                })),
            });
        }
        return definitions;
    }
    async reconcile() {
        if (!this.matter) {
            return;
        }
        const expected = this.definitions;
        const toRemove = [...this.cached.values()].filter((accessory) => !expected.has(accessory.UUID));
        for (const accessory of toRemove) {
            this.log.info(`Removing stale Matter accessory ${accessory.displayName}.`);
            await this.matter.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
            this.cached.delete(accessory.UUID);
            this.registered.delete(accessory.UUID);
            this.published.delete(accessory.UUID);
        }
        const toRegister = [...expected.values()]
            .filter((definition) => !this.registered.has(definition.uuid))
            .map((definition) => definition.accessory);
        if (toRegister.length > 0) {
            await this.matter.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, toRegister);
            for (const definition of expected.values()) {
                this.registered.add(definition.uuid);
                this.cached.set(definition.uuid, definition.accessory);
            }
        }
        const updates = [...expected.values()]
            .filter((definition) => {
            const cached = this.cached.get(definition.uuid);
            return cached !== undefined && cached.displayName !== definition.displayName;
        })
            .map((definition) => definition.accessory);
        if (updates.length > 0) {
            await this.matter.updatePlatformAccessories(updates);
        }
    }
    async publishAll(powerWatts) {
        for (const definition of this.definitions.values()) {
            for (const binding of definition.channels) {
                const energy = this.energy.get(channelKey(definition.deviceGid, binding.channelId));
                await this.publish(definition, binding, powerWatts, energy?.importedMwh ?? 0, energy?.exportedMwh ?? 0);
            }
        }
    }
    async publishStale(now) {
        const threshold = Math.max(3 * this.config.pollInterval * 1000, 180_000);
        if (this.lastSuccessMs > 0 && now - this.lastSuccessMs <= threshold) {
            return;
        }
        for (const definition of this.definitions.values()) {
            for (const binding of definition.channels) {
                const energy = this.energy.get(channelKey(definition.deviceGid, binding.channelId));
                await this.publish(definition, binding, null, energy?.importedMwh ?? 0, energy?.exportedMwh ?? 0);
            }
        }
    }
    async publish(definition, binding, powerWatts, importedMwh, exportedMwh) {
        if (!this.matter) {
            return;
        }
        const key = `${definition.uuid}:${binding.partId ?? 'main'}`;
        const published = this.published.get(key) ?? {};
        const powerMw = powerWatts === null ? null : Math.round(powerWatts * 1000);
        if (powerChanged(published.powerMw, powerMw)) {
            const powerState = {
                activePower: powerMw,
            };
            if (this.config.nominalVoltage !== undefined) {
                const voltageMv = Math.round(this.config.nominalVoltage * 1000);
                powerState.voltage = voltageMv;
                powerState.activeCurrent = powerMw === null ? null : milliwattsToMilliamps(powerMw, voltageMv);
            }
            await this.matter.updateAccessoryState(definition.uuid, 'electricalPowerMeasurement', powerState, binding.partId);
            published.powerMw = powerMw;
        }
        const imported = Math.round(importedMwh);
        const exported = Math.round(exportedMwh);
        if (energyChanged(published.importedMwh, imported)
            || (this.config.solar && energyChanged(published.exportedMwh, exported))) {
            const energyState = {
                cumulativeEnergyImported: { energy: imported },
            };
            if (this.config.solar) {
                energyState.cumulativeEnergyExported = { energy: exported };
            }
            await this.matter.updateAccessoryState(definition.uuid, 'electricalEnergyMeasurement', energyState, binding.partId);
            published.importedMwh = imported;
            published.exportedMwh = exported;
        }
        this.published.set(key, published);
    }
    scheduleNext() {
        if (this.stopped) {
            return;
        }
        this.pollTimer = setTimeout(() => {
            void this.poll()
                .catch((error) => this.log.debug(`Emporia poll rejected: ${errorMessage(error)}`))
                .finally(() => this.scheduleNext());
        }, this.config.pollInterval * 1000);
    }
    async saveState(force) {
        const now = this.now();
        if (!force && now - this.lastSaveMs < SAVE_INTERVAL_MS) {
            return;
        }
        this.lastSaveMs = now;
        this.state.version = 1;
        this.state.energy = this.energy.serialize();
        try {
            await this.stateStore.save(this.state);
        }
        catch (error) {
            this.log.warn(`Could not save Emporia state: ${errorMessage(error)}`);
        }
    }
}
//# sourceMappingURL=platform.js.map