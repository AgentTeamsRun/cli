import { afterEach, describe, expect, it } from '@jest/globals';
import { createServer, type Server } from 'node:net';
import { startLocalAuthServer } from '../src/utils/authServer.js';

const servers: Server[] = [];
const originalOAuthPort = process.env.AGENTTEAMS_OAUTH_PORT;

function listenOnRandomPort(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, 'localhost', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Expected a TCP server address.'));
        return;
      }
      resolve(address.port);
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    if (!server.listening) {
      resolve();
      return;
    }
    server.close(() => resolve());
  });
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => closeServer(server)));
  if (originalOAuthPort === undefined) {
    delete process.env.AGENTTEAMS_OAUTH_PORT;
  } else {
    process.env.AGENTTEAMS_OAUTH_PORT = originalOAuthPort;
  }
});

describe('startLocalAuthServer', () => {
  it('atomically assigns distinct fallback ports to concurrent servers', async () => {
    const occupiedServer = createServer();
    servers.push(occupiedServer);
    const occupiedPort = await listenOnRandomPort(occupiedServer);
    process.env.AGENTTEAMS_OAUTH_PORT = String(occupiedPort);

    const [first, second] = await Promise.all([startLocalAuthServer(), startLocalAuthServer()]);
    servers.push(first.server, second.server);

    expect(first.port).not.toBe(occupiedPort);
    expect(second.port).not.toBe(occupiedPort);
    expect(first.port).not.toBe(second.port);
  });
});
