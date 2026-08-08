/**
 * The credential this process is currently authenticating with, in a form the
 * HTTP layer can act on.
 *
 * `utils/httpClient.ts` must be able to answer "can this 401 be fixed by a
 * refresh?" without importing the config loader (which imports the token client,
 * which would import the HTTP layer back). A one-slot registry keeps that
 * dependency edge from existing at all.
 *
 * Only refreshable personal-token paths register anything here. A legacy `key_`
 * run leaves the slot empty, which is what makes "never attempt a refresh on the
 * old path" a structural property rather than a conditional the caller must remember.
 */
export interface RefreshableCredential {
    /** Resolve the current usable access token without forcing a refresh. */
    resolve?(): Promise<string | null>;
    /** Discard the cached access token and fetch a new one. Null means "could not". */
    refresh(): Promise<string | null>;
}
export type InjectedPersonalTokenRefreshBlockReason = 'IDENTITY_MISSING' | 'CLI_CREDENTIAL_MISSING' | 'CLI_CREDENTIAL_UNAVAILABLE' | 'IDENTITY_MISMATCH';
export declare function setActiveCredential(credential: RefreshableCredential | null): void;
export declare function getActiveCredential(): RefreshableCredential | null;
export declare function setInjectedPersonalTokenRefreshBlockReason(reason: InjectedPersonalTokenRefreshBlockReason): void;
export declare function getInjectedPersonalTokenRefreshBlockReason(): InjectedPersonalTokenRefreshBlockReason | null;
/** Test-only: return the process to the "no refreshable credential" state. */
export declare function resetActiveCredentialForTests(): void;
//# sourceMappingURL=activeCredential.d.ts.map