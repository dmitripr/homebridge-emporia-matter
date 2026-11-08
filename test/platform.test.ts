import { describe, expect, it, vi } from 'vitest';
import type { API, Logging, MatterAccessory, PlatformConfig } from 'homebridge';

import { parseDevices, parseUsage } from '../src/emporia/parse.js';
import type { DeviceUsage, EmporiaDevice } from '../src/emporia/types.js';
import type { AuthTokens, TokenProvider } from '../src/emporia/auth.js';
import { EnergyTracker } from '../src/energy.js';
import { EmporiaMatterPlatform } from '../src/platform.js';
import { MemoryStore, StateStore } from '../src/storage.js';
import { fixture } from './helpers.js';

const devices = parseDevices(fixture('devices_v1.json'));
const usage = parseUsage(fixture('usages_v1.json'));

class FakeAuth implements TokenProvider {
  async getIdToken(): Promise<string> {
    return 'token';
  }

  async refresh(): Promise<AuthTokens> {
    return {
      idToken: 'token',
      accessToken: 'access',
      refreshToken: 'refresh',
      expiresAt: Date.now() + 3600_000,
    };
  }
}

class FakeClient {
  devices: EmporiaDevice[] = devices;
  usage: Map<number, DeviceUsage> = usage;
  fail = false;

  async getDevices(): Promise<EmporiaDevice[]> {
    return this.devices;
  }

  async getUsage(): Promise<Map<number, DeviceUsage>> {
    if (this.fail) {
      throw new Error('api down');
    }
    return this.usage;
  }
}

function logger(): Logging {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    log: vi.fn(),
    success: vi.fn(),
    prefix: '',
  } as unknown as Logging;
}

function makeApi(options: { matterEnabled?: boolean } = {}) {
  const register = vi.fn(async () => undefined);
  const unregister = vi.fn(async () => undefined);
  const updateState = vi.fn(async () => undefined);
  const updatePlatform = vi.fn(async () => undefined);
  const api = {
    versionGreaterOrEqual: () => true,
    serverVersion: '2.5.0',
    isMatterAvailable: () => true,
    isMatterEnabled: () => options.matterEnabled ?? true,
    isMatterExternalsOnly: () => false,
    user: { storagePath: () => '/tmp/emporia-matter-test' },
    matter: {
      uuid: {
        generate: (seed: string) => `uuid-${Buffer.from(seed).toString('base64url')}`,
      },
      deviceTypes: {
        OnOffOutlet: 'OnOffOutlet',
        OnOffLight: 'OnOffLight',
        OnOffSwitch: 'OnOffSwitch',
        BridgedNode: 'BridgedNode',
      },
      registerPlatformAccessories: register,
      unregisterPlatformAccessories: unregister,
      updateAccessoryState: updateState,
      updatePlatformAccessories: updatePlatform,
    },
    on: vi.fn(),
  } as unknown as API;
  return { api, register, unregister, updateState, updatePlatform };
}

function config(overrides: Record<string, unknown> = {}): PlatformConfig {
  return {
    platform: 'EmporiaMatter',
    name: 'Emporia',
    email: 'user@example.com',
    password: 'password',
    pollInterval: 60,
    ...overrides,
  } as PlatformConfig;
}

function makePlatform(api: API, overrides: Record<string, unknown> = {}, deps: {
  client?: FakeClient;
  stateStore?: StateStore;
  now?: () => number;
} = {}) {
  return new EmporiaMatterPlatform(
    logger(),
    config(overrides),
    api,
    {
      auth: new FakeAuth(),
      client: deps.client ?? new FakeClient(),
      stateStore: deps.stateStore ?? new StateStore(new MemoryStore()),
      energy: new EnergyTracker(),
      now: deps.now ?? (() => 1_000_000),
    },
  );
}

function registeredAccessories(register: ReturnType<typeof vi.fn>): MatterAccessory[] {
  const calls = register.mock.calls as unknown as [string, string, MatterAccessory[]][];
  return calls.flatMap((call) => call[2]);
}

describe('EmporiaMatterPlatform', () => {
  it('registers one Matter outlet per exposed channel', async () => {
    const { api, register, updateState } = makeApi();
    const platform = makePlatform(api);
    await platform.start();
    await platform.stop();

    const accessories = registeredAccessories(register);
    expect(accessories).toHaveLength(6);
    expect(accessories.map((accessory) => accessory.displayName)).toEqual(expect.arrayContaining([
      'Test Home Mains',
      'Kitchen',
      'Garage',
      'Unused',
      'Garage Panel Mains',
      'EV charger',
    ]));
    expect(accessories.every((accessory) => accessory.deviceType === 'OnOffOutlet')).toBe(true);
    expect(updateState).toHaveBeenCalled();
  });

  it('does not register mains when hideMains is set', async () => {
    const { api, register } = makeApi();
    const platform = makePlatform(api, { hideMains: true });
    await platform.start();
    await platform.stop();

    const names = registeredAccessories(register).map((accessory) => accessory.displayName);
    expect(names).not.toContain('Test Home Mains');
    expect(names).not.toContain('Garage Panel Mains');
    expect(names).toContain('Kitchen');
  });

  it('honours a per-channel accessory type', async () => {
    const { api, register } = makeApi();
    const platform = makePlatform(api, {
      channels: [{ channelId: 'Branch_1', accessoryType: 'light' }],
    });
    await platform.start();
    await platform.stop();

    const kitchen = registeredAccessories(register).find((accessory) => accessory.displayName === 'Kitchen');
    expect(kitchen?.deviceType).toBe('OnOffLight');
  });

  it('removes a cached accessory that is no longer expected', async () => {
    const { api, register, unregister } = makeApi();
    const stale = {
      UUID: 'stale-uuid',
      displayName: 'Stale',
      deviceType: 'OnOffOutlet',
      serialNumber: 'stale',
      manufacturer: 'Emporia',
      model: 'Emporia Vue',
      context: { deviceGid: 1001 },
      clusters: {},
    } as unknown as MatterAccessory;

    const platform = makePlatform(api);
    platform.configureMatterAccessory(stale);
    await platform.start();
    await platform.stop();

    expect(unregister).toHaveBeenCalledWith('homebridge-emporia-matter', 'EmporiaMatter', [stale]);
    expect(registeredAccessories(register)).toHaveLength(6);
  });

  it('rotates identities when the layout changes from split to grouped', async () => {
    const stateStore = new StateStore(new MemoryStore());
    const first = makeApi();
    const splitPlatform = makePlatform(first.api, {}, { stateStore });
    await splitPlatform.start();
    await splitPlatform.stop();

    const splitAccessories = registeredAccessories(first.register);
    expect(splitAccessories.length).toBe(6);

    const second = makeApi();
    const groupedPlatform = makePlatform(second.api, { splitChannels: false }, { stateStore });
    for (const accessory of splitAccessories) {
      groupedPlatform.configureMatterAccessory(accessory);
    }
    await groupedPlatform.start();
    await groupedPlatform.stop();

    expect(second.unregister).toHaveBeenCalledTimes(6);
    const grouped = registeredAccessories(second.register);
    expect(grouped).toHaveLength(2);
    expect(grouped.every((accessory) => accessory.deviceType === 'BridgedNode')).toBe(true);
    expect(grouped.every((accessory) => (accessory.parts?.length ?? 0) > 0)).toBe(true);
  });

  it('marks power unavailable after the stale threshold', async () => {
    const { api, updateState } = makeApi();
    const client = new FakeClient();
    let now = 1_000_000;
    const platform = makePlatform(api, {}, { client, now: () => now });

    await platform.start();
    now += 4 * 60 * 1000;
    client.fail = true;
    await platform.poll();
    await platform.stop();

    const powerCalls = (updateState.mock.calls as unknown as [string, string, Record<string, unknown>][])
      .filter((call) => call[1] === 'electricalPowerMeasurement');
    expect(powerCalls.some((call) => call[2].activePower === null)).toBe(true);
  });

  it('does not register anything when Matter is disabled', async () => {
    const { api, register } = makeApi({ matterEnabled: false });
    const platform = makePlatform(api);
    await platform.start();

    expect(register).not.toHaveBeenCalled();
  });

  it('uses a stable identity for the same structure', async () => {
    const stateStore = new StateStore(new MemoryStore());
    const first = makeApi();
    const firstPlatform = makePlatform(first.api, {}, { stateStore });
    await firstPlatform.start();
    await firstPlatform.stop();
    const firstUuids = registeredAccessories(first.register).map((accessory) => accessory.UUID).sort();

    const second = makeApi();
    const secondPlatform = makePlatform(second.api, {}, { stateStore });
    for (const accessory of registeredAccessories(first.register)) {
      secondPlatform.configureMatterAccessory(accessory);
    }
    await secondPlatform.start();
    await secondPlatform.stop();
    const secondUuids = registeredAccessories(second.register).map((accessory) => accessory.UUID).sort();

    expect(secondUuids).toEqual(firstUuids);
  });
});
