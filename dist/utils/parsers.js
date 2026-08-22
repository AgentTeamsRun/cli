import { existsSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
const STALE_CACHE_AGE_MS = 3 * 24 * 60 * 60 * 1000;
// .agentteams 기준 상대 경로. 대부분 cli/ 하위이지만 evidence는 .agentteams 직속이다.
const CACHE_DIRS = [
    ['cli', 'active-plan'],
    ['cli', 'active-coaction'],
    ['cli', 'temp'],
    ['cli', 'documents'],
    ['evidence'],
];
export function splitCsv(value) {
    if (typeof value !== 'string') {
        return [];
    }
    const trimmed = value.trim();
    if (trimmed.length === 0) {
        return [];
    }
    return trimmed
        .split(',')
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
}
export function toNonEmptyString(value) {
    if (typeof value !== 'string') {
        return undefined;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}
export function toNonNegativeInteger(value) {
    if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
        return value;
    }
    if (typeof value === 'string' && /^\d+$/.test(value)) {
        return Number.parseInt(value, 10);
    }
    return undefined;
}
export function toPositiveInteger(value) {
    if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
        return value;
    }
    if (typeof value === 'string' && /^\d+$/.test(value)) {
        const parsed = Number.parseInt(value, 10);
        return parsed > 0 ? parsed : undefined;
    }
    return undefined;
}
export function interpretEscapes(content) {
    return content.replace(/\\r\\n/g, '\r\n').replace(/\\n/g, '\n');
}
export function stripFrontmatter(content) {
    return content.replace(/^---[\r\n][\s\S]*?[\r\n]---[\r\n]?/, '').trimStart();
}
export function ensureUrlProtocol(url) {
    const withProtocol = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    return encodeURI(withProtocol);
}
export function toSafeFileName(input) {
    return input
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60);
}
/**
 * 업로드에 사용된 파일이 .agentteams/cli/temp/ 경로에 있을 경우 삭제합니다.
 * convention 파일 등 실제 소스 파일은 삭제하지 않습니다.
 *
 * - `options.keep`(=`--keep-temp`)가 true면 업로드 후에도 temp 원본을 보존합니다.
 * - 입력으로 받은 파일을 말없이 지우지 않도록, 실제 삭제 시 stderr로 한 줄 알립니다
 *   (정본은 서버에 있으므로 temp 사본은 소모성입니다).
 */
export function deleteIfTempFile(fileInput, options) {
    const resolved = resolve(fileInput);
    const normalized = resolved.replace(/\\/g, '/');
    if (!normalized.includes('/.agentteams/cli/temp/') || !existsSync(resolved)) {
        return;
    }
    if (options?.keep) {
        return;
    }
    try {
        unlinkSync(resolved);
        process.stderr.write(`Removed temp upload file: ${resolved} (use --keep-temp to preserve)\n`);
    }
    catch {
        // 삭제 실패는 무시 (읽기 전용 파일시스템 등 예외 상황)
    }
}
/**
 * .agentteams/cli/{active-plan,active-coaction,temp,documents}와 .agentteams/evidence
 * 안에서 mtime이 3일 초과된 일반 파일을 best-effort로 정리합니다. temp/evidence에는
 * .md 외에 html/json/txt/png 등 다양한 산출물이 쌓이므로 확장자를 가리지 않고
 * 정리합니다. 하위 디렉토리는 건너뛰며, 디렉토리/파일 접근 실패는 모두 무시합니다.
 */
export function pruneStaleCacheFiles(projectRoot) {
    const cutoff = Date.now() - STALE_CACHE_AGE_MS;
    for (const sub of CACHE_DIRS) {
        const dir = join(projectRoot, '.agentteams', ...sub);
        if (!existsSync(dir))
            continue;
        let files;
        try {
            files = readdirSync(dir);
        }
        catch {
            continue;
        }
        for (const file of files) {
            const filePath = join(dir, file);
            try {
                const stat = statSync(filePath);
                if (stat.isFile() && stat.mtimeMs < cutoff) {
                    unlinkSync(filePath);
                }
            }
            catch {
                // 개별 파일 실패는 무시
            }
        }
    }
}
//# sourceMappingURL=parsers.js.map