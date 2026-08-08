import { type CredentialReadOptions, type CredentialSaveOutcome, type CredentialStore, type CredentialStoreStatus } from './credentialStore.js';
export interface PersonalTokenStore {
    status(): CredentialStoreStatus;
    /** Pass `{ fresh: true }` before presenting the token — see {@link CredentialReadOptions}. */
    read(options?: CredentialReadOptions): string | null;
    save(refreshToken: string): CredentialSaveOutcome;
    remove(): void;
}
export declare function personalTokenSlot(apiUrl: string): string;
/**
 * Wrap the OS credential store in a single-slot view.
 *
 * Access tokens deliberately have no way in here — they live for 15 minutes and
 * stay in process memory, so there is nothing to revoke if a disk is imaged.
 */
export declare function createPersonalTokenStore(apiUrl: string, store?: CredentialStore): PersonalTokenStore;
//# sourceMappingURL=personalTokenStore.d.ts.map