import { createRequire } from 'node:module';
import axios from 'axios';
import { getActiveCredential } from '../auth/activeCredential.js';
import { isApiOriginRequest } from './apiOrigin.js';
import { getCommandContext } from './commandContext.js';
import { readOrCreateMachineId } from './machineId.js';
import { resolveProjectRootHash } from './projectRootHash.js';
import { writeCache } from './updateCheck.js';
const require = createRequire(import.meta.url);
const pkg = require('../../package.json');
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1_000;
/**
 * Only a request that authenticated with a bearer token can be fixed by a
 * refresh. An `X-API-Key` request carries a long-lived agent key with nothing
 * behind it, so a 401 there means the key itself is wrong.
 */
function usedBearerCredential(config) {
    const headers = config.headers;
    const read = (name) => typeof headers?.get === 'function' ? headers.get(name) : headers?.[name];
    return typeof read('Authorization') === 'string' && read('X-API-Key') === undefined;
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const getRetryDelay = (error, attempt) => {
    const retryAfterHeader = error.response?.headers?.['retry-after'];
    if (retryAfterHeader) {
        const seconds = Number(retryAfterHeader);
        if (!Number.isNaN(seconds) && seconds > 0) {
            return seconds * 1_000;
        }
    }
    const body = error.response?.data;
    if (body?.retryAfter && body.retryAfter > 0) {
        return body.retryAfter * 1_000;
    }
    return BASE_DELAY_MS * 2 ** attempt;
};
axios.defaults.headers.common['X-CLI-Version'] = pkg.version;
const setRequestHeader = (config, name, value) => {
    const headers = config.headers;
    if (typeof headers.set === 'function') {
        headers.set(name, value);
        return;
    }
    headers[name] = value;
};
const removeRequestHeader = (config, name) => {
    const headers = config.headers;
    if (typeof headers.delete === 'function') {
        headers.delete(name);
        return;
    }
    delete headers[name];
};
/**
 * Session identity headers, resolved once per process.
 *
 * A personal access token proves *who* is calling but carries no agent identity, so a plan written
 * through the CLI used to lose the tool axis that the same work keeps when a runner writes it.
 * These two headers give the server enough to look the agent back up
 * (`api/src/utils/resolveWriteAttribution.ts`): the machine the agent was registered on, and the
 * project root it was registered at — hashed, never the plaintext path.
 *
 * Both are omitted rather than sent empty when they cannot be resolved: an absent header means
 * "cannot narrow", while an empty one would match nothing and read like a real value. Resolution
 * touches the filesystem, so it is memoized — a single command issues many requests.
 *
 * They are also scoped to AgentTeams API origins (`utils/apiOrigin.ts`). This interceptor sits on
 * the global axios instance, which also carries the presigned attachment upload to object storage —
 * a host that has no use for a device UUID or a hash of the user's working directory.
 */
let sessionIdentityHeaders = null;
const getSessionIdentityHeaders = () => {
    if (!sessionIdentityHeaders) {
        let machineId = null;
        let projectRootHash = null;
        try {
            machineId = readOrCreateMachineId();
        }
        catch {
            machineId = null;
        }
        try {
            projectRootHash = resolveProjectRootHash();
        }
        catch {
            projectRootHash = null;
        }
        sessionIdentityHeaders = { machineId, projectRootHash };
    }
    return sessionIdentityHeaders;
};
axios.interceptors.request.use((config) => {
    // resolveApiContext()가 모든 요청에 Content-Type: application/json을 붙인다. Fastify는 이 헤더가
    // 있으면 본문을 파싱하므로, 본문 없는 요청은 라우트 진입 전에 FST_ERR_CTP_EMPTY_JSON_BODY(400)로
    // 거절되고 errors.ts가 이를 VALIDATION_ERROR로 감싸 원인이 보이지 않는다. data가 실제로 없을
    // 때(undefined/null)만 헤더를 뺀다. 빈 문자열·빈 객체는 JSON 본문으로 보내야 하므로 유지한다.
    if (config.data === undefined || config.data === null) {
        removeRequestHeader(config, 'Content-Type');
    }
    setRequestHeader(config, 'X-AgentTeams-Client', 'cli');
    setRequestHeader(config, 'X-AgentTeams-Command', getCommandContext());
    setRequestHeader(config, 'X-AgentTeams-Version', pkg.version);
    if (isApiOriginRequest(config)) {
        const { machineId, projectRootHash } = getSessionIdentityHeaders();
        if (machineId) {
            setRequestHeader(config, 'X-AgentTeams-Machine-Id', machineId);
        }
        if (projectRootHash) {
            setRequestHeader(config, 'X-AgentTeams-Project-Root-Hash', projectRootHash);
        }
    }
    return config;
});
axios.interceptors.response.use((response) => {
    const latestVersion = response.headers['x-cli-latest-version'];
    if (latestVersion) {
        writeCache({ lastCheck: Date.now(), latestVersion });
    }
    return response;
}, async (error) => {
    const config = error.config;
    // A personal access token lives 15 minutes, so a long command can outlive
    // the one it started with. Refresh once and replay; anything beyond that is
    // a genuine authentication failure and must reach the user.
    if (config && error.response?.status === 401 && !config._authRefreshAttempted && usedBearerCredential(config)) {
        const credential = getActiveCredential();
        if (credential) {
            config._authRefreshAttempted = true;
            const accessToken = await credential.refresh();
            if (accessToken) {
                setRequestHeader(config, 'Authorization', `Bearer ${accessToken}`);
                return axios.request(config);
            }
        }
    }
    if (!config || error.response?.status !== 429) {
        throw error;
    }
    const retryCount = config._retryCount ?? 0;
    if (retryCount >= MAX_RETRIES) {
        throw error;
    }
    config._retryCount = retryCount + 1;
    const delay = getRetryDelay(error, retryCount);
    await sleep(delay);
    return axios.request(config);
});
export default axios;
//# sourceMappingURL=httpClient.js.map