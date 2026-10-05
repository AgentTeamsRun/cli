/**
 * `Content-Disposition`에서 원본 파일명을 꺼낸다. RFC 5987 `filename*`(UTF-8, 한글 이름)을
 * 우선하고, 없으면 ASCII 폴백 `filename`을 쓴다. 서버 형식은
 * `api/src/services/attachment.ts`의 `attachmentContentDisposition`이다.
 */
export declare const parseContentDispositionFileName: (header: string | undefined) => string | undefined;
export declare function executeAttachmentCommand(apiUrl: string, headers: Record<string, string>, action: string, options: Record<string, unknown>): Promise<unknown>;
//# sourceMappingURL=attachment.d.ts.map