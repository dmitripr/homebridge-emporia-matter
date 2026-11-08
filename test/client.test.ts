import { describe, expect, it, vi } from 'vitest';

import type { AuthTokens, TokenProvider } from '../src/emporia/auth.js';
import { EmporiaApiError, EmporiaClient } from '../src/emporia/client.js';
import { fixture } from './helpers.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

class FakeAuth implements TokenProvider {
  token = 'id-token';
  refreshCalls = 0;

  async getIdToken(): Promise<string> {
    return this.token;
  }

  async refresh(): Promise<AuthTokens> {
    this.refreshCalls += 1;
    this.token = 'new-id-token';
    return {
      idToken: this.token,
      accessToken: 'new-access-token',
      refreshToken: 'refresh-token',
      expiresAt: Date.now() + 3600_000,
    };
  }
}

function client(fetchImpl: typeof fetch, auth = new FakeAuth()) {
  return new EmporiaClient({
    auth,
    fetchImpl,
    sleep: async () => undefined,
    now: () => 1_000_000,
  });
}

describe('EmporiaClient.getDevices', () => {
  it('uses the v1 endpoint with a Bearer token', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(fixture('devices_v1.json')));
    const devices = await client(fetchImpl as unknown as typeof fetch).getDevices();

    expect(devices).toHaveLength(2);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(url)).toBe('https://api.emporiaenergy.com/v1/customers/devices');
    expect(init.headers).toMatchObject({ authorization: 'Bearer id-token' });
  });

  it('falls back to the legacy endpoint on 404', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ message: 'not found' }, 404))
      .mockResolvedValueOnce(jsonResponse(fixture('devices_legacy.json')));
    const devices = await client(fetchImpl as unknown as typeof fetch).getDevices();

    expect(devices).toHaveLength(1);
    const [url, init] = fetchImpl.mock.calls[1] as unknown as [URL, RequestInit];
    expect(String(url)).toBe('https://api.emporiaenergy.com/customers/devices');
    expect(init.headers).toMatchObject({ authtoken: 'id-token' });
  });

  it('falls back to the legacy endpoint on 400', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ message: 'bad request' }, 400))
      .mockResolvedValueOnce(jsonResponse(fixture('devices_legacy.json')));
    const devices = await client(fetchImpl as unknown as typeof fetch).getDevices();

    expect(devices).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const [url, init] = fetchImpl.mock.calls[1] as unknown as [URL, RequestInit];
    expect(String(url)).toBe('https://api.emporiaenergy.com/customers/devices');
    expect(init.headers).toMatchObject({ authtoken: 'id-token' });
  });

  it('includes the endpoint and response body in the error message', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ message: 'device_gids is required' }, 400));

    await expect(client(fetchImpl as unknown as typeof fetch).getDevices()).rejects.toThrow(
      /400\) at \/customers\/devices:.*device_gids is required/,
    );
  });
});

describe('EmporiaClient.getUsage', () => {
  it('asks for 1MIN energy in kWh and parses the response', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(fixture('usages_v1.json')));
    const usage = await client(fetchImpl as unknown as typeof fetch).getUsage([1001, 1002], new Date('2026-11-01T20:10:20.657Z'));

    expect(usage.get(1001)?.channels.get('Mains')?.usageKwh).toBe(0.05);
    const [url] = fetchImpl.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(url)).toContain('/v1/customers/devices/usages');
    expect(String(url)).toContain('device_gids=1001%2C1002');
    expect(String(url)).toContain('scale=1MIN');
    expect(String(url)).toContain('energy_unit=KILOWATT_HOURS');
    expect(String(url)).toContain('instant=2026-11-01T20%3A10%3A20.657Z');
  });

  it('falls back to the legacy AppAPI on 404', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ message: 'not found' }, 404))
      .mockResolvedValueOnce(jsonResponse(fixture('usages_legacy.json')));
    const usage = await client(fetchImpl as unknown as typeof fetch).getUsage([2001]);

    expect(usage.get(2001)?.channels.get('Mains')?.usageKwh).toBe(0.06);
    const [url, init] = fetchImpl.mock.calls[1] as unknown as [URL, RequestInit];
    expect(String(url)).toContain('/AppAPI?');
    expect(String(url)).toContain('apiMethod=getDeviceListUsages');
    expect(String(url)).toContain('deviceGids=2001');
    expect(String(url)).toContain('energyUnit=KilowattHours');
    expect(init.headers).toMatchObject({ authtoken: 'id-token' });
  });

  it('returns an empty map without calling the API when there are no devices', async () => {
    const fetchImpl = vi.fn();
    const usage = await client(fetchImpl as unknown as typeof fetch).getUsage([]);
    expect(usage.size).toBe(0);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('EmporiaClient retries and auth', () => {
  it('refreshes once on 401 and retries the request', async () => {
    const auth = new FakeAuth();
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ message: 'unauthorized' }, 401))
      .mockResolvedValueOnce(jsonResponse(fixture('devices_v1.json')));
    const devices = await client(fetchImpl as unknown as typeof fetch, auth).getDevices();

    expect(devices).toHaveLength(2);
    expect(auth.refreshCalls).toBe(1);
    const [, secondInit] = fetchImpl.mock.calls[1] as unknown as [URL, RequestInit];
    expect(secondInit.headers).toMatchObject({ authorization: 'Bearer new-id-token' });
  });

  it('retries 5xx responses and then succeeds', async () => {
    const sleep = vi.fn(async () => undefined);
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ message: 'server error' }, 500))
      .mockResolvedValueOnce(jsonResponse(fixture('devices_v1.json')));
    const emporia = new EmporiaClient({
      auth: new FakeAuth(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep,
      now: () => 1_000_000,
    });

    await expect(emporia.getDevices()).resolves.toHaveLength(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it('does not retry a 400 response', async () => {
    const sleep = vi.fn(async () => undefined);
    const fetchImpl = vi.fn(async () => jsonResponse({ message: 'bad request' }, 400));
    const emporia = new EmporiaClient({
      auth: new FakeAuth(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep,
      now: () => 1_000_000,
    });

    await expect(emporia.getDevices()).rejects.toMatchObject({ status: 400 });
    expect(sleep).not.toHaveBeenCalled();
  });

  it('does not include the token in API errors', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ message: 'nope' }, 400));
    const emporia = client(fetchImpl as unknown as typeof fetch);

    try {
      await emporia.getDevices();
      throw new Error('expected a failure');
    } catch (error) {
      expect(error).toBeInstanceOf(EmporiaApiError);
      expect(String(error)).not.toContain('id-token');
    }
  });
});
