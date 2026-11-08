import { TokenStore, type StoredTokens } from '../storage.js';
export declare const COGNITO_REGION = "us-east-2";
export declare const COGNITO_USER_POOL = "us-east-2_ghlOXVLi1";
export declare const COGNITO_CLIENT_ID = "4qte47jbstod8apnfic0bunmrq";
export declare const COGNITO_ENDPOINT = "https://cognito-idp.us-east-2.amazonaws.com/";
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
export declare class EmporiaAuthError extends Error {
    readonly code: string;
    constructor(code: string, message: string);
}
export declare class EmporiaAuth implements TokenProvider {
    private readonly email;
    private readonly password?;
    private readonly tokenStore;
    private readonly fetchImpl;
    private readonly now;
    private readonly log?;
    private tokens?;
    private refreshing?;
    constructor(options: EmporiaAuthOptions);
    getIdToken(): Promise<string>;
    login(): Promise<AuthTokens>;
    refresh(): Promise<AuthTokens>;
    private doRefresh;
    private loadPersisted;
    private tokensFromResponse;
    private cognitoRequest;
    private persist;
    /** Test seam: seed tokens without touching the store. */
    setTokensForTest(tokens: AuthTokens): void;
}
