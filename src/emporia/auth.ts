import { TokenStore, type StoredTokens } from '../storage.js';
import { asNumber, asString, errorMessage, isRecord, redactEmail } from '../util.js';

export const COGNITO_REGION = 'us-east-2';
export const COGNITO_USER_POOL = 'us-east-2_ghlOXVLi1';
export const COGNITO_CLIENT_ID = '4qte47jbstod8apnfic0bunmrq';
export const COGNITO_ENDPOINT = `https://cognito-idp.${COGNITO_REGION}.amazonaws.com/`;

const REFRESH_WINDOW_MS = 5 * 60 * 1000;

export interface AuthTokens extends StoredTokens {
  expiresAt: number;
}

export interface TokenProvider {
  getIdToken(): Promise<string>;
  refresh(): Promise<AuthTokens>;
}

export interface AuthLogger {
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export interface EmporiaAuthOptions {
  email: string;
  password?: string;
  tokenStore: TokenStore;
  fetchImpl?: typeof fetch;
  now?: () => number;
  log?: AuthLogger;
}

export class EmporiaAuthError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'EmporiaAuthError';
  }
}

function decodeJwtExpiry(token: string): number | undefined {
  const parts = token.split('.');
  if (parts.length < 2) {
    return undefined;
  }
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as unknown;
    if (!isRecord(payload)) {
      return undefined;
    }
    const exp = asNumber(payload.exp);
    return exp === undefined ? undefined : exp * 1000;
  } catch {
    return undefined;
  }
}

function cognitoErrorCode(body: unknown, status: number): string {
  if (isRecord(body)) {
    const type = asString(body.__type);
    if (type) {
      return type.split('#').pop() ?? type;
    }
  }
  return `HTTP_${status}`;
}

export class EmporiaAuth implements TokenProvider {
  private readonly email: string;
  private readonly password?: string;
  private readonly tokenStore: TokenStore;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly log?: AuthLogger;
  private tokens?: AuthTokens;
  private refreshing?: Promise<AuthTokens>;

  constructor(options: EmporiaAuthOptions) {
    this.email = options.email;
    this.password = options.password;
    this.tokenStore = options.tokenStore;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? Date.now;
    this.log = options.log;
  }

  async getIdToken(): Promise<string> {
    if (!this.tokens) {
      await this.loadPersisted();
    }

    if (this.tokens && this.tokens.expiresAt - this.now() > REFRESH_WINDOW_MS) {
      return this.tokens.idToken;
    }

    if (this.tokens?.refreshToken) {
      try {
        return (await this.refresh()).idToken;
      } catch (error) {
        if (!this.password) {
          throw error;
        }
        this.log?.warn(`Emporia token refresh failed (${errorMessage(error)}); falling back to password login.`);
      }
    }

    if (!this.password) {
      throw new EmporiaAuthError(
        'NO_CREDENTIALS',
        'No valid Emporia refresh token and no password configured. Enter the account password in the plugin settings.',
      );
    }

    return (await this.login()).idToken;
  }

  async login(): Promise<AuthTokens> {
    if (!this.password) {
      throw new EmporiaAuthError('NO_PASSWORD', 'An Emporia password is required for the first login.');
    }

    this.log?.info(`Signing in to Emporia as ${redactEmail(this.email)}.`);
    const response = await this.cognitoRequest({
      AuthFlow: 'USER_PASSWORD_AUTH',
      ClientId: COGNITO_CLIENT_ID,
      AuthParameters: {
        USERNAME: this.email.toLowerCase(),
        PASSWORD: this.password,
      },
    });

    const tokens = this.tokensFromResponse(response, undefined);
    await this.persist(tokens);
    this.log?.info('Emporia sign-in succeeded.');
    return tokens;
  }

  async refresh(): Promise<AuthTokens> {
    if (this.refreshing) {
      return this.refreshing;
    }

    const current = this.tokens ?? (await this.loadPersisted());
    if (!current?.refreshToken) {
      throw new EmporiaAuthError('NO_REFRESH_TOKEN', 'No Emporia refresh token is available.');
    }

    this.refreshing = this.doRefresh(current).finally(() => {
      this.refreshing = undefined;
    });
    return this.refreshing;
  }

  private async doRefresh(current: AuthTokens): Promise<AuthTokens> {
    this.log?.debug('Refreshing Emporia session token.');
    const response = await this.cognitoRequest({
      AuthFlow: 'REFRESH_TOKEN_AUTH',
      ClientId: COGNITO_CLIENT_ID,
      AuthParameters: {
        REFRESH_TOKEN: current.refreshToken,
      },
    });

    const tokens = this.tokensFromResponse(response, current);
    await this.persist(tokens);
    this.log?.debug('Emporia session token refreshed.');
    return tokens;
  }

  private async loadPersisted(): Promise<AuthTokens | undefined> {
    const stored = await this.tokenStore.load();
    if (!stored) {
      return undefined;
    }
    this.tokens = {
      ...stored,
      expiresAt: stored.expiresAt || decodeJwtExpiry(stored.idToken) || 0,
    };
    return this.tokens;
  }

  private tokensFromResponse(response: unknown, previous: AuthTokens | undefined): AuthTokens {
    if (!isRecord(response) || !isRecord(response.AuthenticationResult)) {
      throw new EmporiaAuthError('INVALID_RESPONSE', 'Emporia authentication returned an unexpected response.');
    }

    const result = response.AuthenticationResult;
    const idToken = asString(result.IdToken);
    const accessToken = asString(result.AccessToken);
    const refreshToken = asString(result.RefreshToken) ?? previous?.refreshToken;

    if (!idToken || !accessToken || !refreshToken) {
      throw new EmporiaAuthError('INVALID_RESPONSE', 'Emporia authentication did not return the required tokens.');
    }

    const expiresIn = asNumber(result.ExpiresIn);
    const expiresAt =
      expiresIn !== undefined
        ? this.now() + expiresIn * 1000
        : decodeJwtExpiry(idToken) ?? this.now() + 60 * 60 * 1000;

    return {
      idToken,
      accessToken,
      refreshToken,
      expiresAt,
      email: this.email,
    };
  }

  private async cognitoRequest(body: Record<string, unknown>): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetchImpl(COGNITO_ENDPOINT, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-amz-json-1.1',
          'x-amz-target': 'AWSCognitoIdentityProviderService.InitiateAuth',
        },
        body: JSON.stringify(body),
      });
    } catch (error) {
      throw new EmporiaAuthError('NETWORK', `Could not reach Emporia sign-in: ${errorMessage(error)}`);
    }

    const text = await response.text();
    let parsed: unknown;
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      parsed = {};
    }

    if (!response.ok) {
      const code = cognitoErrorCode(parsed, response.status);
      const message = isRecord(parsed) && asString(parsed.message) ? asString(parsed.message) : response.statusText;
      throw new EmporiaAuthError(code, `Emporia sign-in failed (${code}): ${message}`);
    }

    return parsed;
  }

  private async persist(tokens: AuthTokens): Promise<void> {
    this.tokens = tokens;
    try {
      await this.tokenStore.save(tokens);
    } catch (error) {
      this.log?.warn(`Could not save the Emporia session token: ${errorMessage(error)}`);
    }
  }

  /** Test seam: seed tokens without touching the store. */
  setTokensForTest(tokens: AuthTokens): void {
    this.tokens = tokens;
  }
}
