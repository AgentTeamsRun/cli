/** One page of `GET /skills`. File bodies are **not** included — only metadata and hashes. */
export declare function listSkills(apiUrl: string, projectId: string, headers: Record<string, string>, params?: Record<string, string | number>): Promise<any>;
/** Single skill metadata envelope (`GET /skills/:id`). */
export declare function getSkill(apiUrl: string, projectId: string, headers: Record<string, string>, skillId: string): Promise<any>;
/** The whole package including file bodies (`GET /skills/:id/download`). */
export declare function downloadSkill(apiUrl: string, projectId: string, headers: Record<string, string>, skillId: string, includeAssets?: boolean): Promise<any>;
export type SkillTextFileBody = {
    relativePath: string;
    content: string;
};
export type SkillNewAssetFileBody = {
    relativePath: string;
    kind: 'BINARY';
    sha256: string;
    sizeBytes: number;
    mimeType: string;
    draftKey: string;
};
export type SkillReuseAssetFileBody = {
    relativePath: string;
    kind: 'BINARY';
    sha256: string;
    reuse: true;
};
export type SkillFileBody = SkillTextFileBody | SkillNewAssetFileBody | SkillReuseAssetFileBody;
export declare function createSkill(apiUrl: string, projectId: string, headers: Record<string, string>, body: {
    slug: string;
    files: SkillFileBody[];
    repositoryId?: string;
    scope?: string;
    assetsAware?: boolean;
}): Promise<any>;
export declare function updateSkill(apiUrl: string, projectId: string, headers: Record<string, string>, skillId: string, body: {
    files: SkillFileBody[];
    updatedAt: string;
    scope?: string;
    assetsAware?: boolean;
}): Promise<any>;
/** Asset upload URL issuance (`POST /skills/asset-upload-urls`). */
export declare function requestSkillAssetUploadUrls(apiUrl: string, projectId: string, headers: Record<string, string>, files: {
    relativePath: string;
    sizeBytes: number;
    mimeType: string;
    sha256: string;
}[]): Promise<{
    relativePath: string;
    draftKey: string;
    uploadUrl: string;
}[]>;
/** Raw bytes to a presigned PUT URL (bypasses the API server, like attachment uploads). */
export declare function putSkillAssetBytes(uploadUrl: string, buffer: Buffer, contentType: string): Promise<void>;
/** Raw bytes from a presigned GET URL. */
export declare function fetchSkillAssetBytes(downloadUrl: string): Promise<Buffer>;
export declare function deleteSkill(apiUrl: string, projectId: string, headers: Record<string, string>, skillId: string): Promise<any>;
export type SkillShareCreateBody = {
    scope: string;
    includeBody?: boolean;
    includeExecutable?: boolean;
    allowInstall?: boolean;
    expiresAt?: string;
};
/** `POST /skills/:id/shares`. LINK 범위면 응답 `data.token`에 평문 토큰이 **이 한 번만** 실린다. */
export declare function createSkillShare(apiUrl: string, projectId: string, headers: Record<string, string>, skillId: string, body: SkillShareCreateBody): Promise<any>;
/** `DELETE /skills/:id/shares/:shareId` — 204라 본문이 없다. */
export declare function revokeSkillShare(apiUrl: string, projectId: string, headers: Record<string, string>, skillId: string, shareId: string): Promise<void>;
export declare function listSkillShares(apiUrl: string, projectId: string, headers: Record<string, string>, skillId: string, params?: Record<string, string | number>): Promise<any>;
export declare function listSkillInstalls(apiUrl: string, projectId: string, headers: Record<string, string>, skillId: string, params?: Record<string, string | number>): Promise<any>;
export declare function listSharedSkills(apiUrl: string, projectId: string, headers: Record<string, string>, params?: Record<string, string | number>): Promise<any>;
/** 공유 상세. 파일 목록(경로·크기)만 있고 storageKey는 없다 — 설치 전 미리보기 용도. */
export declare function getSharedSkill(apiUrl: string, projectId: string, headers: Record<string, string>, shareId: string): Promise<any>;
/** `POST /projects/:projectId/skills/install` — 서버 측 복제. 로컬 반영은 `skill download`가 한다. */
export declare function installSharedSkill(apiUrl: string, projectId: string, headers: Record<string, string>, shareId: string): Promise<any>;
/** 비인증 공개 링크 조회 (`GET /api/share/skills/:token`). 토큰 미리보기 용도라 인증 헤더를 싣지 않는다. */
export declare function getPublicSharedSkill(apiUrl: string, shareToken: string): Promise<any>;
/** 링크 토큰으로 설치 (`POST /projects/:projectId/skills/install { token }`). LINK 공유 전용이다. */
export declare function installSharedSkillByToken(apiUrl: string, projectId: string, headers: Record<string, string>, shareToken: string): Promise<any>;
//# sourceMappingURL=skill.d.ts.map