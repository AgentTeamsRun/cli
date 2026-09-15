import { createHash } from 'node:crypto';
import type { PersonalTokenSession } from './personalTokenClient.js';
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
  readAccess?(refreshToken: string): PersonalTokenSession | null;
  saveAccess?(session: PersonalTokenSession, refreshToken: string): void;
  removeAccess?(): void;
}

export function personalTokenSlot(apiUrl: string): string {
  return `${SLOT_PREFIX}:${apiUrl.replace(/\/+$/, '')}`;
}

/**
 * Wrap the credential store in a single-slot view.
 *
 * 15분 access token은 크기 제한 없는 보호 파일의 별도 슬롯에 캐시한다.
 * OS 키체인의 입력 제한과 refresh 저장 상태를 분리하며 파일 금지 시 캐시를 생략한다.
 * 명령마다 회전하며 응답 유실 위험을 누적하던 메모리 전용 결정을 변경했다.
 * refresh 지문을 함께 검증해 재로그인·구버전 CLI 회전 뒤 낡은 캐시를 쓰지 않는다.
 */
export function createPersonalTokenStore(
  apiUrl: string,
  store: CredentialStore = getCredentialStore(),
): PersonalTokenStore {
  const slot = personalTokenSlot(apiUrl);
  const accessSlot = `personal-access:${apiUrl.replace(/\/+$/, '')}`;
  const fingerprint = (token: string) => createHash('sha256').update(token).digest('hex');

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
    readAccess: (refreshToken) => {
      try {
        const raw = store.read(accessSlot, { fresh: true });
        if (!raw) return null;
        const value = JSON.parse(raw);
        if (
          value?.refreshFingerprint !== fingerprint(refreshToken) ||
          typeof value.accessToken !== 'string' ||
          !value.accessToken ||
          typeof value.expiresAt !== 'number' ||
          !Number.isFinite(value.expiresAt) ||
          typeof value.identity?.memberId !== 'string' ||
          typeof value.identity.email !== 'string' ||
          typeof value.identity.nickname !== 'string'
        )
          return null;
        return { accessToken: value.accessToken, expiresAt: value.expiresAt, identity: value.identity };
      } catch {
        return null;
      }
    },
    saveAccess: (session, refreshToken) => {
      store.saveProtectedCache?.(
        accessSlot,
        JSON.stringify({ ...session, refreshFingerprint: fingerprint(refreshToken) }),
      );
    },
    removeAccess: () => store.remove(accessSlot),
  };
}
