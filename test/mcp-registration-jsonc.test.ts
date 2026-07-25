import { describe, it, expect } from '@jest/globals';
import {
  McpConfigParseError,
  parseJsonc,
  readContainerEntry,
  upsertContainerEntry,
} from '../src/mcp-registration/jsonc.js';

const entry = { command: 'npx', args: ['-y', '@agentteams/cli', 'mcp'] };

describe('parseJsonc', () => {
  it('treats an empty document as absent rather than corrupt', () => {
    // Antigravity ships a zero-byte `mcp_config.json`; that must read as "create it".
    expect(parseJsonc('')).toBeUndefined();
    expect(parseJsonc('   \n  ')).toBeUndefined();
  });

  it('accepts comments and trailing commas', () => {
    const source = `{
      // line comment
      "mcpServers": {
        /* block */
        "other": { "command": "npx" },
      },
    }`;
    expect(parseJsonc(source)).toEqual({ mcpServers: { other: { command: 'npx' } } });
  });

  it('does not mistake comment-like or comma-like text inside strings', () => {
    expect(parseJsonc('{ "a": "http://x//y", "b": "value, }" }')).toEqual({ a: 'http://x//y', b: 'value, }' });
  });

  it('throws McpConfigParseError on malformed input', () => {
    expect(() => parseJsonc('{ "a": }')).toThrow(McpConfigParseError);
  });
});

describe('upsertContainerEntry', () => {
  it('creates a whole document when the file is empty', () => {
    const result = upsertContainerEntry('', { containerKey: 'mcpServers', entryKey: 'agentteams', entryValue: entry });

    expect(result.existed).toBe(false);
    expect(JSON.parse(result.text)).toEqual({ mcpServers: { agentteams: entry } });
  });

  it('preserves comments, key order and unrelated servers when appending', () => {
    const source = `{
  // my cursor servers
  "mcpServers": {
    /* keep me */
    "other": {
      "command": "npx"
    }
  },
  "unrelatedTopLevel": true
}
`;

    const result = upsertContainerEntry(source, {
      containerKey: 'mcpServers',
      entryKey: 'agentteams',
      entryValue: entry,
    });

    expect(result.text).toContain('// my cursor servers');
    expect(result.text).toContain('/* keep me */');
    expect(result.text).toContain('"unrelatedTopLevel": true');
    expect(parseJsonc(result.text)).toEqual({
      mcpServers: { other: { command: 'npx' }, agentteams: entry },
      unrelatedTopLevel: true,
    });
  });

  it('adds the container when it is missing without disturbing the rest', () => {
    const source = `{
  "theme": "dark" // trailing comment
}
`;
    const result = upsertContainerEntry(source, {
      containerKey: 'mcp',
      entryKey: 'agentteams',
      entryValue: entry,
    });

    expect(result.text).toContain('// trailing comment');
    expect(parseJsonc(result.text)).toEqual({ theme: 'dark', mcp: { agentteams: entry } });
  });

  it('replaces only the existing entry and reports an identical entry as unchanged', () => {
    const source = `{
  "mcpServers": {
    "agentteams": {
      "command": "old"
    },
    // keep this comment and the server below
    "other": { "command": "npx" }
  }
}
`;

    const updated = upsertContainerEntry(source, {
      containerKey: 'mcpServers',
      entryKey: 'agentteams',
      entryValue: entry,
    });

    expect(updated.existed).toBe(true);
    expect(updated.unchanged).toBe(false);
    expect(updated.text).toContain('// keep this comment and the server below');
    expect(readContainerEntry(updated.text, 'mcpServers', 'agentteams')).toEqual(entry);
    expect(readContainerEntry(updated.text, 'mcpServers', 'other')).toEqual({ command: 'npx' });

    const rerun = upsertContainerEntry(updated.text, {
      containerKey: 'mcpServers',
      entryKey: 'agentteams',
      entryValue: entry,
    });
    expect(rerun.unchanged).toBe(true);
    expect(rerun.text).toEqual(updated.text);
  });

  it('handles an empty container object', () => {
    const result = upsertContainerEntry('{\n  "mcpServers": {}\n}\n', {
      containerKey: 'mcpServers',
      entryKey: 'agentteams',
      entryValue: entry,
    });
    expect(parseJsonc(result.text)).toEqual({ mcpServers: { agentteams: entry } });
  });

  it('supports a dotted container key such as Amp settings', () => {
    const source = '{\n  "amp.mcpServers": {\n    "other": { "command": "npx" }\n  },\n  "amp.other": 1\n}\n';
    const result = upsertContainerEntry(source, {
      containerKey: 'amp.mcpServers',
      entryKey: 'agentteams',
      entryValue: entry,
    });
    expect(parseJsonc(result.text)).toEqual({
      'amp.mcpServers': { other: { command: 'npx' }, agentteams: entry },
      'amp.other': 1,
    });
  });

  it('refuses to edit a document it cannot parse or whose container is not an object', () => {
    expect(() =>
      upsertContainerEntry('{ "mcpServers": ', { containerKey: 'mcpServers', entryKey: 'a', entryValue: entry }),
    ).toThrow(McpConfigParseError);

    expect(() =>
      upsertContainerEntry('[1, 2]', { containerKey: 'mcpServers', entryKey: 'a', entryValue: entry }),
    ).toThrow(/top-level value must be an object/i);

    expect(() =>
      upsertContainerEntry('{ "mcpServers": "nope" }', {
        containerKey: 'mcpServers',
        entryKey: 'a',
        entryValue: entry,
      }),
    ).toThrow(/is not an object/i);
  });
});
