/**
 * 세션 시작 훅을 설치할 수 있는 클라이언트 레지스트리.
 *
 * `mcp-registration/clients.ts`와 같은 관례로 `docsUrl`·`verifiedAt`을 둔다. 훅 스키마가 바뀌었을 때
 * 어느 날짜의 어떤 문서를 근거로 한 주장인지 거슬러 올라갈 수 있어야 한다.
 *
 * Claude Code(2026-09-12, 로컬 2.1.267 + 공식 문서): 설정 위치는 `~/.claude/settings.json`(user)과
 * `.claude/settings.json`(project), 구조는 `hooks.<Event>[] = { matcher, hooks: [{ type, command, timeout }] }`,
 * `timeout` 단위는 초. `.claude/settings.local.json`도 읽히지만 개인 설정 파일이라 여기서는 쓰지 않는다.
 */
export declare const SESSION_HOOK_CLIENT_IDS: readonly ["claude-code"];
export type SessionHookClientId = (typeof SESSION_HOOK_CLIENT_IDS)[number];
export declare const DEFAULT_SESSION_HOOK_CLIENT_ID: SessionHookClientId;
export declare const SESSION_HOOK_SCOPES: readonly ["project", "user"];
export type SessionHookScope = (typeof SESSION_HOOK_SCOPES)[number];
export interface SessionHookPathContext {
    cwd: string;
    homeDir: string;
}
export interface SessionHookCommand {
    type: 'command';
    command: string;
    timeout: number;
}
export interface SessionHookMatcherGroup {
    matcher: string;
    hooks: SessionHookCommand[];
}
export interface SessionHookClientDefinition {
    id: SessionHookClientId;
    label: string;
    docsUrl: string;
    verifiedAt: string;
    configPath: (scope: SessionHookScope, context: SessionHookPathContext) => string;
    /** `hooks` 아래의 이벤트 키. */
    event: string;
    /**
     * AgentTeams 항목의 신원. 설정 파일이 JSON이라 마커 주석을 둘 수 없으므로 명령 문자열이
     * 정확히 같은 훅만 AgentTeams 것으로 본다 — 사용자가 손으로 고친 변형은 건드리지 않는다.
     */
    command: string;
    entry: SessionHookMatcherGroup;
}
export declare const SESSION_HOOK_CLIENTS: SessionHookClientDefinition[];
export declare function isSessionHookClientId(value: unknown): value is SessionHookClientId;
export declare function isSessionHookScope(value: unknown): value is SessionHookScope;
export declare function findSessionHookClient(id: SessionHookClientId): SessionHookClientDefinition | undefined;
//# sourceMappingURL=clients.d.ts.map