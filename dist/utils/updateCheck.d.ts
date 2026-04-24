interface CacheData {
    lastCheck: number;
    latestVersion: string;
}
export declare function readCache(): CacheData | null;
export declare function writeCache(data: CacheData): void;
export declare function compareVersions(current: string, latest: string): boolean;
/**
 * Start an async update check. Call early, collect the message later.
 * Never throws, never blocks CLI execution.
 *
 * 우선순위:
 *   1. API 응답 헤더(X-CLI-Latest-Version)로 갱신된 캐시 확인
 *   2. 캐시 만료 시 npm registry fallback
 */
export declare function startUpdateCheck(currentVersion: string): Promise<string | null>;
export declare function formatUpdateMessage(current: string, latest: string): string;
export {};
//# sourceMappingURL=updateCheck.d.ts.map