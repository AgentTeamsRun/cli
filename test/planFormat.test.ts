import { describe, expect, it } from '@jest/globals';
import {
  appendLineIfExists,
  formatPlanWithDependenciesText,
  mergePlanWithDependencies,
  normalizeDependencies,
  renderDependencyLine,
} from '../src/utils/planFormat.js';

describe('planFormat', () => {
  it('normalizeDependencies extracts blocking and dependents from raw or wrapped payloads', () => {
    expect(normalizeDependencies({ blocking: [{ id: 'p1' }], dependents: [{ id: 'p2' }] })).toEqual({
      blocking: [{ id: 'p1' }],
      dependents: [{ id: 'p2' }],
    });
    expect(normalizeDependencies({ data: { blocking: [{ id: 'p1' }], dependents: [] } })).toEqual({
      blocking: [{ id: 'p1' }],
      dependents: [],
    });
    expect(normalizeDependencies(null)).toEqual({ blocking: [], dependents: [] });
    expect(normalizeDependencies('invalid')).toEqual({ blocking: [], dependents: [] });
  });

  it('mergePlanWithDependencies injects dependencies and falls back when plan response is null', () => {
    const dependencies = { blocking: [{ id: 'p1' }], dependents: [] };

    expect(mergePlanWithDependencies({ data: { id: 'plan-1', title: 'Sample' } }, dependencies)).toEqual({
      data: {
        id: 'plan-1',
        title: 'Sample',
        dependencies,
      },
    });
    expect(mergePlanWithDependencies(null, dependencies)).toEqual({
      data: {
        dependencies,
      },
    });
  });

  it('formatPlanWithDependenciesText renders fields and dependency lines', () => {
    const output = formatPlanWithDependenciesText(
      {
        id: 'plan-1',
        title: 'Write tests',
        status: 'IN_PROGRESS',
        type: 'CHORE',
        priority: 'MEDIUM',
        owner: 'justin',
      },
      {
        blocking: [{ id: 'plan-2', title: 'Prepare fixtures', status: 'DONE' }],
        dependents: [{ id: 'plan-3', title: 'Review tests', status: 'TODO' }],
      }
    );

    expect(output).toContain('id: plan-1');
    expect(output).toContain('owner: justin');
    expect(output).toContain('- [BLOCKING] plan-2: Prepare fixtures (DONE)');
    expect(output).toContain('- [DEPENDENT] plan-3: Review tests (TODO)');
  });

  it('formatPlanWithDependenciesText prints No dependencies when empty', () => {
    const output = formatPlanWithDependenciesText({ id: 'plan-1' }, { blocking: [], dependents: [] });
    expect(output).toContain('No dependencies.');
  });

  it('appendLineIfExists skips nullish and blank values', () => {
    const lines: string[] = [];

    appendLineIfExists(lines, 'title', '  Hello ');
    appendLineIfExists(lines, 'empty', '   ');
    appendLineIfExists(lines, 'missing', undefined);

    expect(lines).toEqual(['title: Hello']);
  });

  it('renderDependencyLine handles valid and invalid dependency objects', () => {
    expect(renderDependencyLine('BLOCKING', { id: 'plan-2', title: 'Prepare', status: 'DONE' })).toBe(
      '- [BLOCKING] plan-2: Prepare (DONE)'
    );
    expect(renderDependencyLine('DEPENDENT', null)).toBe('- [DEPENDENT] unknown');
  });
});
