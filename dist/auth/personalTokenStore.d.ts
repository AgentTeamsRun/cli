import type { PersonalTokenSession } from './personalTokenClient.js';
import { type CredentialReadOptions, type CredentialSaveOutcome, type CredentialStore, type CredentialStoreStatus } from './credentialStore.js';
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
export declare function personalTokenSlot(apiUrl: string): string;
/**
 * Wrap the credential store in a single-slot view.
 *
 * 15분 access token은 크기 제한 없는 보호 파일의 별도 슬롯에 캐시한다.
 * OS 키체인의 입력 제한과 refresh 저장 상태를 분리하며 파일 금지 시 캐시를 생략한다.
 * 명령마다 회전하며 응답 유실 위험을 누적하던 메모리 전용 결정을 변경했다.
 * refresh 지문을 함께 검증해 재로그인·구버전 CLI 회전 뒤 낡은 캐시를 쓰지 않는다.
 */
export declare function createPersonalTokenStore(apiUrl: string, store?: CredentialStore): PersonalTokenStore;
//# sourceMappingURL=personalTokenStore.d.ts.map