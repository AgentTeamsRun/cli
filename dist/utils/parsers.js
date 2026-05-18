import { existsSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
const STALE_CACHE_AGE_MS = 3 * 24 * 60 * 60 * 1000;
const CACHE_DIRS = ['active-plan', 'active-coaction', 'temp'];
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
    return content
        .replace(/\\r\\n/g, '\r\n')
        .replace(/\\n/g, '\n');
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
 */
export function deleteIfTempFile(fileInput) {
    const resolved = resolve(fileInput);
    const normalized = resolved.replace(/\\/g, '/');
    if (normalized.includes('/.agentteams/cli/temp/') && existsSync(resolved)) {
        try {
            unlinkSync(resolved);
        }
        catch {
            // 삭제 실패는 무시 (읽기 전용 파일시스템 등 예외 상황)
        }
    }
}
/**
 * .agentteams/cli/{active-plan,active-coaction,temp} 안에서 mtime이 3일 초과된
 * .md 파일을 best-effort로 정리합니다. 디렉토리/파일 접근 실패는 모두 무시합니다.
 */
export function pruneStaleCacheFiles(projectRoot) {
    const cutoff = Date.now() - STALE_CACHE_AGE_MS;
    for (const sub of CACHE_DIRS) {
        const dir = join(projectRoot, '.agentteams', 'cli', sub);
        if (!existsSync(dir))
            continue;
        let files;
        try {
            files = readdirSync(dir).filter((f) => f.endsWith('.md'));
        }
        catch {
            continue;
        }
        for (const file of files) {
            const filePath = join(dir, file);
            try {
                if (statSync(filePath).mtimeMs < cutoff) {
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