import { describe, expect, it, jest } from '@jest/globals';
import { createVendorRunner } from '../src/mcp-registration/vendorCommand.js';

describe('vendor command process options', () => {
  it('hides the vendor CLI console without enabling a shell', () => {
    const spawnSync = jest.fn(() => ({
      status: 0,
      signal: null,
      stdout: 'ok',
      stderr: '',
      pid: 1234,
      output: [null, 'ok', ''],
    }));
    const runVendorCommand = createVendorRunner(spawnSync);

    expect(runVendorCommand('agent-vendor', ['mcp', 'add'], { cwd: 'C:\\repo', env: {} })).toEqual({
      status: 0,
      stdout: 'ok',
      stderr: '',
    });
    expect(spawnSync).toHaveBeenCalledWith(
      'agent-vendor',
      ['mcp', 'add'],
      expect.objectContaining({ shell: false, windowsHide: true }),
    );
  });
});
