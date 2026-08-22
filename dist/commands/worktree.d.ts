import { spawn } from 'node:child_process';
import { type WorktreeLifecycleEvent } from '../api/worktree.js';
export declare const computeWorktreeLocalKey: (worktreePath: string) => string;
/** worktree lifecycle을 알려 온 호스트. eventId prefix로 남아 이벤트 출처를 구분한다. */
export type WorktreeEventHost = 'orca' | 'herdr';
export declare const createDefaultWorktreeEventId: (event: WorktreeLifecycleEvent["event"], host?: WorktreeEventHost) => string;
export type HerdrWorktreeEvent = {
    worktreePath: string;
    branch: string | null;
    repoRoot: string | null;
};
/**
 * herdr plugin event hook이 주입하는 payload에서 worktree identity를 뽑는다.
 *
 * 훅의 cwd는 플러그인 루트라 Git 조회 기준으로 쓸 수 없고, 삭제 훅 시점에는 worktree 경로가
 * 이미 사라져 있다. 따라서 경로·브랜치·저장소 루트를 모두 이벤트 payload에서 읽는다.
 * 확인 기준: herdr 0.8.0 (`docs/fixtures/herdr-worktree-hooks/captured-contract.json`).
 */
export declare const parseHerdrWorktreeEvent: (env: NodeJS.ProcessEnv, expected: WorktreeLifecycleEvent["event"]) => HerdrWorktreeEvent;
export declare const waitForPathRemoval: (worktreePath: string, options?: {
    intervalMs?: number;
    timeoutMs?: number;
}) => Promise<boolean>;
type ScheduleDeletedEventDeps = {
    spawn?: typeof spawn;
    platform?: NodeJS.Platform;
    execPath?: string;
    entryPath?: string;
    env?: NodeJS.ProcessEnv;
};
export declare const scheduleDeletedEventAfterRemoval: (worktreePath: string, stableCwd: string, event: WorktreeLifecycleEvent, deps?: ScheduleDeletedEventDeps) => void;
type WorktreeIdentity = {
    host: WorktreeEventHost;
    /** localKey 계산 기준이 되는 worktree 경로 */
    worktreePath: string;
    /** 삭제 지연 전달 프로세스가 머무를, worktree 소멸과 무관한 디렉터리 */
    stableCwd: string;
    remoteUrl?: string;
    branch: string | null;
    headSha: string | null;
};
/** identity 계산이 쓰는 Git 조회. 배선(어느 디렉터리를 기준으로 무엇을 읽는지)을 테스트에서 주입해 확인한다. */
export type WorktreeGitReader = {
    resolveTopLevel: (cwd: string) => string | null;
    resolveMainRoot: (cwd: string) => string | null;
    readRemoteOriginUrl: (cwd: string) => string | undefined;
    readGitValue: (args: string[], cwd: string) => string | undefined;
};
/** Orca hook 등 worktree 안에서 실행되는 호출자: 현재 디렉터리에서 identity를 계산한다. */
export declare const resolveCwdIdentity: (cwd: string, git?: WorktreeGitReader) => WorktreeIdentity;
/** herdr plugin event hook: cwd가 플러그인 루트이므로 identity를 이벤트 payload에서 가져온다. */
export declare const resolveHerdrIdentity: (herdrEvent: HerdrWorktreeEvent, event: WorktreeLifecycleEvent["event"], git?: WorktreeGitReader) => WorktreeIdentity;
/**
 * identity와 커맨드 옵션에서 서버로 보낼 lifecycle payload를 조립한다.
 *
 * 서버는 `repositoryId` 또는 `remoteUrl` 중 하나로만 저장소를 찾는다(둘 다 없으면
 * `WORKTREE_REPOSITORY_NOT_FOUND`). 그 상태로 전송하면 훅 로그에 서버 에러 문자열만 남아
 * 원인(저장소 루트를 읽지 못했다)을 알 수 없으므로 전송 전에 여기서 끊는다.
 */
export declare const buildWorktreeLifecyclePayload: (event: WorktreeLifecycleEvent["event"], identity: WorktreeIdentity, options: Record<string, unknown>) => WorktreeLifecycleEvent;
export declare function executeWorktreeCommand(action: string, options: Record<string, unknown>): Promise<unknown>;
export {};
//# sourceMappingURL=worktree.d.ts.map