import { getApiConfigOrThrow } from './convention.js';
import { GUIDE_FILE_NAMES, GUIDE_RECORD_KINDS, describeMissingGuideHash, findGuideProjectRoot, loadLocalPlatformGuide, resolvePlatformGuide, } from '../mcp/guides.js';
/**
 * `agentteams guide get` — 플랫폼 가이드를 이름으로 여는 CLI 경로.
 *
 * MCP의 `agentteams_guide_get`과 같은 로더(`mcp/guides.ts`)를 쓴다. 별도로 존재하는 이유는
 * 그 도구가 `full` 툴 프로파일에만 있고, MCP를 아예 안 쓰는 러너도 있기 때문이다. 이 경로가
 * 없으면 그런 세션에서 가이드에 도달할 방법이 `convention.md`에 손으로 박은 라우팅 표뿐이고,
 * 그 표가 각 가이드 frontmatter의 사본이라 어긋난다(실제로 6개가 빠져 있었다).
 */
export async function guideGet(options) {
    const raw = typeof options.recordKind === 'string' ? options.recordKind.trim() : '';
    if (raw.length === 0) {
        throw new Error(`--record-kind is required. Supported: ${GUIDE_RECORD_KINDS.join(', ')}`);
    }
    const recordKind = GUIDE_RECORD_KINDS.find((kind) => kind === raw);
    if (!recordKind) {
        throw new Error(`Unknown guide record kind: ${raw}. Supported: ${GUIDE_RECORD_KINDS.join(', ')}`);
    }
    // 자격증명은 서버 폴백에만 필요하다. 로컬 사본이 있는데도 선요구하면, 자격증명이 깨진
    // 세션(미로그인·만료)에서 디스크에 멀쩡히 있는 가이드조차 못 여는 명령이 된다 — 비-MCP
    // 러너에게는 이 명령이 유일한 이름 기반 가이드 접근 경로다.
    const projectRoot = findGuideProjectRoot(options.cwd ?? process.cwd());
    let guide = loadLocalPlatformGuide(recordKind, projectRoot);
    if (!guide) {
        const { apiUrl, headers } = await getApiConfigOrThrow({ cwd: options.cwd });
        guide = await resolvePlatformGuide(recordKind, { projectRoot, apiUrl, headers });
    }
    const warning = describeMissingGuideHash(guide);
    return {
        recordKind: guide.recordKind,
        fileName: guide.fileName,
        source: guide.source,
        ...(guide.filePath ? { filePath: guide.filePath } : {}),
        guideHash: guide.guideHash,
        content: guide.content,
        ...(warning ? { warning } : {}),
    };
}
export async function executeGuideCommand(action, options) {
    switch (action) {
        case 'list':
            return {
                data: GUIDE_RECORD_KINDS.map((recordKind) => ({ recordKind, fileName: GUIDE_FILE_NAMES[recordKind] })),
            };
        case 'get':
            return guideGet({ recordKind: options?.recordKind, cwd: options?.cwd });
        default:
            throw new Error(`Unknown guide action: ${action}. Use list or get.`);
    }
}
//# sourceMappingURL=guide.js.map