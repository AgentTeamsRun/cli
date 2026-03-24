import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

describe('updateCheck', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('compareVersions handles patch, equality, v prefix, and major upgrades', async () => {
    const { compareVersions } = await import('../src/utils/updateCheck.js');

    expect(compareVersions('0.1.0', '0.2.0')).toBe(true);
    expect(compareVersions('0.2.0', '0.1.0')).toBe(false);
    expect(compareVersions('0.1.0', '0.1.0')).toBe(false);
    expect(compareVersions('v1.0.0', '1.0.1')).toBe(true);
    expect(compareVersions('1.0.0', '2.0.0')).toBe(true);
  });

  it('formatUpdateMessage includes current version, latest version, and package name', async () => {
    const { formatUpdateMessage } = await import('../src/utils/updateCheck.js');
    const message = formatUpdateMessage('0.1.0', '0.2.0');

    expect(message).toContain('0.1.0');
    expect(message).toContain('0.2.0');
    expect(message).toContain('@agentteams/cli');
  });

  it('readCache returns null when file is missing or invalid', async () => {
    if (typeof (jest as any).unstable_mockModule !== 'function') {
      return;
    }

    const existsSync = jest.fn()
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    const readFileSync = jest.fn(() => '{invalid');

    (jest as any).unstable_mockModule('node:fs', () => ({
      __esModule: true,
      existsSync,
      mkdirSync: jest.fn(),
      readFileSync,
      writeFileSync: jest.fn(),
      default: {
        existsSync,
        mkdirSync: jest.fn(),
        readFileSync,
        writeFileSync: jest.fn(),
      },
    }));
    (jest as any).unstable_mockModule('node:os', () => ({
      __esModule: true,
      homedir: () => '/mock-home',
      default: {
        homedir: () => '/mock-home',
      },
    }));

    const { readCache } = await import('../src/utils/updateCheck.js');

    expect(readCache()).toBeNull();
    expect(readCache()).toBeNull();
  });

  it('writeCache creates the directory when needed and writes JSON payload', async () => {
    if (typeof (jest as any).unstable_mockModule !== 'function') {
      return;
    }

    const mkdirSync = jest.fn();
    const writeFileSync = jest.fn();
    const existsSync = jest.fn((target: string) => !target.endsWith('/.agentteams'));

    (jest as any).unstable_mockModule('node:fs', () => ({
      __esModule: true,
      existsSync,
      mkdirSync,
      readFileSync: jest.fn(),
      writeFileSync,
      default: {
        existsSync,
        mkdirSync,
        readFileSync: jest.fn(),
        writeFileSync,
      },
    }));
    (jest as any).unstable_mockModule('node:os', () => ({
      __esModule: true,
      homedir: () => '/mock-home',
      default: {
        homedir: () => '/mock-home',
      },
    }));

    const { writeCache } = await import('../src/utils/updateCheck.js');

    writeCache({ lastCheck: 123, latestVersion: '0.2.0' });

    expect(mkdirSync).toHaveBeenCalledWith('/mock-home/.agentteams', { recursive: true });
    expect(writeFileSync).toHaveBeenCalledWith(
      '/mock-home/.agentteams/update-check.json',
      JSON.stringify({ lastCheck: 123, latestVersion: '0.2.0' }),
      'utf-8'
    );
  });
});
