import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';

const CALLBACK_TIMEOUT_MS = 60_000;
const DEFAULT_WEB_URL = 'https://agentteams.run';
/** 24 random bytes → 32 base64url characters, comfortably above the 16-character floor. */
const AUTH_STATE_BYTES = 24;

// Only a web build older than this CLI omits the state, so a plain "try again"
// would loop the user forever. Say what is actually wrong and give the two exits
// that work: wait for the deploy, or install a CLI that matches the live web.
const WEB_UPDATE_HINT =
  'The AgentTeams web page did not echo the login state, so it is older than this CLI. ' +
  'Hard-refresh /cli/authorize and retry; if it keeps failing, the web deploy has not caught up yet — ' +
  'retry in a few minutes or install a CLI version matching the deployed web.';

export type AuthResult = {
  teamId: string;
  projectId: string;
  agentName: string;
  apiKey: string;
  configId: string;
  seedPlanId?: string | null;
};

type AuthServerResult = {
  server: Server;
  waitForCallback: () => Promise<AuthResult>;
  port: number;
  /** Echo this back through the authorize URL; the callback is rejected without it. */
  state: string;
};

type StartLocalAuthServerOptions = {
  state?: string;
};

/** Unguessable value that proves a callback belongs to the login this process started. */
export function createAuthState(): string {
  return randomBytes(AUTH_STATE_BYTES).toString('base64url');
}

function listenOnEphemeralPort(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    const onListening = (): void => {
      server.removeListener('error', onError);
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('The local OAuth callback server did not report a TCP port.'));
        return;
      }
      resolve(address.port);
    };
    const onError = (error: Error): void => {
      server.removeListener('listening', onListening);
      reject(error);
    };

    server.once('listening', onListening);
    server.once('error', onError);
    // Port 0 asks the OS for a free port: nothing for another local process to
    // squat on ahead of time, and no fixed range to exhaust.
    server.listen(0, 'localhost');
  });
}

function isAuthResult(value: unknown): value is AuthResult & Record<string, unknown> {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  const seedPlanIdValid =
    candidate.seedPlanId === undefined || candidate.seedPlanId === null || typeof candidate.seedPlanId === 'string';

  return (
    typeof candidate.teamId === 'string' &&
    typeof candidate.projectId === 'string' &&
    typeof candidate.agentName === 'string' &&
    typeof candidate.apiKey === 'string' &&
    typeof candidate.configId === 'string' &&
    seedPlanIdValid
  );
}

/**
 * Copy only the fields the CLI trusts. Anything else in the payload — notably an
 * `apiUrl` pointing every later request at an attacker's server — is dropped here.
 */
function toAuthResult(payload: AuthResult & Record<string, unknown>): AuthResult {
  const result: AuthResult = {
    teamId: payload.teamId,
    projectId: payload.projectId,
    agentName: payload.agentName,
    apiKey: payload.apiKey,
    configId: payload.configId,
  };

  if (payload.seedPlanId !== undefined) {
    result.seedPlanId = payload.seedPlanId;
  }

  return result;
}

function statesMatch(expected: string, received: string): boolean {
  const expectedBytes = Buffer.from(expected, 'utf-8');
  const receivedBytes = Buffer.from(received, 'utf-8');

  if (expectedBytes.length !== receivedBytes.length) {
    return false;
  }

  return timingSafeEqual(expectedBytes, receivedBytes);
}

function readRequestBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    request.on('error', reject);
  });
}

function normalizeOrigin(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

/**
 * Only the configured web origin may post a callback. There is deliberately no
 * blanket `http://localhost:*` allowance: any page served from any local port
 * used to qualify. Local development and the dev environment opt in explicitly
 * instead, through `AGENTTEAMS_WEB_URL` or `AGENTTEAMS_OAUTH_ALLOWED_ORIGINS`.
 */
function getAllowedOrigins(): string[] {
  const origins = new Set<string>();

  const webOrigin = normalizeOrigin(process.env.AGENTTEAMS_WEB_URL || DEFAULT_WEB_URL);
  if (webOrigin) {
    origins.add(webOrigin);
  }

  for (const entry of (process.env.AGENTTEAMS_OAUTH_ALLOWED_ORIGINS ?? '').split(',')) {
    const trimmed = entry.trim();
    if (trimmed.length === 0) {
      continue;
    }

    const origin = normalizeOrigin(trimmed);
    if (origin) {
      origins.add(origin);
    }
  }

  return Array.from(origins.values());
}

function isAllowedOrigin(origin: string | undefined): origin is string {
  if (!origin) {
    return false;
  }

  return getAllowedOrigins().includes(origin);
}

function setCorsHeaders(response: ServerResponse, request?: IncomingMessage): void {
  const origin = request?.headers.origin;

  if (isAllowedOrigin(origin)) {
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

export async function startLocalAuthServer(options?: StartLocalAuthServerOptions): Promise<AuthServerResult> {
  const expectedState = options?.state ?? createAuthState();

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

    // CORS headers only tell a browser what to do with a response; the body was
    // accepted long before that. Refuse the request itself instead.
    if (!isAllowedOrigin(request.headers.origin)) {
      sendJson(response, 403, { message: 'OAuth callback origin is not allowed.' }, request);
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

      const receivedState = payload.state;
      if (typeof receivedState !== 'string' || receivedState.length === 0) {
        sendJson(response, 400, { message: `Missing OAuth callback state. ${WEB_UPDATE_HINT}` }, request);
        return;
      }

      // A mismatch must not consume `settled`: the login this process started is
      // still outstanding, and burning it here would hand a forged callback a
      // trivial denial of service.
      if (!statesMatch(expectedState, receivedState)) {
        sendJson(response, 400, { message: 'OAuth callback state does not match this login.' }, request);
        return;
      }

      sendJson(response, 200, { success: true }, request);

      setTimeout(() => {
        resolveAuth(toAuthResult(payload));
      }, 100);
    } catch {
      sendJson(response, 400, { message: 'Invalid JSON body.' }, request);
    }
  });

  const port = await listenOnEphemeralPort(server);

  server.on('error', (error: Error) => {
    rejectAuth(new Error(`OAuth callback server failed: ${error.message}`));
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
    state: expectedState,
  };
}
