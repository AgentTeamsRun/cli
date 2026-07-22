import httpClient from '../utils/httpClient.js';

export type WorktreeLifecycleEvent = {
  event: 'CREATED' | 'DELETED';
  eventId: string;
  occurredAt: string;
  repositoryId?: string;
  remoteUrl?: string;
  localKey: string;
  branch?: string | null;
  headSha?: string | null;
  displayName?: string | null;
};

export async function sendWorktreeLifecycleEvent(
  apiUrl: string,
  headers: Record<string, string>,
  event: WorktreeLifecycleEvent,
): Promise<unknown> {
  const response = await httpClient.post(`${apiUrl}/api/daemon-triggers/discovered-worktrees/events`, event, {
    headers,
  });
  return response.data;
}
