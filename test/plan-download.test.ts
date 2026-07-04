import { describe, it, expect } from '@jest/globals';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildFreshnessNoticeLines,
  buildPlanRunbookFrontmatter,
  buildUniquePlanRunbookFileName,
  readPlanHtmlUploadInput,
} from '../src/commands/plan.js';

describe('buildPlanRunbookFrontmatter', () => {
  const base = {
    id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    title: 'My Plan',
    status: 'BACKLOG',
    priority: 'HIGH',
    webUrl: 'https://agentteams.run/go?type=plan&id=x',
    downloadedAt: '2026-07-04T00:00:00.000Z',
  };

  it('v2 plan includes contentVersion line', () => {
    const fm = buildPlanRunbookFrontmatter({ ...base, contentVersion: 'V2' });
    expect(fm).toContain('contentVersion: V2');
    expect(fm).toContain('planId: a1b2c3d4-e5f6-7890-abcd-ef1234567890');
    expect(fm).toContain('webUrl: https://agentteams.run/go?type=plan&id=x');
  });

  it('omits contentVersion when absent (v1 compatibility)', () => {
    const fm = buildPlanRunbookFrontmatter(base);
    expect(fm).not.toContain('contentVersion');
  });

  it('omits webUrl when absent', () => {
    const fm = buildPlanRunbookFrontmatter({ ...base, webUrl: null });
    expect(fm).not.toContain('webUrl');
  });
});

describe('buildFreshnessNoticeLines', () => {
  it('includes platform guide change and convention changes', () => {
    const lines = buildFreshnessNoticeLines({
      platformGuidesChanged: true,
      conventionChanges: [{ id: 'c1', type: 'updated', title: 'conventions' }],
    });

    expect(lines).toEqual(['⚠ Updated conventions found:', '  - platform guides (shared)', '  - updated: conventions']);
  });

  it('prints only changed conventions when platform guides are unchanged', () => {
    const lines = buildFreshnessNoticeLines({
      platformGuidesChanged: false,
      conventionChanges: [{ id: 'c2', type: 'new', fileName: 'testing.md' }],
    });

    expect(lines).toEqual(['⚠ Updated conventions found:', '  - new: testing.md']);
  });
});

describe('buildUniquePlanRunbookFileName', () => {
  const planId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

  it('includes planId prefix in runbook filename', () => {
    const fileName = buildUniquePlanRunbookFileName('My Plan Title', planId, []);
    expect(fileName).toBe('my-plan-title-a1b2c3d4.md');
  });

  it('adds numeric suffix when filename already exists', () => {
    const fileName = buildUniquePlanRunbookFileName('My Plan Title', planId, ['my-plan-title-a1b2c3d4.md']);
    expect(fileName).toBe('my-plan-title-a1b2c3d4-2.md');
  });

  it('uses planId prefix for non-ascii-only titles', () => {
    const fileName = buildUniquePlanRunbookFileName('플랜 제목', planId, []);
    expect(fileName).toBe('plan-a1b2c3d4.md');
  });

  it('different planIds produce different filenames for same title', () => {
    const id1 = 'aaaaaaaa-1111-2222-3333-444444444444';
    const id2 = 'bbbbbbbb-1111-2222-3333-444444444444';
    const f1 = buildUniquePlanRunbookFileName('플랜', id1, []);
    const f2 = buildUniquePlanRunbookFileName('플랜', id2, []);
    expect(f1).toBe('plan-aaaaaaaa.md');
    expect(f2).toBe('plan-bbbbbbbb.md');
    expect(f1).not.toBe(f2);
  });
});

describe('readPlanHtmlUploadInput', () => {
  it('reads non-empty HTML from --file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agentteams-plan-html-'));
    const file = join(dir, 'summary.html');
    const html = [
      '<!doctype html><html><head><style>',
      ':root { --text: #111827; --surface: #ffffff; --code-bg: #f3f4f6; }',
      '[data-theme="night"] { --text: #f9fafb; --surface: #111827; --code-bg: #1f2937; }',
      'body { margin: 0; color: var(--text); background: transparent; }',
      '.card { background: var(--surface); } code { background: var(--code-bg); }',
      '</style></head><body><main class="card">Summary<code>ok</code></main></body></html>',
    ].join('');
    try {
      writeFileSync(file, html, 'utf-8');

      expect(readPlanHtmlUploadInput({ file })).toBe(html);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects ambiguous or empty upload input', () => {
    expect(() => readPlanHtmlUploadInput({})).toThrow('--file or --stdin is required');
    expect(() => readPlanHtmlUploadInput({ file: 'summary.html', stdin: true })).toThrow(
      'Use either --file or --stdin',
    );

    const dir = mkdtempSync(join(tmpdir(), 'agentteams-plan-html-'));
    const file = join(dir, 'empty.html');
    try {
      writeFileSync(file, '   ', 'utf-8');

      expect(() => readPlanHtmlUploadInput({ file })).toThrow('HTML content is empty');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
