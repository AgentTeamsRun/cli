import { type Server } from 'node:http';
export type AuthResult = {
    teamId: string;
    projectId: string;
    agentName: string;
    apiKey: string;
    configId: string;
    seedPlanId?: string | null;
};
/**
 * The authorization-code callback. Deliberately smaller than {@link AuthResult}:
 * a single-use code that is worthless without the `code_verifier` this process
 * never sent anywhere, instead of a long-lived key travelling through a browser.
 */
export type AuthorizationCodeResult = {
    code: string;
    state: string;
};
/**
 * The unified setup callback used by `agentteams init`.
 *
 * An authorization code plus the connection identifiers the CLI is about to
 * write into `.agentteams/config.json` — and nothing else. `apiKey` and
 * `apiUrl` stay off this list on purpose: keeping a long-lived secret and the
 * server address out of the browser round trip is the whole reason this path
 * exists, so a new field belongs here only if it may leak to the callback port.
 */
export type UnifiedSetupResult = AuthorizationCodeResult & {
    teamId: string;
    projectId: string;
    configId: string;
    agentName: string;
    seedPlanId?: string | null;
};
/**
 * A web build older than this CLI ignored `flow=setup` and answered with the
 * plain `{ code, state }` of the personal-login path. The code is real but
 * useless here — without the connection identifiers there is no project to
 * configure — so it is deliberately left unredeemed and the login fails loudly.
 *
 * `legacyAgentKeyIssued` marks the *older* skew: a web that does not know the
 * authorization code at all and answered with the agent-key callback. That page
 * minted a 30-day key before posting, so the message has to say so.
 */
export type UnifiedSetupMetadataMissing = {
    metadataMissing: true;
    legacyAgentKeyIssued?: true;
};
export type UnifiedSetupCallback = UnifiedSetupResult | UnifiedSetupMetadataMissing;
export declare const SETUP_METADATA_MISSING_HINT: string;
/**
 * The same skew one deploy further back: the page answered with the legacy
 * agent-key callback. Unlike {@link SETUP_METADATA_MISSING_HINT} this one cannot
 * end with "nothing happened" — the key was already issued server-side and only
 * the user can revoke it.
 */
export declare const SETUP_LEGACY_AGENT_KEY_HINT: string;
export declare function isUnifiedSetupMetadataMissing(value: UnifiedSetupCallback): value is UnifiedSetupMetadataMissing;
export type AuthServerResult<T> = {
    server: Server;
    waitForCallback: () => Promise<T>;
    port: number;
    /** Echo this back through the authorize URL; the callback is rejected without it. */
    state: string;
};
type StartLocalAuthServerOptions = {
    state?: string;
};
/** Unguessable value that proves a callback belongs to the login this process started. */
export declare function createAuthState(): string;
export type PkcePair = {
    /** Stays in this process. Without it a stolen code cannot be redeemed. */
    verifier: string;
    /** S256 hash sent through the browser. */
    challenge: string;
};
/**
 * PKCE S256 pair.
 *
 * 48 random bytes base64url-encode to 64 characters, inside the server's
 * 43–128 range (`api/src/routes/desktop-auth/index.ts`).
 */
export declare function createPkcePair(): PkcePair;
/**
 * Legacy login callback: the web posts the issued agent key back to this port.
 * Kept unchanged for CLI/web combinations that predate the authorization-code
 * path; `P3` is where it goes away.
 */
export declare function startLocalAuthServer(options?: StartLocalAuthServerOptions): Promise<AuthServerResult<AuthResult>>;
/** Authorization-code login callback: only `{ code, state }` crosses this boundary. */
export declare function startAuthorizationCodeServer(options?: StartLocalAuthServerOptions): Promise<AuthServerResult<AuthorizationCodeResult>>;
/**
 * Copy only the fields the CLI trusts, exactly as {@link toAuthResult} does.
 *
 * Returning `null` means "this is not a callback for this login at all";
 * returning the metadata-missing marker means "it is, but from a web build that
 * cannot complete the setup" — the two need different answers upstream.
 */
export declare function parseUnifiedSetupPayload(value: unknown): UnifiedSetupCallback | null;
/** Unified setup callback: an authorization code plus the connection identifiers. */
export declare function startUnifiedSetupServer(options?: StartLocalAuthServerOptions): Promise<AuthServerResult<UnifiedSetupCallback>>;
export {};
//# sourceMappingURL=authServer.d.ts.map