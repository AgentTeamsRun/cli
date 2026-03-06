import { buildAuthorizeUrl, detectOsType } from '../src/commands/init.js';

describe('init helpers', () => {
  test('buildAuthorizeUrl includes authPathEnc and osType when provided', () => {
    const url = buildAuthorizeUrl(9876, 'demo', 'enc-value', 'LINUX');
    const parsed = new URL(url);

    expect(parsed.searchParams.get('port')).toBe('9876');
    expect(parsed.searchParams.get('projectName')).toBe('demo');
    expect(parsed.searchParams.get('ap')).toBe('enc-value');
    expect(parsed.searchParams.get('ot')).toBe('LINUX');
  });

  test('detectOsType maps process.platform to supported values', () => {
    const result = detectOsType();

    if (process.platform === 'darwin') {
      expect(result).toBe('MACOS');
      return;
    }

    if (process.platform === 'linux') {
      expect(result).toBe('LINUX');
      return;
    }

    if (process.platform === 'win32') {
      expect(result).toBe('WINDOWS');
      return;
    }

    expect(result).toBeUndefined();
  });
});
