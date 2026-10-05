/**
 * `agentteams guide get` — 플랫폼 가이드를 이름으로 여는 CLI 경로.
 *
 * MCP의 `agentteams_guide_get`과 같은 로더(`mcp/guides.ts`)를 쓴다. 별도로 존재하는 이유는
 * 그 도구가 `full` 툴 프로파일에만 있고, MCP를 아예 안 쓰는 러너도 있기 때문이다. 이 경로가
 * 없으면 그런 세션에서 가이드에 도달할 방법이 `convention.md`에 손으로 박은 라우팅 표뿐이고,
 * 그 표가 각 가이드 frontmatter의 사본이라 어긋난다(실제로 6개가 빠져 있었다).
 */
export declare function guideGet(options: {
    recordKind?: unknown;
    cwd?: string;
}): Promise<unknown>;
export declare function executeGuideCommand(action: string, options: any): Promise<unknown>;
//# sourceMappingURL=guide.d.ts.map