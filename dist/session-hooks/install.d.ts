import { type SessionHookClientId, type SessionHookScope } from './clients.js';
/**
 * 세션 시작 훅 설치·제거.
 *
 * 대상 파일은 사용자 것이다 — 권한 규칙, 다른 훅, 환경변수가 함께 들어 있다. 그래서 AgentTeams
 * 항목(명령 문자열 정확 일치)만 고치고, 나머지 키·이벤트·훅은 순서까지 그대로 둔다.
 *
 * 편집은 파싱 → 수정 → 직렬화다. `mcp-registration/jsonc.ts`의 텍스트 스플라이스는 키-값
 * 컨테이너 전용이라 배열인 `hooks.<Event>`를 다룰 수 없다. 대신 엄격한 JSON만 받는다: 주석이나
 * 후행 쉼표가 있는 파일을 재직렬화하면 그것들이 조용히 사라지므로, 그런 파일은 쓰지 않고 거부한다.
 * Claude Code 자신도 설정을 바꿀 때 파일을 JSON으로 다시 쓰므로 들여쓰기 외의 서식은 보존 대상이 아니다.
 */
export type SessionHookStatus = 'installed' | 'updated' | 'unchanged' | 'removed' | 'not-installed';
export interface SessionHookOptions {
    clientId?: SessionHookClientId;
    scope?: SessionHookScope;
    /** project 스코프의 기준 디렉터리. */
    cwd?: string;
    /** user 스코프의 기준 디렉터리. 테스트가 실제 홈을 건드리지 않도록 주입할 수 있다. */
    homeDir?: string;
    dryRun?: boolean;
}
export interface SessionHookResult {
    clientId: SessionHookClientId;
    scope: SessionHookScope;
    status: SessionHookStatus;
    configPath: string;
    /** 기존 파일을 바꿨을 때만 채워진다. 새로 만들었거나 쓰지 않았으면 `null`. */
    backupPath: string | null;
    dryRun: boolean;
    message: string;
}
/** 이 오류가 나면 대상 파일은 한 바이트도 바뀌지 않았다. */
export declare class SessionHookConfigError extends Error {
    constructor(message: string);
}
/**
 * AgentTeams 세션 훅을 설치하거나 최신 형태로 갱신한다. `session hook install`과 `init`이
 * 같은 구현을 쓰도록 명령 핸들러와 분리해 둔다.
 *
 * @throws {SessionHookConfigError} 파일을 읽거나 해석하거나 쓸 수 없을 때. 대상 파일은 그대로다.
 */
export declare function installSessionHook(options?: SessionHookOptions): SessionHookResult;
/** 설정 파일에 들어 있는 AgentTeams 세션 훅의 상태. `outdated`는 설치가 `updated`로 고칠 상태다. */
export type SessionHookInstallState = 'installed' | 'outdated' | 'not-installed';
export interface SessionHookInspection {
    clientId: SessionHookClientId;
    scope: SessionHookScope;
    state: SessionHookInstallState;
    configPath: string;
}
/**
 * 파일을 쓰지 않고 AgentTeams 세션 훅 상태만 판정한다(doctor용). 훅 설치는 명시적 opt-in이라
 * 판정하는 쪽은 절대 쓰지 않는다.
 *
 * @throws {SessionHookConfigError} 파일을 읽거나 해석할 수 없을 때.
 */
export declare function inspectSessionHook(options?: Omit<SessionHookOptions, 'dryRun'>): SessionHookInspection;
/**
 * AgentTeams 세션 훅만 지운다. 설치가 파일을 새로 만들었더라도 그 뒤에 사용자가 다른 설정을
 * 넣었을 수 있으므로 파일 자체는 지우지 않는다.
 *
 * @throws {SessionHookConfigError} 파일을 읽거나 해석하거나 쓸 수 없을 때. 대상 파일은 그대로다.
 */
export declare function uninstallSessionHook(options?: SessionHookOptions): SessionHookResult;
//# sourceMappingURL=install.d.ts.map