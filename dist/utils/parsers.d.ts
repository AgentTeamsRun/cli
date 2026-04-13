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
//# sourceMappingURL=parsers.d.ts.map