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
 * 1) `skill download`는 반드시 `skill status` 게이트 뒤에서만 부른다. download는
 *    updateAvailable 판정 없이 모든 로컬 패키지를 덮어쓰므로, 게이트 없이 부르면 로컬에서
 *    작성 중인 스킬이 세션 시작마다 지워진다.
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
    summary: string;
};
export type ConventionFileState = {
    hash: string;
    alwaysOn: boolean;
};
export type ConventionSnapshot = Map<string, ConventionFileState>;
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
export declare function executeSessionCommand(action: string, options: any): Promise<unknown>;
//# sourceMappingURL=session.d.ts.map