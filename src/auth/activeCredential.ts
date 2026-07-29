/**
 * The credential this process is currently authenticating with, in a form the
 * HTTP layer can act on.
 *
 * `utils/httpClient.ts` must be able to answer "can this 401 be fixed by a
 * refresh?" without importing the config loader (which imports the token client,
 * which would import the HTTP layer back). A one-slot registry keeps that
 * dependency edge from existing at all.
 *
 * Only the personal-token path registers anything here. A legacy `key_` run
 * leaves the slot empty, which is what makes "never attempt a refresh on the old
 * path" a structural property rather than a conditional the caller must remember.
 */

export interface RefreshableCredential {
  /** Discard the cached access token and fetch a new one. Null means "could not". */
  refresh(): Promise<string | null>;
}

let active: RefreshableCredential | null = null;

export function setActiveCredential(credential: RefreshableCredential | null): void {
  active = credential;
}

export function getActiveCredential(): RefreshableCredential | null {
  return active;
}

/** Test-only: return the process to the "no refreshable credential" state. */
export function resetActiveCredentialForTests(): void {
  active = null;
}
