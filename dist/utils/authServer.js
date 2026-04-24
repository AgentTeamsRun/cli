import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
const DEFAULT_OAUTH_PORT = 7777;
const OAUTH_PORT_MIN = 7777;
const OAUTH_PORT_MAX = 7790;
const CALLBACK_TIMEOUT_MS = 60_000;
function parsePort(value) {
    if (!value) {
        return null;
    }
    const parsedPort = Number.parseInt(value, 10);
    if (Number.isNaN(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
        return null;
    }
    return parsedPort;
}
function buildCandidatePorts() {
    const requestedPort = parsePort(process.env.AGENTTEAMS_OAUTH_PORT) ?? DEFAULT_OAUTH_PORT;
    const rangePorts = [];
    for (let port = OAUTH_PORT_MIN; port <= OAUTH_PORT_MAX; port += 1) {
        rangePorts.push(port);
    }
    const uniquePorts = new Set();
    uniquePorts.add(requestedPort);
    for (const port of rangePorts) {
        uniquePorts.add(port);
    }
    return Array.from(uniquePorts.values());
}
function isPortAvailableSync(port) {
    const checkScript = [
        'const net = require("node:net");',
        'const port = Number(process.argv[1]);',
        'const server = net.createServer();',
        'server.once("error", () => process.exit(1));',
        'server.listen(port, () => {',
        '  server.close(() => process.exit(0));',
        '});',
    ].join(' ');
    try {
        execFileSync(process.execPath, ['-e', checkScript, String(port)], { stdio: 'ignore', windowsHide: true });
        return true;
    }
    catch {
        return false;
    }
}
function findAvailablePortSync() {
    const candidatePorts = buildCandidatePorts();
    for (const candidatePort of candidatePorts) {
        if (isPortAvailableSync(candidatePort)) {
            return candidatePort;
        }
    }
    throw new Error(`No available OAuth callback port found in ${OAUTH_PORT_MIN}-${OAUTH_PORT_MAX} and requested AGENTTEAMS_OAUTH_PORT.`);
}
function isAuthResult(value) {
    if (!value || typeof value !== 'object') {
        return false;
    }
    const candidate = value;
    return (typeof candidate.teamId === 'string' &&
        typeof candidate.projectId === 'string' &&
        typeof candidate.repositoryId === 'string' &&
        typeof candidate.agentName === 'string' &&
        typeof candidate.apiKey === 'string' &&
        typeof candidate.apiUrl === 'string' &&
        typeof candidate.configId === 'string');
}
function readRequestBody(request) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        request.on('data', (chunk) => chunks.push(chunk));
        request.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
        request.on('error', reject);
    });
}
function getAllowedOrigins() {
    const webUrl = process.env.AGENTTEAMS_WEB_URL || 'https://agentteams.run';
    return [webUrl.replace(/\/+$/, '')];
}
function isAllowedOrigin(origin) {
    const allowedOrigins = getAllowedOrigins();
    if (allowedOrigins.includes(origin)) {
        return true;
    }
    // Allow localhost with any port for dev
    if (/^http:\/\/localhost(:\d+)?$/.test(origin)) {
        return true;
    }
    return false;
}
function setCorsHeaders(response, request) {
    const origin = request?.headers.origin;
    if (origin && isAllowedOrigin(origin)) {
        response.setHeader('Access-Control-Allow-Origin', origin);
        response.setHeader('Vary', 'Origin');
    }
    response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}
function sendJson(response, statusCode, payload, request) {
    const body = JSON.stringify(payload);
    setCorsHeaders(response, request);
    response.writeHead(statusCode, {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
    });
    response.end(body);
}
export function startLocalAuthServer() {
    const port = findAvailablePortSync();
    let settled = false;
    let timeoutHandle = null;
    let isWaiting = false;
    let resolveCallback;
    let rejectCallback;
    const callbackPromise = new Promise((resolve, reject) => {
        resolveCallback = resolve;
        rejectCallback = reject;
    });
    const stopServer = () => {
        if (!server.listening) {
            return;
        }
        server.close();
    };
    const clearTimeoutHandle = () => {
        if (!timeoutHandle) {
            return;
        }
        clearTimeout(timeoutHandle);
        timeoutHandle = null;
    };
    const resolveAuth = (payload) => {
        if (settled) {
            return;
        }
        settled = true;
        clearTimeoutHandle();
        resolveCallback?.(payload);
        stopServer();
    };
    const rejectAuth = (error) => {
        if (settled) {
            return;
        }
        settled = true;
        clearTimeoutHandle();
        rejectCallback?.(error);
        stopServer();
    };
    const server = createServer(async (request, response) => {
        if (request.method === 'OPTIONS') {
            setCorsHeaders(response, request);
            response.writeHead(204);
            response.end();
            return;
        }
        if (request.method !== 'POST' || request.url !== '/callback') {
            sendJson(response, 404, { message: 'Not found.' }, request);
            return;
        }
        if (settled) {
            sendJson(response, 409, { message: 'OAuth callback already processed.' }, request);
            return;
        }
        try {
            const rawBody = await readRequestBody(request);
            const payload = JSON.parse(rawBody);
            if (!isAuthResult(payload)) {
                sendJson(response, 400, { message: 'Invalid OAuth callback payload.' }, request);
                return;
            }
            sendJson(response, 200, { success: true }, request);
            setTimeout(() => {
                resolveAuth(payload);
            }, 100);
        }
        catch {
            sendJson(response, 400, { message: 'Invalid JSON body.' }, request);
        }
    });
    server.once('error', (error) => {
        rejectAuth(new Error(error.code === 'EADDRINUSE'
            ? `OAuth callback port ${port} is already in use.`
            : `OAuth callback server failed: ${error.message}`));
    });
    server.once('close', () => {
        if (!settled && isWaiting) {
            rejectAuth(new Error('OAuth callback server closed before receiving callback.'));
            return;
        }
        if (!settled) {
            settled = true;
            clearTimeoutHandle();
        }
    });
    server.listen(port, 'localhost');
    const waitForCallback = () => {
        if (!isWaiting) {
            isWaiting = true;
            timeoutHandle = setTimeout(() => {
                rejectAuth(new Error('OAuth callback timed out after 60 seconds.'));
            }, CALLBACK_TIMEOUT_MS);
        }
        return callbackPromise;
    };
    return {
        server,
        waitForCallback,
        port,
    };
}
//# sourceMappingURL=authServer.js.map