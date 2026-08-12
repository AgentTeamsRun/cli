import { describe, expect, it } from '@jest/globals';
import { isApiOriginRequest, registerApiOrigin, resolveRequestOrigin } from '../src/utils/apiOrigin.js';
import { DEFAULT_API_URL } from '../src/utils/config.js';

/**
 * `utils/apiOrigin.ts` cannot import the config loader (it would close the
 * httpClient → config → token client → httpClient cycle), so it repeats the
 * default API URL. If the two ever drift, the default deployment silently
 * stops sending session identity headers — the tool axis would vanish with no
 * error anywhere.
 */
describe('apiOrigin default mirrors the config default', () => {
  it('treats the built-in default API URL as a known origin without any registration', () => {
    expect(isApiOriginRequest({ url: `${DEFAULT_API_URL}/api/projects/p/plans` })).toBe(true);
  });
});

describe('resolveRequestOrigin', () => {
  it('prefers an absolute url over baseURL — the presigned upload shape', () => {
    expect(
      resolveRequestOrigin({ url: 'https://bucket.r2.cloudflarestorage.com/uploads/a', baseURL: DEFAULT_API_URL }),
    ).toBe('https://bucket.r2.cloudflarestorage.com');
  });

  it('resolves a relative url against baseURL', () => {
    expect(resolveRequestOrigin({ url: '/api/projects/p/plans', baseURL: DEFAULT_API_URL })).toBe(DEFAULT_API_URL);
  });

  it('returns null when there is nothing to resolve', () => {
    expect(resolveRequestOrigin({})).toBeNull();
    expect(resolveRequestOrigin({ url: 'not a url' })).toBeNull();
  });
});

describe('isApiOriginRequest', () => {
  it('is fail-closed for an unregistered origin', () => {
    expect(isApiOriginRequest({ url: 'https://unknown.example.com/api/projects/p/plans' })).toBe(false);
  });

  it('accepts an origin registered by resolveApiContext, ignoring path and trailing slash', () => {
    registerApiOrigin('https://api.custom.example/');
    expect(isApiOriginRequest({ url: 'https://api.custom.example/api/projects/p/plans' })).toBe(true);
  });

  it('ignores values that are not URLs', () => {
    registerApiOrigin('   ');
    registerApiOrigin(undefined);
    expect(isApiOriginRequest({ url: '   ' })).toBe(false);
  });
});
