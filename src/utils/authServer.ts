import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { execFileSync } from 'node:child_process';

const DEFAULT_OAUTH_PORT = 7777;
const OAUTH_PORT_MIN = 7777;
const OAUTH_PORT_MAX = 7790;
const CALLBACK_TIMEOUT_MS = 60_000;

export type AuthResult = {
  teamId: string;
  projectId: string;
  repositoryId: string;
  agentName: string;
  apiKey: string;
  apiUrl: string;
  configId: string;
};

type AuthServerResult = {
  server: Server;
  waitForCallback: () => Promise<AuthResult>;
  port: number;
};

function parsePort(value: string | undefined): number | null {
  if (!value) {
    return null;
  }

  const parsedPort = Number.parseInt(value, 10);
  if (Number.isNaN(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
    return null;
  }

  return parsedPort;
}

function buildCandidatePorts(): number[] {
  const requestedPort = parsePort(process.env.AGENTTEAMS_OAUTH_PORT) ?? DEFAULT_OAUTH_PORT;
  const rangePorts: number[] = [];

  for (let port = OAUTH_PORT_MIN; port <= OAUTH_PORT_MAX; port += 1) {
    rangePorts.push(port);
  }

  const uniquePorts = new Set<number>();
  uniquePorts.add(requestedPort);

  for (const port of rangePorts) {
    uniquePorts.add(port);
  }

  return Array.from(uniquePorts.values());
}

function isPortAvailableSync(port: number): boolean {
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
  } catch {
    return false;
  }
}

function findAvailablePortSync(): number {
  const candidatePorts = buildCandidatePorts();

  for (const candidatePort of candidatePorts) {
    if (isPortAvailableSync(candidatePort)) {
      return candidatePort;
    }
  }

  throw new Error(
    `No available OAuth callback port found in ${OAUTH_PORT_MIN}-${OAUTH_PORT_MAX} and requested AGENTTEAMS_OAUTH_PORT.`
  );
}

function isAuthResult(value: unknown): value is AuthResult {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.teamId === 'string' &&
    typeof candidate.projectId === 'string' &&
    typeof candidate.repositoryId === 'string' &&
    typeof candidate.agentName === 'string' &&
    typeof candidate.apiKey === 'string' &&
    typeof candidate.apiUrl === 'string' &&
    typeof candidate.configId === 'string'
  );
}

function readRequestBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    request.on('error', reject);
  });
}

function getAllowedOrigins(): string[] {
  const webUrl = process.env.AGENTTEAMS_WEB_URL || 'https://agentteams.run';
  return [webUrl.replace(/\/+$/, '')];
}

function isAllowedOrigin(origin: string): boolean {
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

function setCorsHeaders(response: ServerResponse, request?: IncomingMessage): void {
  const origin = request?.headers.origin;

  if (origin && isAllowedOrigin(origin)) {
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Vary', 'Origin');
  }

  response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function sendJson(response: ServerResponse, statusCode: number, payload: unknown, request?: IncomingMessage): void {
  const body = JSON.stringify(payload);
  setCorsHeaders(response, request);
  response.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  response.end(body);
}

export function startLocalAuthServer(): AuthServerResult {
  const port = findAvailablePortSync();

  let settled = false;
  let timeoutHandle: NodeJS.Timeout | null = null;
  let isWaiting = false;

  let resolveCallback: ((result: AuthResult) => void) | undefined;
  let rejectCallback: ((error: Error) => void) | undefined;

  const callbackPromise = new Promise<AuthResult>((resolve, reject) => {
    resolveCallback = resolve;
    rejectCallback = reject;
  });

  const stopServer = (): void => {
    if (!server.listening) {
      return;
    }

    server.close();
  };

  const clearTimeoutHandle = (): void => {
    if (!timeoutHandle) {
      return;
    }

    clearTimeout(timeoutHandle);
    timeoutHandle = null;
  };

  const resolveAuth = (payload: AuthResult): void => {
    if (settled) {
      return;
    }

    settled = true;
    clearTimeoutHandle();
    resolveCallback?.(payload);
    stopServer();
  };

  const rejectAuth = (error: Error): void => {
    if (settled) {
      return;
    }

    settled = true;
    clearTimeoutHandle();
    rejectCallback?.(error);
    stopServer();
  };

  const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
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
      const payload: unknown = JSON.parse(rawBody);

      if (!isAuthResult(payload)) {
        sendJson(response, 400, { message: 'Invalid OAuth callback payload.' }, request);
        return;
      }

      sendJson(response, 200, { success: true }, request);
      
      setTimeout(() => {
        resolveAuth(payload);
      }, 100);
    } catch {
      sendJson(response, 400, { message: 'Invalid JSON body.' }, request);
    }
  });

  server.once('error', (error: Error & { code?: string }) => {
    rejectAuth(
      new Error(
        error.code === 'EADDRINUSE'
          ? `OAuth callback port ${port} is already in use.`
          : `OAuth callback server failed: ${error.message}`
      )
    );
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

  const waitForCallback = (): Promise<AuthResult> => {
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
