import { getCredentialStore, } from './credentialStore.js';
/**
 * The refresh token is the only long-lived secret the new auth path keeps, and
 * it is bound to the server that issued it: a token from the dev API must never
 * be replayed against production. The API URL is therefore part of the account
 * name rather than shared across every server.
 */
const SLOT_PREFIX = 'personal-refresh';
export function personalTokenSlot(apiUrl) {
    return `${SLOT_PREFIX}:${apiUrl.replace(/\/+$/, '')}`;
}
/**
 * Wrap the OS credential store in a single-slot view.
 *
 * Access tokens deliberately have no way in here — they live for 15 minutes and
 * stay in process memory, so there is nothing to revoke if a disk is imaged.
 */
export function createPersonalTokenStore(apiUrl, store = getCredentialStore()) {
    const slot = personalTokenSlot(apiUrl);
    return {
        status: () => store.status(),
        read: (options) => store.read(slot, options),
        save: (refreshToken) => store.save(slot, refreshToken),
        remove: () => store.remove(slot),
    };
}
//# sourceMappingURL=personalTokenStore.js.map