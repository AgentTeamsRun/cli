import { describe, it, expect } from '@jest/globals';
import { executePlanCommand } from '../src/commands/plan.js';

const apiUrl = 'http://localhost:0';
const projectId = 'test-project';
const headers = {};

const baseCreateOptions = {
  title: 'plan complexity test',
  content: 'some plan body content',
  runnerType: 'CLAUDE_CODE',
  model: 'claude-opus-4-8',
  // an HTML preview source so the preview gate passes when reached
  htmlStdin: false,
};

describe('plan create complexity validation', () => {
  it('rejects create when --complexity is missing', async () => {
    await expect(
      executePlanCommand(apiUrl, projectId, headers, 'create', { ...baseCreateOptions }),
    ).rejects.toThrow(/--complexity is required/);
  });

  it('rejects create when --complexity is not a valid tier', async () => {
    await expect(
      executePlanCommand(apiUrl, projectId, headers, 'create', { ...baseCreateOptions, complexity: 'HUGE' }),
    ).rejects.toThrow(/Invalid --complexity/);
  });

  it('rejects create without an HTML preview even when complexity is valid', async () => {
    await expect(
      executePlanCommand(apiUrl, projectId, headers, 'create', { ...baseCreateOptions, complexity: 'MINIMAL' }),
    ).rejects.toThrow(/HTML preview is required/);
  });
});

describe('plan update complexity validation', () => {
  it('rejects update when --complexity is not a valid tier', async () => {
    await expect(
      executePlanCommand(apiUrl, projectId, headers, 'update', { id: 'p1', complexity: 'HUGE' }),
    ).rejects.toThrow(/Invalid --complexity/);
  });
});
