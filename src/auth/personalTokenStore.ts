import {
  getCredentialStore,
  type CredentialReadOptions,
  type CredentialSaveOutcome,
  type CredentialStore,
  type CredentialStoreStatus,
} from './credentialStore.js';

/**
 * The refresh token is the only long-lived secret the new auth path keeps, and
 * it is bound to the server that issued it: a token from the dev API must never
 * be replayed against production. The API URL is therefore part of the account
 * name rather than shared across every server.
 */
const SLOT_PREFIX = 'personal-refresh';

export interface PersonalTokenStore {
  status(): CredentialStoreStatus;
  /** Pass `{ fresh: true }` before presenting the token — see {@link CredentialReadOptions}. */
  read(options?: CredentialReadOptions): string | null;
  save(refreshToken: string): CredentialSaveOutcome;
  remove(): void;
}

export function personalTokenSlot(apiUrl: string): string {
  return `${SLOT_PREFIX}:${apiUrl.replace(/\/+$/, '')}`;
}

/**
 * Wrap the credential store in a single-slot view.
 *
 * Access tokens deliberately have no way in here — they live for 15 minutes and
 * stay in process memory, so there is nothing to revoke if a disk is imaged.
 */
export function createPersonalTokenStore(
  apiUrl: string,
  store: CredentialStore = getCredentialStore(),
): PersonalTokenStore {
  const slot = personalTokenSlot(apiUrl);

  return {
    // Scoped to the slot, not the store: once a login has had to fall back to a
    // file, "which backend is this token in" is a per-server answer. Asking the
    // store-wide question would name the OS keychain on a machine whose keychain
    // recovered but whose token is still in the file — and `auth status` would
    // then point the user at a store that does not have it.
    status: () => store.status(slot),
    read: (options) => store.read(slot, options),
    save: (refreshToken) => store.save(slot, refreshToken),
    remove: () => store.remove(slot),
  };
}
