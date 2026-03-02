import { existsSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';

export function splitCsv(value: string): string[] {
  if (typeof value !== 'string') {
    return [];
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return [];
  }

  return trimmed
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export function toNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function toNonNegativeInteger(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
    return value;
  }

  if (typeof value === 'string' && /^\d+$/.test(value)) {
    return Number.parseInt(value, 10);
  }

  return undefined;
}

export function toPositiveInteger(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return value;
  }

  if (typeof value === 'string' && /^\d+$/.test(value)) {
    const parsed = Number.parseInt(value, 10);
    return parsed > 0 ? parsed : undefined;
  }

  return undefined;
}

export function interpretEscapes(content: string): string {
  return content
    .replace(/\\r\\n/g, '\r\n')
    .replace(/\\n/g, '\n');
}

export function stripFrontmatter(content: string): string {
  return content.replace(/^---[\r\n][\s\S]*?[\r\n]---[\r\n]?/, '').trimStart();
}

export function toSafeFileName(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/**
 * 업로드에 사용된 파일이 .agentteams/temp/ 경로에 있을 경우 삭제합니다.
 * convention 파일 등 실제 소스 파일은 삭제하지 않습니다.
 */
export function deleteIfTempFile(fileInput: string): void {
  const resolved = resolve(fileInput);
  const normalized = resolved.replace(/\\/g, '/');
  if (normalized.includes('/.agentteams/temp/') && existsSync(resolved)) {
    try {
      unlinkSync(resolved);
    } catch {
      // 삭제 실패는 무시 (읽기 전용 파일시스템 등 예외 상황)
    }
  }
}
