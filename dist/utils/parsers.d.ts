export declare function splitCsv(value: string): string[];
export declare function toNonEmptyString(value: unknown): string | undefined;
export declare function toNonNegativeInteger(value: unknown): number | undefined;
export declare function toPositiveInteger(value: unknown): number | undefined;
export declare function interpretEscapes(content: string): string;
export declare function stripFrontmatter(content: string): string;
export declare function ensureUrlProtocol(url: string): string;
export declare function toSafeFileName(input: string): string;
/**
 * 업로드에 사용된 파일이 .agentteams/cli/temp/ 경로에 있을 경우 삭제합니다.
 * convention 파일 등 실제 소스 파일은 삭제하지 않습니다.
 */
export declare function deleteIfTempFile(fileInput: string): void;
/**
 * .agentteams/cli/{active-plan,active-coaction,temp} 안에서 mtime이 3일 초과된
 * .md 파일을 best-effort로 정리합니다. 디렉토리/파일 접근 실패는 모두 무시합니다.
 */
export declare function pruneStaleCacheFiles(projectRoot: string): void;
//# sourceMappingURL=parsers.d.ts.map