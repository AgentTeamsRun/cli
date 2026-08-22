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
 *
 * - `options.keep`(=`--keep-temp`)가 true면 업로드 후에도 temp 원본을 보존합니다.
 * - 입력으로 받은 파일을 말없이 지우지 않도록, 실제 삭제 시 stderr로 한 줄 알립니다
 *   (정본은 서버에 있으므로 temp 사본은 소모성입니다).
 */
export declare function deleteIfTempFile(fileInput: string, options?: {
    keep?: boolean;
}): void;
/**
 * .agentteams/cli/{active-plan,active-coaction,temp,documents}와 .agentteams/evidence
 * 안에서 mtime이 3일 초과된 일반 파일을 best-effort로 정리합니다. temp/evidence에는
 * .md 외에 html/json/txt/png 등 다양한 산출물이 쌓이므로 확장자를 가리지 않고
 * 정리합니다. 하위 디렉토리는 건너뛰며, 디렉토리/파일 접근 실패는 모두 무시합니다.
 */
export declare function pruneStaleCacheFiles(projectRoot: string): void;
//# sourceMappingURL=parsers.d.ts.map