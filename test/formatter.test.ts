import { describe, expect, it } from '@jest/globals';
import { formatOutput } from '../src/utils/formatter.js';

describe('formatter', () => {
  it('formats json output with JSON.stringify indentation', () => {
    expect(formatOutput({ id: 'p1' }, 'json')).toBe('{\n  "id": "p1"\n}');
  });

  it('formats a single object in text mode with preferred key ordering', () => {
    const output = formatOutput(
      {
        status: 'DONE',
        id: 'plan-1',
        title: 'Write tests',
        meta: { owner: 'justin', note: 'ready' },
        tags: ['cli', 'test'],
        ignored: null,
      },
      'text'
    );

    expect(output).toContain('id: plan-1');
    expect(output.indexOf('id: plan-1')).toBeLessThan(output.indexOf('title: Write tests'));
    expect(output).toContain('meta:\n  note: ready\n  owner: justin');
    expect(output).toContain('tags: cli, test');
    expect(output).not.toContain('ignored:');
  });

  it('formats arrays and wrapped data payloads in text mode', () => {
    expect(
      formatOutput(
        [{ id: 'p1', title: 'One' }, { id: 'p2', title: 'Two' }],
        'text'
      )
    ).toContain('\n\n');

    expect(formatOutput({ data: [{ id: 'p1', title: 'One' }] }, 'text')).toContain('id: p1');
    expect(formatOutput({ data: { id: 'p2', title: 'Two' } }, 'text')).toContain('title: Two');
  });

  it('formats primitive values as strings', () => {
    expect(formatOutput('hello', 'text')).toBe('hello');
    expect(formatOutput(42, 'text')).toBe('42');
  });
});
