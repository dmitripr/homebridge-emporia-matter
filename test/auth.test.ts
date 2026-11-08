import { describe, expect, it, vi } from 'vitest';

import { COGNITO_ENDPOINT, EmporiaAuth, EmporiaAuthError } from '../src/emporia/auth.js';
import { MemoryStore, TokenStore } from '../src/storage.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function authResult(overrides: Record<string, unknown> = {}): unknown {
  return {
    AuthenticationResult: {
      IdToken: 'id-token-1',
      AccessToken: 'access-token-1',
      RefreshToken: 'refresh-token-1',
      ExpiresIn: 3600,
      TokenType: 'Bearer',
      ...overrides,
    },
  };
}

function logger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

describe('EmporiaAuth', () => {
  it('logs in with USER_PASSWORD_AUTH and stores the tokens', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(authResult()));
    const store = new TokenStore(new MemoryStore());
    const log = logger();
    const auth = new EmporiaAuth({
      email: 'User@Example.com',
      password: 'secret-password',
      tokenStore: store,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => 1_000_000,
      log,
    });

    await expect(auth.getIdToken()).resolves.toBe('id-token-1');
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(COGNITO_ENDPOINT);
    expect(init.headers).toMatchObject({
      'x-amz-target': 'AWSCognitoIdentityProviderService.InitiateAuth',
    });
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.AuthFlow).toBe('USER_PASSWORD_AUTH');
    expect(body.AuthParameters).toMatchObject({
      USERNAME: 'user@example.com',
      PASSWORD: 'secret-password',
    });

    const saved = await store.load();
    expect(saved?.idToken).toBe('id-token-1');
    expect(saved?.refreshToken).toBe('refresh-token-1');
    expect(saved?.expiresAt).toBe(1_000_000 + 3600 * 1000);

    const messages = [...log.info.mock.calls, ...log.debug.mock.calls, ...log.warn.mock.calls].flat().join(' ');
    expect(messages).not.toContain('secret-password');
    expect(messages).not.toContain('id-token-1');
    expect(messages).not.toContain('User@Example.com');
  });

  it('reuses an unexpired stored token without calling Cognito', async () => {
    const store = new TokenStore(new MemoryStore());
    await store.save({
      idToken: 'stored-id',
      accessToken: 'stored-access',
      refreshToken: 'stored-refresh',
      expiresAt: 2_000_000,
    });
    const fetchImpl = vi.fn();
    const auth = new EmporiaAuth({
      email: 'user@example.com',
      tokenStore: store,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => 1_000_000,
    });

    await expect(auth.getIdToken()).resolves.toBe('stored-id');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('refreshes an expired token and keeps the old refresh token when Cognito omits a new one', async () => {
    const store = new TokenStore(new MemoryStore());
    await store.save({
      idToken: 'old-id',
      accessToken: 'old-access',
      refreshToken: 'old-refresh',
      expiresAt: 1_000,
    });
    const fetchImpl = vi.fn(async () => jsonResponse(authResult({
      IdToken: 'new-id',
      AccessToken: 'new-access',
      RefreshToken: undefined,
      ExpiresIn: 3600,
    })));
    const auth = new EmporiaAuth({
      email: 'user@example.com',
      tokenStore: store,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => 2_000_000,
    });

    await expect(auth.getIdToken()).resolves.toBe('new-id');
    const body = JSON.parse(String((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body)) as Record<string, unknown>;
    expect(body.AuthFlow).toBe('REFRESH_TOKEN_AUTH');
    expect(body.AuthParameters).toMatchObject({ REFRESH_TOKEN: 'old-refresh' });
    expect((await store.load())?.refreshToken).toBe('old-refresh');
  });

  it('falls back to password login when refresh is rejected', async () => {
    const store = new TokenStore(new MemoryStore());
    await store.save({
      idToken: 'old-id',
      accessToken: 'old-access',
      refreshToken: 'expired-refresh',
      expiresAt: 1_000,
    });
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ __type: 'NotAuthorizedException', message: 'Refresh Token has expired' }, 400))
      .mockResolvedValueOnce(jsonResponse(authResult({ IdToken: 'fresh-id', RefreshToken: 'fresh-refresh' })));
    const log = logger();
    const auth = new EmporiaAuth({
      email: 'user@example.com',
      password: 'password',
      tokenStore: store,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => 2_000_000,
      log,
    });

    await expect(auth.getIdToken()).resolves.toBe('fresh-id');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(log.warn).toHaveBeenCalled();
  });

  it('throws NO_CREDENTIALS when the refresh token is invalid and no password is configured', async () => {
    const store = new TokenStore(new MemoryStore());
    await store.save({
      idToken: 'old-id',
      accessToken: 'old-access',
      refreshToken: 'expired-refresh',
      expiresAt: 1_000,
    });
    const fetchImpl = vi.fn(async () => jsonResponse({
      __type: 'NotAuthorizedException',
      message: 'Refresh Token has expired',
    }, 400));
    const auth = new EmporiaAuth({
      email: 'user@example.com',
      tokenStore: store,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => 2_000_000,
    });

    await expect(auth.getIdToken()).rejects.toMatchObject({ code: 'NotAuthorizedException' });
  });

  it('reports invalid credentials without leaking them', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      __type: 'NotAuthorizedException',
      message: 'Incorrect username or password.',
    }, 400));
    const auth = new EmporiaAuth({
      email: 'user@example.com',
      password: 'wrong-password',
      tokenStore: new TokenStore(new MemoryStore()),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(auth.login()).rejects.toBeInstanceOf(EmporiaAuthError);
    await expect(auth.login()).rejects.toMatchObject({ code: 'NotAuthorizedException' });
    await expect(auth.login()).rejects.not.toThrow(/wrong-password/);
  });

  it('wraps network failures', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('socket closed');
    });
    const auth = new EmporiaAuth({
      email: 'user@example.com',
      password: 'password',
      tokenStore: new TokenStore(new MemoryStore()),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(auth.login()).rejects.toMatchObject({ code: 'NETWORK' });
  });
});
