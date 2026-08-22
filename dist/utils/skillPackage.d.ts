/**
 * Skill 패키지의 로컬 소유권과 원자적 교체. `.agentteams/skills/<slug>/`의 유일한 소유자는
 * 이 모듈이며, `convention download`의 카테고리 sweep은 이 디렉터리를 건드리지 않는다.
 *
 * 계약(진입 파일, 허용 디렉터리, 크기 상한)의 SSOT는 서버가 배포하는 skill-package-guide.md다.
 * CLI는 같은 규칙을 API 호출 **전에** 한 번 더 적용해, 잘못된 패키지가 네트워크를 타기 전에
 * 사용자에게 이유를 알려준다. 최종 판정은 여전히 서버가 한다.
 */
/** `.agentteams` 아래 스킬 패키지 루트 디렉터리 이름. */
export declare const SKILL_PACKAGE_DIR = "skills";
/** 스킬 manifest 파일명. conventions.manifest.json 스키마는 건드리지 않는다(D7). */
export declare const SKILL_MANIFEST_FILE = "skills.manifest.json";
export declare const SKILL_ENTRY_FILE = "SKILL.md";
export declare const SKILL_RESOURCE_DIRS: readonly ["references", "scripts"];
export declare const SKILL_LIMITS: {
    readonly entryFileBytes: number;
    readonly resourceFileBytes: number;
    readonly fileCount: 50;
    readonly totalBytes: number;
    readonly pathLength: 200;
};
export type SkillPackageFile = {
    relativePath: string;
    content: string;
};
/** mirror 대상. 값은 `--skill-targets` 토큰과 1:1로 대응한다. */
export declare const SKILL_MIRROR_TARGETS: readonly ["agents", "claude", "github"];
export type SkillMirrorTarget = (typeof SKILL_MIRROR_TARGETS)[number];
export declare const SKILL_TARGETS_NONE = "none";
export type SkillManifestEntry = {
    skillId: string;
    slug: string;
    version: string;
    /** 프로젝트 루트 기준 상대 경로. 이 목록에 있는 파일만 CLI가 지운다. */
    mirrorPaths: string[];
};
export type SkillDownloadManifestV1 = {
    version: 1;
    generatedAt: string;
    entries: SkillManifestEntry[];
};
export declare class SkillPackageError extends Error {
    constructor(message: string);
}
export declare const skillPackageRoot: (projectRoot: string) => string;
export declare const skillManifestPath: (projectRoot: string) => string;
/**
 * `--skill-targets` 파싱. 문법은 `--agent-files`와 같다: 콤마 구분 목록 또는 `none`.
 * 지정하지 않으면 null을 돌려주고, 호출부가 마커 탐지 기본값을 쓴다.
 */
export declare const parseSkillTargetsOption: (raw: unknown) => SkillMirrorTarget[] | null;
/**
 * 마커가 실재하는 클라이언트만 고른다. `.agents`는 마커 없이도 항상 포함된다.
 * `runnerType`을 알면 그 엔진이 읽는 경로를 마커 유무와 무관하게 추가한다.
 */
export declare const detectSkillMirrorTargets: (projectRoot: string, runnerType?: string) => SkillMirrorTarget[];
/**
 * 로컬에만 있는 패키지 slug — 매니페스트에도 원격에도 없는 것.
 *
 * `skill status`는 원래 매니페스트와 원격만 비교했다. 그래서 방금 만들고 `skill create --apply`를
 * 안 한 패키지는 **양쪽 어디에도 없어서 보이지 않았고**, 그 침묵을 convention.md가 "스킬이 제일
 * 잊기 쉽다"는 상시 산문으로 메우고 있었다. 잊은 그 시점에 도구가 말하는 편이 강하다.
 */
export declare const findUnregisteredSkillSlugs: (projectRoot: string, knownSlugs: Set<string>) => string[];
export declare const mirrorDirFor: (projectRoot: string, target: SkillMirrorTarget, slug: string) => string;
export declare const computeSkillVersion: (files: {
    relativePath: string;
    content: string;
}[]) => string;
/** 패키지 계약을 로컬에서 먼저 적용한다. 실패 사유는 서버 메시지와 같은 축을 쓴다. */
export declare const validateSkillPackageFiles: (files: SkillPackageFile[]) => void;
/**
 * 로컬 디렉터리에서 패키지 파일을 모은다. symlink는 따라가지 않는다 — 링크가 패키지 밖을
 * 가리키면 저장소 밖 파일이 업로드된다.
 */
export declare const collectSkillPackageFiles: (packageDir: string) => SkillPackageFile[];
export declare const readSkillManifest: (projectRoot: string) => SkillDownloadManifestV1;
export declare const writeSkillManifest: (projectRoot: string, manifest: SkillDownloadManifestV1) => void;
/**
 * 임시 디렉터리에 전부 쓴 뒤 한 번에 교체한다. 쓰기 도중 실패하면 기존 디렉터리는
 * byte-for-byte 그대로 남는다 — 부분 적용된 패키지는 "설치됐지만 깨진" 상태를 만든다.
 */
export declare const writePackageAtomically: (targetDir: string, files: SkillPackageFile[]) => void;
/** manifest에 기록된 경로만 지운다. 사용자가 mirror 디렉터리에 둔 파일은 건드리지 않는다. */
export declare const removeManifestPaths: (projectRoot: string, relativePaths: string[]) => void;
/**
 * mirror 디렉터리를 `.gitignore`에 넣는다. mirror는 `.agentteams/skills/`에서 파생된 사본이라
 * 커밋 대상이 아니다. `--commit-mirrors`를 준 프로젝트는 이 호출을 건너뛴다.
 */
export declare const ensureMirrorGitignore: (projectRoot: string, targets: SkillMirrorTarget[]) => void;
//# sourceMappingURL=skillPackage.d.ts.map