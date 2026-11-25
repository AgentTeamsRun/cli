import { createHash } from 'node:crypto';
/**
 * Filesystem-safe name for a credential slot.
 *
 * A slot embeds an API URL, whose `:` and `/` are not portable in a filename, so
 * everything the CLI keeps per slot on disk — the rotation lock and the credential
 * file fallback — is named by this hash instead. Sharing one function is what
 * keeps `personal-token-<hash>.lock` and `personal-token-<hash>.cred`
 * recognisably the same slot; forking it would let the two drift apart silently.
 *
 * 16 hex characters is 64 bits. This is a naming scheme, not a security boundary:
 * the slot text is not a secret, and a collision would only mean two API URLs
 * sharing a lock and a credential file.
 */
export function credentialSlotHash(slot) {
    return createHash('sha256').update(slot).digest('hex').slice(0, 16);
}
//# sourceMappingURL=slotHash.js.map