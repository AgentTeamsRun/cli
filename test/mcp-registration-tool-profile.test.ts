import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getTopLevelUnionToolNames, getUnionFreeToolProfiles } from '../src/mcp/catalog.js';
import {
  findClient,
  resolveClientToolProfile,
  runMcpConfigCommand,
  runMcpInstallCommand,
} from '../src/mcp-registration/index.js';
import type { McpCredentials } from '../src/mcp-registration/serverSpec.js';
import type { McpClientDefinition, McpPathContext } from '../src/mcp-registration/types.js';

const credentials: McpCredentials = {
  projectId: 'project-fixture',
  teamId: 'team-fixture',
  apiUrl: 'https://api.agentteams.run',
};

const client = (id: string): McpClientDefinition => {
  const found = findClient(id);
  if (!found) throw new Error(`missing fixture client: ${id}`);
  return found;
};

describe('tool profiles a client cannot load', () => {
  // Kiro's Bedrock backend answers 400 to a tool whose input schema is a top-level
  // union, and that failure takes the whole request with it — so which profiles
  // contain one is a correctness question, not a cost question.
  describe('catalog scan', () => {
    it('reports the top-level union tools per profile', () => {
      expect(getTopLevelUnionToolNames('full').sort()).toEqual([
        'agentteams_comment_create',
        'agentteams_comment_list',
      ]);
      expect(getTopLevelUnionToolNames('read')).toEqual(['agentteams_comment_list']);
      expect(getTopLevelUnionToolNames('comments').sort()).toEqual([
        'agentteams_comment_create',
        'agentteams_comment_list',
      ]);
      expect(getTopLevelUnionToolNames('documents')).toEqual([]);
      expect(getTopLevelUnionToolNames('minimal')).toEqual([]);
    });

    it('derives the union-free profiles from the live catalog', () => {
      // Flattening a union must widen this set without any edit to the client registry.
      expect(getUnionFreeToolProfiles()).toEqual(['documents', 'minimal']);
    });
  });

  describe('resolveClientToolProfile', () => {
    it('narrows the implicit full default for a constrained client and says so', () => {
      const resolved = resolveClientToolProfile(client('kiro-cli'), 'full', false);

      expect(resolved.toolProfile).toBe('documents');
      expect(resolved.notice).toContain('narrowed to documents');
      expect(resolved.notice).toContain('agentteams_comment_list');
    });

    it('honours an explicit profile but warns that the client cannot load it', () => {
      const resolved = resolveClientToolProfile(client('kiro-cli'), 'full', true);

      expect(resolved.toolProfile).toBe('full');
      expect(resolved.notice).toContain('Warning');
      expect(resolved.notice).toContain('--tool-profile documents');
    });

    it('leaves a union-free profile alone even for a constrained client', () => {
      expect(resolveClientToolProfile(client('kiro-cli'), 'documents', true)).toEqual({ toolProfile: 'documents' });
      expect(resolveClientToolProfile(client('kiro-cli'), 'minimal', false)).toEqual({ toolProfile: 'minimal' });
    });

    it('never touches a client without a schema constraint', () => {
      expect(resolveClientToolProfile(client('claude-code'), 'full', false)).toEqual({ toolProfile: 'full' });
      expect(resolveClientToolProfile(client('kimi-cli'), 'read', false)).toEqual({ toolProfile: 'read' });
    });
  });

  describe('command surfaces', () => {
    let home: string;
    let cwd: string;
    let bin: string;
    let context: McpPathContext;

    beforeEach(() => {
      home = mkdtempSync(join(tmpdir(), 'agentteams-mcp-profile-home-'));
      cwd = mkdtempSync(join(tmpdir(), 'agentteams-mcp-profile-cwd-'));
      bin = mkdtempSync(join(tmpdir(), 'agentteams-mcp-profile-bin-'));
      writeFileSync(join(bin, 'agentteams'), '', 'utf-8');
      context = { homeDir: home, cwd, env: { PATH: bin } as NodeJS.ProcessEnv };
    });

    afterEach(() => {
      for (const dir of [home, cwd, bin]) rmSync(dir, { recursive: true, force: true });
    });

    it('installs Kiro with the narrowed profile in the written entry', () => {
      const result = runMcpInstallCommand({ client: 'kiro-cli', scope: 'user' }, { credentials, context });

      expect(result.exitCode).toBe(0);
      expect(result.text).toContain('narrowed to documents');

      const entry = JSON.parse(readFileSync(join(home, '.kiro', 'settings', 'mcp.json'), 'utf-8')).mcpServers
        .agentteams;
      expect(entry.args).toEqual(['mcp', '--tool-profile', 'documents']);
    });

    it('writes the explicit profile Kiro was asked for, with the warning attached', () => {
      const result = runMcpInstallCommand(
        { client: 'kiro-cli', scope: 'user', toolProfile: 'full' },
        { credentials, context },
      );

      expect(result.exitCode).toBe(0);
      expect(result.text).toContain('Warning');

      const entry = JSON.parse(readFileSync(join(home, '.kiro', 'settings', 'mcp.json'), 'utf-8')).mcpServers
        .agentteams;
      expect(entry.args).toEqual(['mcp']);
    });

    it('leaves every other client on the requested profile in the same batch', () => {
      const result = runMcpConfigCommand({ scope: 'user' }, { credentials, context });
      const sections = (result.json as { clients: { clientId: string; toolProfile: string }[] }).clients;

      expect(sections.find((section) => section.clientId === 'kiro-cli')?.toolProfile).toBe('documents');
      for (const section of sections.filter((candidate) => candidate.clientId !== 'kiro-cli')) {
        expect(section.toolProfile).toBe('full');
      }
    });

    it('renders the Kiro snippet with the profile it will actually run', () => {
      const result = runMcpConfigCommand({ client: 'kiro-cli', scope: 'user' }, { credentials, context });

      expect(result.text).toContain('--tool-profile');
      expect(result.text).toContain('narrowed to documents');
    });
  });
});
