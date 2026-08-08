import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { TOOL_PROFILES } from '@agentteams/context-tools';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { containsUnionSchema, getUnionFreeToolProfiles, getUnionToolNames } from '../src/mcp/catalog.js';
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
  // contain one is a correctness question, not a cost question. The catalog is
  // union-free as of the comment-tool flattening, so the guard below now resolves
  // to "nothing to narrow" without any edit to the client registry. The machinery
  // stays: a new union tool would put Kiro back in the narrowed state, which the
  // synthetic-fixture suite at the bottom keeps covered.
  describe('catalog scan', () => {
    it('detects unions nested below an object property', () => {
      expect(
        containsUnionSchema({
          type: 'object',
          properties: {
            parent: {
              anyOf: [{ type: 'string' }, { type: 'number' }],
            },
          },
        }),
      ).toBe(true);
      expect(
        containsUnionSchema({
          type: 'object',
          properties: { parent: { type: 'string' } },
        }),
      ).toBe(false);
    });

    it('finds no union tool at any schema depth in any profile', () => {
      for (const profile of TOOL_PROFILES) {
        expect({ profile, unions: getUnionToolNames(profile) }).toEqual({ profile, unions: [] });
      }
    });

    it('derives the union-free profiles from the live catalog', () => {
      expect(getUnionFreeToolProfiles()).toEqual([...TOOL_PROFILES]);
    });
  });

  describe('resolveClientToolProfile', () => {
    it('leaves the implicit full default alone for Kiro now that nothing is rejected', () => {
      expect(resolveClientToolProfile(client('kiro-cli'), 'full', false)).toEqual({ toolProfile: 'full' });
    });

    it('honours an explicit profile without a warning', () => {
      expect(resolveClientToolProfile(client('kiro-cli'), 'full', true)).toEqual({ toolProfile: 'full' });
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

    it('installs Kiro on the full catalog with no narrowing notice', () => {
      const result = runMcpInstallCommand({ client: 'kiro-cli', scope: 'user' }, { credentials, context });

      expect(result.exitCode).toBe(0);
      expect(result.text).not.toContain('narrowed');
      expect(result.text).not.toContain('Warning');

      const entry = JSON.parse(readFileSync(join(home, '.kiro', 'settings', 'mcp.json'), 'utf-8')).mcpServers
        .agentteams;
      expect(entry.args).toEqual(['mcp']);
    });

    it('still writes a narrower profile when Kiro is explicitly asked for one', () => {
      const result = runMcpInstallCommand(
        { client: 'kiro-cli', scope: 'user', toolProfile: 'documents' },
        { credentials, context },
      );

      expect(result.exitCode).toBe(0);
      expect(result.text).not.toContain('Warning');

      const entry = JSON.parse(readFileSync(join(home, '.kiro', 'settings', 'mcp.json'), 'utf-8')).mcpServers
        .agentteams;
      expect(entry.args).toEqual(['mcp', '--tool-profile', 'documents']);
    });

    it('puts every client in the batch on the same requested profile', () => {
      const result = runMcpConfigCommand({ scope: 'user' }, { credentials, context });
      const sections = (result.json as { clients: { clientId: string; toolProfile: string }[] }).clients;

      expect(sections.find((section) => section.clientId === 'kiro-cli')?.toolProfile).toBe('full');
      for (const section of sections) {
        expect(section.toolProfile).toBe('full');
      }
    });

    it('renders the Kiro snippet without a narrowed-profile argument', () => {
      const result = runMcpConfigCommand({ client: 'kiro-cli', scope: 'user' }, { credentials, context });

      expect(result.text).not.toContain('narrowed');
      // The rendered snippet is the args array; the unquoted `--tool-profile` in the
      // native-discovery hint below it is prose, not something the client would run.
      expect(result.text).not.toContain('"--tool-profile"');
    });
  });
});

// The live catalog no longer has a union, so the narrowing path above is dormant.
// It is not dead: the next tool that ships a union root would silently brick every
// Kiro conversation if this machinery stopped working. The catalog is mocked here
// so the guard keeps being exercised against a synthetic union.
describe('narrowing a client whose catalog does contain a union', () => {
  const withSyntheticUnion = async (unionProfiles: string[]) => {
    jest.resetModules();
    jest.unstable_mockModule('../src/mcp/catalog.js', () => ({
      __esModule: true,
      getUnionToolNames: (profile: string) => (unionProfiles.includes(profile) ? ['synthetic_union_tool'] : []),
      getUnionFreeToolProfiles: () => TOOL_PROFILES.filter((profile) => !unionProfiles.includes(profile)),
    }));
    return import('../src/mcp-registration/index.js');
  };

  afterEach(() => {
    jest.resetModules();
  });

  it('narrows the implicit full default back to the declared fallback and says so', async () => {
    const registration = await withSyntheticUnion(['full', 'read', 'comments']);
    const kiro = registration.findClient('kiro-cli');
    expect(kiro).toBeDefined();

    const resolved = registration.resolveClientToolProfile(kiro!, 'full', false);

    expect(resolved.toolProfile).toBe('documents');
    expect(resolved.notice).toContain('narrowed to documents');
    expect(resolved.notice).toContain('synthetic_union_tool');
  });

  it('honours an explicit profile but warns that the client cannot load it', async () => {
    const registration = await withSyntheticUnion(['full', 'read', 'comments']);
    const kiro = registration.findClient('kiro-cli');

    const resolved = registration.resolveClientToolProfile(kiro!, 'full', true);

    expect(resolved.toolProfile).toBe('full');
    expect(resolved.notice).toContain('Warning');
    expect(resolved.notice).toContain('--tool-profile documents');
  });

  it('picks a usable profile from the live catalog when the declared fallback stopped being safe', async () => {
    // A union reaching `documents` makes the hand-declared fallback a config that
    // bricks the client — the resolver must not write it anyway.
    const registration = await withSyntheticUnion(['full', 'read', 'comments', 'documents']);
    const kiro = registration.findClient('kiro-cli');

    const resolved = registration.resolveClientToolProfile(kiro!, 'full', false);

    expect(resolved.toolProfile).toBe('minimal');
    expect(resolved.notice).toContain('narrowed to minimal');
  });

  it('leaves a union-free profile alone even for a constrained client', async () => {
    const registration = await withSyntheticUnion(['full', 'read', 'comments']);
    const kiro = registration.findClient('kiro-cli');

    expect(registration.resolveClientToolProfile(kiro!, 'documents', true)).toEqual({ toolProfile: 'documents' });
    expect(registration.resolveClientToolProfile(kiro!, 'minimal', false)).toEqual({ toolProfile: 'minimal' });
  });
});
