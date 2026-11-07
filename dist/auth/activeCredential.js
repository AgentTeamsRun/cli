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
let active = null;
let injectedPersonalTokenRefreshBlockReason = null;
export function setActiveCredential(credential) {
    active = credential;
    injectedPersonalTokenRefreshBlockReason = null;
}
export function getActiveCredential() {
    return active;
}
export function setInjectedPersonalTokenRefreshBlockReason(reason) {
    injectedPersonalTokenRefreshBlockReason = reason;
}
export function getInjectedPersonalTokenRefreshBlockReason() {
    return injectedPersonalTokenRefreshBlockReason;
}
/** Test-only: return the process to the "no refreshable credential" state. */
export function resetActiveCredentialForTests() {
    active = null;
    injectedPersonalTokenRefreshBlockReason = null;
}
//# sourceMappingURL=activeCredential.js.map