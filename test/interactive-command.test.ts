import { describe, expect, it, jest } from '@jest/globals';
import { executeValidatedInteractiveCommand } from '../src/utils/interactiveCommand.js';

describe('executeValidatedInteractiveCommand', () => {
  it('rejects an unsupported format before invoking the mutating executor', async () => {
    const execute = jest.fn(async () => ({ changedCount: 1 }));

    await expect(executeValidatedInteractiveCommand('yaml', execute)).rejects.toThrow('Unsupported output format');
    expect(execute).not.toHaveBeenCalled();
  });

  it('executes after normalizing a supported format', async () => {
    const execute = jest.fn(async () => ({ changedCount: 0 }));

    await expect(executeValidatedInteractiveCommand('json', execute)).resolves.toEqual({
      result: { changedCount: 0 },
      format: 'json',
    });
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
