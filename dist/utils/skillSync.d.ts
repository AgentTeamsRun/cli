import { type SkillManifestEntry, type SkillWritableFile } from './skillPackage.js';
export type SkillConflict = {
    path: string;
    reason: 'modified' | 'added' | 'deleted' | 'unknown' | 'unsafe';
};
export type SkillTree = Record<string, string>;
export declare const hashSkillFile: (content: string | Buffer) => string;
export declare const skillFileHashes: (roots: string[], files: SkillWritableFile[]) => Record<string, string>;
export declare const assertSkillSlug: (slug: string) => void;
export declare const skillEntryRoots: (entry: SkillManifestEntry) => string[];
/** 링크를 따라가지 않고 바이너리·빈 디렉터리까지 검사하되 OS 자동 생성 파일은 제외한다. 업로드 필터를 재사용하면 로컬 추가가 누락된다. */
export declare const readSkillTree: (projectRoot: string, root: string) => SkillTree;
export declare const findSkillConflicts: (root: string, current: SkillTree, baseline: Record<string, string> | undefined) => SkillConflict[];
export type SkillTreeChange = {
    root: string;
    files: SkillWritableFile[] | null;
    before: SkillTree;
};
/** 준비한 모든 경로와 manifest를 함께 적용한다. 복구 실패 시 백업은 지우지 않는다. */
export declare const commitSkillChanges: (projectRoot: string, changes: SkillTreeChange[], manifestContent: string, previousManifest: string | undefined) => void;
//# sourceMappingURL=skillSync.d.ts.map