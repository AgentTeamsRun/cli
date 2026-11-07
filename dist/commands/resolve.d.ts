import { type EntityRefKind } from '../utils/entityRef.js';
export interface ResolveApiContext {
    apiUrl: string;
    projectId: string;
    headers: Record<string, string>;
}
/**
 * Standard `resolve` envelope. `kind` tells the caller what to do next:
 * read `filePath`, use `record`, or open `url` / run `suggestedCommand`.
 */
export interface ResolveResult {
    message: string;
    kind: EntityRefKind;
    refType: string;
    id: string;
    parentId?: string;
    filePath?: string;
    url?: string;
    suggestedCommand?: string;
    fallbackCommand: string;
    record?: unknown;
}
/**
 * Resolve one `[label](type:id[:path])` entity reference.
 *
 * `loadContext` is lazy on purpose: external markers and local convention
 * paths resolve without any project configuration or network access.
 */
export declare function executeResolveCommand(options: Record<string, unknown>, loadContext: () => Promise<ResolveApiContext>): Promise<ResolveResult>;
//# sourceMappingURL=resolve.d.ts.map