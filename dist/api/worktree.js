import httpClient from '../utils/httpClient.js';
export async function sendWorktreeLifecycleEvent(apiUrl, headers, event) {
    const response = await httpClient.post(`${apiUrl}/api/daemon-triggers/discovered-worktrees/events`, event, {
        headers,
    });
    return response.data;
}
//# sourceMappingURL=worktree.js.map