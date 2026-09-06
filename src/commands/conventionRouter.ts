import {
  conventionCreate,
  conventionDelete,
  conventionDownload,
  conventionList,
  conventionShow,
  conventionStatus,
  conventionUpdate,
} from './convention.js';
import { withCommandContext } from '../utils/commandContext.js';
import { executeSkillCommand } from './skill.js';
import { loadConfigWithCredential } from '../utils/config.js';
import { resolveApiContext } from '../utils/apiContext.js';

export async function executeConventionCommand(action: string, options: any): Promise<any> {
  return withCommandContext(`convention:${action}`, () => executeConventionCommandWithContext(action, options));
}

async function executeConventionCommandWithContext(action: string, options: any): Promise<any> {
  switch (action) {
    case 'list':
      return conventionList();
    case 'show':
      return conventionShow();
    case 'download':
      return conventionDownload({ cwd: options?.cwd });
    case 'status':
      return conventionStatus({ cwd: options?.cwd });
    case 'create': {
      const files = options?.file;
      const hasFiles = typeof files === 'string' || (Array.isArray(files) && files.length > 0);
      if (!hasFiles) {
        throw new Error('--file is required for convention create');
      }
      return conventionCreate({ cwd: options?.cwd, file: options.file, scope: options?.scope });
    }
    case 'update': {
      const files = options?.file;
      const hasFiles = typeof files === 'string' || (Array.isArray(files) && files.length > 0);
      if (!hasFiles) {
        throw new Error('--file is required for convention update');
      }
      return conventionUpdate({ cwd: options?.cwd, file: options.file, apply: options.apply });
    }
    case 'delete': {
      const files = options?.file;
      const hasFiles = typeof files === 'string' || (Array.isArray(files) && files.length > 0);
      if (!hasFiles) {
        throw new Error('--file is required for convention delete');
      }
      return conventionDelete({ cwd: options?.cwd, file: options.file, apply: options.apply });
    }
    default:
      throw new Error(
        'Unknown convention action: ' + action + '. Use list, show, download, status, create, update, or delete.',
      );
  }
}

export async function executeSyncCommand(action: string, options: any): Promise<any> {
  return withCommandContext('sync', () => executeSyncCommandWithContext(action, options));
}

/** 사람의 동기화도 공통 로컬 변경 보호를 사용한다. 강제 덮어쓰기는 skill download --id --force로 분리한다. */
async function executeSyncCommandWithContext(action: string, options: any): Promise<any> {
  switch (action) {
    case 'download': {
      const cwd = options?.cwd;
      const conventions = await conventionDownload({ cwd });
      return { ...conventions, skills: await syncSkillDownload(cwd) };
    }
    default:
      throw new Error(`Unknown sync action: ${action}. Use download.`);
  }
}

type SkillSyncResult = { message: string; warning?: string };

async function syncSkillDownload(cwd?: string): Promise<SkillSyncResult> {
  const config = await loadConfigWithCredential();
  if (!config) {
    // 컨벤션 다운로드가 이미 성공한 뒤이므로 여기까지 오는 일은 드물다. 그래도 스킬 하나 때문에
    // 방금 받은 컨벤션까지 실패로 만들지는 않는다.
    return { message: 'Skills skipped: project is not configured.' };
  }

  const { apiUrl, headers } = resolveApiContext(config);
  try {
    const result = await executeSkillCommand(apiUrl, config.projectId, headers, 'download', {
      cwd: cwd ?? process.cwd(),
    });

    return {
      ...result,
      message: result.message,
    };
  } catch (error) {
    // 네트워크·API 오류도 미설정 케이스와 같은 이유로 강등한다 — 컨벤션은 이미 받아졌는데
    // exit 1로 끝나면 사용자가 컨벤션 동기화까지 실패한 것으로 오판한다.
    const reason = error instanceof Error ? error.message : String(error);
    return { message: `Skill download failed: ${reason}` };
  }
}
