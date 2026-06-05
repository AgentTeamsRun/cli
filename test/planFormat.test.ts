import { describe, expect, it } from '@jest/globals';
import {
  mergePlanWithDependencies,
  normalizeDependencies,
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

});
