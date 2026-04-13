import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import chalk from 'chalk';
const PACKAGE_NAME = '@agentteams/cli';
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const FETCH_TIMEOUT_MS = 3000;
function getCachePath() {
    return join(homedir(), '.agentteams', 'update-check.json');
}
export function readCache() {
    try {
        const cachePath = getCachePath();
        if (!existsSync(cachePath))
            return null;
        return JSON.parse(readFileSync(cachePath, 'utf-8'));
    }
    catch {
        return null;
    }
}
export function writeCache(data) {
    try {
        const cachePath = getCachePath();
        const dir = join(homedir(), '.agentteams');
        if (!existsSync(dir))
            mkdirSync(dir, { recursive: true });
        writeFileSync(cachePath, JSON.stringify(data), 'utf-8');
    }
    catch {
        // ignore write failures silently
    }
}
/** Fallback: npm registry에서 최신 버전 조회 (API 헤더가 없는 경우에만 사용) */
async function fetchLatestVersion() {
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
        const response = await fetch(`https://registry.npmjs.org/${PACKAGE_NAME}/latest`, { signal: controller.signal });
        clearTimeout(timeout);
        if (!response.ok)
            return null;
        const data = (await response.json());
        return data.version ?? null;
    }
    catch {
        return null;
    }
}
export function compareVersions(current, latest) {
    const parse = (v) => v.replace(/^v/, '').split('.').map(Number);
    const c = parse(current);
    const l = parse(latest);
    for (let i = 0; i < 3; i++) {
        if ((l[i] ?? 0) > (c[i] ?? 0))
            return true;
        if ((l[i] ?? 0) < (c[i] ?? 0))
            return false;
    }
    return false;
}
/**
 * Start an async update check. Call early, collect the message later.
 * Never throws, never blocks CLI execution.
 *
 * 우선순위:
 *   1. API 응답 헤더(X-CLI-Latest-Version)로 갱신된 캐시 확인
 *   2. 캐시 만료 시 npm registry fallback
 */
export function startUpdateCheck(currentVersion) {
    return (async () => {
        // 1. 캐시 확인 (httpClient가 API 헤더로 이미 갱신했을 수 있음)
        const cache = readCache();
        if (cache && Date.now() - cache.lastCheck < CHECK_INTERVAL_MS) {
            if (compareVersions(currentVersion, cache.latestVersion)) {
                return formatUpdateMessage(currentVersion, cache.latestVersion);
            }
            return null;
        }
        // 2. 캐시 없거나 만료 → npm registry fallback
        const latestVersion = await fetchLatestVersion();
        if (!latestVersion)
            return null;
        writeCache({ lastCheck: Date.now(), latestVersion });
        if (compareVersions(currentVersion, latestVersion)) {
            return formatUpdateMessage(currentVersion, latestVersion);
        }
        return null;
    })().catch(() => null);
}
export function formatUpdateMessage(current, latest) {
    return [
        '',
        chalk.yellow('╭─────────────────────────────────────────────────────────────╮'),
        chalk.yellow('│') + chalk.bold.yellow(' ACTION REQUIRED: CLI update available') + chalk.yellow('                    │'),
        chalk.yellow('│') + `  ${current} → ${chalk.green(latest)}` + ' '.repeat(Math.max(0, 48 - current.length - latest.length)) + chalk.yellow('│'),
        chalk.yellow('│') + chalk.cyan(`  Run: npm install -g ${PACKAGE_NAME}`) + ' '.repeat(Math.max(0, 22 - PACKAGE_NAME.length + 25)) + chalk.yellow('│'),
        chalk.yellow('│') + '  Update to get the latest conventions and features.' + ' '.repeat(8) + chalk.yellow('│'),
        chalk.yellow('╰─────────────────────────────────────────────────────────────╯'),
        '',
    ].join('\n');
}
//# sourceMappingURL=updateCheck.js.map