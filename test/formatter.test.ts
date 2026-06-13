import { describe, expect, it } from '@jest/globals';
import { formatOutput } from '../src/utils/formatter.js';

describe('formatter', () => {
  it('formats output with JSON.stringify indentation', () => {
    expect(formatOutput({ id: 'p1' })).toBe('{\n  "id": "p1"\n}');
  });

  it('preserves object structure instead of applying text key ordering', () => {
    const data = {
      status: 'DONE',
      id: 'plan-1',
      title: 'Write tests',
      meta: { owner: 'justin', note: 'ready' },
      tags: ['cli', 'test'],
      ignored: null,
    };
    const output = formatOutput(data);

    expect(JSON.parse(output)).toEqual(data);
    expect(output).toContain('"ignored": null');
  });

  it('formats arrays and wrapped data payloads as JSON', () => {
    expect(
      JSON.parse(
        formatOutput([
          { id: 'p1', title: 'One' },
          { id: 'p2', title: 'Two' },
        ]),
      ),
    ).toEqual([
      { id: 'p1', title: 'One' },
      { id: 'p2', title: 'Two' },
    ]);

    expect(JSON.parse(formatOutput({ data: [{ id: 'p1', title: 'One' }] }))).toEqual({
      data: [{ id: 'p1', title: 'One' }],
    });
    expect(JSON.parse(formatOutput({ data: { id: 'p2', title: 'Two' } }))).toEqual({
      data: { id: 'p2', title: 'Two' },
    });
  });

  it('formats primitive values as JSON', () => {
    expect(formatOutput('hello')).toBe('"hello"');
    expect(formatOutput(42)).toBe('42');
  });
});
