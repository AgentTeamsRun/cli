import {
  conventionCreate,
  conventionDelete,
  conventionDownload,
  conventionList,
  conventionShow,
  conventionStatus,
  conventionUpdate,
} from './convention.js';

export async function executeConventionCommand(action: string, options: any): Promise<any> {
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
      return conventionCreate({ cwd: options?.cwd, file: options.file });
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
      throw new Error('Unknown convention action: ' + action + '. Use list, show, download, status, create, update, or delete.');
  }
}

export async function executeSyncCommand(action: string, options: any): Promise<any> {
  switch (action) {
    case 'download':
      return conventionDownload({ cwd: options?.cwd });
    default:
      throw new Error(`Unknown sync action: ${action}. Use download.`);
  }
}
