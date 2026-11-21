/** JSON의 진단 코드는 유지하고 사람이 읽는 로그인 안내를 공유한다. */
export function describeEndedLogin(reason?: string | null): string {
  if (reason === 'reused') {
    return "Your AgentTeams sign-in ended because a sign-in token was used more than once. Run 'agentteams auth login' to sign in again. If you were not running two agentteams commands at the same time, review your sessions in the AgentTeams web app.";
  }
  if (reason === 'expired') {
    return "Your AgentTeams sign-in expired. Run 'agentteams auth login' to sign in again.";
  }
  if (reason === 'invalid') {
    return "Your AgentTeams sign-in is no longer valid. Run 'agentteams auth login' to sign in again.";
  }
  return "Your AgentTeams login was revoked or expired. Run 'agentteams auth login' to sign in again.";
}

// The authorization code's five-minute TTL begins only when the browser issues
// it. This longer local wait gives a new user time to sign in and pick a project.
export const BROWSER_AUTH_TIMEOUT_MS = 10 * 60 * 1000;
export const BROWSER_AUTH_TIMEOUT_NOTICE = 'You have 10 minutes to finish authorization (Ctrl+C to cancel).';
