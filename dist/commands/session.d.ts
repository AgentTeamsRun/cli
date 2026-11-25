import { type SessionHookResult } from '../session-hooks/install.js';
/**
 * `agentteams session sync` — 세션 시작 동기화.
 *
 * convention.md의 Session Start 절이 러너에게 시키던 판정을 이쪽으로 옮긴 명령이다. 그 절은
 * status 두 번, download 두 번, 실패 3종 분기, 미러 타깃 플래그를 산문으로 설명했는데,
 * 에이전트가 그걸 읽고 매 세션 재현해야 할 이유가 없다. 여기서는 하나만 답한다:
 * **지금 무엇을 다시 읽어야 하는가**(`reread`).
 *
 * 두 가지 불변식이 있다.
 *
 * 1) `skill status`로 불필요한 다운로드를 줄인다. 실제 파일 변경은 다운로드 경로의
 *    공통 충돌 검사가 보호하며, 세션 동기화는 강제 옵션을 전달하지 않는다.
 * 2) 어떤 실패도 예외로 새어나가지 않는다. 이 명령이 죽으면 에이전트가 본 작업을 시작도 못 하고
 *    멈춘다. 실패는 전부 `notes`로 내려보내고 정상 종료한다.
 */
export type SessionSyncResult = {
    /** 지금 다시 읽어야 하는 파일. 내용이 바뀐 **always_on** 파일만 들어간다. */
    reread: string[];
    /** 서버에서 사라진 always_on 파일. 재독할 대상이 없으므로 `reread`와 분리한다. */
    invalidated: string[];
    synced: {
        conventions: boolean;
        skills: boolean;
        platformGuides: boolean;
    };
    /** 보고만 한다 — 실행 중인 바이너리를 세션 도중에 교체하지 않는다. */
    cliUpdateAvailable: boolean;
    notes: string[];
    skillConflicts: number;
    summary: string;
};
export type ConventionFileState = {
    hash: string;
    alwaysOn: boolean;
};
export type ConventionSnapshot = Map<string, ConventionFileState>;
/** 프로젝트 밖 결과의 표식. 훅 출력은 이 결과를 무출력으로 다루므로 문구를 한 곳에 둔다. */
export declare const NOT_A_PROJECT_NOTE = "Not an AgentTeams project \u2014 nothing to sync.";
/**
 * 스냅샷 대상 = 매니페스트에 기록된 배포 파일 + `convention.md`.
 * 후자는 매니페스트 엔트리가 아니라서 명시적으로 더해야 한다.
 */
export declare const snapshotConventionFiles: (projectRoot: string) => ConventionSnapshot;
/**
 * 재독 계획. **always_on만** 대상이다 — `model_decision` 파일은 정의상 필요할 때 여는 등급이라,
 * 세션 시작에 미리 읽히면 always_on을 늘린 것과 같아진다.
 *
 * 판정 기준은 updatedAt이 아니라 **내용 해시**다. 서버 메타데이터가 움직여도 배포된 바이트가
 * 같으면 에이전트가 다시 읽을 이유가 없고, 매니페스트에 없는 `convention.md`처럼 메타데이터
 * 자체가 없는 파일도 같은 규칙으로 다뤄진다.
 *
 * 사라진 always_on은 `reread`에 넣을 수 없다 — 읽을 파일이 없다. 그래서 `invalidated`로
 * 분리한다. 에이전트 컨텍스트에는 그 규칙이 아직 남아 있으므로 "무효"라는 신호가 필요하다.
 */
export declare const diffConventionSnapshots: (before: ConventionSnapshot, after: ConventionSnapshot) => {
    reread: string[];
    invalidated: string[];
};
export declare function sessionSync(options?: {
    cwd?: string;
}): Promise<SessionSyncResult>;
/**
 * 충돌 안내를 한 줄로 요약한다. 패키지마다 미러 경로 전체가 붙던 기존 형태는 세션 시작 출력의
 * 대부분을 차지했으므로(실측 96%), slug 목록과 해결 명령만 남긴다. 상세(보존 경로)는
 * `skill download` 출력에서 그대로 확인할 수 있다.
 *
 * 반환은 항상 0개 또는 1개다. `conflicts`가 비어 있는데 `conflictNotes`만 있는 비정상 입력에는
 * 정보를 잃지 않도록 기존 목록을 그대로 돌려준다.
 */
export declare const summarizeSkillConflicts: (conflicts: {
    slug: string;
}[] | undefined | null, fallbackNotes: string[] | undefined | null) => string[];
/**
 * Claude Code SessionStart 훅 출력(https://code.claude.com/docs/en/hooks). `additionalContext`는
 * 세션 컨텍스트에 그대로 주입되므로, 에이전트가 할 일만 문장으로 남긴다.
 *
 * 프로젝트 밖이면 `null`이다. 훅은 사용자 설정에 걸려 모든 저장소의 세션에서 돌 수 있는데,
 * 무관한 세션에 "이미 동기화했다"는 문장을 넣으면 그 자체가 잘못된 컨텍스트가 된다.
 *
 * CLI 업데이트는 알리기만 한다. 전역 설치는 사용자 판단이라 에이전트에게 설치를 시키지 않는다.
 */
export declare function formatClaudeCodeSessionStartHook(result: SessionSyncResult): string | null;
/**
 * `session hook install|uninstall`의 입력 검증. user 스코프는 이 머신의 모든 세션에 걸리므로
 * `--yes` 없이는 쓰지 않는다 — 미리보기(`--dry-run`)는 쓰지 않으니 허용한다.
 */
export declare function runSessionHookCommand(action: 'install' | 'uninstall', options?: Record<string, unknown>, context?: {
    homeDir?: string;
}): SessionHookResult;
export declare function executeSessionCommand(action: string, options: any): Promise<unknown>;
//# sourceMappingURL=session.d.ts.map