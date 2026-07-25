/**
 * Minimal JSONC reader plus a surgical single-entry editor.
 *
 * MCP client config files are user-owned: OpenCode ships `opencode.jsonc`, and
 * Cursor/Antigravity/Kimi users routinely keep comments and a hand-picked key
 * order in their `mcp.json`. A `JSON.parse` → `JSON.stringify` round-trip would
 * silently delete those comments and reorder everything, so writes are done as
 * a text splice that touches only the AgentTeams entry and leaves every other
 * byte of the document exactly where it was.
 */

export class McpConfigParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'McpConfigParseError';
  }
}

const WHITESPACE = new Set([' ', '\t', '\n', '\r']);

/** Skip whitespace and `//` / block comments starting at `index`. */
function skipTrivia(text: string, index: number): number {
  let i = index;
  while (i < text.length) {
    const char = text[i];
    if (WHITESPACE.has(char)) {
      i += 1;
      continue;
    }
    if (char === '/' && text[i + 1] === '/') {
      i += 2;
      while (i < text.length && text[i] !== '\n') i += 1;
      continue;
    }
    if (char === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i += 1;
      i = Math.min(i + 2, text.length);
      continue;
    }
    break;
  }
  return i;
}

function scanString(text: string, index: number): number {
  let i = index + 1;
  while (i < text.length) {
    const char = text[i];
    if (char === '\\') {
      i += 2;
      continue;
    }
    if (char === '"') return i + 1;
    i += 1;
  }
  throw new McpConfigParseError('Unterminated string literal');
}

/** Return the index just past the value that starts at (or after) `index`. */
function scanValue(text: string, index: number): number {
  const start = skipTrivia(text, index);
  const char = text[start];
  if (char === undefined) throw new McpConfigParseError('Unexpected end of input');
  if (char === '"') return scanString(text, start);

  if (char === '{' || char === '[') {
    const close = char === '{' ? '}' : ']';
    let depth = 0;
    let i = start;
    while (i < text.length) {
      const current = text[i];
      if (current === '"') {
        i = scanString(text, i);
        continue;
      }
      if (current === '/' && (text[i + 1] === '/' || text[i + 1] === '*')) {
        i = skipTrivia(text, i);
        continue;
      }
      if (current === char) depth += 1;
      else if (current === close) {
        depth -= 1;
        if (depth === 0) return i + 1;
      }
      i += 1;
    }
    throw new McpConfigParseError('Unterminated object or array');
  }

  let i = start;
  while (i < text.length && !WHITESPACE.has(text[i]) && text[i] !== ',' && text[i] !== '}' && text[i] !== ']') {
    i += 1;
  }
  if (i === start) throw new McpConfigParseError(`Unexpected token "${char}"`);
  return i;
}

interface JsoncMember {
  key: string;
  keyStart: number;
  valueStart: number;
  valueEnd: number;
}

/** List the direct members of the object whose `{` sits at `objectStart`. */
function listMembers(text: string, objectStart: number): JsoncMember[] {
  const members: JsoncMember[] = [];
  let i = skipTrivia(text, objectStart + 1);

  while (i < text.length && text[i] !== '}') {
    if (text[i] === ',') {
      i = skipTrivia(text, i + 1);
      continue;
    }
    if (text[i] !== '"') throw new McpConfigParseError('Expected a quoted object key');

    const keyStart = i;
    const keyEnd = scanString(text, i);
    const key = JSON.parse(text.slice(keyStart, keyEnd)) as string;

    const colon = skipTrivia(text, keyEnd);
    if (text[colon] !== ':') throw new McpConfigParseError(`Expected ":" after object key "${key}"`);

    const valueStart = skipTrivia(text, colon + 1);
    const valueEnd = scanValue(text, valueStart);
    members.push({ key, keyStart, valueStart, valueEnd });
    i = skipTrivia(text, valueEnd);
  }

  return members;
}

/**
 * Parse JSON with comments and trailing commas. Returns `undefined` for an
 * empty document — an untouched client config file is frequently zero bytes,
 * and that is a "create it" signal rather than a corruption signal.
 */
export function parseJsonc(text: string): unknown {
  if (text.trim().length === 0) return undefined;

  let normalized = '';
  let i = 0;
  while (i < text.length) {
    const char = text[i];
    if (char === '"') {
      const end = scanString(text, i);
      normalized += text.slice(i, end);
      i = end;
      continue;
    }
    if (char === '/' && (text[i + 1] === '/' || text[i + 1] === '*')) {
      normalized += ' ';
      i = skipTrivia(text, i);
      continue;
    }
    if (char === ',') {
      const next = skipTrivia(text, i + 1);
      if (text[next] === '}' || text[next] === ']') {
        normalized += ' ';
        i += 1;
        continue;
      }
    }
    normalized += char;
    i += 1;
  }

  try {
    return JSON.parse(normalized);
  } catch (error) {
    throw new McpConfigParseError(error instanceof Error ? error.message : String(error));
  }
}

function detectIndentUnit(text: string): string {
  const match = /\n([ \t]+)\S/.exec(text);
  return match ? match[1] : '  ';
}

function lineIndentOf(text: string, index: number): string {
  const lineStart = text.lastIndexOf('\n', index) + 1;
  const match = /^[ \t]*/.exec(text.slice(lineStart, index));
  return match ? match[0] : '';
}

function serializeValue(value: unknown, indentUnit: string, baseIndent: string): string {
  const json = JSON.stringify(value, null, indentUnit);
  return json
    .split('\n')
    .map((line, lineIndex) => (lineIndex === 0 ? line : `${baseIndent}${line}`))
    .join('\n');
}

function appendMember(text: string, objectStart: number, memberText: string, memberIndent: string): string {
  const objectEnd = scanValue(text, objectStart) - 1;
  const members = listMembers(text, objectStart);

  if (members.length === 0) {
    const closingIndent = lineIndentOf(text, objectStart);
    return `${text.slice(0, objectStart + 1)}\n${memberIndent}${memberText}\n${closingIndent}${text.slice(objectEnd)}`;
  }

  const last = members[members.length - 1];
  const afterLast = skipTrivia(text, last.valueEnd);
  const hasTrailingComma = text[afterLast] === ',';
  const insertAt = hasTrailingComma ? afterLast + 1 : last.valueEnd;
  const separator = hasTrailingComma ? '' : ',';

  return `${text.slice(0, insertAt)}${separator}\n${memberIndent}${memberText}${text.slice(insertAt)}`;
}

export interface UpsertContainerEntryOptions {
  /** Top-level key holding the server map, e.g. `mcpServers`, `mcp`, `amp.mcpServers`. */
  containerKey: string;
  entryKey: string;
  entryValue: unknown;
}

export interface UpsertContainerEntryResult {
  text: string;
  /** The entry was already present before this edit. */
  existed: boolean;
  /** The entry was already present *and* byte-identical, so nothing was rewritten. */
  unchanged: boolean;
}

/**
 * Insert or replace `containerKey.entryKey` in a JSON/JSONC document without
 * reformatting anything else.
 *
 * @throws {McpConfigParseError} when the document is not parseable, or when the
 * root / container is not an object. Callers must treat this as "leave the
 * user's file untouched" rather than as permission to overwrite it.
 */
export function upsertContainerEntry(source: string, options: UpsertContainerEntryOptions): UpsertContainerEntryResult {
  const { containerKey, entryKey, entryValue } = options;
  const indentUnit = detectIndentUnit(source);

  if (source.trim().length === 0) {
    const entry = serializeValue(entryValue, indentUnit, indentUnit.repeat(2));
    const text =
      `{\n${indentUnit}${JSON.stringify(containerKey)}: {\n` +
      `${indentUnit.repeat(2)}${JSON.stringify(entryKey)}: ${entry}\n` +
      `${indentUnit}}\n}\n`;
    return { text, existed: false, unchanged: false };
  }

  // Validate before splicing: a corrupt document must fail loudly here so the
  // caller can preserve the original instead of writing a half-repaired file.
  parseJsonc(source);

  const rootStart = skipTrivia(source, 0);
  if (source[rootStart] !== '{') {
    throw new McpConfigParseError('The top-level value must be an object');
  }

  const container = listMembers(source, rootStart).find((member) => member.key === containerKey);

  if (!container) {
    const memberIndent = lineIndentOf(source, rootStart) + indentUnit;
    const entry = serializeValue(entryValue, indentUnit, `${memberIndent}${indentUnit}`);
    const memberText =
      `${JSON.stringify(containerKey)}: {\n` +
      `${memberIndent}${indentUnit}${JSON.stringify(entryKey)}: ${entry}\n` +
      `${memberIndent}}`;
    return { text: appendMember(source, rootStart, memberText, memberIndent), existed: false, unchanged: false };
  }

  if (source[container.valueStart] !== '{') {
    throw new McpConfigParseError(`"${containerKey}" exists but is not an object`);
  }

  const entries = listMembers(source, container.valueStart);
  const existing = entries.find((member) => member.key === entryKey);

  if (existing) {
    const baseIndent = lineIndentOf(source, existing.keyStart);
    const entry = serializeValue(entryValue, indentUnit, baseIndent);
    if (source.slice(existing.valueStart, existing.valueEnd) === entry) {
      return { text: source, existed: true, unchanged: true };
    }
    return {
      text: `${source.slice(0, existing.valueStart)}${entry}${source.slice(existing.valueEnd)}`,
      existed: true,
      unchanged: false,
    };
  }

  const memberIndent =
    entries.length > 0
      ? lineIndentOf(source, entries[0].keyStart)
      : lineIndentOf(source, container.keyStart) + indentUnit;
  const entry = serializeValue(entryValue, indentUnit, memberIndent);
  const memberText = `${JSON.stringify(entryKey)}: ${entry}`;

  return {
    text: appendMember(source, container.valueStart, memberText, memberIndent),
    existed: false,
    unchanged: false,
  };
}

/** Read `containerKey.entryKey` from a parsed document, if present. */
export function readContainerEntry(source: string, containerKey: string, entryKey: string): unknown {
  const parsed = parseJsonc(source);
  if (parsed === undefined || parsed === null || typeof parsed !== 'object') return undefined;
  const container = (parsed as Record<string, unknown>)[containerKey];
  if (container === null || typeof container !== 'object') return undefined;
  return (container as Record<string, unknown>)[entryKey];
}
